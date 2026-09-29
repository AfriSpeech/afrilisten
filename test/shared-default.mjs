/**
 * The usage notice's wording flips on LISTEN_SHARED_DEFAULT.
 *
 * config.mjs reads process.env once at import time, so this has to set the
 * variable before index.mjs (and so config.mjs) is ever imported in this
 * process -- unlike test/routes.mjs, which checks the default (unset) case
 * and must not import this module first, or Node's module cache would hand
 * both files the same, already-decided config.
 *
 * Run with: node test/shared-default.mjs
 */
import assert from 'node:assert/strict';

process.env.LISTEN_API_KEY ||= 'test-key-for-shared-default';
process.env.LISTEN_RATE_ENABLED = '0';
process.env.LISTEN_SHARED_DEFAULT = '1';

let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ok   ${name}`); }
  catch (error) { console.log(`  FAIL ${name}\n       ${error.message}`); process.exitCode = 1; }
};

const { default: worker } = await import('../src/index.mjs');

await t('the notice says this is the shared default, and how to opt out of it', async () => {
  const response = await worker.fetch(new Request('https://example.test/languages'));
  const { notice } = await response.json();
  assert.equal(notice.status, 'shared-default');
  assert.match(notice.message, /shared public service/);
  assert.match(notice.message, /unvetted per site/);
  assert.match(notice.production, /data-endpoint/);
});

console.log(`\n  ${passed} shared-default checks passed`);
