// ─────────────────────────────────────────────────────────────────────────────
// proxy.js — local Infocar proxy (Express)
//
// For local dev only. The Vercel deployment uses serverless functions under
// api/ — see vercel.json. Both paths share lib/infocar.js.
//
// - Reads INFOCAR_* from env. If missing → /api/* returns 503.
// - Optional gate: if DADOCAR_GATE_SECRET is set, /api/* requires
//   `Authorization: Bearer <secret>`. If unset, the local proxy is open
//   (convenient for `localhost` dev; the Vercel deploy always enforces).
// - Serves the static frontend from ../web at the root path.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const path     = require("node:path");
const fs       = require("node:fs");
const { timingSafeEqual } = require("node:crypto");
const express = require("express");
const cors    = require("cors");

const {
  credentialsAreSet,
  infocarGet,
  maskTail,
  PLATE_RE,
  VIN_RE,
} = require("../lib/infocar");

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
  if (!expected) return next();              // gate disabled locally
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

function ensureCreds(_req, res, next) {
  if (credentialsAreSet()) return next();
  return res.status(503).json({
    error:   "credentials_missing",
    message: "Infocar credentials are not configured. Set INFOCAR_ID_KEY, INFOCAR_USERNAME, INFOCAR_PASSWORD in apps/infocar-test/.env and restart the proxy.",
  });
}

app.get("/api/healthz", gateCheck, (_req, res) => {
  res.json({ ok: true, credentials_set: credentialsAreSet(), gate_enforced: Boolean(process.env.DADOCAR_GATE_SECRET) });
});

app.get("/api/vehicle/plate/:plate", gateCheck, ensureCreds, async (req, res) => {
  const raw = String(req.params.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!PLATE_RE.test(raw)) {
    return res.status(400).json({ error: "invalid_plate", message: "Placa fora dos formatos antigo (ABC1234) ou Mercosul (ABC1D23)." });
  }
  const out = await infocarGet(`/api/v1.0/CodificacaoFipe/placa/${encodeURIComponent(raw)}`);
  console.log(`[${new Date().toISOString()}] /placa  q=${maskTail(raw)}  status=${out.status}  ${out.latencyMs}ms`);
  res.setHeader("x-upstream-latency-ms", String(out.latencyMs));
  res.status(out.status).type(out.contentType).send(out.body);
});

app.get("/api/vehicle/chassi/:chassi", gateCheck, ensureCreds, async (req, res) => {
  const raw = String(req.params.chassi || "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (!VIN_RE.test(raw)) {
    return res.status(400).json({ error: "invalid_chassi", message: "Chassi deve ter 17 caracteres alfanuméricos (sem I, O ou Q)." });
  }
  const out = await infocarGet(`/api/v1.0/CodificacaoFipe/chassi/${encodeURIComponent(raw)}`);
  console.log(`[${new Date().toISOString()}] /chassi  q=${maskTail(raw)}  status=${out.status}  ${out.latencyMs}ms`);
  res.setHeader("x-upstream-latency-ms", String(out.latencyMs));
  res.status(out.status).type(out.contentType).send(out.body);
});

// Loose backward-compat: the old proxy exposed /healthz (no /api prefix).
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, credentials_set: credentialsAreSet(), gate_enforced: Boolean(process.env.DADOCAR_GATE_SECRET) });
});

app.listen(PORT, () => {
  console.log(`Dadocar Infocar test proxy listening on http://localhost:${PORT}`);
  console.log(`  credentials_set:  ${credentialsAreSet()}`);
  console.log(`  gate enforced:    ${Boolean(process.env.DADOCAR_GATE_SECRET)}`);
});
