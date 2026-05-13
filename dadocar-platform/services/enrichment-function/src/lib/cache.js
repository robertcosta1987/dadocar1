// ─────────────────────────────────────────────────────────────────────────────
// cache.js — Cosmos cache-aside for vehicle lookups.
//
// Plate lookups: cache to/from the `vehicles` container (PK `/placa`,
// TTL 30 days via container default).
//
// VIN/chassi lookups: NOT YET WIRED. The schema has a separate
// `vehicle_index` container (PK `/lookup_key`) intended for bidirectional
// plate↔VIN mapping; until that's implemented, VIN queries skip the cache.
//
// Failure semantics:
//   - Read errors  → log + return null (treat as cache miss; lookup continues).
//   - Write errors → log + swallow (the response to the caller already left).
//   - 404 on read  → return null without logging (normal miss path).
//
// Auth: DefaultAzureCredential. The Function App's system-assigned MI has
// the Cosmos DB Built-in Data Contributor role on the account, granted by
// the Bicep template. Local-auth is disabled on the account.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { CosmosClient } = require("@azure/cosmos");
const { DefaultAzureCredential } = require("@azure/identity");

const DB_NAME           = "dadocar";
const VEHICLES_CONTAINER = "vehicles";

let _client = null;
function client() {
  if (_client) return _client;
  const endpoint = process.env.COSMOS_ENDPOINT;
  if (!endpoint) throw new Error("COSMOS_ENDPOINT is not set on this Function App");
  _client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  return _client;
}

let _vehicles = null;
function vehiclesContainer() {
  if (_vehicles) return _vehicles;
  _vehicles = client().database(DB_NAME).container(VEHICLES_CONTAINER);
  return _vehicles;
}

/**
 * Look up a previously-cached vehicle response by plate.
 * Returns the stored payload (the unified `sources[]` response) and the
 * timestamp it was originally written, or null on miss.
 */
async function getCachedByPlate(plate) {
  try {
    const { resource } = await vehiclesContainer().item(plate, plate).read();
    if (!resource) return null;
    return { payload: resource.payload, fetched_at: resource.fetched_at };
  } catch (err) {
    if (err.code === 404) return null;     // normal miss
    console.warn(`[cache] read failed for ${plate}: code=${err.code} msg=${err.message}`);
    return null;                            // fail-open: treat as miss
  }
}

/**
 * Write the unified response for a plate. Fire-and-forget — never throws,
 * since the user response has already been sent.
 *
 * Document shape:
 *   {
 *     id:          "EFS8F45",              // Cosmos doc id
 *     placa:       "EFS8F45",              // partition key
 *     payload:     <unified response shape>,
 *     fetched_at:  ISO string
 *   }
 *
 * Container `vehicles` has defaultTtl=2592000 (30 days) — Cosmos handles
 * eviction automatically. We don't set `ttl` on the doc, so the container
 * default applies.
 */
async function setCachedByPlate(plate, payload) {
  try {
    await vehiclesContainer().items.upsert({
      id:         plate,
      placa:      plate,
      payload,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn(`[cache] write failed for ${plate}: code=${err.code} msg=${err.message}`);
  }
}

module.exports = {
  getCachedByPlate,
  setCachedByPlate,
};
