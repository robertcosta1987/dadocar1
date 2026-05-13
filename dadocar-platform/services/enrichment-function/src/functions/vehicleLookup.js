// ─────────────────────────────────────────────────────────────────────────────
// vehicleLookup.js — HTTP triggers for the vehicle aggregator.
//
// Routes (after the configured `routePrefix: "api"` in host.json):
//   GET  /api/vehicle/plate/{plate}         — looks up a plate via every
//                                              ready provider in parallel.
//   GET  /api/vehicle/chassi/{chassi}       — same, by VIN.
//   GET  /api/providers                     — lists providers + readiness.
//
// Query string options for the two lookup routes:
//   ?sources=infocar,denatran,…   — comma-separated subset; default = "all
//                                    ready providers". Unknown ids are
//                                    silently dropped (the response notes
//                                    which sources actually ran).
//   ?fresh=1                      — bypass the Cosmos `vehicles` cache and
//                                    force a fresh provider fan-out. The
//                                    fresh response is still cached on
//                                    success so the next call benefits.
//
// Cache (plate mode only today):
//   - Read: Cosmos `vehicles` container, PK = plate. Hit → response is
//     returned immediately with `cached: true` + `cached_at`. Miss →
//     normal provider fan-out.
//   - Write: on a successful fan-out, fire-and-forget upsert.
//   - VIN mode skips the cache for now (planned: `vehicle_index` lookup
//     resolves VIN → plate, then read `vehicles`).
//
// Auth: authLevel "function". Caller supplies the function key as
// `?code=...` or the `x-functions-key` header. APIM will eventually
// replace this with a subscription-key dance; until then the function
// key is the gate.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { app } = require("@azure/functions");
const providers = require("../providers");
const { PLATE_RE, VIN_RE, normalizePlate, normalizeVin } = require("../lib/validation");
const cache = require("../lib/cache");

/**
 * Shared lookup handler used by both the plate and the chassi routes.
 */
async function handleLookup(request, context, mode /* "plate" | "vin" */) {
  const raw = mode === "plate"
    ? normalizePlate(request.params.plate)
    : normalizeVin(request.params.chassi);

  const re = mode === "plate" ? PLATE_RE : VIN_RE;
  if (!re.test(raw)) {
    return {
      status: 400,
      jsonBody: {
        error:   mode === "plate" ? "invalid_plate" : "invalid_chassi",
        message: mode === "plate"
          ? "Placa fora dos formatos antigo (ABC1234) ou Mercosul (ABC1D23)."
          : "Chassi deve ter 17 caracteres alfanuméricos (sem I, O ou Q).",
      },
    };
  }

  const fresh = request.query.get("fresh") === "1";

  // Cache-aside read. Plate mode only for now; VIN mode goes straight
  // to providers until the vehicle_index lookup is wired.
  if (mode === "plate" && !fresh) {
    const hit = await cache.getCachedByPlate(raw);
    if (hit) {
      context.log(`vehicle plate q=${raw.slice(0, 3)}*** cache=HIT cached_at=${hit.fetched_at}`);
      return {
        status: 200,
        jsonBody: {
          ...hit.payload,
          cached:    true,
          cached_at: hit.fetched_at,
        },
      };
    }
  }

  // Resolve the source subset. Empty / missing means "all ready providers".
  const requestedRaw = (request.query.get("sources") || "").trim();
  const requestedIds = requestedRaw ? requestedRaw.split(",").map(s => s.trim()).filter(Boolean) : null;
  const unknownIds   = requestedIds ? requestedIds.filter(id => !providers.byId(id)) : [];
  const candidates   = requestedIds
    ? requestedIds.map(id => providers.byId(id)).filter(Boolean)
    : providers.all();

  // Only call providers whose credentials are actually present in Key Vault.
  const readiness = await Promise.all(candidates.map(p => p.isReady().catch(() => false)));
  const ready     = candidates.filter((_, i) => readiness[i]);
  const skipped   = candidates.filter((_, i) => !readiness[i]).map(p => p.id);

  if (ready.length === 0) {
    return {
      status: 503,
      jsonBody: {
        error:   "no_provider_ready",
        message: "Nenhum provedor está com credenciais configuradas para esta consulta.",
        skipped_providers: skipped,
        unknown_sources:   unknownIds,
      },
    };
  }

  // Fan out in parallel. Promise.allSettled so one slow / failing vendor
  // never poisons the whole report.
  const results = await Promise.allSettled(
    ready.map(p => mode === "plate" ? p.lookupByPlate(raw) : p.lookupByVin(raw)),
  );

  const sources = results.map((r, i) => {
    const provider = ready[i];
    if (r.status === "rejected") {
      return {
        id:               provider.id,
        display_name:     provider.displayName,
        ok:               false,
        error:            "provider_threw",
        message:          String(r.reason && r.reason.message || r.reason),
        upstream_status:  null,
        latency_ms:       null,
        data:             null,
      };
    }
    const v = r.value || {};
    return {
      id:               provider.id,
      display_name:     provider.displayName,
      ok:               Boolean(v.ok),
      error:            v.error ?? null,
      message:          v.message ?? null,
      upstream_status:  v.upstream_status ?? null,
      latency_ms:       v.latency_ms ?? null,
      data:             v.data ?? null,
    };
  });

  const okCount = sources.filter(s => s.ok).length;
  context.log(`vehicle ${mode} q=${raw.slice(0, 3)}*** ran=${ready.length} ok=${okCount} cache=MISS`);

  const responseBody = {
    query:               { kind: mode, value: raw },
    generated_at:        new Date().toISOString(),
    ran_providers:       ready.map(p => p.id),
    skipped_providers:   skipped,
    unknown_sources:     unknownIds,
    sources,
    cached:              false,
  };

  // Fire-and-forget cache write. Only on a successful plate fan-out — we
  // don't want to cache "all providers failed" responses (next call should
  // retry). VIN mode doesn't write yet.
  if (mode === "plate" && okCount > 0) {
    cache.setCachedByPlate(raw, responseBody).catch((err) =>
      context.log(`[cache] write threw outside fail-open: ${err && err.message}`),
    );
  }

  return { status: 200, jsonBody: responseBody };
}

app.http("vehicleLookupPlate", {
  methods:    ["GET"],
  authLevel:  "function",
  route:      "vehicle/plate/{plate}",
  handler:    (req, ctx) => handleLookup(req, ctx, "plate"),
});

app.http("vehicleLookupChassi", {
  methods:    ["GET"],
  authLevel:  "function",
  route:      "vehicle/chassi/{chassi}",
  handler:    (req, ctx) => handleLookup(req, ctx, "vin"),
});

app.http("listProviders", {
  methods:    ["GET"],
  authLevel:  "function",
  route:      "providers",
  handler:    async (_req, _ctx) => {
    const list = providers.all();
    const ready = await Promise.all(list.map(p => p.isReady().catch(() => false)));
    return {
      status: 200,
      jsonBody: {
        providers: list.map((p, i) => ({
          id:           p.id,
          display_name: p.displayName,
          ready:        ready[i],
        })),
      },
    };
  },
});

// Anonymous health probe — handy for APIM upstream-health checks. No data
// leak: returns only liveness, not provider readiness or secret state.
app.http("healthz", {
  methods:    ["GET"],
  authLevel:  "anonymous",
  route:      "healthz",
  handler:    async () => ({ status: 200, jsonBody: { ok: true, ts: new Date().toISOString() } }),
});
