#!/usr/bin/env node
// Class-name guard. A feature that ships its own classes must keep them to its prefix, and no other
// file may use the same class (the scenery once reused `sk-sun` and `sk-day`, which the ribbon and the
// calendar already owned, and broke both).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OWNED = [
  { files: ['app/sticker/NightSky.tsx', 'app/sticker/DaySky.tsx'], prefix: 'sk-sky-', modifiers: /^(c\d|b\d|l\d|is-\d)$/ },
];
const walk = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f.startsWith('.')) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(f)) out.push(p);
  }
  return out;
};
const classesOf = text => new Set([...text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].flatMap(m => (m[1] || m[2] || '').replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean)));
const all = walk('app');
const bad = [];
for (const { files, prefix, modifiers } of OWNED) {
  const mine = new Set();
  for (const f of files) {
    for (const c of classesOf(readFileSync(f, 'utf8'))) {
      mine.add(c);
      if (!c.startsWith(prefix) && !modifiers.test(c)) bad.push(`${f}: class "${c}" must start with ${prefix}`);
    }
  }
  for (const f of all.filter(f => !files.includes(f)))
    for (const c of classesOf(readFileSync(f, 'utf8')))
      if (c.startsWith(prefix) && mine.has(c)) bad.push(`${f}: reuses "${c}" owned by ${files.join(' / ')}`);
}
if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
console.log('class names: scenery classes are prefixed and unshared');
