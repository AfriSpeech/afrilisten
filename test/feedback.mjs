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
const { recordFeedback, feedbackReport, renderFeedbackPage } = await import('../src/lib/feedback.mjs');

let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ok   ${name}`); }
  catch (error) { console.log(`  FAIL ${name}\n       ${error.message}`); process.exitCode = 1; }
};

await t('no ratings yet is an empty report, not an error', async () => {
  assert.deepEqual(await feedbackReport(), {});
});

await t('ratings for one language are counted correctly and track voice', async () => {
  await recordFeedback({ languageCode: 'swh', rating: 'up', voice: 'Charon' });
  await recordFeedback({ languageCode: 'swh', rating: 'up', voice: 'Charon' });
  await recordFeedback({ languageCode: 'swh', rating: 'down', voice: 'Puck' });
  const report = await feedbackReport();
  assert.equal(report.swh.up, 2);
  assert.equal(report.swh.down, 1);
  assert.equal(report.swh.total, 3);
  assert.equal(report.swh.upRate, 66.7);
  assert.equal(report.swh.voices.Charon.up, 2);
  assert.equal(report.swh.voices.Puck.down, 1);
});

await t('two ratings written at the same instant are both kept', async () => {
  // The whole reason ratings are one file each rather than one shared,
  // appended-to file: two writes landing in the same millisecond must not
  // overwrite one another the way a shared file under last-write-wins would.
  await Promise.all([
    recordFeedback({ languageCode: 'yor', rating: 'up', voice: 'Charon' }),
    recordFeedback({ languageCode: 'yor', rating: 'up', voice: 'Charon' }),
    recordFeedback({ languageCode: 'yor', rating: 'down', voice: 'Kore' }),
    recordFeedback({ languageCode: 'yor', rating: 'down', voice: 'Kore' }),
  ]);
  const report = await feedbackReport();
  assert.equal(report.yor.up, 2);
  assert.equal(report.yor.down, 2);
  assert.equal(report.yor.total, 4);
  assert.equal(report.yor.upRate, 50);
});

await t('languages with no ratings are left out of the report', async () => {
  const report = await feedbackReport();
  assert.ok(!('amh' in report), 'a language nobody rated should not appear');
});

await t('renderFeedbackPage produces a well-formed HTML document with metrics', async () => {
  const report = await feedbackReport();
  const html = renderFeedbackPage(report, [
    { code: 'swh', name: 'Swahili', countries: ['KE', 'TZ'] },
    { code: 'yor', name: 'Yoruba', countries: ['NG'] },
    { code: 'amh', name: 'Amharic', countries: ['ET'] },
  ]);
  assert.ok(html.includes('<!DOCTYPE html>'), 'should be full HTML');
  assert.ok(html.includes('Swahili'), 'should contain Swahili');
  assert.ok(html.includes('Yoruba'), 'should contain Yoruba');
  assert.ok(html.includes('Amharic'), 'should contain Amharic');
  assert.ok(html.includes('AfriListen'), 'should have brand heading');
  assert.ok(html.includes('Language Evaluation Benchmark'), 'should have title');
});

await rm(dir, { recursive: true, force: true });
console.log(`\n  ${passed} feedback checks passed`);
