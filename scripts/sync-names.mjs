/**
 * Refresh the names and country lists in speech-data.mjs from afriso.
 *
 * The provider code for each language is the part worth reviewing, so this
 * script leaves it alone and only fills in the descriptive fields. It also
 * reports any language that afriso knows but this table has no code for, because
 * a language missing here cannot be offered even though we have data for it.
 *
 * Usage: node scripts/sync-names.mjs [path-to-afrispeech-website]
 */
import fs from 'node:fs';
import path from 'node:path';

const website = process.argv[2] || process.env.AFRISPEECH_WEBSITE || '../../afrispeech';
const dataPath = path.resolve(website, 'src/data/languages.js');
if (!fs.existsSync(dataPath)) {
  console.error(`Cannot find ${dataPath}. Pass the website path as the first argument.`);
  process.exit(1);
}
const { findLanguage } = await import(dataPath);
const tablePath = path.resolve('src/lib/speech-data.mjs');
const source = fs.readFileSync(tablePath, 'utf8');

const rows = [...source.matchAll(/^ {2}([a-z]{3}): \{ name: ("(?:[^"\\]|\\.)*"), google: ("(?:[^"\\]|\\.)*"), countries: (\[[^\]]*\]) \},$/gm)];
if (!rows.length) {
  console.error('Could not read any rows from speech-data.mjs; has its shape changed?');
  process.exit(1);
}

let changed = 0;
const unmapped = [];
let updated = source;
for (const [, code, , google, countries] of rows) {
  const entry = findLanguage(code);
  if (!entry) { unmapped.push(code); continue; }
  const next = `  ${code}: { name: ${JSON.stringify(entry.name)}, google: ${google}, countries: ${JSON.stringify(entry.countries || [])} },`;
  if (next !== rows.find((r) => r[1] === code)[0]) changed += 1;
  updated = updated.replace(rows.find((r) => r[1] === code)[0], next);
}
if (changed) fs.writeFileSync(tablePath, updated);
console.log(`Checked ${rows.length} languages, refreshed ${changed}.`);
if (unmapped.length) console.log(`Not in afriso: ${unmapped.join(', ')}`);
