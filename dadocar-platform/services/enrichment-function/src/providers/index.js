// ─────────────────────────────────────────────────────────────────────────────
// providers/index.js — registry.
// Adding a new provider:
//   require("./<id>")           ← create the file alongside infocar.js
//   PROVIDERS.push(<id>)        ← single edit here
// No other code change required.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const infocar = require("./infocar");

const PROVIDERS = [
  infocar,
  // Future: require("./denatran"), require("./checagem"), ...
];

function all()        { return PROVIDERS.slice(); }
function ids()        { return PROVIDERS.map(p => p.id); }
function byId(id)     { return PROVIDERS.find(p => p.id === id) || null; }

module.exports = { all, ids, byId };
