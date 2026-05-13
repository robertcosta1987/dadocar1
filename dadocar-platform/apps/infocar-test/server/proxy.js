// ─────────────────────────────────────────────────────────────────────────────
// proxy.js — local Vercel-equivalent proxy (Express)
//
// For local dev only. Mirrors the Vercel serverless functions:
//   GET /api/healthz                          — local; reports gate + agg config
//   GET /api/providers                        — proxies to the Function App
//   GET /api/vehicle/plate/:plate             — proxies to the Function App
//   GET /api/vehicle/chassi/:chassi           — proxies to the Function App
//
// The actual vendor calls (Infocar, etc.) happen inside the Function App.
// This proxy just adds the shared-secret gate and forwards. Env needed:
//   DADOCAR_GATE_SECRET   shared-secret bearer for the UI (optional locally)
//   AZURE_FUNCTION_URL    https://dadocar-dev-func-enrich-brs.azurewebsites.net
//   AZURE_FUNCTION_KEY    function-app default key
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const path     = require("node:path");
const fs       = require("node:fs");
const { timingSafeEqual } = require("node:crypto");
const express = require("express");
const cors    = require("cors");

const {
  isReady,
  callAggregator,
  maskTail,
  PLATE_RE,
  VIN_RE,
} = require("../lib/aggregator");

// ─── Light .env loader. Keep deps to express+cors only.
(function loadDotenv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
})();

const PORT = Number(process.env.PORT || 3001);

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

function gateCheck(req, res, next) {
  const expected = process.env.DADOCAR_GATE_SECRET || "";
  if (!expected) return next();
  const auth = req.header("authorization") || "";
  const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!constantTimeEqual(presented, expected)) {
    return res.status(401).json({
      error:   "unauthorized",
      message: "Missing or invalid Authorization: Bearer <secret> header.",
    });
  }
  next();
}

function ensureAggregator(_req, res, next) {
  if (isReady()) return next();
  return res.status(503).json({
    error:   "aggregator_unconfigured",
    message: "Set AZURE_FUNCTION_URL and AZURE_FUNCTION_KEY in apps/infocar-test/.env and restart the proxy.",
  });
}

const app = express();

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (/^http:\/\/localhost(:\d+)?$/i.test(origin)) return cb(null, true);
    if (/^http:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin)) return cb(null, true);
    return cb(new Error("CORS: localhost only"));
  },
  exposedHeaders: ["x-upstream-latency-ms"],
}));

app.use(express.static(path.resolve(__dirname, "..", "web")));

app.get("/api/healthz", gateCheck, (_req, res) => {
  res.json({
    ok: true,
    aggregator_configured: isReady(),
    gate_enforced: Boolean(process.env.DADOCAR_GATE_SECRET),
  });
});

app.get("/api/providers", gateCheck, ensureAggregator, async (req, res) => {
  const out = await callAggregator("/api/providers");
  res.setHeader("x-upstream-latency-ms", String(out.latencyMs));
  res.status(out.status).type(out.contentType).send(out.body);
});

app.get("/api/vehicle/plate/:plate", gateCheck, ensureAggregator, async (req, res) => {
  const raw = String(req.params.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!PLATE_RE.test(raw)) {
    return res.status(400).json({ error: "invalid_plate", message: "Placa fora dos formatos antigo (ABC1234) ou Mercosul (ABC1D23)." });
  }
  const sources = typeof req.query?.sources === "string" ? req.query.sources : undefined;
  const out = await callAggregator(`/api/vehicle/plate/${encodeURIComponent(raw)}`, { searchParams: { sources } });
  console.log(`[${new Date().toISOString()}] /placa  q=${maskTail(raw)}  status=${out.status}  ${out.latencyMs}ms`);
  res.setHeader("x-upstream-latency-ms", String(out.latencyMs));
  res.status(out.status).type(out.contentType).send(out.body);
});

app.get("/api/vehicle/chassi/:chassi", gateCheck, ensureAggregator, async (req, res) => {
  const raw = String(req.params.chassi || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (!VIN_RE.test(raw)) {
    return res.status(400).json({ error: "invalid_chassi", message: "Chassi deve ter 17 caracteres alfanuméricos (sem I, O ou Q)." });
  }
  const sources = typeof req.query?.sources === "string" ? req.query.sources : undefined;
  const out = await callAggregator(`/api/vehicle/chassi/${encodeURIComponent(raw)}`, { searchParams: { sources } });
  console.log(`[${new Date().toISOString()}] /chassi  q=${maskTail(raw)}  status=${out.status}  ${out.latencyMs}ms`);
  res.setHeader("x-upstream-latency-ms", String(out.latencyMs));
  res.status(out.status).type(out.contentType).send(out.body);
});

// Loose backward-compat with the old proxy that exposed /healthz (no prefix).
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, aggregator_configured: isReady(), gate_enforced: Boolean(process.env.DADOCAR_GATE_SECRET) });
});

app.listen(PORT, () => {
  console.log(`Dadocar test proxy listening on http://localhost:${PORT}`);
  console.log(`  aggregator configured: ${isReady()}`);
  console.log(`  gate enforced:         ${Boolean(process.env.DADOCAR_GATE_SECRET)}`);
});
