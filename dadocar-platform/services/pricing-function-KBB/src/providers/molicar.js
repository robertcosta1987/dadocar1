// ─────────────────────────────────────────────────────────────────────────────
// providers/molicar.js — Molicar Decoder + KBB Pricing.
//
// One vendor exposes two distinct pieces of intelligence:
//   - Vehicle decoder data (VIN, body, brand/model/version, …)
//   - KBB-aligned pricing broken down by sale channel (NewVehicle, UsedDealer,
//     SellPrivateParty, SellDealer, FPP), each with Min / Max / FairPrice.
//
// Both come back in a single GET /api/v3/plate/{plate} call. We forward the
// vendor's response verbatim under `data` — the webclient is responsible
// for shaping it for display.
//
// Auth: OAuth2 client_credentials against a separate auth host. We cache
// the bearer in-process and renew with a 5-minute safety margin before
// the vendor's `expires_in` deadline. Multi-instance Function Apps will
// each fetch their own token; sharing via Cosmos is a future enhancement
// (same trade-off documented in infocar.js).
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { getSecrets } = require("../lib/secrets");

const MOLICAR_AUTH_BASE     = "https://auth-decoder.molicar.com.br";
const MOLICAR_DECODER_BASE  = "https://decoder.molicar.com.br";

// Token TTL safety margin. Vendor returns expires_in (seconds, 3600 by
// default); we refresh once we get within this window of expiry so a
// long-running request doesn't get a 401 mid-flight.
const TOKEN_REFRESH_MARGIN  = 5 * 60 * 1000;       // 5 min
const TOKEN_FALLBACK_TTL_MS = 60 * 60 * 1000;      // 1 h if vendor omits expires_in
const FETCH_TIMEOUT_MS      = 20 * 1000;

const SECRET_NAMES = ["molicar-client-id", "molicar-client-secret"];

let _token = null;
let _tokenExpiresAt = 0;

async function loadCreds() {
  const s = await getSecrets(SECRET_NAMES);
  return {
    clientId:     s["molicar-client-id"]     || "",
    clientSecret: s["molicar-client-secret"] || "",
  };
}

async function isReady() {
  try {
    const c = await loadCreds();
    return Boolean(c.clientId && c.clientSecret);
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
  if (!c.clientId || !c.clientSecret) {
    const err = new Error("Molicar credentials missing in Key Vault");
    err.upstreamStatus = null;
    throw err;
  }

  // OAuth2 client_credentials. Body is form-urlencoded (per vendor docs).
  const form = new URLSearchParams();
  form.set("client_id",     c.clientId);
  form.set("client_secret", c.clientSecret);
  form.set("grant_type",    "client_credentials");

  const res = await fetchWithTimeout(`${MOLICAR_AUTH_BASE}/oauth2/token`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept:         "application/json",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err  = new Error(`Molicar oauth2/token HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.upstreamStatus = res.status;
    throw err;
  }

  const json = await res.json();
  const tok  = json?.access_token;
  if (!tok) throw new Error("Molicar oauth2/token returned no access_token field");

  const ttlMs = Number.isFinite(json?.expires_in)
    ? Number(json.expires_in) * 1000
    : TOKEN_FALLBACK_TTL_MS;

  _token = tok;
  _tokenExpiresAt = Date.now() + ttlMs;
  return _token;
}

/**
 * Shared upstream caller for both /plate/{plate} and /vin/{vin} routes. The
 * vendor returns the same payload shape for either; we just swap the URL.
 *
 * @param {"plate"|"vin"} mode
 * @param {string}        value already-normalised plate or VIN
 */
async function callDecoder(mode, value) {
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

  const upstreamPath = mode === "vin"
    ? `/api/v3/vin/${encodeURIComponent(value)}`
    : `/api/v3/plate/${encodeURIComponent(value)}`;

  let res;
  try {
    res = await fetchWithTimeout(
      `${MOLICAR_DECODER_BASE}${upstreamPath}`,
      {
        method:  "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept:        "application/json",
        },
        // Vendor docs (PricingAPI v3.0.6 §6) document a 302 for long-wait
        // recall flows. Follow it transparently — fetch default already does.
        redirect: "follow",
      },
    );
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
      message:          (body && (body.message || body.error)) || `Molicar HTTP ${res.status}`,
      data:             body,
      upstream_status:  res.status,
      latency_ms,
    };
  }
  return { ok: true, data: body, upstream_status: res.status, latency_ms };
}

async function lookupByPlate(plate) {
  return callDecoder("plate", plate);
}

async function lookupByVin(vin) {
  return callDecoder("vin", vin);
}

module.exports = {
  id:           "molicar",
  displayName:  "Molicar · KBB Pricing",
  isReady,
  lookupByPlate,
  lookupByVin,
};
