// ─────────────────────────────────────────────────────────────────────────────
// cost.js — Azure Cost Management query for one calendar month, scoped to a RG.
// Uses the Function App's managed identity (DefaultAzureCredential) which must
// hold "Cost Management Reader" at the subscription (or RG) scope.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const { DefaultAzureCredential } = require("@azure/identity");

const COST_API = "2023-11-01";

/** Resolve the calendar month to report on. `month` = "YYYY-MM" or undefined
 *  (defaults to the PREVIOUS month relative to now, UTC). */
function monthRange(month) {
  const now = new Date();
  let y, m; // m is 0-based
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    y = Number(month.slice(0, 4));
    m = Number(month.slice(5, 7)) - 1;
  } else {
    y = now.getUTCFullYear();
    m = now.getUTCMonth() - 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  const from = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  const to = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59)); // last day of the month
  const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return {
    id: `${y}-${String(m + 1).padStart(2, "0")}`,         // 2026-05  (used in file names)
    labelEn: `${MONTHS_EN[m]} ${y}`,                       // May 2026 (email subject)
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

let _cred = null;
function credential() {
  if (!_cred) _cred = new DefaultAzureCredential();
  return _cred;
}

/** Query actual cost for a RG/month, grouped by ResourceId + MeterCategory + Meter.
 *  Returns the raw rows + the column order. */
async function queryMonth({ subscriptionId, resourceGroup, from, to }) {
  const token = (await credential().getToken("https://management.azure.com/.default")).token;
  const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.CostManagement/query?api-version=${COST_API}`;
  const body = {
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod: { from, to },
    dataset: {
      granularity: "None",
      aggregation: {
        totalCost: { name: "PreTaxCost", function: "Sum" },
        qty: { name: "UsageQuantity", function: "Sum" },
      },
      grouping: [
        { type: "Dimension", name: "ResourceId" },
        { type: "Dimension", name: "MeterCategory" },
        { type: "Dimension", name: "Meter" },
      ],
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Cost Management ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const cols = (json.properties.columns || []).map((c) => c.name);
  const idx = (n) => cols.indexOf(n);
  const I = { cost: idx("PreTaxCost"), qty: idx("UsageQuantity"), res: idx("ResourceId"), cat: idx("MeterCategory"), meter: idx("Meter"), cur: idx("Currency") };
  const rows = (json.properties.rows || []).map((r) => ({
    cost: Number(r[I.cost]) || 0,
    qty: Number(r[I.qty]) || 0,
    resourceId: String(r[I.res] || ""),
    resourceName: String(r[I.res] || "").split("/").pop() || "(sem nome)",
    meterCategory: String(r[I.cat] || ""),
    meter: String(r[I.meter] || ""),
    currency: String(r[I.cur] || "USD"),
  }));
  return rows;
}

module.exports = { monthRange, queryMonth };
