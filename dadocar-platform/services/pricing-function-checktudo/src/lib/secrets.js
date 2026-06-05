// ─────────────────────────────────────────────────────────────────────────────
// secrets.js — Key Vault reader.
//
// Mirrors services/enrichment-function/src/lib/secrets.js verbatim so the
// two Function Apps share the same operational contract:
//
//   - In Azure, DefaultAzureCredential picks up the Function App's
//     system-assigned Managed Identity (which Bicep grants
//     `Key Vault Secrets User` on the dev vault).
//   - Locally, the same credential chain falls through to the developer's
//     `az login` session — so as long as the developer has Secrets Get
//     rights they can run the Function locally with no env-var changes.
//   - In-process cache: 5 min TTL. Plenty for a token flow whose upstream
//     tokens live 1h+; small enough that rotating a secret in Key Vault
//     recovers without a Function restart.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { SecretClient } = require("@azure/keyvault-secrets");
const { DefaultAzureCredential } = require("@azure/identity");

const TTL_MS = 5 * 60 * 1000;

let _client = null;
function client() {
  if (_client) return _client;
  const url = process.env.KEYVAULT_URL;
  if (!url) throw new Error("KEYVAULT_URL is not set on this Function App");
  _client = new SecretClient(url, new DefaultAzureCredential());
  return _client;
}

const _cache = new Map();   // name → { value, expiresAt }

async function getSecret(name) {
  const entry = _cache.get(name);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  try {
    const result = await client().getSecret(name);
    const value  = result.value ?? null;
    _cache.set(name, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  } catch (err) {
    // SecretNotFound is normal — the secret simply hasn't been seeded yet.
    // Bubble other errors (network, auth) up so the caller can log/respond.
    if (err && err.code === "SecretNotFound") {
      _cache.set(name, { value: null, expiresAt: Date.now() + 60_000 });
      return null;
    }
    throw err;
  }
}

/** Fetch many secrets in parallel. Missing entries map to null. */
async function getSecrets(names) {
  const pairs = await Promise.all(names.map(async (n) => [n, await getSecret(n)]));
  return Object.fromEntries(pairs);
}

/** Test-only escape hatch; not used at runtime. */
function _resetCache() { _cache.clear(); }

module.exports = { getSecret, getSecrets, _resetCache };
