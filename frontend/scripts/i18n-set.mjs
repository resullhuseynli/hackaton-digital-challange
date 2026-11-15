#!/usr/bin/env node
/**
 * Adds/updates keys in both locale files at once, so az.json and en.json never drift.
 * Usage: node scripts/i18n-set.mjs patch.json   where patch.json = { "a.b.c": ["az text", "en text"] }
 */
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('../src/i18n/locales/', import.meta.url);
const patch = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const [i, lang] of ['az', 'en'].entries()) {
  const file = new URL(`${lang}.json`, dir);
  const dict = JSON.parse(readFileSync(file, 'utf8'));
  for (const [path, values] of Object.entries(patch)) {
    const keys = path.split('.');
    let node = dict;
    for (const k of keys.slice(0, -1)) node = node[k] ??= {};
    node[keys.at(-1)] = values[i];
  }
  writeFileSync(file, JSON.stringify(dict, null, 2) + '\n');
}
console.log(`updated ${Object.keys(patch).length} keys in az.json and en.json`);
