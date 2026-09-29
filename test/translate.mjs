/**
 * Translation helpers: clipping, Thai script detection, and Thai pivot.
 *
 * Run with: node test/translate.mjs
 */
import assert from 'node:assert/strict';
import { clipToLimit, isThai, translateViaThai } from '../src/lib/translate.mjs';

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

await t('clipToLimit preserves short strings under 100 chars', () => {
  assert.equal(clipToLimit('Hello world'), 'Hello world');
  assert.equal(clipToLimit(''), '');
});

await t('clipToLimit truncates to at most 100 chars and respects word boundaries', () => {
  const long = 'The African Union summit brought together delegates from across fifty-four nations in Addis Ababa today.';
  const clipped = clipToLimit(long, 100);
  assert.ok(clipped.length <= 100, `length was ${clipped.length}`);
  assert.ok(!clipped.endsWith(' '), 'should be trimmed');
  assert.ok(clipped.startsWith('The African Union'));
});

await t('isThai correctly recognizes Thai script', () => {
  assert.equal(isThai('สวัสดี'), true);
  assert.equal(isThai('Hello world'), false);
  assert.equal(isThai('Habari yako'), false);
  assert.equal(isThai(''), false);
});

await t('translateViaThai translates English to Swahili via Thai pivot', async () => {
  const res = await translateViaThai('Welcome to Africa today.', 'sw', 'en');
  assert.ok(res.text, 'must return text');
  assert.notEqual(res.text, 'Welcome to Africa today.');
  assert.equal(isThai(res.text), false, 'output must not be in Thai');
});

console.log(`\n  ${passed} translate checks passed`);
