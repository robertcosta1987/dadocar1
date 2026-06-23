// lib/retention.js — retention policy as data (Art. 15/16). CommonJS port of
// apps/webclient/src/lib/lgpd/retention.ts (keep the two in sync). Pure: builds
// parameterized SQL (@cutoff); no date is ever string-interpolated.
"use strict";

function intEnv(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

// CONFIRMED policy (OPEN_DECISIONS #2): 1 ano logs/consultas, 2 anos contas inativas.
function loadRetention(env) {
  return {
    apiLogPiiDays: intEnv(env.LGPD_RETENTION_APILOG_DAYS, 365),
    consultationDays: intEnv(env.LGPD_RETENTION_CONSULT_DAYS, 365),
    inactiveAccountDays: intEnv(env.LGPD_RETENTION_INACTIVE_DAYS, 730),
  };
}

function cutoffIso(days, now) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

const LOG_PII_PRESENT =
  "(placa IS NOT NULL OR ip IS NOT NULL OR user_agent IS NOT NULL OR country IS NOT NULL OR city IS NOT NULL)";

function retentionTasks(cfg) {
  const consult = (table) => ({
    countSql: `SELECT COUNT(*) AS n FROM ${table} WHERE consulted_at < @cutoff`,
    applySql: `DELETE FROM ${table} WHERE consulted_at < @cutoff`,
  });
  return [
    {
      key: "apilog_pii", label: "Anonimizar PII de api_request_logs", days: cfg.apiLogPiiDays, optIn: false,
      countSql: `SELECT COUNT(*) AS n FROM api_request_logs WHERE created_at < @cutoff AND ${LOG_PII_PRESENT}`,
      applySql: `UPDATE api_request_logs SET placa=NULL, ip=NULL, user_agent=NULL, country=NULL, city=NULL WHERE created_at < @cutoff AND ${LOG_PII_PRESENT}`,
    },
    { key: "consult_checktudo", label: "Excluir consultas CheckTudo antigas", days: cfg.consultationDays, optIn: false, ...consult("checktudo_consultas") },
    { key: "consult_infocar", label: "Excluir consultas Infocar antigas", days: cfg.consultationDays, optIn: false, ...consult("infocar_consultas") },
    { key: "consult_kbb", label: "Excluir consultas KBB antigas", days: cfg.consultationDays, optIn: false, ...consult("kbb_consultas") },
    {
      key: "inactive_accounts", label: "Desativar+anonimizar contas inativas", days: cfg.inactiveAccountDays, optIn: true,
      countSql: `SELECT COUNT(*) AS n FROM users WHERE status='active' AND last_login_at IS NOT NULL AND last_login_at < @cutoff`,
      applySql: `UPDATE users SET email=CONCAT('anon-', CAST(id AS NVARCHAR(40)), '@anonimizado.invalid'), name=NULL, status='disabled', api_key_hash=NULL, api_key_prefix=NULL, must_change_password=1 WHERE status='active' AND last_login_at IS NOT NULL AND last_login_at < @cutoff`,
    },
  ];
}

module.exports = { loadRetention, cutoffIso, retentionTasks };
