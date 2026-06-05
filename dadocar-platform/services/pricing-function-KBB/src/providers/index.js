// ─────────────────────────────────────────────────────────────────────────────
// providers/index.js — pricing-provider registry.
// Adding a new pricing provider:
//   require("./<id>")           ← create the file alongside molicar.js
//   PROVIDERS.push(<id>)        ← single edit here
// No other code change required.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const molicar = require("./molicar");

const PROVIDERS = [
  molicar,
  // Future: require("./xpprecos"), require("./webmotors"), ...
];

function all()    { return PROVIDERS.slice(); }
function ids()    { return PROVIDERS.map(p => p.id); }
function byId(id) { return PROVIDERS.find(p => p.id === id) || null; }

module.exports = { all, ids, byId };
