// ─────────────────────────────────────────────────────────────────────────────
// costReport.js — monthly Azure cost report.
//   • Timer trigger: 1st of every month, 08:00 UTC → reports the PREVIOUS month.
//   • HTTP trigger:  GET /api/cost-report[?month=YYYY-MM] → run on demand.
// For the target month it: queries Cost Management, builds a per-resource report
// and a meter-level report, publishes a static HTML page (<YYYY-MM>.html) + an
// index, saves a <YYYY-MM>.txt to blob, and e-mails the stakeholders via ACS.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { app } = require("@azure/functions");
const { BlobServiceClient } = require("@azure/storage-blob");
const { EmailClient } = require("@azure/communication-email");
const { monthRange, queryMonth } = require("../lib/cost");
const { aggregate, pageHtml, emailHtml, textReport, indexHtml } = require("../lib/render");

const DEFAULT_SUB = "587a98de-d3a2-417d-9dbf-33459f464a6c";

function cfg() {
  return {
    subscriptionId: process.env.COST_SUBSCRIPTION_ID || DEFAULT_SUB,
    resourceGroup: process.env.COST_RESOURCE_GROUP || "rg-dadocar-dev-brs",
    storageConn: process.env.REPORTS_STORAGE_CONNECTION,
    webEndpoint: (process.env.REPORTS_WEB_ENDPOINT || "").replace(/\/$/, ""),
    acsConn: process.env.ACS_CONNECTION_STRING,
    acsSender: process.env.ACS_SENDER,
    recipients: (process.env.REPORT_RECIPIENTS || "rcosta1987@icloud.com,suporte@moneycar.com.br,suporte@profitcar.com.br")
      .split(",").map((s) => s.trim()).filter(Boolean),
  };
}

async function uploadText(container, name, content, contentType) {
  await container.createIfNotExists();
  const blob = container.getBlockBlobClient(name);
  await blob.upload(content, Buffer.byteLength(content), {
    blobHTTPHeaders: { blobContentType: contentType, blobCacheControl: "public, max-age=300" },
  });
}

async function run(month, log) {
  const c = cfg();
  if (!c.storageConn) throw new Error("REPORTS_STORAGE_CONNECTION not set");
  const { id, labelEn, from, to } = monthRange(month);
  log.info(`Cost report for ${id} (${from}..${to})`);

  const rows = await queryMonth({ subscriptionId: c.subscriptionId, resourceGroup: c.resourceGroup, from, to });
  const agg = aggregate(rows);
  const generatedIso = new Date().toISOString();

  const page = pageHtml(agg, labelEn, generatedIso);
  const text = textReport(agg, labelEn, generatedIso);
  const body = emailHtml(agg, labelEn);

  // Publish: static page (indexed by month) + text file + refreshed index.
  const svc = BlobServiceClient.fromConnectionString(c.storageConn);
  const web = svc.getContainerClient("$web");
  const reports = svc.getContainerClient("reports");
  await uploadText(web, `${id}.html`, page, "text/html; charset=utf-8");
  await uploadText(reports, `${id}.txt`, text, "text/plain; charset=utf-8");

  // Rebuild the index from every monthly page present.
  const ids = [];
  for await (const b of web.listBlobsFlat()) { const m = b.name.match(/^(\d{4}-\d{2})\.html$/); if (m) ids.push(m[1]); }
  await uploadText(web, "index.html", indexHtml(ids), "text/html; charset=utf-8");

  const pageUrl = c.webEndpoint ? `${c.webEndpoint}/${id}.html` : null;

  // Email the stakeholders.
  let emailStatus = "skipped (ACS not configured)";
  if (c.acsConn && c.acsSender && c.recipients.length) {
    const client = new EmailClient(c.acsConn);
    const html = pageUrl ? `${body}<p style="font-size:13px"><a href="${pageUrl}">Ver relatório completo (página)</a></p>` : body;
    const poller = await client.beginSend({
      senderAddress: c.acsSender,
      content: { subject: `Azure Cloud Cost to Run the company in the month of ${labelEn}`, html, plainText: text + (pageUrl ? `\n\nRelatório: ${pageUrl}` : "") },
      recipients: { to: c.recipients.map((address) => ({ address })) },
    });
    const result = await poller.pollUntilDone();
    emailStatus = `${result.status} → ${c.recipients.join(", ")}`;
  }

  const summary = { month: id, total: agg.total, currency: agg.cur, pageUrl, email: emailStatus };
  log.info(`Done: ${JSON.stringify(summary)}`);
  return summary;
}

app.timer("costReportTimer", {
  schedule: "0 0 8 1 * *", // 1st of month, 08:00 UTC → previous month
  handler: async (_t, ctx) => { await run(undefined, ctx); },
});

app.http("costReportHttp", {
  methods: ["GET", "POST"],
  authLevel: "function",
  route: "cost-report",
  handler: async (req, ctx) => {
    try {
      const month = req.query.get("month") || undefined;
      const summary = await run(month, ctx);
      return { jsonBody: { ok: true, ...summary } };
    } catch (e) {
      ctx.error(e);
      return { status: 500, jsonBody: { ok: false, error: e.message } };
    }
  },
});
