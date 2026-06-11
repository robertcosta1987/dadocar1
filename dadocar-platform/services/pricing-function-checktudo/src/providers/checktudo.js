// ─────────────────────────────────────────────────────────────────────────────
// providers/checktudo.js — CheckTudo vehicle-data integration.
//
// CheckTudo's query API is ASYNCHRONOUS: you enqueue an "order" and then either
// receive a webhook callback OR poll for the result. We present a synchronous
// API to the webclient by polling `GET /api/query/json-response/:queryId`
// until the result lands or a time budget runs out.
//
// Auth + flow (verified live against api.checktudo.com.br, see the function
// README and docs/superpowers/specs/2026-06-04-checktudo-integration-design.md):
//
//   1. POST /auth/login { username, password }            → body.token
//      The token is a JWT (~24h). It is the value of the `Authorization`
//      header for EVERY /api/query/* call — raw, no "Bearer " prefix.
//
//   2. POST /api/query/order
//        headers: { Authorization: <token> }
//        body:    { querycode: <int>, keys: { placa | chassi | uf | ... },
//                   duplicity: false }
//      → body { orderId, queryId, status: "enqueued", createdAt }
//      (`duplicity:false` reuses a recently-run document → avoids re-billing.)
//
//   3. GET /api/query/json-response/:queryId
//        headers: { Authorization: <token> }
//      → body { _id, refClass, responseJSON: {…} } once the query completes;
//        a pending body / 404 while it is still processing.
//
// NOTE: the `generate-api-key` step from the printed manual belongs to the
// SYNCHRONOUS /api/vehicle/:userid path and is NOT used here. Proven: the order
// endpoint returns 410 "Consulta inválida" (auth OK) with the login token, and
// 401 "Token de navegação inválido" with the apiKey.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { getSecrets } = require("../lib/secrets");

const AUTH_BASE     = "https://api.checktudo.com.br";
const API_BASE      = "https://api.checktudo.com.br/api";
const FETCH_TIMEOUT = 20 * 1000;

// Total time we will wait for a CheckTudo result to materialise via polling.
// Veículo Total observed at ~27s, so 28s was too tight; 55s stays well within
// the Azure load-balancer's 230s sync HTTP limit while keeping the page snappy.
const POLL_BUDGET_MS   = 55 * 1000;
const POLL_INTERVAL_MS = 1500;

const SECRET_NAMES = ["checktudo-username", "checktudo-password"];

// Selectable vehicle products (querycode → display name). Exposed to the
// webclient via the function's /api/products route and validated on lookup.
const PRODUCTS = {
  65:  "Veículo Total +",
  66:  "Veículo Total",
  67:  "Veículo Essencial",
  13:  "Decodificador e Precificador",
  71:  "Dados Cadastrais do Veículo",
  76:  "Decodificador + Histórico FIPE",
  241: "Decodificador V.4",
};
const DEFAULT_PRODUCT = 66;

function isValidProduct(code) {
  return Object.prototype.hasOwnProperty.call(PRODUCTS, Number(code));
}
function productName(code) {
  return PRODUCTS[Number(code)] || `Consulta ${code}`;
}

// In-process navigation-token cache. The JWT lives ~24h; we refresh a little
// early and also re-login on any 401 from the query endpoints.
let _token   = null;
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
    headers: { "Content-Type": "application/json", Accept: "application/json" },
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
  if (!tok) throw new Error("CheckTudo /auth/login returned no token field");
  _token   = tok;
  _tokenAt = Date.now();
  return tok;
}

async function getToken({ force = false } = {}) {
  if (!force && _token && Date.now() - _tokenAt < TOKEN_TTL) return _token;
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

async function submitOrder(querycode, keys, token) {
  const res = await fetchWithTimeout(`${API_BASE}/query/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token, Accept: "application/json" },
    body: JSON.stringify({ querycode: Number(querycode), keys, duplicity: false }),
  });
  const json = await res.json().catch(() => ({}));
  // 206 "Consulta executada recentemente" — with duplicity:false the vendor
  // refuses to re-run (and re-bill) a recently-queried document. We don't want
  // to pay for a duplicate, so signal the caller to fetch the EXISTING result.
  if (res.status === 206 || json?.status?.cod === 206) {
    return { ok: false, duplicate: true, status: 206, message: vendorMessage(json, "Consulta executada recentemente") };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: vendorMessage(json, `CheckTudo order HTTP ${res.status}`),
      json,
    };
  }
  const body = json?.body || {};
  // Some products may return the completed payload inline; most enqueue.
  if (body.responseJSON || body.data) {
    return { ok: true, completed: true, status: res.status, queryId: body.queryId || body._id, body, json };
  }
  if (body.queryId) {
    return { ok: true, completed: false, status: res.status, queryId: body.queryId, orderId: body.orderId, json };
  }
  return { ok: false, status: res.status, message: "Unexpected CheckTudo order response shape", json };
}

/**
 * Find the most recent existing query for a document key (placa/chassi) that
 * matches the requested querycode — used to recover the result on a 206
 * "executada recentemente" without re-billing. Returns a queryId or null.
 */
async function findExistingQueryId(key, querycode, token) {
  if (!key) return null;
  const res = await fetchWithTimeout(
    `${API_BASE}/query/document/${encodeURIComponent(key)}`,
    { method: "GET", headers: { Authorization: token, Accept: "application/json" } },
  );
  if (!res.ok) return null;
  const json = await res.json().catch(() => ({}));
  const list = Array.isArray(json?.body) ? json.body : [];
  const matches = list
    .filter((q) => Number(q.queryCode) === Number(querycode))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const best = matches.find((q) => q.status === true) || matches[0];
  return best ? best.queryId : null;
}

async function fetchResult(queryId, token) {
  const res = await fetchWithTimeout(
    `${API_BASE}/query/json-response/${encodeURIComponent(queryId)}`,
    { method: "GET", headers: { Authorization: token, Accept: "application/json" } },
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
 * Run a CheckTudo query end-to-end (login → order → poll).
 * @param {number} querycode
 * @param {object} keys  e.g. { placa } or { chassi }
 */
async function runQuery(querycode, keys) {
  const t0 = Date.now();

  let token;
  try {
    token = await getToken();
  } catch (err) {
    return {
      ok: false,
      error: "auth_failed",
      message: err.message,
      upstream_status: err.upstreamStatus ?? null,
      latency_ms: Date.now() - t0,
    };
  }

  let order = await submitOrder(querycode, keys, token);

  // Stale token → re-login once and retry the order.
  if (!order.ok && order.status === 401) {
    try { token = await getToken({ force: true }); }
    catch (err) {
      return { ok: false, error: "auth_failed", message: err.message, upstream_status: 401, latency_ms: Date.now() - t0 };
    }
    order = await submitOrder(querycode, keys, token);
  }

  // 206 duplicate → recover the existing result instead of paying for a re-run.
  if (!order.ok && order.duplicate) {
    const key = keys.placa || keys.chassi || keys.renavam || keys.motor || null;
    const existingId = await findExistingQueryId(key, querycode, token);
    if (existingId) {
      const result = await pollUntilReady(existingId, token);
      if (result.ok) {
        return {
          ok: true,
          data: result.data,
          refClass: result.refClass,
          queryId: existingId,
          upstream_status: 200,
          latency_ms: Date.now() - t0,
          cached_upstream: true,
          reused_upstream: true,
        };
      }
      return {
        ok: false,
        error: result.pending ? "poll_timeout" : `result_${result.status}`,
        message: result.message || "Falha ao recuperar a consulta existente.",
        upstream_status: result.status,
        queryId: existingId,
        latency_ms: Date.now() - t0,
      };
    }
    return {
      ok: false,
      error: "duplicate_no_result",
      message: order.message || "Consulta executada recentemente, sem resultado recuperável.",
      upstream_status: 206,
      latency_ms: Date.now() - t0,
    };
  }

  if (!order.ok) {
    return {
      ok: false,
      error: `order_${order.status}`,
      message: typeof order.message === "string" ? order.message : "CheckTudo order failed",
      upstream_status: order.status,
      latency_ms: Date.now() - t0,
    };
  }

  if (order.completed) {
    const data = order.body.responseJSON || order.body.data || order.body;
    return {
      ok: true,
      data,
      queryId: order.queryId,
      upstream_status: order.status,
      latency_ms: Date.now() - t0,
      cached_upstream: true,
    };
  }

  const result = await pollUntilReady(order.queryId, token);
  if (!result.ok) {
    return {
      ok: false,
      error: result.pending ? "poll_timeout" : `result_${result.status}`,
      message: result.message || "CheckTudo result fetch failed",
      upstream_status: result.status,
      queryId: order.queryId,
      latency_ms: Date.now() - t0,
    };
  }

  return {
    ok: true,
    data: result.data,
    refClass: result.refClass,
    queryId: order.queryId,
    upstream_status: result.status,
    latency_ms: Date.now() - t0,
    poll_attempts: result.attempts,
  };
}

async function lookupByPlate(plate, querycode = DEFAULT_PRODUCT) {
  return runQuery(querycode, { placa: plate });
}

async function lookupByVin(vin, querycode = DEFAULT_PRODUCT) {
  return runQuery(querycode, { chassi: vin });
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
};
