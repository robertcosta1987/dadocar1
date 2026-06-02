// ─────────────────────────────────────────────────────────────────────────────
// validation.js — Brazilian plate + VIN format checks.
//
// Same rules used by services/enrichment-function and the webclient form, so
// the pricing endpoint enforces an identical input contract.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

/** Old (`ABC1234`) or Mercosul (`ABC1D23`) plate. */
const PLATE_RE = /^([A-Z]{3}\d{4}|[A-Z]{3}\d[A-Z]\d{2})$/;

/** Standard 17-char VIN with no I, O, or Q. */
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

function normalizePlate(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function normalizeVin(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
}

module.exports = { PLATE_RE, VIN_RE, normalizePlate, normalizeVin };
