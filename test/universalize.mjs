/**
 * Universalize unit tests.
 *
 * Run with: node test/universalize.mjs
 */
import assert from 'node:assert/strict';
import { universalize } from '../src/lib/universalize.mjs';

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

await t('universalize handles empty string', async () => {
  assert.equal(await universalize('', 'swh'), '');
});

await t('universalize normalizes Twi special characters (ɔ, ɛ)', async () => {
  const res = await universalize('Onyankopɔn akwaaba', 'twi');
  assert.ok(!res.includes('ɔ'), 'should not contain open-o');
  assert.ok(res.includes('onyankopon'), `got: ${res}`);
});

await t('universalize romanizes Amharic Ge\'ez text', async () => {
  const res = await universalize('እግዚአብሔር', 'amh');
  assert.ok(/^[a-z0-9\s.]+$/i.test(res), `should be plain latin: ${res}`);
});

console.log(`\n  ${passed} universalize checks passed`);
process.exit(process.exitCode || 0);
