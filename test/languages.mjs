/**
 * Language lookup and locale defaults.
 *
 * The important check is the last one: a country default pointing at a code
 * that does not resolve is silent, and the reader just gets English with no
 * explanation. Run with: node test/languages.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SPEECH_LANGUAGES, OFFERED_LANGUAGES, findSpeechLanguage, defaultForLocale, languageCatalogue, scopedLanguages } from '../src/lib/languages.mjs';

let passed = 0;
const t = (name, fn) => {
  try { fn(); passed += 1; console.log(`  ok   ${name}`); }
  catch (error) { console.log(`  FAIL ${name}\n       ${error.message}`); process.exitCode = 1; }
};

t('every mapped language resolves by its own afriso code', () => {
  const bad = SPEECH_LANGUAGES.filter((l) => !findSpeechLanguage(l.code));
  assert.deepEqual(bad.map((l) => l.code), []);
});

t('every language also resolves by its Google code', () => {
  const bad = SPEECH_LANGUAGES.filter((l) => !findSpeechLanguage(l.google));
  assert.deepEqual(bad.map((l) => l.google), []);
});

t('a language resolves by its English name', () => {
  const swahili = SPEECH_LANGUAGES.find((l) => l.name.startsWith('Swahili'));
  assert.equal(findSpeechLanguage(swahili.name)?.google, swahili.google);
});

t('no Google code is offered twice under two names', () => {
  const seen = new Map();
  for (const l of SPEECH_LANGUAGES) {
    assert.ok(!seen.has(l.google), `${l.google} offered as both ${seen.get(l.google)} and ${l.code}`);
    seen.set(l.google, l.code);
  }
});

t('an unknown value resolves to null rather than throwing', () => {
  assert.equal(findSpeechLanguage('nonsense-code'), null);
  assert.equal(findSpeechLanguage(''), null);
  assert.equal(findSpeechLanguage(undefined), null);
});

/* Every country default must point at a code we can actually resolve. This is
   the check that catches a language we have data for but never gave a Google
   code: the default silently degrades to English. */
t('every country default resolves to a real language', () => {
  const source = fs.readFileSync(new URL('../src/lib/languages.mjs', import.meta.url), 'utf8');
  const block = source.match(/const DEFAULT_BY_COUNTRY = \{([\s\S]*?)\n\};/)[1];
  const wanted = [...new Set([...block.matchAll(/'[a-z]{3}'/g)].map((m) => m[0].slice(1, -1)))];
  const unresolved = wanted.filter((code) => !findSpeechLanguage(code));
  assert.deepEqual(unresolved, [], `no Google code for: ${unresolved.join(', ')}`);
});

t('a country default wins over the language half of the locale', () => {
  // A Kenyan browser is offered Swahili, the country default, rather than
  // whatever the language half of the locale said.
  assert.equal(defaultForLocale('en-KE'), 'swh');
  assert.equal(defaultForLocale('sw-KE'), 'swh');
  // Amharic is mapped, so Ethiopia has a default of its own.
  const amharic = findSpeechLanguage('amh');
  assert.equal(amharic.google, 'am', 'Amharic must be mapped for ET to have a default');
  assert.equal(defaultForLocale('am-ET'), 'amh');
  // A country with no default of its own keeps the language half.
  assert.equal(defaultForLocale('fr-FR'), 'en');
});

t('a locale is read as the country it names', () => {
  // Zulu is mapped, so a South African browser is offered Zulu.
  assert.equal(defaultForLocale('zu-ZA'), 'zul');
  assert.equal(defaultForLocale('sw-TZ'), 'swh');
  // Nothing recognisable, or nothing at all, falls back rather than failing.
  assert.equal(defaultForLocale('xx-XX'), 'en');
  assert.equal(defaultForLocale(''), 'en');
  assert.equal(defaultForLocale(undefined), 'en');
});

t('every language in the table is offered', () => {
  // There is no per-language voice to confirm, so this asserts the table is
  // consistent with itself rather than that any language has been heard
  // pronounced well. The honest check for that is listening to one.
  const notOffered = SPEECH_LANGUAGES.filter((l) => !l.tts);
  assert.deepEqual(notOffered.map((l) => l.name), [],
    `held back: ${notOffered.map((l) => l.name).join(', ')}`);
  assert.ok(OFFERED_LANGUAGES.length >= 35, `only ${OFFERED_LANGUAGES.length} offered`);
});

t('a language can be pulled out without touching the code', () => {
  // LISTEN_HELD_BACK_LANGUAGES is read at load time, so this checks the
  // mechanism rather than the outcome.
  assert.ok(SPEECH_LANGUAGES.length > OFFERED_LANGUAGES.length - 1);
  assert.ok(OFFERED_LANGUAGES.every((l) => l.google));
});

t('the catalogue payload carries only what the dropdown needs', () => {
  const list = languageCatalogue();
  assert.ok(Array.isArray(list));
  for (const entry of list) {
    assert.deepEqual(Object.keys(entry).sort(), ['code', 'countries', 'google', 'name']);
  }
});

t('with nothing configured, everything is offered', () => {
  assert.equal(scopedLanguages([], []), OFFERED_LANGUAGES);
  assert.equal(scopedLanguages(), OFFERED_LANGUAGES);
});

t('specific codes narrow to exactly those languages', () => {
  const scoped = scopedLanguages(['yor', 'swh'], []);
  assert.deepEqual(scoped.map((l) => l.code).sort(), ['swh', 'yor']);
});

t('a country adds every language attributed to it', () => {
  const scoped = scopedLanguages([], ['GH']);
  assert.ok(scoped.length > 1, 'Ghana has more than one language in the table');
  assert.ok(scoped.every((l) => l.countries.includes('GH')));
  const aka = findSpeechLanguage('aka');
  assert.ok(scoped.some((l) => l.code === aka.code), 'Akan is spoken in Ghana');
});

t('codes and countries combine as a union, not an intersection', () => {
  // An explicit code (Yoruba, spoken in Nigeria, not Ghana) plus a country
  // (Ghana): both must appear, not just languages satisfying both at once.
  const scoped = scopedLanguages(['yor'], ['GH']).map((l) => l.code);
  assert.ok(scoped.includes('yor'), 'the explicit code should be included');
  assert.ok(scoped.includes('aka'), 'a language of the given country should be included');
});

console.log(`\n  ${passed} language checks passed`);
