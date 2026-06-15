// ─────────────────────────────────────────────────────────────────────────────
// providers/checktudo.js — CheckTudo vehicle-data integration.
//
// We use CheckTudo's SYNCHRONOUS query endpoint for ALL products: a single
// POST returns the completed result inline (no order + poll). Verified live to
// be markedly faster than the old async order→poll flow.
//
// Auth + flow (verified live against api.checktudo.com.br):
//
//   1. POST /auth/login { username, password }
//      → body.token          (JWT, ~24h — the raw `Authorization` value, no Bearer)
//      → body.user._id       (the integration account id used in the query path)
//
//   2. POST /api/vehicle/{userId}
//        headers: { Authorization: <token>, + browser headers (Cloudflare) }
//        body:    { querycode: <int>, keys: { placa | chassi | ... } }
//      → { status: { cod }, body: { headerInfos: { queryid, isAsyncQuery },
//          data: {…}, billing, error } }
//      `cod` 200 = full data; 206 = partial (ran, but some/all services had no
//      records — data still returned). The result is returned INLINE.
//
// Async fallback: if the vendor ever flags a product as async (isAsyncQuery:true
// with no inline data), we fall back to polling GET /api/query/json-response/
// {queryId}. In practice the sync endpoint returns data directly for every
// product we offer.
//
// Browser headers (User-Agent + Origin + Referer) are sent on every request:
// CheckTudo sits behind Cloudflare, which can 1010-block non-browser signatures.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { getSecrets } = require("../lib/secrets");

const AUTH_BASE     = "https://api.checktudo.com.br";
const API_BASE      = "https://api.checktudo.com.br/api";
const FETCH_TIMEOUT = 20 * 1000;

// The synchronous /api/vehicle call waits for the full result server-side. This
// function app severs synchronous HTTP at ~60s, so we time the vendor call out a
// little under that. Real calls return in a few seconds; this is just a ceiling.
const VEHICLE_TIMEOUT_MS = 55 * 1000;

// Polling knobs for the rare async-fallback path (kept for slow/async products).
const POLL_BUDGET_MS   = 45 * 1000;
const POLL_INTERVAL_MS = 1500;

// Browser-like headers so Cloudflare doesn't 1010-block the request signature.
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Origin: "https://app.checktudo.com.br",
  Referer: "https://app.checktudo.com.br/",
};

/** Standard JSON headers for an authenticated query call. */
function authHeaders(token) {
  return { "Content-Type": "application/json", Accept: "application/json", Authorization: token, ...BROWSER_HEADERS };
}

const SECRET_NAMES = ["checktudo-username", "checktudo-password"];

// Selectable vehicle products (querycode → display name). Exposed to the
// webclient via the function's /api/products route and validated on lookup.
const PRODUCTS = {
  // Combos / pre-existing (names kept as-is)
  65:  "Total Plus",
  66:  "Veículo Total",
  67:  "Veículo Essencial",
  13:  "Decodificador e Precificador",
  71:  "Dados Cadastrais do Veículo",
  76:  "Decodificador + Histórico FIPE",
  241: "Decodificador V.4",
  // Full CheckTudo catalog (price sheet 2026) — mirrors the commercial catalog.
  1:    "Agregados v.2",
  2:    "Histórico KM",
  3:    "Base Nacional",
  4:    "Base Estadual",
  5:    "Renajud Detalhe",
  11:   "Roubo e Furto",
  14:   "Recall",
  16:   "Leilão",
  19:   "Farol",
  22:   "Histórico de Veículos",
  34:   "Gravame",
  39:   "Multas Renainf",
  61:   "Acessórios",
  68:   "Leilão Completo",
  69:   "Leilão Sintético",
  70:   "Gravame Completo",
  77:   "Histórico de Proprietários",
  80:   "CNH Nacional",
  105:  "Consulta ECV",
  123:  "Leilão Premium",
  175:  "ECV Premium",
  181:  "Agregados Renavam",
  187:  "Débitos e Multas",
  189:  "Completa Lojista",
  191:  "Leilão Plus",
  202:  "Decodificador e Precificador v.2",
  206:  "Consulta CSV",
  207:  "Proprietário Atual",
  209:  "Agregados Renavam v.2",
  210:  "Indício de Sinistro",
  213:  "Base Nacional - Motor",
  244:  "Detalhe Comunicação de Venda",
  250:  "Ficha Técnica Especial",
  316:  "Radar Securitário",
  404:  "Localizador de Agregados",
  500:  "Informações de Parceiros (Anúncios)",
  1190: "Comparativo e especificações",
  1245: "Cesta Básica",
  1830: "Ficha Técnica",
  1840: "Custo médio de manutenção",
  2033: "ECV Elite",
  2070: "Proprietário Atual 2",
  2090: "Dados Básicos do Veículo",
  2200: "Revisão",
  5888: "Base Nacional Unificada",
};
const DEFAULT_PRODUCT = 66;

function isValidProduct(code) {
  return Object.prototype.hasOwnProperty.call(PRODUCTS, Number(code));
}
function productName(code) {
  return PRODUCTS[Number(code)] || `Consulta ${code}`;
}

// In-process auth cache: the JWT (~24h) and the integration account id (userId)
// that the /api/vehicle/{userId} path needs. We refresh a little early and also
// re-login on any 401 from the query endpoints.
let _token   = null;
let _userId  = null;
let _tokenAt = 0;
const TOKEN_TTL = 23 * 60 * 60 * 1000; // 23h

async function loadCreds() {
  const s = await getSecrets(SECRET_NAMES);
  return {
    username: s["checktudo-username"] || "",
    password: s["checktudo-password"] || "",
  };
}

async function isReady() {
  try {
    const c = await loadCreds();
    return Boolean(c.username && c.password);
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

async function login() {
  const c = await loadCreds();
  if (!c.username || !c.password) {
    const err = new Error("CheckTudo credentials missing in Key Vault");
    err.upstreamStatus = null;
    throw err;
  }
  const res = await fetchWithTimeout(`${AUTH_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...BROWSER_HEADERS },
    body: JSON.stringify({ username: c.username, password: c.password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err  = new Error(`CheckTudo /auth/login HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.upstreamStatus = res.status;
    throw err;
  }
  const json = await res.json();
  const tok  = json?.body?.token;
  const uid  = json?.body?.user?._id;
  if (!tok) throw new Error("CheckTudo /auth/login returned no token field");
  if (!uid) throw new Error("CheckTudo /auth/login returned no user._id field");
  _token   = tok;
  _userId  = uid;
  _tokenAt = Date.now();
  return { token: tok, userId: uid };
}

/** Cached { token, userId }; re-logs in when forced or the cache is stale. */
async function getAuth({ force = false } = {}) {
  if (!force && _token && _userId && Date.now() - _tokenAt < TOKEN_TTL) {
    return { token: _token, userId: _userId };
  }
  return login();
}

// CheckTudo wraps every response in { status: { cod, msg }, body }. Pull out a
// human message from either a string `body` or `status.msg`.
function vendorMessage(json, fallback) {
  if (!json) return fallback;
  if (typeof json.body === "string") return json.body;
  if (json.status && json.status.msg) return json.status.msg;
  return fallback;
}

/**
 * Run a query synchronously via POST /api/vehicle/{userId}. Returns the result
 * INLINE — no order/poll. `cod` 200 = full data, 206 = partial (ran but some
 * services had no records; data still present). On a vendor-flagged async product
 * (isAsyncQuery + no inline data) we return the queryId so the caller can poll.
 */
async function vehicleQuery(userId, querycode, keys, token) {
  const res = await fetchWithTimeout(
    `${API_BASE}/vehicle/${encodeURIComponent(userId)}`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ querycode: Number(querycode), keys }),
    },
    VEHICLE_TIMEOUT_MS,
  );
  const json = await res.json().catch(() => ({}));
  const cod  = json?.status?.cod;
  const body = json?.body || {};

  // Treat any 2xx vendor code (200 ok, 206 partial) over a 2xx HTTP status as
  // success. Everything else (401 stale token, 404 not found, 4xx/5xx) is an error.
  const codOk = typeof cod === "number" ? cod >= 200 && cod < 300 : res.ok;
  if (!res.ok || !codOk) {
    return { ok: false, status: cod || res.status, message: vendorMessage(json, `CheckTudo vehicle HTTP ${res.status}`), json };
  }

  const header  = body.headerInfos || {};
  const queryId = header.queryid || header.queryId || body._id || null;
  let   data    = body.data || body.responseJSON || null;
  // An empty object is "no inline data" — the vendor returns cod 206 with no
  // inline payload when it dedups a recently-run plate+product (anti re-bill).
  if (data && typeof data === "object" && Object.keys(data).length === 0) data = null;

  // A vendor-side error string with no data → surface as a failure.
  if (!data && body.error) {
    return { ok: false, status: cod || res.status, message: String(body.error), json };
  }
  // No inline data but we have the queryId (deduped 206, or an async product) →
  // recover the canonical result via GET json-response/{queryId} (no re-bill).
  if (!data && queryId) {
    return { ok: true, recoverById: true, status: cod || res.status, queryId, json };
  }
  // Inline synchronous result (the fast first-query path; may be partial @206).
  if (data) {
    return { ok: true, status: cod || res.status, queryId, data, json };
  }
  return { ok: false, status: cod || res.status, message: vendorMessage(json, "CheckTudo returned no data"), json };
}

async function fetchResult(queryId, token) {
  const res = await fetchWithTimeout(
    `${API_BASE}/query/json-response/${encodeURIComponent(queryId)}`,
    { method: "GET", headers: { Authorization: token, Accept: "application/json", ...BROWSER_HEADERS } },
  );
  // A 404 while the query is still processing is normal — treat as pending.
  if (res.status === 404) return { ok: false, status: 404, pending: true };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, message: vendorMessage(json, `CheckTudo result HTTP ${res.status}`), json };
  }
  const body = json?.body || {};
  const data = body.responseJSON || body.data || null;
  if (data) return { ok: true, status: res.status, refClass: body.refClass || null, data, json };
  // 200 but no payload yet → still processing.
  return { ok: false, status: res.status, pending: true, json };
}

async function pollUntilReady(queryId, token, budgetMs = POLL_BUDGET_MS) {
  const start = Date.now();
  let attempts = 0;
  let last = null;
  while (Date.now() - start < budgetMs) {
    attempts++;
    last = await fetchResult(queryId, token);
    if (last.ok) return { ...last, attempts };
    if (!last.pending) return { ...last, attempts };
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { ok: false, status: 504, pending: true, attempts, message: "Polling budget exhausted", ...(last || {}) };
}

/**
 * Run a CheckTudo query end-to-end synchronously (login → vehicle query).
 * Falls back to polling only for vendor-flagged async products.
 * @param {number} querycode
 * @param {object} keys  e.g. { placa } or { chassi }
 */
async function runQuery(querycode, keys) {
  const t0 = Date.now();

  let token, userId;
  try {
    ({ token, userId } = await getAuth());
  } catch (err) {
    return {
      ok: false,
      error: "auth_failed",
      message: err.message,
      upstream_status: err.upstreamStatus ?? null,
      latency_ms: Date.now() - t0,
    };
  }

  let resp = await vehicleQuery(userId, querycode, keys, token);

  // Stale token → re-login once and retry.
  if (!resp.ok && resp.status === 401) {
    try { ({ token, userId } = await getAuth({ force: true })); }
    catch (err) {
      return { ok: false, error: "auth_failed", message: err.message, upstream_status: 401, latency_ms: Date.now() - t0 };
    }
    resp = await vehicleQuery(userId, querycode, keys, token);
  }

  if (!resp.ok) {
    return {
      ok: false,
      error: `vehicle_${resp.status}`,
      message: typeof resp.message === "string" ? resp.message : "CheckTudo vehicle query failed",
      upstream_status: resp.status,
      latency_ms: Date.now() - t0,
    };
  }

  // No inline data (deduped 206 or async product) → recover the canonical
  // result via json-response by queryId. Not billed; usually returns at once.
  if (resp.recoverById) {
    const result = await pollUntilReady(resp.queryId, token);
    if (!result.ok) {
      return {
        ok: false,
        error: result.pending ? "poll_timeout" : `result_${result.status}`,
        message: result.message || "CheckTudo result fetch failed",
        upstream_status: result.status,
        queryId: resp.queryId,
        latency_ms: Date.now() - t0,
      };
    }
    return {
      ok: true,
      data: result.data,
      refClass: result.refClass,
      queryId: resp.queryId,
      upstream_status: result.status,
      latency_ms: Date.now() - t0,
      poll_attempts: result.attempts,
    };
  }

  // Synchronous result (the common path).
  return {
    ok: true,
    data: resp.data,
    queryId: resp.queryId,
    upstream_status: resp.status,
    latency_ms: Date.now() - t0,
  };
}

async function lookupByPlate(plate, querycode = DEFAULT_PRODUCT) {
  return runQuery(querycode, { placa: plate });
}

async function lookupByVin(vin, querycode = DEFAULT_PRODUCT) {
  return runQuery(querycode, { chassi: vin });
}

/**
 * Poll an EXISTING order by queryId — never submits a new order, so it is never
 * billed. Used by the webclient to resume a query that returned poll_timeout,
 * avoiding the re-charge that re-submitting would cause (the vendor's 206 dedup
 * does NOT cover still-pending orders). Returns the same shape as runQuery.
 */
async function pollResultById(queryId) {
  const t0 = Date.now();
  let token;
  try { ({ token } = await getAuth()); }
  catch (err) {
    return { ok: false, error: "auth_failed", message: err.message, upstream_status: err.upstreamStatus ?? null, latency_ms: Date.now() - t0 };
  }
  const result = await pollUntilReady(queryId, token);
  if (!result.ok) {
    return {
      ok: false,
      error: result.pending ? "poll_timeout" : `result_${result.status}`,
      message: result.message || "CheckTudo result fetch failed",
      upstream_status: result.status,
      queryId,
      latency_ms: Date.now() - t0,
    };
  }
  return { ok: true, data: result.data, refClass: result.refClass, queryId, upstream_status: result.status, latency_ms: Date.now() - t0, poll_attempts: result.attempts };
}

module.exports = {
  id:          "checktudo",
  displayName: "CheckTudo · Dados Veiculares",
  PRODUCTS,
  DEFAULT_PRODUCT,
  isValidProduct,
  productName,
  isReady,
  lookupByPlate,
  lookupByVin,
  pollResultById,
};
