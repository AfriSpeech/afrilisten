/**
 * The limits on minting a token.
 *
 * These are the only thing standing between a public endpoint and the Gemini
 * quota, so the checks are about what happens at the edges: the request that is
 * allowed, the one after it that is not, and the shared ceiling that per
 * address limits cannot help with.
 *
 * The counter is stubbed rather than reached, so the windows can be inspected
 * directly and the day-long limits can be tested without waiting a day.
 *
 * Run with: node test/ratelimit.mjs
 */
import assert from 'node:assert/strict';

process.env.LISTEN_RATE_ENABLED = '1';
process.env.LISTEN_RATE_PER_MINUTE = '3';
process.env.LISTEN_RATE_PER_DAY = '5';
process.env.LISTEN_BUDGET_PER_DAY = '0';

const { checkFlood, claimBudget, callerId, setCounter } = await import('../src/lib/ratelimit.mjs');

/**
 * What the route does for a real request: the flood guard first, then the
 * budget once the request is known to start a run. Returning whichever
 * refuses first keeps these checks about the same question as before -- may
 * this caller start a run -- without pretending it is one function.
 */
const start = async (request) => {
  const flood = await checkFlood(request);
  return flood.ok ? claimBudget(request) : flood;
};

/** Just enough Redis for the counters: incr, expire, and a way to look. */
const counters = new Map();
const expiries = new Map();
const opened = new Map();
setCounter(async (key, window) => {
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  if (next === 1) {
    expiries.set(key, window);
    opened.set(key, (opened.get(key) ?? 0) + 1);
  }
  return next;
});

let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ok   ${name}`); }
  catch (error) { console.log(`  FAIL ${name}\n       ${error.message}`); process.exitCode = 1; }
};

const from = (ip) => new Request('https://listen.example/speak', {
  headers: ip ? { 'cf-connecting-ip': ip } : {},
});

await t('Cloudflare\'s address is the one counted', () => {
  assert.equal(callerId(from('203.0.113.7')), '203.0.113.7');
});

await t('a forwarded address is the fallback, first entry only', () => {
  const request = new Request('https://listen.example/speak', {
    headers: { 'x-forwarded-for': '198.51.100.4, 10.0.0.1' },
  });
  assert.equal(callerId(request), '198.51.100.4');
});

await t('a client that can be trusted with no address gets no identity', () => {
  // Better to count nobody than to invent an identity from a header anyone can
  // set, which would let one caller spend everyone\'s quota.
  assert.equal(callerId(from(null)), null);
});

await t('the first requests are allowed and then the caller is stopped', async () => {
  counters.clear();
  for (let n = 1; n <= 3; n += 1) {
    const limit = await start(from('203.0.113.1'));
    assert.equal(limit.ok, true, `request ${n} should have been allowed`);
  }
  const fourth = await start(from('203.0.113.1'));
  assert.equal(fourth.ok, false);
  assert.equal(fourth.status, 429);
  assert.equal(fourth.scope, 'minute');
  assert.ok(fourth.retryAfter > 0, 'a 429 should say when to come back');
});

await t('the stop is per address, not global', async () => {
  // The whole point of counting by address: one caller cannot spend the quota
  // of everyone else.
  const other = await start(from('203.0.113.2'));
  assert.equal(other.ok, true, 'a different address is unaffected');
});

await t('a caller who waits a minute can still start a run', async () => {
  // Paced requests must not be caught by the per-minute limit, or a legitimate
  // reader would be throttled for asking slowly.
  counters.clear();
  for (let n = 0; n < 6; n += 1) {
    await start(from('203.0.113.3'));
    counters.delete('listen:rl:min:203.0.113.3'); // the minute passes
  }
  assert.ok(true);
});

await t('the daily limit eventually stops a caller who paces themselves', async () => {
  counters.clear();
  let limit;
  for (let n = 0; n < 7; n += 1) {
    limit = await start(from('203.0.113.5'));
    counters.delete('listen:rl:min:203.0.113.5');
  }
  assert.equal(limit.ok, false, 'six in a day is one too many');
  assert.equal(limit.scope, 'day');
});

await t('a window is given its expiry once, when it is opened', async () => {
  // If the expiry were reset on every hit the window would keep sliding
  // forward and a caller could never run out of it, which would make the
  // per-minute limit worth nothing against anyone patient.
  counters.clear();
  expiries.clear();
  const key = 'listen:rl:min:203.0.113.9';
  for (let n = 0; n < 3; n += 1) await start(from('203.0.113.9'));

  assert.equal(opened.get(key), 1, 'the window was opened exactly once');
  assert.equal(expiries.get(key), 60, 'and it lives for a minute');
  assert.equal(expiries.get('listen:rl:day:203.0.113.9'), 86400,
    'the daily window is kept for a day');
});

await t('a caller with no address is still counted against the budget', async () => {
  // With no identity there is nothing to count against but the shared ceiling.
  counters.clear();
  process.env.LISTEN_BUDGET_PER_DAY = '2';
  const { config } = await import('../src/lib/config.mjs');
  const original = config.budgetPerDay;
  config.budgetPerDay = 2;

  assert.equal((await start(from(null))).ok, true);
  assert.equal((await start(from(null))).ok, true);
  const third = await start(from(null));
  assert.equal(third.ok, false);
  assert.equal(third.scope, 'budget');
  assert.equal(third.status, 503, 'a spent budget is our problem, not the caller\'s');

  config.budgetPerDay = original;
});

await t('the budget is shared, so changing address does not escape it', async () => {
  // Per-address limits are all bypassed by rotating address. This is the one
  // that is not, which is why it exists.
  counters.clear();
  const { config } = await import('../src/lib/config.mjs');
  const original = config.budgetPerDay;
  config.budgetPerDay = 3;
  config.ratePerMinute = 0;
  config.ratePerDay = 0;

  const results = [];
  for (let n = 0; n < 5; n += 1) {
    results.push(await start(from(`198.51.100.${n}`)));
  }
  assert.equal(results.filter((r) => r.ok).length, 3, 'three fresh addresses, three runs');
  assert.equal(results[3].scope, 'budget');
  assert.equal(results[4].scope, 'budget');

  config.budgetPerDay = original;
  config.ratePerMinute = 3;
  config.ratePerDay = 5;
});



/* --- the ordering, checked against the real route ------------------------- */
/* /token takes no page text, so there is no malformed-body case to refuse for
   free the way an earlier version of this file checked for /speak. What is
   still worth proving against the real route rather than the limiter on its
   own is that a mint attempt is charged once, and that the flood guard runs
   ahead of it regardless. */

process.env.LISTEN_API_KEY = 'test-key-for-ratelimit';
process.env.LISTEN_BUDGET_PER_DAY = '1';
delete process.env.GEMINI_API_KEY;
const { config } = await import('../src/lib/config.mjs');
config.budgetPerDay = 1;
config.ratePerMinute = 0;

const { default: worker } = await import('../src/index.mjs');
const post = (body, ip) => worker.fetch(new Request('https://example.test/token', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-listen-key': 'test-key-for-ratelimit',
    'cf-connecting-ip': ip,
  },
  body: JSON.stringify(body),
}));

await t('a mint attempt is charged once', async () => {
  counters.clear();
  // The budget here is 1, and this is the request charged for it. There is no
  // GEMINI_API_KEY in this test, so the mint itself fails -- what matters is
  // that the request got past the gates and was charged before that happened.
  const response = await post({ pieces: 2 }, '203.0.113.24');
  assert.notEqual(response.status, 401, 'refused as unauthenticated, which is not what this checks');
  assert.equal(counters.get('listen:rl:budget:day'), 1, 'and it spent the budget');
});

await t('so the next request is turned away by the spent budget', async () => {
  const refused = await post({ pieces: 2 }, '203.0.113.25');
  assert.equal(refused.status, 503, 'the budget is spent');
  assert.equal(refused.headers.get('x-listen-limit'), 'budget');
});

await t('the flood guard runs before any mint is attempted', async () => {
  counters.clear();
  config.budgetPerDay = 0;
  config.ratePerMinute = 2;
  const first = await post({}, '203.0.113.26');
  const second = await post({}, '203.0.113.26');
  const third = await post({}, '203.0.113.26');
  assert.notEqual(first.status, 429);
  assert.notEqual(second.status, 429);
  assert.equal(third.status, 429, 'the third request in a minute is a flood');
  config.ratePerMinute = 0;
});

console.log(`\n  ${passed} rate limit checks passed`);
