// ─────────────────────────────────────────────────────────────────────────────
// validation.js — Brazilian plate, VIN, and CPF format checks.
//
// Same plate/VIN rules as the enrichment + KBB functions so all three
// services enforce identical input contracts. CPF is new: 11 numeric digits,
// optionally formatted as "000.000.000-00".
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

/** Old (`ABC1234`) or Mercosul (`ABC1D23`) plate. */
const PLATE_RE = /^([A-Z]{3}\d{4}|[A-Z]{3}\d[A-Z]\d{2})$/;

/** Standard 17-char VIN with no I, O, or Q. */
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

/** Brazilian CPF — exactly 11 digits (post-normalisation). */
const CPF_RE = /^\d{11}$/;

function normalizePlate(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function normalizeVin(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
}
function normalizeCpf(raw) {
  return String(raw || "").replace(/\D/g, "");
}

module.exports = { PLATE_RE, VIN_RE, CPF_RE, normalizePlate, normalizeVin, normalizeCpf };
