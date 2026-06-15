// ─────────────────────────────────────────────────────────────────────────────
// render.js — build the two reports (per-resource + meter detail) as an HTML page,
// an email HTML body and a plain-text version, with simple data-driven insights.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

function round2(n) { return Math.round(n * 100) / 100; }
function money(n, cur) { return `${cur} ${round2(n).toFixed(2)}`; }
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

/** Aggregate raw rows into per-resource totals and per-resource meter detail. */
function aggregate(rows) {
  const cur = (rows[0] && rows[0].currency) || "USD";
  const byRes = new Map();
  for (const r of rows) {
    if (!byRes.has(r.resourceId)) byRes.set(r.resourceId, { resourceName: r.resourceName, cost: 0, meters: [] });
    const e = byRes.get(r.resourceId);
    e.cost += r.cost;
    if (r.meter) e.meters.push({ meter: r.meter, category: r.meterCategory, qty: r.qty, cost: r.cost });
  }
  const resources = [...byRes.values()].map((e) => ({ ...e, cost: round2(e.cost), meters: e.meters.sort((a, b) => b.cost - a.cost) }))
    .sort((a, b) => b.cost - a.cost);
  const total = round2(resources.reduce((s, r) => s + r.cost, 0));
  return { cur, resources, total };
}

/** Plain-language insights from the aggregate. */
function insights(agg) {
  const { resources, total, cur } = agg;
  const out = [];
  const paid = resources.filter((r) => r.cost > 0);
  if (paid[0]) out.push(`Maior custo: ${paid[0].resourceName} — ${money(paid[0].cost, cur)} (${total ? Math.round((paid[0].cost / total) * 100) : 0}% do total).`);
  if (paid[1]) out.push(`Segundo: ${paid[1].resourceName} — ${money(paid[1].cost, cur)} (${total ? Math.round((paid[1].cost / total) * 100) : 0}%).`);
  // Idle Event Hubs heuristic: capacity charge but zero ingress/operations.
  for (const r of resources) {
    const eh = r.meters.filter((m) => /event hubs|service bus/i.test(m.category));
    if (eh.length) {
      const cap = eh.find((m) => /throughput unit/i.test(m.meter));
      const traffic = eh.filter((m) => /ingress|messaging operations|capture/i.test(m.meter)).reduce((s, m) => s + m.qty, 0);
      if (cap && cap.cost > 0 && traffic === 0) out.push(`${r.resourceName}: paga ${money(cap.cost, cur)} de capacidade (Throughput Unit) com tráfego ZERO no mês — recurso ocioso, candidato a remoção.`);
    }
  }
  return out;
}

function perResourceRowsHtml(agg) {
  return agg.resources.map((r) => `      <tr><td>${esc(r.resourceName)}</td><td class="r">${money(r.cost, agg.cur)}</td></tr>`).join("\n");
}
function meterRowsHtml(agg) {
  return agg.resources.filter((r) => r.cost > 0).map((r) => {
    const head = `      <tr class="grp"><td colspan="4">${esc(r.resourceName)} — ${money(r.cost, agg.cur)}</td></tr>`;
    const body = r.meters.map((m) => `      <tr><td></td><td>${esc(m.meter)}</td><td class="r">${round2(m.qty)}</td><td class="r">${money(m.cost, agg.cur)}</td></tr>`).join("\n");
    return head + "\n" + body;
  }).join("\n");
}

/** Full standalone HTML page for the static website. */
function pageHtml(agg, monthLabel, generatedIso) {
  const ins = insights(agg);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Custo Azure — ${esc(monthLabel)}</title>
<style>
 body{font-family:Inter,system-ui,Arial,sans-serif;color:#0b1220;background:#f6f8fc;margin:0;padding:32px}
 .wrap{max-width:880px;margin:0 auto;background:#fff;border:1px solid #e7eaf0;border-radius:16px;padding:28px 30px}
 h1{font-size:24px;margin:0 0 4px} .sub{color:#5b6473;font-size:13px;margin-bottom:20px}
 h2{font-size:17px;margin:26px 0 8px} table{width:100%;border-collapse:collapse;font-size:14px}
 th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #eef1f6} td.r,th.r{text-align:right}
 thead th{color:#5b6473;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
 tr.grp td{background:#f0f3f9;font-weight:600} .total{font-weight:700;font-size:16px}
 .ins{background:#fff7f0;border:1px solid #ffd9b3;border-radius:12px;padding:14px 16px;margin-top:18px}
 .ins li{margin:4px 0;font-size:14px} .foot{color:#9aa3b2;font-size:12px;margin-top:22px}
 .accent{height:5px;border-radius:99px;background:linear-gradient(90deg,#e4002b 0 33%,#fff 33% 66%,#0033a0 66%);margin-bottom:18px;border:1px solid #eef}
</style></head><body><div class="wrap">
<div class="accent"></div>
<h1>Custo Azure para operar a empresa — ${esc(monthLabel)}</h1>
<div class="sub">Resource group: rg-dadocar-dev-brs · Custo real (pré-impostos) · Moeda: ${esc(agg.cur)}</div>

<h2>1) Custo por recurso</h2>
<table><thead><tr><th>Recurso</th><th class="r">Custo</th></tr></thead><tbody>
${perResourceRowsHtml(agg)}
      <tr class="total"><td>TOTAL</td><td class="r">${money(agg.total, agg.cur)}</td></tr>
</tbody></table>

<h2>2) Detalhamento por medição (meter)</h2>
<table><thead><tr><th>Recurso</th><th>Meter</th><th class="r">Qtd</th><th class="r">Custo</th></tr></thead><tbody>
${meterRowsHtml(agg)}
</tbody></table>

${ins.length ? `<div class="ins"><strong>Leitura rápida</strong><ul>${ins.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}
<div class="foot">Gerado automaticamente em ${esc(generatedIso)} · Placas360 / ARX · Azure Cost Management</div>
</div></body></html>`;
}

/** Compact email HTML body. */
function emailHtml(agg, monthLabel) {
  const ins = insights(agg);
  const rows = agg.resources.map((r) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${esc(r.resourceName)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${money(r.cost, agg.cur)}</td></tr>`).join("");
  const meterBlocks = agg.resources.filter((r) => r.cost > 0).map((r) =>
    `<p style="margin:10px 0 2px"><strong>${esc(r.resourceName)}</strong> — ${money(r.cost, agg.cur)}</p>` +
    `<table style="border-collapse:collapse;font-size:13px;width:100%">${r.meters.map((m) => `<tr><td style="padding:2px 8px">${esc(m.meter)}</td><td style="padding:2px 8px;text-align:right">qtd ${round2(m.qty)}</td><td style="padding:2px 8px;text-align:right">${money(m.cost, agg.cur)}</td></tr>`).join("")}</table>`
  ).join("");
  return `<div style="font-family:Arial,sans-serif;color:#0b1220;max-width:680px">
<h2 style="margin:0 0 4px">Custo Azure para operar a empresa — ${esc(monthLabel)}</h2>
<p style="color:#5b6473;font-size:13px;margin:0 0 16px">Resource group <strong>rg-dadocar-dev-brs</strong> · custo real (pré-impostos) · ${esc(agg.cur)}</p>
<h3 style="font-size:15px">1) Custo por recurso</h3>
<table style="border-collapse:collapse;font-size:14px;width:100%">${rows}<tr><td style="padding:6px 8px;font-weight:700">TOTAL</td><td style="padding:6px 8px;text-align:right;font-weight:700">${money(agg.total, agg.cur)}</td></tr></table>
<h3 style="font-size:15px;margin-top:18px">2) Detalhamento por medição (meter)</h3>
${meterBlocks}
${ins.length ? `<div style="background:#fff7f0;border:1px solid #ffd9b3;border-radius:10px;padding:12px 14px;margin-top:16px"><strong>Leitura rápida</strong><ul>${ins.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}
<p style="color:#9aa3b2;font-size:12px;margin-top:18px">Relatório gerado automaticamente · Placas360 / ARX · Azure Cost Management.</p>
</div>`;
}

/** Plain-text version (saved to blob + used as email plainText fallback). */
function textReport(agg, monthLabel, generatedIso) {
  const L = [];
  L.push(`CUSTO AZURE PARA OPERAR A EMPRESA — ${monthLabel}`);
  L.push(`Resource group: rg-dadocar-dev-brs | Custo real (pré-impostos) | Moeda: ${agg.cur}`);
  L.push(`Gerado em: ${generatedIso}`);
  L.push("");
  L.push("== 1) CUSTO POR RECURSO ==");
  for (const r of agg.resources) L.push(`  ${r.resourceName.padEnd(36)} ${money(r.cost, agg.cur)}`);
  L.push(`  ${"TOTAL".padEnd(36)} ${money(agg.total, agg.cur)}`);
  L.push("");
  L.push("== 2) DETALHAMENTO POR MEDIÇÃO (METER) ==");
  for (const r of agg.resources.filter((x) => x.cost > 0)) {
    L.push(`  ${r.resourceName} — ${money(r.cost, agg.cur)}`);
    for (const m of r.meters) L.push(`     - ${m.meter} | qtd ${round2(m.qty)} | ${money(m.cost, agg.cur)}`);
  }
  const ins = insights(agg);
  if (ins.length) { L.push(""); L.push("== LEITURA RÁPIDA =="); for (const i of ins) L.push(`  * ${i}`); }
  return L.join("\n");
}

/** Index page listing all monthly reports (newest first). */
function indexHtml(items) {
  const links = items.sort((a, b) => b.localeCompare(a)).map((id) => `<li><a href="./${id}.html">${id}</a></li>`).join("\n");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatórios de Custo Azure</title>
<style>body{font-family:Inter,system-ui,Arial,sans-serif;background:#f6f8fc;color:#0b1220;margin:0;padding:32px}.w{max-width:560px;margin:0 auto;background:#fff;border:1px solid #e7eaf0;border-radius:16px;padding:26px}h1{font-size:22px}a{color:#0033a0}li{margin:6px 0;font-size:15px}</style>
</head><body><div class="w"><h1>Relatórios de Custo Azure</h1><p style="color:#5b6473">rg-dadocar-dev-brs · por mês</p><ul>${links}</ul></div></body></html>`;
}

module.exports = { aggregate, pageHtml, emailHtml, textReport, indexHtml };
