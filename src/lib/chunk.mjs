/**
 * Sentence-aware chunking for text-to-speech synthesis.
 *
 * Chunks text strictly along sentence boundaries (. ! ? … ። \n), packing
 * complete sentences together up to `maxChars` per chunk so Gemini Live turns
 * never cut off mid-sentence or mid-thought.
 */

const TERMINATORS = new Set(['.', '!', '?', '…', '።', '\n']);

/**
 * Split text into complete sentences, preserving trailing punctuation and quotes.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  const clean = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];

  const sentences = [];
  let current = '';

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    current += ch;

    if (TERMINATORS.has(ch)) {
      // Consume closing quotes or brackets (e.g. '."', '!")', '»')
      while (i + 1 < clean.length && /["'’”')\]»]/.test(clean[i + 1])) {
        current += clean[++i];
      }
      // Consume trailing whitespace
      while (i + 1 < clean.length && /\s/.test(clean[i + 1])) {
        i += 1;
      }
      const trimmed = current.trim();
      if (trimmed) sentences.push(trimmed);
      current = '';
    }
  }
  if (current.trim()) sentences.push(current.trim());
  return sentences;
}

/**
 * If a single sentence exceeds `maxChars`, split along clause boundaries (; , : -)
 * without cutting words.
 *
 * @param {string} sentence
 * @param {number} maxChars
 * @returns {string[]}
 */
export function splitOversized(sentence, maxChars) {
  const pieces = [];
  let rest = sentence.trim();
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    const cut = Math.max(
      window.lastIndexOf('; '),
      window.lastIndexOf(', '),
      window.lastIndexOf(': '),
      window.lastIndexOf(' - '),
    );
    if (cut > maxChars * 0.4) {
      pieces.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
      continue;
    }
    const space = window.lastIndexOf(' ');
    const at = space > 0 ? space : maxChars;
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest.trim()) pieces.push(rest.trim());
  return pieces;
}

/**
 * Pack sentences into chunks of at most `maxChars`, guaranteeing that chunks
 * strictly respect sentence boundaries wherever possible.
 *
 * @param {string} text
 * @param {number} [maxChars=220]
 * @returns {string[]}
 */
export function chunkBySentences(text, maxChars = 220) {
  const sentences = splitSentences(text);
  if (!sentences.length) return [];

  const chunks = [];
  let packed = '';

  for (const s of sentences) {
    if (!packed) {
      packed = s;
    } else if (packed.length + 1 + s.length <= maxChars) {
      packed += ' ' + s;
    } else {
      // Chunk ends strictly at sentence boundary
      chunks.push(packed);
      packed = s;
    }
  }
  if (packed) chunks.push(packed);

  const result = [];
  for (const c of chunks) {
    if (c.length <= maxChars) {
      result.push(c);
    } else {
      result.push(...splitOversized(c, maxChars));
    }
  }

  return result.filter(Boolean);
}
