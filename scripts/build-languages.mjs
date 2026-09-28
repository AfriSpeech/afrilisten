/**
 * Build src/lib/speech-data.mjs from two sources:
 *
 *   - the word-level MT benchmark (gemini-word-mt-bench), which says how well
 *     Gemini actually translates into a language -- medium tier (>=30% pass)
 *     or better is the bar for offering it;
 *   - afriso (https://github.com/AfriSpeech/afriso), which supplies the name,
 *     language family and country list for anything the benchmark scored.
 *
 * A language enters the table when it clears the benchmark bar AND is not on
 * EXCLUDE below. That list is short and specific on purpose: the benchmark's
 * language set is "spoken in an African country", not "African language", so
 * it also contains colonial and diaspora languages (Arabic, Spanish, Yiddish,
 * Ladino) that happen to have a country entry. Family alone cannot separate
 * these from the languages that belong here: Malagasy is Austronesian and
 * Krio, Kabuverdianu, Cameroon Pidgin and the rest are Indo-European-lexified
 * creoles, but all of them are mother tongues of African populations, not
 * imports, so excluding by family would drop them along with what should
 * actually be cut.
 *
 * The existing 43 languages' `google` codes (real Google Translate codes,
 * curated by hand, still returned for backward compatibility even though
 * nothing in the pipeline reads them any more) are preserved across a
 * rebuild. A language with no such code gets its own iso639_3 as `google`,
 * which keeps every entry's `google` value unique without inventing an
 * association with a service this project no longer calls.
 *
 * Usage:
 *   node scripts/build-languages.mjs [path-to-gemini-word-mt-bench]
 *
 * Fetches afriso's languages.csv from GitHub at run time; the bench path
 * defaults to a sibling directory of this repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const benchRoot = path.resolve(
  process.argv[2] || process.env.MT_BENCH_PATH || path.join(root, '..', 'gemini-word-mt-bench'),
);
const summaryPath = path.join(benchRoot, 'results', 'summary.json');
if (!fs.existsSync(summaryPath)) {
  console.error(`Cannot find ${summaryPath}. Pass the bench repo path as the first argument.`);
  process.exit(1);
}

// Specific and short on purpose -- see the file header. Arabic's many
// varieties, then the non-African high-resource or diaspora languages that
// otherwise survive the tier cut.
const EXCLUDE = new Set([
  'ara', 'arb', 'arz', 'avl', 'ayl', 'apd', 'aec', 'acq', 'ary', 'aeb',
  'pga', 'shu', 'aju', 'arq', 'aao', 'yud', 'jrb', // Arabic and its varieties
  'spa', 'yid', 'ydd', 'lad', // Spanish, Yiddish, Eastern Yiddish, Ladino
]);

/** A minimal, quote-aware CSV line splitter. Good enough for afriso's export:
 *  no field we read embeds a comma, but alt_names (which we do not read)
 *  embeds escaped quotes, so a naive split(',') is not safe against the file
 *  as a whole. */
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
    countries: row[col.countries] ? row[col.countries].split(';').filter(Boolean) : [],
  });
}
console.log(`afriso: ${afriso.size} languages.`);

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const qualifying = summary.languages.filter(
  (l) => (l.tier === 'medium' || l.tier === 'strong') && !EXCLUDE.has(l.iso639_3),
);
console.log(`bench: ${summary.languages.length} scored, ${qualifying.length} at medium tier or better after exclusions.`);

const speechDataPath = path.join(root, 'src', 'lib', 'speech-data.mjs');
const existingSource = fs.readFileSync(speechDataPath, 'utf8');
const existingGoogle = new Map(
  [...existingSource.matchAll(/^\s*([a-z]{3}): \{ name: "(?:[^"\\]|\\.)*", google: "([^"\\]*)"/gm)]
    .map(([, code, google]) => [code, google]),
);

const table = new Map();
let noAfrisoEntry = 0;
for (const lang of qualifying) {
  const info = afriso.get(lang.iso639_3);
  if (!info) { noAfrisoEntry += 1; continue; }
  table.set(lang.iso639_3, {
    name: info.name,
    google: existingGoogle.get(lang.iso639_3) || lang.iso639_3,
    countries: info.countries,
  });
}

// The 4 currently-offered languages the benchmark scored below medium tier
// (Baoulé, Dinka, Nuer, Tiv) are deliberately not carried forward: the whole
// point of this table is that the benchmark decides what clears the bar,
// existing entries included. A language missing from the benchmark entirely
// (an afriso attribution gap, not a quality signal -- Bemba, Luo, Swahili)
// is not evidence of anything and is kept as-is.
for (const [code, google] of existingGoogle) {
  if (table.has(code)) continue;
  const stillScored = summary.languages.find((l) => l.iso639_3 === code);
  if (stillScored) continue; // scored and didn't qualify: drop it
  const match = existingSource.match(new RegExp(`^\\s*${code}: (\\{[^}]*\\}),?$`, 'm'));
  if (match) {
    const kept = new Function(`return ${match[1]}`)();
    table.set(code, kept);
  }
}

console.log(`No afriso entry for ${noAfrisoEntry} benchmark languages (skipped).`);
console.log(`Final table: ${table.size} languages.`);

const lines = [...table.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([code, { name, google, countries }]) =>
    `  ${code}: { name: ${JSON.stringify(name)}, google: ${JSON.stringify(google)}, countries: ${JSON.stringify(countries)} },`);

const output = `/**
 * The languages this server can speak, with a legacy provider code for each.
 *
 * Generated by scripts/build-languages.mjs from the word-level MT benchmark
 * (gemini-word-mt-bench) and afriso (https://github.com/AfriSpeech/afriso).
 * A language is here because Gemini scored medium tier (>=30% pass) or
 * better translating into it in that benchmark, with a short, specific
 * exclude list of colonial and diaspora languages that share the benchmark's
 * "spoken in an African country" criterion without being one -- see the
 * build script for the exact list and reasoning. Regenerate with
 * \`npm run build:speech-data\`.
 *
 * \`google\` is a Google Translate code where this project used to have one,
 * curated by hand, kept only for API backward compatibility. Where there
 * never was one, it is the language's own iso639_3 code, so the field stays
 * unique without claiming an association with a service nothing here calls.
 * Names and countries are only used for the catalogue and for deciding which
 * language a reader in a given country should default to; neither affects
 * what gets spoken.
 */
export const LANGUAGE_DATA = {
${lines.join('\n')}
};
`;

fs.writeFileSync(speechDataPath, output);
console.log(`Wrote ${speechDataPath}`);
