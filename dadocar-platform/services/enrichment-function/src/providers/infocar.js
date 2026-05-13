// ─────────────────────────────────────────────────────────────────────────────
// providers/infocar.js — Infocar Codificação FIPE.
//
// Implements the Provider contract from ./_types.js. Reads credentials from
// Key Vault (secrets: infocar-id-key / infocar-username / infocar-password),
// caches the bearer token in-process for ~7h45m, and forwards Infocar's
// JSON response verbatim under `data`.
//
// Future-proofing: token caching is per-process. Multi-instance Function
// Apps will each fetch their own token — wasteful but not broken. Shared
// cache via Cosmos `secrets` container is a future enhancement.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { getSecrets } = require("../lib/secrets");

const INFOCAR_BASE           = "https://api.datacast3.com";
const TOKEN_TTL_MS           = 8 * 60 * 60 * 1000;
const TOKEN_REFRESH_MARGIN   = 15 * 60 * 1000;       // refresh 15 min early
const FETCH_TIMEOUT_MS       = 20 * 1000;
const SECRET_NAMES = ["infocar-id-key", "infocar-username", "infocar-password"];

let _token = null;
let _tokenExpiresAt = 0;

async function loadCreds() {
  const s = await getSecrets(SECRET_NAMES);
  return {
    idKey:    s["infocar-id-key"]    || "",
    username: s["infocar-username"]  || "",
    password: s["infocar-password"]  || "",
  };
}

async function isReady() {
  try {
    const c = await loadCreds();
    return Boolean(c.idKey && c.username && c.password);
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

async function getToken() {
  const now = Date.now();
  if (_token && now < _tokenExpiresAt - TOKEN_REFRESH_MARGIN) return _token;
  const c = await loadCreds();
  const chave = Buffer.from(`${c.username}:${c.password}`).toString("base64");
  const res = await fetchWithTimeout(`${INFOCAR_BASE}/api/Token/GerarToken`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "infocar-id-Key": c.idKey },
    body:    JSON.stringify({ chave }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err  = new Error(`Infocar GerarToken HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.upstreamStatus = res.status;
    throw err;
  }
  const json = await res.json();
  const tok  = json?.token || json?.Token || json?.data?.token;
  if (!tok) throw new Error("Infocar GerarToken returned no token field");
  _token = tok;
  _tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
  return _token;
}

async function callUpstream(upstreamPath) {
  const t0 = Date.now();
  let token;
  try {
    token = await getToken();
  } catch (err) {
    return {
      ok:               false,
      error:            "token_fetch_failed",
      message:          err.message,
      upstream_status:  err.upstreamStatus ?? null,
      latency_ms:       Date.now() - t0,
    };
  }

  const c = await loadCreds();
  let res;
  try {
    res = await fetchWithTimeout(`${INFOCAR_BASE}${upstreamPath}`, {
      method: "GET",
      headers: {
        "infocar-id-Key": c.idKey,
        Authorization:    `Bearer ${token}`,
        Accept:           "application/json",
      },
    });
  } catch (err) {
    return {
      ok:               false,
      error:            "upstream_unreachable",
      message:          err.message,
      upstream_status:  null,
      latency_ms:       Date.now() - t0,
    };
  }

  const latency_ms = Date.now() - t0;
  let body;
  try { body = await res.json(); }
  catch { body = null; }

  if (!res.ok) {
    return {
      ok:               false,
      error:            `upstream_${res.status}`,
      message:          (body && (body.message || body.error)) || `Infocar HTTP ${res.status}`,
      data:             body,
      upstream_status:  res.status,
      latency_ms,
    };
  }
  return { ok: true, data: body, upstream_status: res.status, latency_ms };
}

async function lookupByPlate(plate) {
  return callUpstream(`/api/v1.0/CodificacaoFipe/placa/${encodeURIComponent(plate)}`);
}

async function lookupByVin(vin) {
  return callUpstream(`/api/v1.0/CodificacaoFipe/chassi/${encodeURIComponent(vin)}`);
}

module.exports = {
  id:           "infocar",
  displayName:  "Infocar · Codificação FIPE",
  isReady,
  lookupByPlate,
  lookupByVin,
};
