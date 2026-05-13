// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vehicle/chassi/:chassi
// Vercel serverless function. Same behavior as server/proxy.js's chassi route.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { enforceGate } = require("../../_gate");
const { credentialsAreSet, infocarGet, maskTail, VIN_RE } = require("../../../lib/infocar");

module.exports = async (req, res) => {
  if (!enforceGate(req, res)) return;

  if (!credentialsAreSet()) {
    return res.status(503).setHeader("content-type", "application/json").send(JSON.stringify({
      error: "credentials_missing",
      message: "Infocar credentials are not configured on the server. Set INFOCAR_ID_KEY, INFOCAR_USERNAME, INFOCAR_PASSWORD in the Vercel project's environment variables.",
    }));
  }

  const raw = String(req.query?.chassi || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (!VIN_RE.test(raw)) {
    return res.status(400).setHeader("content-type", "application/json").send(JSON.stringify({
      error: "invalid_chassi",
      message: "Chassi deve ter 17 caracteres alfanuméricos (sem I, O ou Q).",
    }));
  }

  const out = await infocarGet(`/api/v1.0/CodificacaoFipe/chassi/${encodeURIComponent(raw)}`);
  console.log(`[${new Date().toISOString()}] /chassi  q=${maskTail(raw)}  status=${out.status}  ${out.latencyMs}ms`);
  res.setHeader("x-upstream-latency-ms", String(out.latencyMs));
  res.status(out.status).setHeader("content-type", out.contentType).send(out.body);
};
