// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vehicle/chassi/:chassi
// Vercel proxy → Dadocar Function App aggregator → vendor(s).
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { enforceGate } = require("../../_gate");
const { isReady, callAggregator, maskTail, VIN_RE } = require("../../../lib/aggregator");

module.exports = async (req, res) => {
  if (!enforceGate(req, res)) return;

  if (!isReady()) {
    return res.status(503).setHeader("content-type", "application/json").send(JSON.stringify({
      error: "aggregator_unconfigured",
      message: "Set AZURE_FUNCTION_URL and AZURE_FUNCTION_KEY on the Vercel project so this proxy can reach the Dadocar Function App.",
    }));
  }

  const raw = String(req.query?.chassi || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (!VIN_RE.test(raw)) {
    return res.status(400).setHeader("content-type", "application/json").send(JSON.stringify({
      error: "invalid_chassi",
      message: "Chassi deve ter 17 caracteres alfanuméricos (sem I, O ou Q).",
    }));
  }

  const sources = typeof req.query?.sources === "string" ? req.query.sources : undefined;

  const out = await callAggregator(`/api/vehicle/chassi/${encodeURIComponent(raw)}`, {
    searchParams: { sources },
  });
  console.log(`[${new Date().toISOString()}] /chassi  q=${maskTail(raw)}  status=${out.status}  ${out.latencyMs}ms`);
  res.setHeader("x-upstream-latency-ms", String(out.latencyMs));
  res.status(out.status).setHeader("content-type", out.contentType).send(out.body);
};
