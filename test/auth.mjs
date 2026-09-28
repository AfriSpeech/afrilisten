/**
 * Auth and CORS guard. Each case runs in its own process because config.mjs
 * snapshots the environment at import time, which is also what happens in
 * production. Run with: node test/auth.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = fileURLToPath(new URL('.', import.meta.url));
const runCase = (name) => {
  const result = spawnSync(process.execPath, [`${here}auth-case.mjs`, name], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

let passed = 0;
const t = (name, fn) => {
  try { fn(); passed += 1; console.log(`  ok   ${name}`); }
  catch (error) { console.log(`  FAIL ${name}\n       ${error.message}`); process.exitCode = 1; }
};

// An unset key must shut the endpoint, not open it.
{
  const c = runCase('none');
  t('unset key refuses every caller', () => assert.equal(c.missing, 503));
  t('unset key grants no CORS origin', () => assert.equal(c.echoGood, null));
}

// A key is required, and it must match exactly.
{
  const c = runCase('key');
  t('missing key -> 401', () => assert.equal(c.missing, 401));
  t('wrong key -> 401', () => assert.equal(c.wrong, 401));
  t('truncated key -> 401', () => assert.equal(c.prefix, 401));
  t('extended key -> 401', () => assert.equal(c.longer, 401));
  t('exact key passes', () => assert.equal(c.right, true));
  t('no allowlist means no cross-origin grant', () => assert.equal(c.echoAny, null));
}

// With an allowlist, only those origins are let in.
{
  const c = runCase('origins');
  t('allowed origin passes', () => assert.equal(c.goodOrigin, true));
  t('allowed origin is echoed back', () => assert.equal(c.echoGood, 'https://example.com'));
  t('other origin -> 403', () => assert.equal(c.evilOrigin, 403));
  t('other origin gets no CORS header', () => assert.equal(c.echoEvil, null));
  t('originless server call still allowed', () => assert.equal(c.noOrigin, true));
  t('GET and POST are both permitted', () => assert.equal(c.methods, 'GET, POST, OPTIONS'));
}

// An explicit wildcard stays available for local work.
{
  const c = runCase('wild');
  t('explicit * is honoured', () => assert.equal(c.echoAny, '*'));
}

console.log(`\n  ${passed} auth checks passed`);
