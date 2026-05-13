// ─────────────────────────────────────────────────────────────────────────────
// app.js — Dadocar Infocar test frontend
// Vanilla DOM. No framework, no build step.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const PLATE_OLD     = /^[A-Z]{3}\d{4}$/;
const PLATE_MERCO   = /^[A-Z]{3}\d[A-Z]\d{2}$/;
const VIN_RE        = /^[A-HJ-NPR-Z0-9]{17}$/;
const PLATE_EXAMPLE = "EFS8F45";
const VIN_EXAMPLE   = "9BWKB05W89P075362";

const $ = (id) => document.getElementById(id);

const state = {
  mode: "plate",        // "plate" | "chassi"
};

// ─── Gate (shared bearer secret) ─────────────────────────────────────────
const GATE_KEY = "dadocar:gate-secret";

function getGateSecret() { return sessionStorage.getItem(GATE_KEY) || ""; }
function setGateSecret(v) { sessionStorage.setItem(GATE_KEY, v); }
function clearGateSecret() { sessionStorage.removeItem(GATE_KEY); }

function showGate(errMsg = "") {
  $("gateCard").hidden  = false;
  $("queryCard").hidden = true;
  $("gateError").textContent = errMsg;
  setTimeout(() => $("gateInput").focus(), 0);
}
function hideGate() {
  $("gateCard").hidden  = true;
  $("queryCard").hidden = false;
}

$("gateForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("gateInput").value.trim();
  if (!v) return;
  setGateSecret(v);
  $("gateInput").value = "";
  hideGate();
});

// On boot: show the gate if no secret stored.
if (!getGateSecret()) showGate();
else hideGate();

// ─── Theme toggle ──────────────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem("dadocar:theme");
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
  $("themeToggle").addEventListener("click", () => {
    const isDark = (document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("dadocar:theme", next);
  });
})();

// ─── Mode tabs ─────────────────────────────────────────────────────────────
document.querySelectorAll(".mode-tabs [role='tab']").forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

function setMode(mode) {
  state.mode = mode;
  for (const btn of document.querySelectorAll(".mode-tabs [role='tab']")) {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  }
  const isPlate = mode === "plate";
  $("queryLabel").textContent = isPlate ? "Placa do veículo" : "Chassi (VIN) do veículo";
  $("queryInput").placeholder = isPlate ? PLATE_EXAMPLE : VIN_EXAMPLE;
  $("queryInput").value = "";
  $("validationMsg").textContent = "";
  $("submitBtn").disabled = true;
  hideError();
  $("result").hidden = true;
}

// ─── Input handling: uppercase, validate ───────────────────────────────────
const input = $("queryInput");
input.addEventListener("input", () => {
  const raw = input.value.toUpperCase().replace(/\s+/g, "");
  if (raw !== input.value) input.value = raw;
  validateInput();
});

function validateInput() {
  const v = input.value.trim();
  const valMsg = $("validationMsg");
  if (v.length === 0) {
    valMsg.textContent = "";
    $("submitBtn").disabled = true;
    return false;
  }
  if (state.mode === "plate") {
    if (PLATE_OLD.test(v) || PLATE_MERCO.test(v)) {
      valMsg.textContent = "";
      $("submitBtn").disabled = false;
      return true;
    }
    valMsg.textContent = "Placa inválida. Use o formato ABC1234 ou ABC1D23.";
    $("submitBtn").disabled = true;
    return false;
  }
  // chassi
  if (VIN_RE.test(v)) {
    valMsg.textContent = "";
    $("submitBtn").disabled = false;
    return true;
  }
  if (/[IOQ]/.test(v)) {
    valMsg.textContent = "Chassi não pode conter as letras I, O ou Q.";
  } else {
    valMsg.textContent = "Chassi deve ter 17 caracteres alfanuméricos.";
  }
  $("submitBtn").disabled = true;
  return false;
}

async function gatedFetch(url, opts = {}) {
  const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
  const secret  = getGateSecret();
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return fetch(url, { ...opts, headers });
}

// ─── Submit ────────────────────────────────────────────────────────────────
$("queryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validateInput()) return;
  const value = input.value.trim();
  const endpoint = state.mode === "plate"
    ? `/api/vehicle/plate/${encodeURIComponent(value)}`
    : `/api/vehicle/chassi/${encodeURIComponent(value)}`;

  setLoading(true);
  hideError();
  $("result").hidden = true;
  const startedAt = new Date();

  let res;
  try {
    res = await gatedFetch(endpoint);
  } catch (err) {
    setLoading(false);
    return showError({
      title:   "Sem conexão",
      message: `Não foi possível chamar a API. Em local: verifique se o proxy está rodando em localhost:3001. Em Vercel: a função está fora do ar? (${err.message})`,
    });
  }

  // 401 → token was rejected; show the gate again with an explanation and stop.
  if (res.status === 401) {
    setLoading(false);
    clearGateSecret();
    showGate("Token inválido. Tente novamente.");
    return;
  }

  const latency = res.headers.get("x-upstream-latency-ms");
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  setLoading(false);

  if (res.status === 503 && body && body.error === "credentials_missing") {
    return showError({
      title:   "Credenciais Infocar não configuradas",
      message: body.message + " Veja apps/infocar-test/README.md.",
      warn:    true,
    });
  }
  if (res.status === 401) {
    return showError({
      title:   "Falha de autenticação Infocar",
      message: "As credenciais Infocar foram rejeitadas (HTTP 401). Verifique INFOCAR_ID_KEY, INFOCAR_USERNAME e INFOCAR_PASSWORD.",
    });
  }
  if (res.status === 404) {
    return showError({
      title:   "Veículo não encontrado",
      message: "Verifique a placa/chassi informado.",
    });
  }
  if (!res.ok) {
    return showError({
      title:   `Erro HTTP ${res.status}`,
      message: (body && (body.message || body.error)) || `Falha na requisição para ${endpoint}.`,
    });
  }

  renderResult(body, { endpoint, startedAt, upstreamLatencyMs: latency });
});

function setLoading(isLoading) {
  const btn = $("submitBtn");
  if (isLoading) {
    btn.classList.add("loading");
    btn.disabled = true;
  } else {
    btn.classList.remove("loading");
    btn.disabled = !validateInput();
  }
}

function showError({ title, message, warn = false }) {
  const el = $("error");
  el.hidden = false;
  el.classList.toggle("warn", warn);
  el.innerHTML = "";
  const h = document.createElement("h3"); h.textContent = title; el.appendChild(h);
  const p = document.createElement("p");  p.textContent = message; el.appendChild(p);
}
function hideError() { $("error").hidden = true; }

// ─── Render aggregator response ───────────────────────────────────────────
// The Vercel API now forwards the Function-App aggregator response shape:
//   { query, generated_at, ran_providers, skipped_providers,
//     unknown_sources, sources: [ { id, display_name, ok, data, ... } ] }
// For each ok source whose `data` looks like Infocar's payload (has
// dados.dadosDoVeiculo / dados.fipes), we render the existing Dados +
// FIPE sections. The first ok Infocar-shaped source wins for the main
// render today; the meta band always lists every source's status so
// adding a vendor surfaces immediately.
function renderResult(body, meta) {
  const result = $("result");
  result.hidden = false;

  const sources = Array.isArray(body?.sources) ? body.sources : [];
  const okSources = sources.filter(s => s && s.ok && s.data);
  const primary   = okSources.find(s => s?.data?.dados?.dadosDoVeiculo) || okSources[0] || null;

  // Meta footer at top of card.
  const metaEl = $("resultMeta");
  metaEl.innerHTML = "";
  metaEl.appendChild(metaPill("endpoint", meta.endpoint));
  metaEl.appendChild(metaPill("upstream",  meta.upstreamLatencyMs ? `${meta.upstreamLatencyMs} ms` : "—"));
  metaEl.appendChild(metaPill("ts",         meta.startedAt.toISOString()));
  for (const s of sources) {
    const badge = `${s.display_name || s.id}: ${s.ok ? "ok" : (s.error || "fail")}${s.latency_ms != null ? ` (${s.latency_ms}ms)` : ""}`;
    metaEl.appendChild(metaPill("source", badge));
  }

  // Dados do Veículo.
  const dados = primary?.data?.dados?.dadosDoVeiculo || {};
  const grid = $("dadosGrid");
  grid.innerHTML = "";
  const entries = Object.entries(dados);
  if (entries.length === 0) {
    const note = document.createElement("dd"); note.textContent = "Nenhum dado retornado."; note.className = "empty";
    grid.appendChild(note);
  } else {
    for (const [k, v] of entries) {
      const dt = document.createElement("dt"); dt.textContent = humanLabel(k);
      const dd = document.createElement("dd");
      if (v === null || v === undefined || v === "") {
        dd.textContent = "—"; dd.className = "empty";
      } else {
        dd.textContent = String(v);
      }
      grid.appendChild(dt); grid.appendChild(dd);
    }
  }

  // Preços FIPE.
  const fipes = Array.isArray(primary?.data?.dados?.fipes) ? primary.data.dados.fipes : [];
  const fipeList = $("fipeList");
  fipeList.innerHTML = "";
  if (fipes.length === 0) {
    const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "Sem preços FIPE retornados.";
    fipeList.appendChild(empty);
  } else {
    for (const f of fipes) {
      const card = document.createElement("div"); card.className = "fipe-card";
      const left = document.createElement("div"); left.className = "fipe-meta";
      const code = document.createElement("span"); code.className = "fipe-codigo"; code.textContent = f.codigoFipe ?? "—";
      const desc = document.createElement("span"); desc.className = "fipe-desc";   desc.textContent = f.descricao ?? "—";
      left.appendChild(code); left.appendChild(desc);
      const valor = document.createElement("span"); valor.className = "fipe-valor";
      valor.textContent = formatBrlValor(f.valor);
      card.appendChild(left); card.appendChild(valor);
      fipeList.appendChild(card);
    }
  }

  // Raw JSON viewer (collapsed by default).
  const raw = $("rawJson");
  raw.innerHTML = highlightJson(body);
}

function metaPill(label, value) {
  const span = document.createElement("span");
  span.textContent = `${label}: ${value}`;
  return span;
}

function humanLabel(key) {
  // Convert camelCase -> "Title Case With Spaces".
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function formatBrlValor(raw) {
  if (raw === null || raw === undefined || raw === "") return "—";
  if (typeof raw === "number") {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(raw);
  }
  if (typeof raw !== "string") return String(raw);
  if (raw.trim().startsWith("R$")) return raw;          // already pre-formatted

  // Strip everything that isn't a digit, separator, or sign.
  const clean = raw.replace(/[^\d,.\-]/g, "");
  if (!clean) return raw;

  // Decide decimal separator by whichever appears LAST. Handles both
  // US-style "46,841.00" and BR-style "46.841,00" from Infocar.
  const lastComma = clean.lastIndexOf(",");
  const lastDot   = clean.lastIndexOf(".");
  let normalized;
  if (lastComma === -1 && lastDot === -1) {
    normalized = clean;
  } else if (lastComma > lastDot) {
    // BR — dots are thousands separators, comma is decimal.
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && lastComma !== -1) {
    // US — commas are thousands, dot is decimal.
    normalized = clean.replace(/,/g, "");
  } else {
    // Single dot only — ambiguous. Treat 3-digit tail as thousands
    // (e.g. "70.815" → 70815, not 70.815), shorter tail as decimal
    // ("70.81" → 70.81).
    const tail = clean.length - lastDot - 1;
    normalized = tail === 3 ? clean.replace(".", "") : clean;
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return raw;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

// ─── Lightweight JSON syntax highlighter ──────────────────────────────────
function highlightJson(value) {
  const pretty = JSON.stringify(value, null, 2);
  if (!pretty) return "";
  return pretty
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
      let cls = "json-number";
      if (/^"/.test(match)) cls = /:$/.test(match) ? "json-key" : "json-string";
      else if (/true|false/.test(match)) cls = "json-bool";
      else if (/null/.test(match))       cls = "json-null";
      return `<span class="${cls}">${match}</span>`;
    });
}

// ─── Copy-to-clipboard for the raw JSON ───────────────────────────────────
$("copyJsonBtn").addEventListener("click", async (e) => {
  e.preventDefault();
  const text = $("rawJson").innerText;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const btn = $("copyJsonBtn");
    const prev = btn.textContent;
    btn.textContent = "Copiado";
    setTimeout(() => (btn.textContent = prev), 1500);
  } catch {
    // Fallback: select the text so the user can ⌘C manually.
    const range = document.createRange();
    range.selectNodeContents($("rawJson"));
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  }
});

// Default to plate mode.
setMode("plate");
