"use strict";
// scrubPii.js — remove the vehicle OWNER's personal data from a cached consult
// payload while keeping all VEHICLE data (the enrichment MOAT). Recursive; safe
// on any JSON shape. Mirrors apps/webclient/src/lib/lgpd/scrubPii.ts.

const OWNER_PII_KEYS = new Set([
  "proprietario", "proprietarioatual", "proprietarios", "historicoproprietarios",
  "nomeproprietario", "cpf", "cpfcnpj", "cnpj", "documento", "rg", "nomemae",
  "datanascimento", "nascimento",
]);

function isOwnerKey(k) {
  return OWNER_PII_KEYS.has(String(k).toLowerCase().replace(/[\s_-]/g, ""));
}

function scrubOwnerPii(value) {
  if (Array.isArray(value)) return value.map(scrubOwnerPii);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isOwnerKey(k)) continue;
      out[k] = scrubOwnerPii(v);
    }
    return out;
  }
  return value;
}

/** Scrub a JSON string payload; returns scrubbed JSON, or the input unchanged if
 *  it isn't parseable. */
function scrubPayloadJson(payloadJson) {
  let parsed;
  try { parsed = JSON.parse(payloadJson); } catch { return payloadJson; }
  return JSON.stringify(scrubOwnerPii(parsed));
}

module.exports = { scrubOwnerPii, scrubPayloadJson };
