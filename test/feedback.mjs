/**
 * Recording and reporting per-language feedback.
 *
 * Run with: node test/feedback.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const dir = await mkdtemp(path.join(os.tmpdir(), 'afrispeech-feedback-test-'));
process.env.LISTEN_FEEDBACK_DIR = dir;
const { recordFeedback, feedbackReport } = await import('../src/lib/feedback.mjs');

let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ok   ${name}`); }
  catch (error) { console.log(`  FAIL ${name}\n       ${error.message}`); process.exitCode = 1; }
};

await t('no ratings yet is an empty report, not an error', async () => {
  assert.deepEqual(await feedbackReport(), {});
});

await t('ratings for one language are counted correctly', async () => {
  await recordFeedback({ languageCode: 'swh', rating: 'up' });
  await recordFeedback({ languageCode: 'swh', rating: 'up' });
  await recordFeedback({ languageCode: 'swh', rating: 'down' });
  const report = await feedbackReport();
  assert.deepEqual(report.swh, { up: 2, down: 1, total: 3, upRate: 66.7 });
});

await t('two ratings written at the same instant are both kept', async () => {
  // The whole reason ratings are one file each rather than one shared,
  // appended-to file: two writes landing in the same millisecond must not
  // overwrite one another the way a shared file under last-write-wins would.
  await Promise.all([
    recordFeedback({ languageCode: 'yor', rating: 'up' }),
    recordFeedback({ languageCode: 'yor', rating: 'up' }),
    recordFeedback({ languageCode: 'yor', rating: 'down' }),
    recordFeedback({ languageCode: 'yor', rating: 'down' }),
  ]);
  const report = await feedbackReport();
  assert.deepEqual(report.yor, { up: 2, down: 2, total: 4, upRate: 50 });
});

await t('languages with no ratings are left out of the report', async () => {
  const report = await feedbackReport();
  assert.ok(!('amh' in report), 'a language nobody rated should not appear');
});

await rm(dir, { recursive: true, force: true });
console.log(`\n  ${passed} feedback checks passed`);
