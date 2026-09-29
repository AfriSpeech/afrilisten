/**
 * Build src/lib/speech-data.mjs from the 51 African languages supported by Google Translate
 * with country and metadata mappings from afriso (https://github.com/AfriSpeech/afriso).
 *
 * Every language in this table is directly supported by the free Google Translate API
 * and pivots through Thai (`source -> th -> target`) before being universalised
 * via africa-g2p and spoken by Gemini Live.
 *
 * Usage:
 *   node scripts/build-languages.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const speechDataPath = path.join(root, 'src', 'lib', 'speech-data.mjs');

const GOOGLE_TRANSLATE_AFRICAN = [
  { code: 'ach', google: 'ach', name: 'Acholi' },
  { code: 'aar', google: 'aa', name: 'Afar' },
  { code: 'afr', google: 'af', name: 'Afrikaans' },
  { code: 'aka', google: 'ak', name: 'Akan' },
  { code: 'alz', google: 'alz', name: 'Alur' },
  { code: 'amh', google: 'am', name: 'Amharic' },
  { code: 'bam', google: 'bm', name: 'Bambara' },
  { code: 'bci', google: 'bci', name: 'Baoulé' },
  { code: 'bem', google: 'bem', name: 'Bemba' },
  { code: 'nya', google: 'ny', name: 'Chichewa' },
  { code: 'din', google: 'din', name: 'Dinka' },
  { code: 'dov', google: 'dov', name: 'Dombe' },
  { code: 'dyu', google: 'dyu', name: 'Dyula' },
  { code: 'ewe', google: 'ee', name: 'Ewe' },
  { code: 'fon', google: 'fon', name: 'Fon' },
  { code: 'gaa', google: 'gaa', name: 'Ga' },
  { code: 'hau', google: 'ha', name: 'Hausa' },
  { code: 'ibo', google: 'ig', name: 'Igbo' },
  { code: 'knc', google: 'kr', name: 'Kanuri' },
  { code: 'cgg', google: 'cgg', name: 'Kiga' },
  { code: 'kin', google: 'rw', name: 'Kinyarwanda' },
  { code: 'ktu', google: 'ktu', name: 'Kituba' },
  { code: 'kri', google: 'kri', name: 'Krio' },
  { code: 'lin', google: 'ln', name: 'Lingala' },
  { code: 'luo', google: 'luo', name: 'Luo' },
  { code: 'mlg', google: 'mg', name: 'Malagasy' },
  { code: 'mfe', google: 'mfe', name: 'Morisyen' },
  { code: 'ndc', google: 'ndc-ZW', name: 'Ndau' },
  { code: 'nus', google: 'nus', name: 'Nuer' },
  { code: 'orm', google: 'om', name: 'Oromo' },
  { code: 'nso', google: 'nso', name: 'Pedi' },
  { code: 'run', google: 'rn', name: 'Rundi' },
  { code: 'sag', google: 'sg', name: 'Sango' },
  { code: 'crs', google: 'crs', name: 'Seselwa Creole French' },
  { code: 'sna', google: 'sn', name: 'Shona' },
  { code: 'som', google: 'so', name: 'Somali' },
  { code: 'sot', google: 'st', name: 'Southern Sotho' },
  { code: 'sus', google: 'sus', name: 'Susu' },
  { code: 'swh', google: 'sw', name: 'Swahili' },
  { code: 'ssw', google: 'ss', name: 'Swati' },
  { code: 'tir', google: 'ti', name: 'Tigrinya' },
  { code: 'tiv', google: 'tiv', name: 'Tiv' },
  { code: 'twi', google: 'ak', name: 'Twi' },
  { code: 'lua', google: 'lua', name: 'Tshiluba' },
  { code: 'tso', google: 'ts', name: 'Tsonga' },
  { code: 'tsn', google: 'tn', name: 'Tswana' },
  { code: 'tum', google: 'tum', name: 'Tumbuka' },
  { code: 'ven', google: 've', name: 'Venda' },
  { code: 'wol', google: 'wo', name: 'Wolof' },
  { code: 'xho', google: 'xh', name: 'Xhosa' },
  { code: 'yor', google: 'yo', name: 'Yoruba' },
  { code: 'zul', google: 'zu', name: 'Zulu' },
];

/** Minimal quote-aware CSV parser */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

console.log('Fetching afriso languages.csv...');
const afrisoCsv = await fetch(
  'https://raw.githubusercontent.com/AfriSpeech/afriso/main/src/afriso/data/languages.csv',
).then((r) => {
  if (!r.ok) throw new Error(`afriso fetch failed: HTTP ${r.status}`);
  return r.text();
});

const [header, ...rows] = parseCsv(afrisoCsv);
const col = Object.fromEntries(header.map((name, i) => [name, i]));
const afriso = new Map();
for (const row of rows) {
  const code = row[col.iso639_3];
  if (!code) continue;
  afriso.set(code, {
    name: row[col.name],
    countries: row[col.countries] ? row[col.countries].split(';').filter((c) => c && c !== 'false') : [],
  });
}
console.log(`afriso: ${afriso.size} languages loaded.`);

const table = new Map();
for (const lang of GOOGLE_TRANSLATE_AFRICAN) {
  const info = afriso.get(lang.code);
  table.set(lang.code, {
    name: (info && info.name) || lang.name,
    google: lang.google,
    countries: (info && info.countries && info.countries.length) ? info.countries : [],
  });
}

// Special case / region overrides where afriso has specific dialect boundaries
if (table.has('swh')) {
  table.get('swh').countries = ['BI', 'KE', 'MZ', 'RW', 'SO', 'TZ', 'UG'];
}
if (table.has('aka')) {
  table.get('aka').name = 'Twi';
  table.get('aka').countries = ['GH', 'TG'];
}
if (table.has('twi')) {
  table.get('twi').name = 'Twi';
  table.get('twi').countries = ['GH', 'TG'];
}

console.log(`Built table with ${table.size} languages.`);

const lines = [...table.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([code, { name, google, countries }]) =>
    `  ${code}: { name: ${JSON.stringify(name)}, google: ${JSON.stringify(google)}, countries: ${JSON.stringify(countries)} },`);

const output = `/**
 * The languages this server can speak, with the Google Translate provider code for each.
 *
 * Generated by scripts/build-languages.mjs from the African languages supported
 * in Google Translate, with country coverage and names from afriso (https://github.com/AfriSpeech/afriso).
 *
 * Translation pivots through Thai (\`source -> th -> target\`) before being universalised
 * via africa-g2p (https://github.com/AfriSpeech/africa-g2p) and spoken by Gemini Live.
 * Regenerate with \`npm run build:speech-data\`.
 */
export const LANGUAGE_DATA = {
${lines.join('\n')}
};
`;

fs.writeFileSync(speechDataPath, output);
console.log(`Wrote ${speechDataPath}`);
