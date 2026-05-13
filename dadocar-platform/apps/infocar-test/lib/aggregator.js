// ─────────────────────────────────────────────────────────────────────────────
// lib/aggregator.js
// Thin client for the Dadocar Function App (services/enrichment-function/).
// The Vercel app used to call Infocar directly; now it always goes through
// the aggregator so adding a vendor doesn't require any Vercel-side change.
//
// Required env on Vercel (Production + Preview):
//   AZURE_FUNCTION_URL    https://dadocar-dev-func-enrich-brs.azurewebsites.net
//   AZURE_FUNCTION_KEY    the function-app default function key
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const FETCH_TIMEOUT_MS = 25_000;

function config() {
  return {
    url: (process.env.AZURE_FUNCTION_URL || "").replace(/\/$/, ""),
    key: process.env.AZURE_FUNCTION_KEY || "",
  };
}

function isReady() {
  const c = config();
  return Boolean(c.url && c.key);
}

function maskTail(s, keep = 3) {
  if (!s) return "—";
  return s.length <= keep ? "***" : `${s.slice(0, keep)}***`;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

/**
 * Call any path on the Function App. Returns `{ status, latencyMs,
 * contentType, body }` — body is the raw text so the caller can forward
 * it verbatim or parse + re-serialize as needed.
 */
async function callAggregator(path, { searchParams } = {}) {
  const t0 = Date.now();
  const c  = config();
  const u  = new URL(`${c.url}${path}`);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    }
  }
  let res;
  try {
    res = await fetchWithTimeout(u.toString(), {
      method: "GET",
      headers: { "x-functions-key": c.key, Accept: "application/json" },
    });
  } catch (err) {
    return {
      status:      502,
      latencyMs:   Date.now() - t0,
      contentType: "application/json",
      body:        JSON.stringify({ error: "aggregator_unreachable", message: err.message }),
    };
  }
  const body = await res.text();
  return {
    status:      res.status,
    latencyMs:   Date.now() - t0,
    contentType: res.headers.get("content-type") || "application/json",
    body,
  };
}

// Brazilian plate + VIN validators (defence in depth — server validates too).
const PLATE_RE = /^([A-Z]{3}\d{4}|[A-Z]{3}\d[A-Z]\d{2})$/;
const VIN_RE   = /^[A-HJ-NPR-Z0-9]{17}$/;

module.exports = {
  isReady,
  callAggregator,
  maskTail,
  PLATE_RE,
  VIN_RE,
};
