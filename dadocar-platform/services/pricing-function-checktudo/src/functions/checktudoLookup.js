// ─────────────────────────────────────────────────────────────────────────────
// checktudoLookup.js — HTTP triggers for the CheckTudo vehicle-data function.
//
// Routes (after the configured `routePrefix: "api"` in host.json):
//   GET /api/checktudo/plate/{plate}?product=<querycode>
//   GET /api/checktudo/vin/{vin}?product=<querycode>
//   GET /api/products   — selectable querycodes + display names + default
//   GET /api/health     — liveness; leaks nothing about credentials
//
// `product` is the CheckTudo querycode (default 66 = Veículo Total) and is
// validated against the provider's allow-list. The lookup routes run the async
// order→poll flow and return a unified envelope:
//
//   { ok: true,  product: { code, name }, queryId, data, latency_ms,
//     cached_upstream?, poll_attempts?, refClass?, raw }
//   { ok: false, product: { code, name }, error, message, upstream_status,
//     latency_ms }
//
// Input-validation failures return HTTP 400. Every other outcome (including
// upstream errors) returns HTTP 200 with `ok:false` so the caller inspects the
// envelope — same failure-isolation convention as the KBB pricing function.
//
// Auth: authLevel "function" — caller supplies the function key as `?code=...`
// or the `x-functions-key` header.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { app } = require("@azure/functions");
const checktudo = require("../providers/checktudo");
const { PLATE_RE, VIN_RE, normalizePlate, normalizeVin } = require("../lib/validation");

/** Resolve & validate the ?product= querycode. Returns { code } or { error }. */
function resolveProduct(request) {
  const raw = request.query.get("product");
  const code = raw ? Number(raw) : checktudo.DEFAULT_PRODUCT;
  if (!Number.isInteger(code) || !checktudo.isValidProduct(code)) {
    return { error: true, code };
  }
  return { code };
}

function productInvalidBody(code) {
  return {
    status: 400,
    jsonBody: {
      error: "invalid_product",
      message: `Produto (querycode) inválido: ${code}. Use /api/products para a lista.`,
      products: checktudo.PRODUCTS,
    },
  };
}

/** Shape a provider result into the public envelope. */
function envelope(code, result) {
  const product = { code, name: checktudo.productName(code) };
  if (result.ok) {
    return {
      status: 200,
      jsonBody: {
        ok: true,
        product,
        queryId: result.queryId ?? null,
        refClass: result.refClass ?? null,
        data: result.data,
        latency_ms: result.latency_ms ?? null,
        cached_upstream: Boolean(result.cached_upstream),
        poll_attempts: result.poll_attempts ?? null,
      },
    };
  }
  return {
    status: 200,
    jsonBody: {
      ok: false,
      product,
      error: result.error || "upstream_failure",
      message: result.message || "Consulta CheckTudo falhou.",
      upstream_status: result.upstream_status ?? null,
      latency_ms: result.latency_ms ?? null,
    },
  };
}

async function plateHandler(request, context) {
  const placa = normalizePlate(request.params.plate);
  if (!PLATE_RE.test(placa)) {
    return {
      status: 400,
      jsonBody: {
        error: "invalid_plate",
        message: "Placa fora dos formatos antigo (ABC1234) ou Mercosul (ABC1D23).",
      },
    };
  }
  const p = resolveProduct(request);
  if (p.error) return productInvalidBody(p.code);

  const t0 = Date.now();
  try {
    const result = await checktudo.lookupByPlate(placa, p.code);
    context.log(
      `checktudo plate q=${placa.slice(0, 3)}*** product=${p.code} ok=${result.ok} ` +
      `upstream=${result.upstream_status ?? "-"} latency_ms=${Date.now() - t0}`,
    );
    return envelope(p.code, result);
  } catch (err) {
    context.error("checktudo plate lookup unexpected error", err);
    return { status: 500, jsonBody: { error: "internal", message: err.message } };
  }
}

async function vinHandler(request, context) {
  const vin = normalizeVin(request.params.vin);
  if (!VIN_RE.test(vin)) {
    return {
      status: 400,
      jsonBody: {
        error: "invalid_vin",
        message: "Chassi deve ter 17 caracteres alfanuméricos (sem I, O ou Q).",
      },
    };
  }
  const p = resolveProduct(request);
  if (p.error) return productInvalidBody(p.code);

  const t0 = Date.now();
  try {
    const result = await checktudo.lookupByVin(vin, p.code);
    const masked = `${vin.slice(0, 3)}***${vin.slice(-5)}`;
    context.log(
      `checktudo vin q=${masked} product=${p.code} ok=${result.ok} ` +
      `upstream=${result.upstream_status ?? "-"} latency_ms=${Date.now() - t0}`,
    );
    return envelope(p.code, result);
  } catch (err) {
    context.error("checktudo vin lookup unexpected error", err);
    return { status: 500, jsonBody: { error: "internal", message: err.message } };
  }
}

async function productsHandler() {
  const ready = await checktudo.isReady();
  return {
    status: 200,
    jsonBody: {
      default: checktudo.DEFAULT_PRODUCT,
      ready,
      products: Object.entries(checktudo.PRODUCTS).map(([code, name]) => ({
        code: Number(code),
        name,
      })),
    },
  };
}

function healthHandler() {
  return { status: 200, jsonBody: { ok: true, service: "pricing-function-checktudo" } };
}

// ───────────────────────────────────────────────────────────────────────────
app.http("checktudoByPlate", {
  route:     "checktudo/plate/{plate}",
  methods:   ["GET"],
  authLevel: "function",
  handler:   plateHandler,
});

app.http("checktudoByVin", {
  route:     "checktudo/vin/{vin}",
  methods:   ["GET"],
  authLevel: "function",
  handler:   vinHandler,
});

app.http("products", {
  route:     "products",
  methods:   ["GET"],
  authLevel: "function",
  handler:   productsHandler,
});

app.http("health", {
  route:     "health",
  methods:   ["GET"],
  authLevel: "anonymous",
  handler:   healthHandler,
});
