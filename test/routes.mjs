/**
 * The route module itself, loaded and exercised.
 *
 * Every other check imports a library file directly, so a mistake in the file
 * that wires the routes together would pass all of them. A wrong import name
 * in index.mjs is exactly that: nothing failed until the server was started.
 *
 * Run with: node test/routes.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.LISTEN_API_KEY ||= 'test-key-for-routes';
process.env.LISTEN_RATE_ENABLED = '0';
// Isolated from any real feedback data and from other test runs.
process.env.LISTEN_FEEDBACK_DIR = mkdtempSync(path.join(os.tmpdir(), 'afrispeech-feedback-routes-test-'));
// Deterministic regardless of what the ambient shell happens to export: the
// point of the checks below is what happens when this is unset.
delete process.env.GEMINI_API_KEY;

let passed = 0;
const check = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ok   ${name}`); }
  catch (error) { console.log(`  FAIL ${name}\n       ${error.message}`); process.exitCode = 1; }
};

// Loading is the point: this fails on a bad import before anything is called.
const { default: worker } = await import('../src/index.mjs');

const call = (path, init = {}) => worker.fetch(new Request(`https://example.test${path}`, {
  ...init,
  headers: { 'x-listen-key': 'test-key-for-routes', ...(init.headers || {}) },
}));

await check('the module loads and exposes a fetch handler', () => {
  assert.equal(typeof worker.fetch, 'function');
});

await check('a request without the key is refused', async () => {
  const response = await worker.fetch(new Request('https://example.test/token', { method: 'POST' }));
  assert.equal(response.status, 401);
});

await check('the language list is offered, so no client has to guess a code', async () => {
  const r = await call('/languages');
  assert.equal(r.status, 200);
  // Offered without a key, because a client needs it before it has anything
  // else, and it is the one answer here that costs nothing to give away.
  const open = await worker.fetch(new Request('https://example.test/languages'));
  assert.equal(open.status, 200);
  const { languages } = await r.json();
  assert.ok(languages.length >= 40, 'every language is offered');
  const swahili = languages.find((l) => l.code === 'swh');
  assert.ok(swahili, 'Swahili is reachable by a code that exists');
  assert.equal(swahili.google, 'sw');
});

await check('the language list also carries what the widget needs to chunk a page itself', async () => {
  const r = await call('/languages');
  const { speech } = await r.json();
  assert.ok(speech, 'no speech settings in the response');
  assert.equal(typeof speech.model, 'string');
  assert.ok(speech.model.length > 0, 'no model named');
  assert.ok(Number.isFinite(speech.maxChars) && speech.maxChars > 0);
  assert.ok(Number.isFinite(speech.chunkChars) && speech.chunkChars > 0);
});

await check('a bad token request fails as a busy service, not a crash', async () => {
  // No GEMINI_API_KEY is set, so minting itself fails; what matters is that it
  // fails as a clean 503 with a message a reader can read, not an exception.
  const response = await call('/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pieces: 3 }),
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.ok(body.error, 'no error message returned');
});

await check('a malformed body is tolerated: there is no page text left to validate', async () => {
  // /token takes nothing from the caller but an optional piece-count hint, so
  // a body that fails to parse is treated as no hint rather than refused.
  const response = await call('/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  // Still fails, but for the same reason as above (no key), not the body.
  assert.equal(response.status, 503);
});

await check('feedback is refused without the key, same as token minting', async () => {
  const response = await worker.fetch(new Request('https://example.test/feedback', { method: 'POST' }));
  assert.equal(response.status, 401);
});

await check('a rating for an unknown language is refused', async () => {
  const response = await call('/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ languageCode: 'not-a-real-code', rating: 'up' }),
  });
  assert.equal(response.status, 400);
});

await check('a rating that is not up or down is refused', async () => {
  const response = await call('/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ languageCode: 'swh', rating: 'sideways' }),
  });
  assert.equal(response.status, 400);
});

await check('a valid rating is accepted and shows up in the report', async () => {
  const response = await call('/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ languageCode: 'swh', rating: 'up' }),
  });
  assert.equal(response.status, 200);

  const reportResponse = await call('/feedback/report');
  assert.equal(reportResponse.status, 200);
  const { report } = await reportResponse.json();
  assert.ok(report.swh?.up >= 1, 'the rating just sent should be counted');
});

await check('the report is refused without the key', async () => {
  const response = await worker.fetch(new Request('https://example.test/feedback/report'));
  assert.equal(response.status, 401);
});

await check('an unknown route is a 404, not a crash', async () => {
  const response = await call('/nope');
  assert.equal(response.status, 404);
});

await check('a preflight is answered without the key', async () => {
  const response = await worker.fetch(new Request('https://example.test/token', { method: 'OPTIONS' }));
  assert.equal(response.status, 204);
});

console.log(`\n  ${passed} route checks passed`);
