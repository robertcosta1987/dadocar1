// ─────────────────────────────────────────────────────────────────────────────
// retention.js — LGPD retention / de-identification job (Art. 15/16).
//   • Timer trigger: diariamente 03:00 UTC.
//   • HTTP trigger:  GET/POST /api/retention[?apply=1][&accounts=1] → on demand.
// Anonimiza PII de api_request_logs, exclui consultas veiculares antigas e (opt-in)
// anonimiza contas inativas, mantendo registros fiscais (Art. 16).
//
// SEGURANÇA: DRY-RUN por padrão. Só executa de fato quando RETENTION_APPLY=1
// (ou ?apply=1 no HTTP). Contas inativas só entram com RETENTION_INCLUDE_ACCOUNTS=1
// (ou ?accounts=1). Tudo parametrizado em @cutoff; nenhum dado pessoal em log.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { app } = require("@azure/functions");
const sql = require("mssql");
const { loadRetention, cutoffIso, retentionTasks } = require("../lib/retention");

function parseConnString(s) {
  const out = {};
  for (const part of String(s).split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  const server = (out["server"] || "").replace(/^tcp:/, "").split(",")[0];
  return {
    server,
    port: Number((out["server"] || "").split(",")[1] || 1433),
    database: out["initial catalog"] || out["database"] || "",
    user: out["user id"] || out["uid"] || "",
    password: out["password"] || out["pwd"] || "",
    options: {
      encrypt: (out["encrypt"] || "true").toLowerCase() === "true",
      trustServerCertificate: (out["trustservercertificate"] || "false").toLowerCase() === "true",
      enableArithAbort: true,
    },
    requestTimeout: 120000,
    connectionTimeout: 90000,
  };
}

async function run(ctx, { apply, includeAccounts }) {
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL not set");
  const now = new Date();
  const cfg = loadRetention(process.env);
  const tasks = retentionTasks(cfg).filter((t) => includeAccounts || !t.optIn);
  ctx.log(`LGPD retention — ${apply ? "APPLY" : "DRY-RUN"} — now ${now.toISOString()} — accounts=${includeAccounts}`);

  const pool = await sql.connect(parseConnString(cs));
  const results = [];
  try {
    for (const t of tasks) {
      const cutoff = cutoffIso(t.days, now);
      if (!apply) {
        const c = await pool.request().input("cutoff", sql.DateTime2, cutoff).query(t.countSql);
        const n = Number((c.recordset[0] || {}).n || 0);
        results.push({ task: t.key, mode: "dry-run", rows: n, cutoff });
        ctx.log(`[dry-run] ${t.key}: ${n} (corte < ${cutoff})`);
      } else {
        const r = await pool.request().input("cutoff", sql.DateTime2, cutoff).query(t.applySql);
        const n = r.rowsAffected[0] || 0;
        results.push({ task: t.key, mode: "apply", rows: n, cutoff });
        ctx.log(`[apply] ${t.key}: ${n} (corte < ${cutoff})`);
      }
    }
  } finally {
    await pool.close();
  }
  return results;
}

const APPLY = process.env.RETENTION_APPLY === "1";
const INCLUDE_ACCOUNTS = process.env.RETENTION_INCLUDE_ACCOUNTS === "1";

app.timer("retentionTimer", {
  schedule: "0 0 3 * * *", // diariamente às 03:00 UTC
  handler: async (_t, ctx) => {
    await run(ctx, { apply: APPLY, includeAccounts: INCLUDE_ACCOUNTS });
  },
});

app.http("retentionHttp", {
  methods: ["GET", "POST"],
  authLevel: "function",
  handler: async (req, ctx) => {
    const sp = new URL(req.url).searchParams;
    const apply = sp.get("apply") === "1";
    const includeAccounts = sp.get("accounts") === "1" || INCLUDE_ACCOUNTS;
    const results = await run(ctx, { apply, includeAccounts });
    return { jsonBody: { ok: true, apply, includeAccounts, results } };
  },
});
