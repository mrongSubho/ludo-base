#!/usr/bin/env node
/**
 * Function-signature gate.
 *
 * Why this exists: `CREATE OR REPLACE FUNCTION` with a *different* argument list
 * does not replace — it creates an OVERLOAD. On 2026-10-22 migration
 * 202610220002 re-declared `join_matchmaking` with `integer` wagers while the
 * baseline had `numeric`, so the database ended up with both. PostgREST then
 * refused to choose and every quick-match join returned:
 *
 *   Could not choose the best candidate function between:
 *     public.join_matchmaking(p_player_id => text, p_game_mode => text, ...)
 *
 * `check:schema` counted migrations and function definitions, so a silent
 * overload looked exactly like a normal update. This gate compares each
 * definition's argument TYPES against the previous definition of the same name.
 *
 * Rule: redefining a function with a different type list is allowed only if the
 * migration also DROPs the old signature. That is what makes the change a
 * replacement rather than an overload — and it forces the author to say so.
 *
 * Static: reads files only, no database. Safe for CI.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = join(ROOT, 'supabase', 'migrations');

const files = readdirSync(DIR).filter((f) => /^\d{6,}\d*_.*\.sql$/.test(f)).sort();

/** Split a parameter list on top-level commas. */
function splitParams(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Reduce one parameter declaration to just its type. */
function paramType(decl) {
  let d = decl.trim().replace(/\s+/g, ' ');
  // Drop a `default …` tail (may contain commas inside quotes/casts, but we have
  // already split on top-level commas so anything left is the type + default).
  const defIdx = d.search(/\s+default\s+/i);
  if (defIdx !== -1) d = d.slice(0, defIdx).trim();
  // Drop a leading parameter name if there are two tokens and the first is an
  // identifier (p_x, v_x, or any bare word) rather than a type keyword.
  const parts = d.split(' ');
  if (parts.length >= 2) {
    const first = parts[0].toLowerCase();
    const isModifier = /^(in|out|inout|variadic)$/.test(first);
    if (!isModifier) d = parts.slice(1).join(' ');
  }
  return d.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Pull every function definition and DROP out of one file, in order. */
function scan(src) {
  const defs = [];
  const drops = [];

  const defRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
  let m;
  while ((m = defRe.exec(src))) {
    // Walk forward to the matching close paren.
    let i = defRe.lastIndex;
    let depth = 1;
    let start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    const raw = src.slice(start, i - 1);
    defs.push({ name: m[1].toLowerCase(), types: splitParams(raw).map(paramType).join(','), index: m.index });
  }

  const dropRe = /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s*\(([^)]*)\)/gi;
  while ((m = dropRe.exec(src))) {
    drops.push({ name: m[1].toLowerCase(), types: splitParams(m[2]).map(paramType).join(',') });
  }

  return { defs, drops };
}

// Replay the migration chain and track LIVE signatures per function name.
//
// The invariant that matters is the database's own: at the end of the chain, a
// function name must have exactly ONE live signature. `CREATE OR REPLACE` with
// the same argument list replaces; with a different list it ADDS an overload.
// A `DROP FUNCTION name(types)` removes one. So a migration may legitimately
// change a signature as long as it drops the old one — and an overload that is
// never dropped is exactly the bug that broke quick match.
const live = new Map(); // name -> Map<sig, file>

for (const file of files) {
  const { defs, drops } = scan(readFileSync(join(DIR, file), 'utf8'));
  const events = [
    ...drops.map((d) => ({ kind: 'drop', name: d.name, sig: d.types, index: d.index ?? 0 })),
    ...defs.map((d) => ({ kind: 'def', name: d.name, sig: d.types, index: d.index })),
  ].sort((a, b) => a.index - b.index);

  for (const e of events) {
    if (!live.has(e.name)) live.set(e.name, new Map());
    const sigs = live.get(e.name);
    if (e.kind === 'drop') sigs.delete(e.sig);
    else sigs.set(e.sig, file);
  }
}

const problems = [];
for (const [name, sigs] of live) {
  if (sigs.size > 1) {
    problems.push({ name, sigs: [...sigs.entries()] });
  }
}

if (problems.length > 0) {
  console.error(`✗ function-signature gate: ${problems.length} function(s) end the chain with multiple live signatures\n`);
  for (const p of problems) {
    console.error(`  ${p.name} has ${p.sigs.length} overloads after all migrations:`);
    for (const [sig, file] of p.sigs) console.error(`    (${sig})   ← ${file}`);
    console.error('    → PostgREST cannot choose between overloads and returns');
    console.error('      "Could not choose the best candidate function". Every caller gets a 500.');
    console.error(`      Fix: DROP FUNCTION IF EXISTS ${p.name}(<the stale signature>); in a new migration.\n`);
  }
  process.exit(1);
}

console.log(`✓ function-signature gate clean (${files.length} migrations, no silent overloads)`);
