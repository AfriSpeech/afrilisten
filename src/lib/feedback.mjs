/**
 * Per-language feedback: a thumbs up or down on the audio just played.
 *
 * Stored as one small file per rating, not appended to a shared log. Modal
 * Volumes -- where this lives in production -- commit in the background
 * every few seconds and use last-write-wins on a shared file: two ratings
 * written around the same moment from different containers could silently
 * drop one. Two different files never conflict, whatever the timing, so a
 * directory of small per-rating files is the shape that is actually safe to
 * write concurrently, at the cost of the report doing more reading than a
 * single running tally would.
 *
 * With no LISTEN_FEEDBACK_DIR set, this falls back to a temp directory so
 * local development works with no configuration; it just does not persist
 * across restarts there, which is fine off a Volume.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.env.LISTEN_FEEDBACK_DIR || path.join(os.tmpdir(), 'afrispeech-listen-feedback');

function dirFor(languageCode) {
  // One directory per language, so the report can list a single language's
  // ratings without reading every other language's files to filter them out.
  return path.join(ROOT, languageCode);
}

/**
 * @param {object} options
 * @param {string} options.languageCode an AfriSpeech code, e.g. "swh"
 * @param {"up"|"down"} options.rating
 */
export async function recordFeedback({ languageCode, rating }) {
  const dir = dirFor(languageCode);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${randomUUID()}.json`);
  await writeFile(file, JSON.stringify({ languageCode, rating, at: new Date().toISOString() }));
}

/**
 * Per-language counts, for the deployer's own report.
 *
 * @returns {Promise<Record<string, {up: number, down: number, total: number, upRate: number}>>}
 */
export async function feedbackReport() {
  const report = {};
  let languageCodes;
  try {
    languageCodes = await readdir(ROOT);
  } catch (error) {
    if (error.code === 'ENOENT') return report; // nothing rated yet
    throw error;
  }

  for (const code of languageCodes) {
    const dir = dirFor(code);
    const files = await readdir(dir).catch(() => []);
    let up = 0;
    let down = 0;
    for (const name of files) {
      const parsed = await readFile(path.join(dir, name), 'utf8')
        .then((text) => JSON.parse(text))
        .catch(() => null);
      if (!parsed) continue; // a file half-written when read loses one vote, not the count
      if (parsed.rating === 'up') up += 1;
      else if (parsed.rating === 'down') down += 1;
    }
    const total = up + down;
    if (total === 0) continue;
    report[code] = { up, down, total, upRate: Math.round((up / total) * 1000) / 10 };
  }
  return report;
}
