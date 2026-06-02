// ─────────────────────────────────────────────────────────────────────────────
// pricingLookup.js — HTTP triggers for the pricing aggregator.
//
// Routes (after the configured `routePrefix: "api"` in host.json):
//   GET  /api/pricing/plate/{plate}      — looks up a plate via every ready
//                                          pricing provider in parallel and
//                                          returns a unified shape.
//   GET  /api/pricing/vin/{vin}          — same flow but keyed by VIN. Both
//                                          modes are documented in the
//                                          PricingAPI v3.0.6 spec.
//   GET  /api/providers                  — lists providers + readiness.
//   GET  /api/health                     — liveness; deliberately leaks
//                                          nothing about credentials.
//
// Query-string options on the lookup routes:
//   ?sources=molicar,xpprecos            comma-separated subset; default is
//                                        "all ready providers". Unknown ids
//                                        are silently dropped (the response
//                                        lists which sources actually ran).
//
// Auth: authLevel "function". Caller supplies the function key as
// `?code=...` or the `x-functions-key` header. APIM will eventually replace
// this with a subscription-key dance; until then the function key is the
// gate (same convention as enrichment-function).
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { app } = require("@azure/functions");
const providers = require("../providers");
const { PLATE_RE, VIN_RE, normalizePlate, normalizeVin } = require("../lib/validation");

/**
 * Resolve which providers should run for this request. Honors ?sources=
 * if supplied; otherwise returns every provider whose isReady() resolves
 * truthy. Missing creds → silently skipped (and reported in the response).
 */
async function pickProviders(request) {
  const requested = (request.query.get("sources") || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

  const all = providers.all();
  const candidates = requested.length
    ? requested.map((id) => providers.byId(id)).filter(Boolean)
    : all;

  const readyFlags = await Promise.all(candidates.map((p) => p.isReady()));
  const ready    = candidates.filter((_, i) => readyFlags[i]);
  const skipped  = candidates
    .filter((_, i) => !readyFlags[i])
    .map((p) => ({ id: p.id, reason: "missing_credentials" }));

  // ?sources= entries that don't exist at all → reported separately so
  // typos surface to the caller.
  const unknown = requested
    .filter((id) => !providers.byId(id))
    .map((id) => ({ id, reason: "unknown_provider" }));

  return { ready, skipped: [...skipped, ...unknown] };
}

/**
 * Fan out the lookup across the selected providers in parallel. Each
 * provider's response goes into `sources[]` namespaced by id. We never
 * throw upstream errors out of the handler — a failing provider becomes
 * an entry with ok=false.
 *
 * @param {"plate"|"vin"} mode
 * @param {string}        value normalised plate or VIN
 */
async function runLookup(mode, value, request) {
  const { ready, skipped } = await pickProviders(request);

  if (!ready.length) {
    return {
      sources: [],
      ran_providers: [],
      skipped_providers: skipped,
    };
  }

  const sources = await Promise.all(
    ready.map(async (p) => {
      const fn = mode === "vin" ? p.lookupByVin : p.lookupByPlate;
      const result = await fn.call(p, value);
      return {
        id:               p.id,
        ok:               Boolean(result.ok),
        upstream_status:  result.upstream_status ?? null,
        latency_ms:       result.latency_ms ?? null,
        error:            result.error,
        message:          result.message,
        data:             result.data,
      };
    }),
  );

  return {
    sources,
    ran_providers:     ready.map((p) => p.id),
    skipped_providers: skipped,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// HTTP handlers
// ───────────────────────────────────────────────────────────────────────────

async function lookupByPlateHandler(request, context) {
  const raw = normalizePlate(request.params.plate);
  if (!PLATE_RE.test(raw)) {
    return {
      status: 400,
      jsonBody: {
        error:   "invalid_plate",
        message: "Placa fora dos formatos antigo (ABC1234) ou Mercosul (ABC1D23).",
      },
    };
  }

  const t0 = Date.now();
  try {
    const result = await runLookup("plate", raw, request);
    context.log(
      `pricing plate q=${raw.slice(0, 3)}*** ran=${result.ran_providers.join(",") || "-"} ` +
      `skipped=${result.skipped_providers.map((s) => s.id).join(",") || "-"} ` +
      `latency_ms=${Date.now() - t0}`,
    );
    return { status: 200, jsonBody: result };
  } catch (err) {
    context.error("pricing plate lookup unexpected error", err);
    return {
      status: 500,
      jsonBody: { error: "internal", message: err.message },
    };
  }
}

async function lookupByVinHandler(request, context) {
  const raw = normalizeVin(request.params.vin);
  if (!VIN_RE.test(raw)) {
    return {
      status: 400,
      jsonBody: {
        error:   "invalid_vin",
        message: "Chassi deve ter 17 caracteres alfanuméricos (sem I, O ou Q).",
      },
    };
  }

  const t0 = Date.now();
  try {
    const result = await runLookup("vin", raw, request);
    // Mask the middle 9 chars of the VIN in the log line; first 3 (WMI) +
    // last 5 are enough to grep without leaking the full identifier.
    const masked = `${raw.slice(0, 3)}***${raw.slice(-5)}`;
    context.log(
      `pricing vin q=${masked} ran=${result.ran_providers.join(",") || "-"} ` +
      `skipped=${result.skipped_providers.map((s) => s.id).join(",") || "-"} ` +
      `latency_ms=${Date.now() - t0}`,
    );
    return { status: 200, jsonBody: result };
  } catch (err) {
    context.error("pricing vin lookup unexpected error", err);
    return {
      status: 500,
      jsonBody: { error: "internal", message: err.message },
    };
  }
}

async function providersHandler() {
  // Report each provider + whether its credentials are present.
  const all = providers.all();
  const readyFlags = await Promise.all(all.map((p) => p.isReady()));
  return {
    status: 200,
    jsonBody: {
      providers: all.map((p, i) => ({
        id:           p.id,
        displayName:  p.displayName,
        ready:        Boolean(readyFlags[i]),
      })),
    },
  };
}

function healthHandler() {
  // Liveness only — do not surface credential state.
  return { status: 200, jsonBody: { ok: true, service: "pricing-function" } };
}

// ───────────────────────────────────────────────────────────────────────────
// Registrations
// ───────────────────────────────────────────────────────────────────────────

app.http("pricingByPlate", {
  route:      "pricing/plate/{plate}",
  methods:    ["GET"],
  authLevel:  "function",
  handler:    lookupByPlateHandler,
});

app.http("pricingByVin", {
  route:      "pricing/vin/{vin}",
  methods:    ["GET"],
  authLevel:  "function",
  handler:    lookupByVinHandler,
});

app.http("providers", {
  route:      "providers",
  methods:    ["GET"],
  authLevel:  "function",
  handler:    providersHandler,
});

app.http("health", {
  route:      "health",
  methods:    ["GET"],
  authLevel:  "anonymous",
  handler:    healthHandler,
});
