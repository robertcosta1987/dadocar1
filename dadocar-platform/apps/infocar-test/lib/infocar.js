// ─────────────────────────────────────────────────────────────────────────────
// lib/infocar.js
// Shared Infocar API logic. Used by both the local Express proxy
// (server/proxy.js) and the Vercel serverless functions (api/*).
//
// - Token cache is module-level: warm Vercel invocations reuse the token,
//   cold starts refetch (no shared state across regions/instances, which is
//   fine — the token endpoint is idempotent and cheap).
// - Reads credentials from process.env on each call so a redeploy /
//   env-var change takes effect without restart.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const INFOCAR_BASE         = "https://api.datacast3.com";
const TOKEN_TTL_MS         = 8 * 60 * 60 * 1000;
const TOKEN_REFRESH_MARGIN = 15 * 60 * 1000;        // refresh 15 min early
const FETCH_TIMEOUT_MS     = 20 * 1000;

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function creds() {
  return {
    idKey:    process.env.INFOCAR_ID_KEY    || "",
    username: process.env.INFOCAR_USERNAME  || "",
    password: process.env.INFOCAR_PASSWORD  || "",
  };
}

function credentialsAreSet() {
  const c = creds();
  return Boolean(c.idKey && c.username && c.password);
}

function maskTail(s, keep = 3) {
  if (!s) return "—";
  return s.length <= keep ? "***" : `${s.slice(0, keep)}***`;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function getInfocarToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt - TOKEN_REFRESH_MARGIN) {
    return cachedToken;
  }
  const c = creds();
  const chave = Buffer.from(`${c.username}:${c.password}`).toString("base64");
  const res = await fetchWithTimeout(`${INFOCAR_BASE}/api/Token/GerarToken`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "infocar-id-Key": c.idKey },
    body:    JSON.stringify({ chave }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Infocar GerarToken HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.upstreamStatus = res.status;
    throw err;
  }
  const json = await res.json();
  const token = json?.token || json?.Token || json?.data?.token;
  if (!token) throw new Error("Infocar GerarToken returned no token field");

  cachedToken = token;
  cachedTokenExpiresAt = Date.now() + TOKEN_TTL_MS;
  return cachedToken;
}

/**
 * GET a vehicle lookup from Infocar. Returns
 *   { status, latencyMs, contentType, body }
 * — body is a raw string (Infocar's JSON), forwarded verbatim by the caller.
 */
async function infocarGet(upstreamPath) {
  const t0 = Date.now();
  let token;
  try {
    token = await getInfocarToken();
  } catch (err) {
    return {
      status:      502,
      latencyMs:   Date.now() - t0,
      contentType: "application/json",
      body:        JSON.stringify({ error: "token_fetch_failed", message: err.message }),
    };
  }

  let upstream;
  try {
    upstream = await fetchWithTimeout(`${INFOCAR_BASE}${upstreamPath}`, {
      method:  "GET",
      headers: {
        "infocar-id-Key": creds().idKey,
        Authorization:    `Bearer ${token}`,
        Accept:           "application/json",
      },
    });
  } catch (err) {
    return {
      status:      502,
      latencyMs:   Date.now() - t0,
      contentType: "application/json",
      body:        JSON.stringify({ error: "upstream_unreachable", message: err.message }),
    };
  }
  const body = await upstream.text();
  return {
    status:      upstream.status,
    latencyMs:   Date.now() - t0,
    contentType: upstream.headers.get("content-type") || "application/json",
    body,
  };
}

// Brazilian plate + VIN validators (defence in depth — server validates too).
const PLATE_RE = /^([A-Z]{3}\d{4}|[A-Z]{3}\d[A-Z]\d{2})$/;
const VIN_RE   = /^[A-HJ-NPR-Z0-9]{17}$/;

module.exports = {
  credentialsAreSet,
  getInfocarToken,
  infocarGet,
  maskTail,
  PLATE_RE,
  VIN_RE,
};
