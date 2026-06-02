// ─────────────────────────────────────────────────────────────────────────────
// _types.js — pricing provider contract (JSDoc; runtime no-op).
//
// Same shape as services/enrichment-function/src/providers/_types.js so the
// HTTP trigger can fan out to multiple pricing vendors in the future with
// zero structural changes.
//
// To add a new pricing provider:
//   1. Create src/providers/<id>.js with the same export shape as
//      molicar.js.
//   2. Add it to the PROVIDERS array in ./index.js.
//   3. Seed its credentials into Key Vault and document the secret names
//      in README.md.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

/**
 * @typedef {Object} ProviderResponse
 * @property {boolean}        ok               true on a successful upstream call
 * @property {*}              [data]           raw vendor JSON, namespaced under
 *                                             `sources[].data` in the aggregator
 *                                             response. Don't transform here.
 * @property {string}         [error]          short tag if !ok (e.g. "upstream_404")
 * @property {string}         [message]        human-readable error (pt-BR ok)
 * @property {number}         latency_ms       wall-clock to first byte of response
 * @property {number|null}    upstream_status  HTTP status from the vendor, if any
 */

/**
 * @typedef {Object} PricingProvider
 * @property {string}                                       id             stable kebab-case id, e.g. "molicar"
 * @property {string}                                       displayName    human label
 * @property {() => Promise<boolean>}                       isReady        true if all credentials are present
 * @property {(plate: string) => Promise<ProviderResponse>} lookupByPlate
 * @property {(vin:   string) => Promise<ProviderResponse>} lookupByVin
 */

// JSDoc-only module. Nothing to export.
module.exports = {};
