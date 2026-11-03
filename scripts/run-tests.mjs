#!/usr/bin/env node
// Bundles each tests/*.test.ts with esbuild (so TypeScript imports resolve) and runs it with node:test.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'lifehub-tests-'));
let failed = 0;
for (const f of readdirSync('tests').filter(f => f.endsWith('.test.ts'))) {
  const out = join(dir, f.replace('.ts', '.mjs'));
  execFileSync('./node_modules/.bin/esbuild', [`tests/${f}`, '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`, '--log-level=error']);
  try {
    const r = execFileSync('node', ['--test', out], { encoding: 'utf8' });
    console.log(`${f}: ${(r.match(/ℹ pass (\d+)/) || [])[1]} passed`);
  } catch (e) {
    failed++;
    console.error(e.stdout || e.message);
  }
}
if (failed) process.exit(1);
