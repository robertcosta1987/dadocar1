#!/usr/bin/env node
// refresh.mjs — copy the latest source markdown into ./content/ so the
// static site renders the freshest IaaS.MD + decisions/ tree. Run before
// every deploy. No transformation — the browser does the rendering.
//
// Usage:   node refresh.mjs
// Output:  docs/site/content/*.md  +  docs/site/content/manifest.json
"use strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(here, "..");
const repoRoot = path.resolve(docsRoot, "..");
const contentDir = path.join(here, "content");

async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }

async function copy(srcRel, dstName) {
  const src = path.join(docsRoot, srcRel);
  const dst = path.join(contentDir, dstName);
  const body = await fs.readFile(src, "utf8");
  await fs.writeFile(dst, body);
  return { srcRel, dstName, bytes: body.length };
}

function trySh(cmd) {
  try { return execSync(cmd, { cwd: repoRoot, encoding: "utf8" }).trim(); }
  catch { return ""; }
}

const main = async () => {
  await ensureDir(contentDir);

  const copied = [];
  // Lowercase the .MD extension on copy — case-sensitive filesystems
  // (Azure Static Web Apps is one) would otherwise miss the file when
  // the HTML asks for content/IaaS.md.
  copied.push(await copy("IaaS.MD", "IaaS.md"));
  copied.push(await copy("decisions/0001-closed-beta-launch.md", "0001-closed-beta-launch.md"));
  copied.push(await copy("decisions/0002-web-deploy-aesthetics-standard.md", "0002-web-deploy-aesthetics-standard.md"));
  copied.push(await copy("decisions/0003-doc-update-workflow.md", "0003-doc-update-workflow.md"));
  copied.push(await copy("decisions/0007-webclient-productization.md", "0007-webclient-productization.md"));
  copied.push(await copy("decisions/next-steps/README.md", "next-steps-README.md"));

  // individual gap items.
  for (let i = 1; i <= 18; i++) {
    const num = String(i).padStart(3, "0");
    const files = await fs.readdir(path.join(docsRoot, "decisions/next-steps"));
    const match = files.find(f => f.startsWith(`${num}-`));
    if (!match) continue;
    copied.push(await copy(`decisions/next-steps/${match}`, `next-steps-${num}.md`));
  }

  const manifest = {
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    commit: trySh("git rev-parse --short HEAD"),
    branch: trySh("git rev-parse --abbrev-ref HEAD"),
    files: copied.map(c => ({ from: c.srcRel, to: c.dstName, bytes: c.bytes }))
  };
  await fs.writeFile(path.join(contentDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`✓ refreshed ${copied.length} files into ${path.relative(repoRoot, contentDir)}/`);
  console.log(`  generated_at = ${manifest.generated_at}`);
  console.log(`  commit       = ${manifest.commit || "(no git)"}`);
};

main().catch((e) => { console.error(e); process.exit(1); });
