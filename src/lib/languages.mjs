/**
 * The languages the Listen feature can actually speak.
 *
 * A language is offered only when there is a code for it on both sides: the
 * ISO 639-3 code afriso uses, and a second code that the generated table carries
 * for the underlying provider. The second is now only a label rather than
 * something in the request path, since there is no separate translation call, but
 * the entry is what says a language is known to work rather than merely written
 * down.
 *
 * The name and country list for each code come from the generated table in
 * speech-data.mjs, which this repository owns.
 */

import { LANGUAGE_DATA } from './speech-data.mjs';


/**
 * There is no per-language voice to confirm, and no probe that would tell us
 * anything true: one voice reads whatever language it is given, so testing it
 * would find a model producing words, not a language working. `tts` is
 * therefore a claim this file makes rather than one it has verified, and the
 * honest way to narrow it is to listen.
 *
 * LISTEN_HELD_BACK_LANGUAGES exists so a language that turns out to be unusable
 * can be pulled out without a code change.
 */
const HELD_BACK = new Set(
  String(process.env.LISTEN_HELD_BACK_LANGUAGES || '')
    .split(',')
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean),
);

const BY_GOOGLE = new Map();
const BY_AFRISO = new Map();

export const SPEECH_LANGUAGES = Object.entries(LANGUAGE_DATA)
  .map(([code, entry]) => ({
    code,
    name: entry.name,
    countries: entry.countries,
    google: entry.google,
    tts: Boolean(entry.google) && !HELD_BACK.has(entry.google.toLowerCase()),
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  // `aka` and `twi` are the same continuum under two names; offer it once.
  .filter((lang, i, all) => all.findIndex((l) => l.google === lang.google) === i);

for (const lang of SPEECH_LANGUAGES) {
  // Lookups are lowercased, so index that way. Ndau's provider code carries a
  // region tag ("ndc-ZW") and would otherwise be unreachable by its own code.
  if (!BY_GOOGLE.has(lang.google.toLowerCase())) BY_GOOGLE.set(lang.google.toLowerCase(), lang);
  if (!BY_AFRISO.has(lang.code)) BY_AFRISO.set(lang.code, lang);
}

/** Languages the widget may offer. */
export const OFFERED_LANGUAGES = SPEECH_LANGUAGES.filter((l) => l.tts);

/** Resolve an afriso code, a Google code, or an English name. */
export function findSpeechLanguage(value) {
  const key = String(value || '').trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  return BY_AFRISO.get(lower) || BY_GOOGLE.get(lower)
    || SPEECH_LANGUAGES.find((l) => l.name.toLowerCase() === lower)
    || null;
}

/**
 * Which language to default to per country, so a reader in Tanzania is offered
 * Swahili and one in Nigeria Yoruba, rather than whatever sorts first.
 * Countries with no listed African language fall through to English.
 */
const DEFAULT_BY_COUNTRY = {
  // East
  TZ: 'swh', KE: 'swh', UG: 'swh', RW: 'kin', BI: 'run', CD: 'lin',
  CG: 'lin', GA: 'fon', CM: 'fon', CF: 'sag', ET: 'amh', SO: 'som',
  DJ: 'som', ER: 'tir', SS: 'din', SD: 'din',
  // Southern
  ZA: 'zul', ZW: 'sna', ZM: 'sna', BW: 'swh', NA: 'afr', LS: 'sot',
  SZ: 'ssw', MW: 'nya',
  // West
  NG: 'yor', GH: 'aka', TG: 'aka', CI: 'bci', SN: 'wol', GM: 'wol',
  // North and islands
  MA: 'zgh', MG: 'mlg', SC: 'crs',
};

/**
 * Pick a starting language from a browser locale such as "sw-TZ", "yo-NG" or
 * "en-GB": exact country match first, then the language half of the tag, then
 * English.
 */
export function defaultForLocale(locale) {
  const tag = String(locale || '').trim();
  if (!tag) return 'en';

  const [langPart, region] = tag.split(/[-_]/);
  const regional = DEFAULT_BY_COUNTRY[(region || '').toUpperCase()];
  if (regional) {
    const lang = findSpeechLanguage(regional);
    if (lang && lang.tts) return lang.code;
  }

  const direct = findSpeechLanguage(langPart);
  if (direct && direct.tts) return direct.code;

  return 'en';
}

/** Compact payload for the widget's dropdown. */
export function languageCatalogue() {
  return OFFERED_LANGUAGES.map(({ code, name, google, countries }) => ({
    code, name, google, countries,
  }));
}
