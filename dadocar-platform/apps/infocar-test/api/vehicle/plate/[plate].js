// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vehicle/plate/:plate
// Vercel proxy → Dadocar Function App aggregator → vendor(s).
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { enforceGate } = require("../../_gate");
const { isReady, callAggregator, maskTail, PLATE_RE } = require("../../../lib/aggregator");

module.exports = async (req, res) => {
  if (!enforceGate(req, res)) return;

  if (!isReady()) {
    return res.status(503).setHeader("content-type", "application/json").send(JSON.stringify({
      error: "aggregator_unconfigured",
      message: "Set AZURE_FUNCTION_URL and AZURE_FUNCTION_KEY on the Vercel project so this proxy can reach the Dadocar Function App.",
    }));
  }

  const raw = String(req.query?.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!PLATE_RE.test(raw)) {
    return res.status(400).setHeader("content-type", "application/json").send(JSON.stringify({
      error: "invalid_plate",
      message: "Placa fora dos formatos antigo (ABC1234) ou Mercosul (ABC1D23).",
    }));
  }

  // Optional ?sources=infocar,denatran passthrough.
  const sources = typeof req.query?.sources === "string" ? req.query.sources : undefined;

  const out = await callAggregator(`/api/vehicle/plate/${encodeURIComponent(raw)}`, {
    searchParams: { sources },
  });
  console.log(`[${new Date().toISOString()}] /placa  q=${maskTail(raw)}  status=${out.status}  ${out.latencyMs}ms`);
  res.setHeader("x-upstream-latency-ms", String(out.latencyMs));
  res.status(out.status).setHeader("content-type", out.contentType).send(out.body);
};
