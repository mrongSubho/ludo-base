/**
 * signing-triggers scanner — static, script-assisted audit helper.
 *
 * Enumerates every signMessageAsync / signTypedDataAsync / ensureAppSession /
 * ensureEcdhPublished site reachable from UI, with trigger context. Output is
 * a human table + JSON for docs/notes/signing-triggers.md.
 *
 * This script is READ-ONLY (fs reads only). It never edits, never networks.
 *
 * USAGE:
 *   node scripts/signing-triggers-scan.mjs
 *   node scripts/signing-triggers-scan.mjs --json
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const roots = ["hooks", "app", "lib"].map((d) => path.join(repoRoot, d));

const patterns = [
  { key: "signMessageAsync", re: /signMessageAsync\s*\(/g },
  { key: "signTypedDataAsync", re: /signTypedDataAsync\s*\(/g },
  { key: "ensureAppSession", re: /ensureAppSession\s*\(/g },
  { key: "ensureEcdhPublished", re: /ensureEcdhPublished\s*\(/g },
  { key: "publishMyEcdhPubkey", re: /publishMyEcdhPubkey\s*\(/g },
  { key: "setInterval", re: /setInterval\s*\(/g },
];

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(full, out);
    } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = roots.flatMap((r) => walk(r));
const hits = [];
for (const f of files) {
  let content = "";
  try {
    content = fs.readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    for (const p of patterns) {
      const m = line.match(p.re);
      if (m) {
        const rel = path.relative(repoRoot, f);
        hits.push({
          file: rel,
          line: idx + 1,
          kind: p.key,
          text: line.trim().slice(0, 200),
        });
      }
    }
  });
}

const asJson = process.argv.includes("--json");
if (asJson) {
  console.log(JSON.stringify({ repoRoot, totalFiles: files.length, hits }, null, 2));
} else {
  console.log(`# signing-triggers scan (static, script-assisted)`);
  console.log(`# files scanned: ${files.length} | hits: ${hits.length}`);
  console.log(`# generated: node scripts/signing-triggers-scan.mjs`);
  console.log("");
  const byKind = {};
  for (const h of hits) {
    byKind[h.kind] = (byKind[h.kind] || 0) + 1;
  }
  console.log("## counts by kind");
  for (const [k, v] of Object.entries(byKind)) console.log(`- ${k}: ${v}`);
  console.log("");
  console.log("## hits (file:line | kind | code)");
  const sorted = [...hits].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  for (const h of sorted) {
    console.log(`- ${h.file}:${h.line} | ${h.kind} | ${h.text}`);
  }
  console.log("");
  console.log("Next: curate into docs/notes/signing-triggers.md with cadence + failure-behavior columns.");
}
