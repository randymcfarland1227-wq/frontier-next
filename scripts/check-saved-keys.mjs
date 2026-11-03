#!/usr/bin/env node
// Fails when code saves under a key that isn't filed in lib/dataRegistry.ts (cloud / device / cache).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f.startsWith('.')) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p);
  }
  return out;
};
const files = ['app', 'lib', 'src'].flatMap(d => walk(d));
const registry = readFileSync('lib/dataRegistry.ts', 'utf8');
const filed = new Set([...registry.matchAll(/key: '([^']+)'/g)].map(m => m[1]));
const used = new Map();
const note = (k, f) => used.set(k, [...(used.get(k) || []), f]);
for (const f of files) {
  if (f === 'lib/dataRegistry.ts') continue;
  const t = readFileSync(f, 'utf8');
  for (const m of t.matchAll(/['"`](lifehub-[a-z0-9-]+)['"`]/g)) note(m[1], f);
  for (const m of t.matchAll(/(?:readSaved|writeSaved|useSavedChoice|getItem|setItem|dayRecord|useDayState)(?:<[^>()]*>)?\(\s*['"](sk-[a-z0-9-]+)['"]/g)) note(m[1], f);
}
const missing = [...used.keys()].filter(k => !filed.has(k)).sort();
const stale = [...filed].filter(k => !used.has(k)).sort();
if (stale.length) console.log(`note: ${stale.length} filed key(s) no longer appear in code: ${stale.join(', ')}`);
if (missing.length) {
  console.error('Saved keys used in code but not filed in lib/dataRegistry.ts (choose cloud, device or cache):');
  for (const k of missing) console.error(`  ${k}   (${used.get(k)[0]})`);
  process.exit(1);
}
console.log(`saved keys: ${used.size} in use, all filed in lib/dataRegistry.ts`);
