/**
 * Sentence-aware chunking unit tests.
 *
 * Run with: node test/chunk.mjs
 */
import assert from 'node:assert/strict';
import { splitSentences, chunkBySentences } from '../src/lib/chunk.mjs';

let passed = 0;
const t = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.log(`  FAIL ${name}\n       ${error.message}`);
    process.exitCode = 1;
  }
};

await t('splitSentences splits on period, exclamation, and question marks', () => {
  const text = 'First sentence. Second sentence! Third sentence?';
  const sentences = splitSentences(text);
  assert.deepEqual(sentences, ['First sentence.', 'Second sentence!', 'Third sentence?']);
});

await t('splitSentences preserves quotes after punctuation', () => {
  const text = 'He said, "Welcome!" She replied, "Thank you."';
  const sentences = splitSentences(text);
  assert.equal(sentences[0], 'He said, "Welcome!"');
  assert.equal(sentences[1], 'She replied, "Thank you."');
});

await t('chunkBySentences strictly respects sentence boundaries', () => {
  const text = 'The president spoke today. Economic reforms were announced. Millions of citizens will benefit.';
  const chunks = chunkBySentences(text, 65);
  assert.ok(chunks.length >= 2);
  for (const c of chunks) {
    assert.ok(/[.!?…]$/.test(c), `Chunk did not end on sentence boundary: "${c}"`);
  }
});

console.log(`\n  ${passed} chunk checks passed`);
process.exit(process.exitCode || 0);
