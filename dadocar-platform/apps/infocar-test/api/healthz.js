// ─────────────────────────────────────────────────────────────────────────────
// GET /api/healthz
// Local health surface for the Vercel app: reports whether the gate and the
// aggregator endpoint are configured. Gated by the same shared secret so an
// anonymous probe can't reveal deployment state.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { enforceGate } = require("./_gate");
const { isReady } = require("../lib/aggregator");

module.exports = (req, res) => {
  if (!enforceGate(req, res)) return;
  res.status(200).setHeader("content-type", "application/json").send(JSON.stringify({
    ok: true,
    aggregator_configured: isReady(),
  }));
};
