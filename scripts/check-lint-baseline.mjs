#!/usr/bin/env node
// Lint must not get worse: the known baseline is 3 errors + 3 warnings (set-state-in-effect in life-hub.tsx).
import { execFileSync } from 'node:child_process';
const BASE = { errors: 3, warnings: 3 };
let out;
try {
  out = execFileSync('npx', ['eslint', '.', '--ignore-pattern', 'dist', '--ignore-pattern', 'dist-pages', '--ignore-pattern', '.next', '-f', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  out = e.stdout;
}
const res = JSON.parse(out);
const errors = res.reduce((n, f) => n + f.errorCount, 0);
const warnings = res.reduce((n, f) => n + f.warningCount, 0);
console.log(`lint: ${errors} errors, ${warnings} warnings (baseline ${BASE.errors}/${BASE.warnings})`);
if (errors > BASE.errors || warnings > BASE.warnings) process.exit(1);
