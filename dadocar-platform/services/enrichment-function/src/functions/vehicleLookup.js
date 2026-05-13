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

  context.log(`vehicle ${mode} q=${raw.slice(0, 3)}*** ran=${ready.length} ok=${sources.filter(s => s.ok).length}`);

  return {
    status: 200,
    jsonBody: {
      query:               { kind: mode, value: raw },
      generated_at:        new Date().toISOString(),
      ran_providers:       ready.map(p => p.id),
      skipped_providers:   skipped,
      unknown_sources:     unknownIds,
      sources,
    },
  };
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
