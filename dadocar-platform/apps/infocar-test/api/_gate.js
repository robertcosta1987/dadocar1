// ─────────────────────────────────────────────────────────────────────────────
// api/_gate.js
// Shared bearer-token check for every Vercel API function. The underscore
// prefix tells Vercel not to expose this as a route.
//
// The expected secret comes from DADOCAR_GATE_SECRET on Vercel. If it's not
// set at all, the function denies the request (fail closed) — the app is
// gated by design and a missing env var is a misconfiguration, not "no gate".
// Use timingSafeEqual to avoid trivial string-compare timing leaks.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";
const { timingSafeEqual } = require("node:crypto");

function readGateSecret(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization || "";
  if (!auth.startsWith("Bearer ")) return "";
  return auth.slice("Bearer ".length).trim();
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

/**
 * Returns true if the request is authorized. Sends the 401 response itself
 * when it isn't — caller should `return` immediately if this returns false.
 */
function enforceGate(req, res) {
  const expected = process.env.DADOCAR_GATE_SECRET || "";
  if (!expected) {
    res.status(503).setHeader("content-type", "application/json").send(
      JSON.stringify({
        error: "gate_unconfigured",
        message: "DADOCAR_GATE_SECRET is not set on the server. The deployment is mis-configured.",
      })
    );
    return false;
  }
  const presented = readGateSecret(req);
  if (!constantTimeEqual(presented, expected)) {
    res.status(401).setHeader("content-type", "application/json").send(
      JSON.stringify({
        error: "unauthorized",
        message: "Missing or invalid Authorization: Bearer <secret> header.",
      })
    );
    return false;
  }
  return true;
}

module.exports = { enforceGate };
