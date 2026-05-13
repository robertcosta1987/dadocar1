// ─────────────────────────────────────────────────────────────────────────────
// GET /api/vehicle/plate/:plate
// Vercel serverless function. Same behavior as server/proxy.js's plate route.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { enforceGate } = require("../../_gate");
const { credentialsAreSet, infocarGet, maskTail, PLATE_RE } = require("../../../lib/infocar");

module.exports = async (req, res) => {
  if (!enforceGate(req, res)) return;

  if (!credentialsAreSet()) {
    return res.status(503).setHeader("content-type", "application/json").send(JSON.stringify({
      error: "credentials_missing",
      message: "Infocar credentials are not configured on the server. Set INFOCAR_ID_KEY, INFOCAR_USERNAME, INFOCAR_PASSWORD in the Vercel project's environment variables.",
    }));
  }

  const raw = String(req.query?.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!PLATE_RE.test(raw)) {
    return res.status(400).setHeader("content-type", "application/json").send(JSON.stringify({
      error: "invalid_plate",
      message: "Placa fora dos formatos antigo (ABC1234) ou Mercosul (ABC1D23).",
    }));
  }

  const out = await infocarGet(`/api/v1.0/CodificacaoFipe/placa/${encodeURIComponent(raw)}`);
  console.log(`[${new Date().toISOString()}] /placa  q=${maskTail(raw)}  status=${out.status}  ${out.latencyMs}ms`);
  res.setHeader("x-upstream-latency-ms", String(out.latencyMs));
  res.status(out.status).setHeader("content-type", out.contentType).send(out.body);
};
