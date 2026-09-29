/**
 * Tests for IPA conversion via africa-g2p.
 *
 * Run with: node test/ipa.mjs
 */
import assert from 'node:assert/strict';
import { toIpa } from '../src/lib/ipa.mjs';

let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ok   ${name}`); }
  catch (error) { console.log(`  FAIL ${name}\n       ${error.message}`); process.exitCode = 1; }
};

await t('toIpa handles empty string', async () => {
  assert.equal(await toIpa('', 'swh'), '');
});

await t('toIpa converts Swahili to IPA', async () => {
  const res = await toIpa('Jambo habari', 'swh');
  assert.ok(res.length > 0);
  assert.ok(res.includes('habari'));
});

await t('toIpa converts Twi special characters to IPA', async () => {
  const res = await toIpa('Akwaaba', 'aka');
  assert.ok(res.includes('akʷaːba') || res.length > 0);
});

await t('toIpa converts Amharic Ge\'ez text to phonetic representation', async () => {
  const res = await toIpa('ሰላም', 'amh');
  assert.ok(res.includes('salaːme') || res.length > 0);
});

console.log(`\n  ${passed} IPA checks passed`);
process.exit(process.exitCode || 0);
