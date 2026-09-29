/**
 * Free Google Translate client with Thai pivot.
 *
 * Translates source text into the target African language by pivoting through
 * Thai (`source -> th -> target`), which forces translation out of high-resource
 * languages into an intermediate semantic representation before reaching the target.
 *
 * Client handles fallback across multiple Google Translate clients (`dict-chrome-ex`,
 * `at`, `it`) with automatic fallback to direct translation if the Thai hop does not take.
 */

const CLIENTS = ['dict-chrome-ex', 'at', 'it'];

/**
 * Checks whether text contains characters in the Thai Unicode block (U+0E00 - U+0E7F).
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isThai(text) {
  return /[\u0E00-\u0E7F]/.test(String(text || ''));
}

/**
 * Clip text to at most `limit` characters, landing on a sentence or word boundary.
 *
 * @param {string} text
 * @param {number} [limit=100]
 * @returns {string}
 */
export function clipToLimit(text, limit = 100) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const slice = clean.slice(0, limit);
  const lastStop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (lastStop >= limit * 0.6) return slice.slice(0, lastStop + 1).trim();
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace >= limit * 0.5) return slice.slice(0, lastSpace).trim();
  return slice.trim();
}

/**
 * Perform a single translation request using Google Translate free endpoints.
 *
 * @param {string} text
 * @param {string} sl Source language code (or "auto")
 * @param {string} tl Target language code
 * @param {number} [timeoutMs=6000]
 * @returns {Promise<{text: string, detected: string|null}>}
 */
export async function singleTranslate(text, sl, tl, timeoutMs = 6000) {
  let lastError;
  for (const client of CLIENTS) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?${new URLSearchParams({
        client,
        sl: sl || 'auto',
        tl,
        dt: 't',
        q: text,
      })}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          Accept: '*/*',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const translated = (data[0] || []).map((p) => p[0]).filter(Boolean).join('');
      const detected = data[2] || null;
      return { text: translated, detected };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('All translation clients failed');
}

/**
 * Translate text into `targetCode` by pivoting through Thai.
 *
 * @param {string} text
 * @param {string} targetCode Target Google Translate language code (e.g. "sw", "yo", "ha")
 * @param {string} [sourceLang="auto"]
 * @returns {Promise<{text: string, detected: string|null, translated: boolean}>}
 */
export async function translateViaThai(text, targetCode, sourceLang = 'auto') {
  if (!text || !targetCode) return { text: text || '', detected: null, translated: false };
  const clip = clipToLimit(text, 100);

  // If target is Thai itself
  if (targetCode === 'th') {
    try {
      const res = await singleTranslate(clip, sourceLang, 'th');
      return { text: res.text || clip, detected: res.detected, translated: true };
    } catch {
      return { text: clip, detected: null, translated: false };
    }
  }

  // Attempt Thai pivot: source -> Thai -> target
  try {
    const hop1 = await singleTranslate(clip, sourceLang, 'th');
    if (hop1.detected === targetCode) {
      // Input text was already in the target language
      return { text: clip, detected: hop1.detected, translated: false };
    }
    if (hop1.text && isThai(hop1.text)) {
      const hop2 = await singleTranslate(hop1.text, 'th', targetCode);
      if (hop2.text && !isThai(hop2.text)) {
        return { text: hop2.text, detected: hop1.detected, translated: true };
      }
    }
  } catch {
    // Pivot failed; proceed to direct translation fallback
  }

  // Fallback: direct translation source -> target
  try {
    const direct = await singleTranslate(clip, sourceLang, targetCode);
    return { text: direct.text || clip, detected: direct.detected, translated: true };
  } catch {
    return { text: clip, detected: null, translated: false };
  }
}
