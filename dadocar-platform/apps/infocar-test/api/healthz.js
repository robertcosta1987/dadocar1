// ─────────────────────────────────────────────────────────────────────────────
// GET /api/healthz
// Reports whether credentials + gate are configured. Gated — same secret as
// the vehicle endpoints, so anonymous callers can't probe deployment state.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { enforceGate } = require("./_gate");
const { credentialsAreSet } = require("../lib/infocar");

module.exports = (req, res) => {
  if (!enforceGate(req, res)) return;
  res.status(200).setHeader("content-type", "application/json").send(JSON.stringify({
    ok: true,
    credentials_set: credentialsAreSet(),
  }));
};
