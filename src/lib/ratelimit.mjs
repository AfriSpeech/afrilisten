/**
 * Who may mint a token, and how often.
 *
 * The service is public and cannot be otherwise: the endpoint and the key are
 * both in the page source, and the key is not a secret in any case. A browser
 * is the only thing that sends an Origin header honestly, so the allowlist
 * stops other people's pages from spending the quota, and stops nothing else.
 * Anyone with curl can reach /token, and would otherwise be able to mint
 * tokens against the Gemini key as fast as they liked.
 *
 * So the aim is not to keep callers out. It is to put a ceiling on what one
 * caller, or many callers, can cost. Three limits, cheapest first:
 *
 *   - per address, per minute, so one caller cannot flood;
 *   - per address, per day, so a caller who waits a minute between requests
 *     still cannot mint tokens all day;
 *   - across everyone, per day, which is the one that matters. Per-address
 *     limits are all bypassed by rotating addresses, and a budget is not.
 *
 * Only a minted token is charged to the allowances. What a malformed request
 * does still cost is a socket, so those are counted separately by the flood
 * guard.
 *
 * The counters used to live in Redis, because an earlier version of this
 * service ran as a durable workflow and a step had no memory of the others.
 * There is no workflow now — this is a single, long-lived process — so an
 * in-memory map sees every request the same way Redis did.
 */

import { config } from './config.mjs';

const MINUTE = 60;
const DAY = 24 * 60 * 60;

/** key -> { count, expiresAt } */
const windows = new Map();

// Every address that ever asks leaves a key behind until its window expires.
// Swept periodically rather than left to grow for the life of the process.
// unref() so this sweep never keeps the process alive on its own, which
// matters for a script that runs the handler once and exits, such as a test.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows) {
    if (entry.expiresAt <= now) windows.delete(key);
  }
}, DAY * 1000);
sweep.unref?.();

/**
 * Who to count this against.
 *
 * Cloudflare sets CF-Connecting-IP and it cannot be forged by a client, so it
 * is preferred. Behind no proxy there is nothing trustworthy to read, and
 * rather than invent an identity from a header anyone can set, the request is
 * counted against nobody in particular and only the shared budget applies.
 *
 * @param {Request} request
 * @returns {string|null}
 */
export function callerId(request) {
  const direct = request.headers.get('cf-connecting-ip');
  if (direct) return direct.trim();

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();

  return null;
}

/**
 * Count one hit, and put an expiry on the window the first time it is used.
 *
 * The expiry is only set when the counter is created, otherwise every request
 * would push the window along and a caller could never run out of it.
 */
async function hit(key, window) {
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || entry.expiresAt <= now) {
    windows.set(key, { count: 1, expiresAt: now + window * 1000 });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

let counter = hit;

/**
 * Swap the counter, for the checks.
 *
 * A module namespace cannot be patched from outside, so the seam has to be a
 * function the module calls rather than an import the test replaces.
 *
 * @param {(key: string, window: number) => Promise<number>} fn
 */
export function setCounter(fn) {
  counter = fn;
}

/**
 * The flood guard: one request per address per minute.
 *
 * This runs before the body is even looked at, because its job is to stop a
 * caller hammering the endpoint, and a request that turns out to be malformed
 * still cost us a socket and a Redis round trip. It counts requests, not runs.
 *
 * @param {Request} request
 * @returns {Promise<{ok: boolean, status?: number, error?: string,
 *   retryAfter?: number, scope?: string}>}
 */
export async function checkFlood(request) {
  if (!config.rateEnabled) return { ok: true };

  const id = callerId(request);
  if (!id) return { ok: true };

  const perMinute = config.ratePerMinute;
  if (perMinute > 0) {
    const count = await counter(`listen:rl:min:${id}`, MINUTE);
    if (count > perMinute) {
      return {
        ok: false,
        status: 429,
        scope: 'minute',
        retryAfter: MINUTE,
        error: `Too many requests. You can start ${perMinute} a minute; try again shortly.`,
      };
    }
  }

  return { ok: true };
}

/**
 * What a run costs: the caller's daily allowance and the service's budget.
 *
 * This runs only once the request is known to be a real one that is about to
 * start a run, so a caller cannot spend the day's Gemini money by posting
 * bodies that were never going to be read. The global budget is the one limit
 * that cannot be got around by changing address, which is exactly why it has
 * to be spent only on genuine starts.
 *
 * @param {Request} request
 * @returns {Promise<{ok: boolean, status?: number, error?: string,
 *   retryAfter?: number, scope?: string}>}
 */
export async function claimBudget(request) {
  if (!config.rateEnabled) return { ok: true };

  const id = callerId(request);

  if (id) {
    const perDay = config.ratePerDay;
    if (perDay > 0) {
      const count = await counter(`listen:rl:day:${id}`, DAY);
      if (count > perDay) {
        return {
          ok: false,
          status: 429,
          scope: 'day',
          retryAfter: DAY,
          error: `You have reached the daily limit of ${perDay}. It resets in 24 hours.`,
        };
      }
    }
  }

  // The ceiling on the whole service's spend for the day.
  const budget = config.budgetPerDay;
  if (budget > 0) {
    const count = await counter('listen:rl:budget:day', DAY);
    if (count > budget) {
      return {
        ok: false,
        status: 503,
        scope: 'budget',
        retryAfter: DAY,
        error: 'AfriListen has reached its daily limit and is resting until tomorrow.',
      };
    }
  }

  return { ok: true };
}
