// ─────────────────────────────────────────────────────────────────────────────
// GET /api/providers
// Vercel proxy → Function App `/api/providers`. Lists registered vendors
// and whether each one's credentials are present in Key Vault. Useful for
// admin UI / dashboards. Gated by the shared secret like every other route.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { enforceGate } = require("./_gate");
const { isReady, callAggregator } = require("../lib/aggregator");

module.exports = async (req, res) => {
  if (!enforceGate(req, res)) return;
  if (!isReady()) {
    return res.status(503).setHeader("content-type", "application/json").send(JSON.stringify({
      error: "aggregator_unconfigured",
      message: "Set AZURE_FUNCTION_URL and AZURE_FUNCTION_KEY on the Vercel project so this proxy can reach the Dadocar Function App.",
    }));
  }
  const out = await callAggregator("/api/providers");
  res.setHeader("x-upstream-latency-ms", String(out.latencyMs));
  res.status(out.status).setHeader("content-type", out.contentType).send(out.body);
};
