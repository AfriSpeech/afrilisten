/**
 * The key and the origin allowlist, and what they are honestly worth.
 *
 * Neither of them is access control, and it is worth being plain about why,
 * because the alternative is trusting them and being wrong:
 *
 *   - The key is in the page source. Every visitor can read it. It is a label
 *     that says "this is widget traffic", nothing more.
 *   - An Origin header is set by the browser, and only the browser. curl sends
 *     none, so the allowlist below is skipped entirely, and anyone who wants to
 *     send one can. It stops other people's *pages* from spending the quota
 *     from a reader's browser. That is worth having, and it is not a lock.
 *
 * So what actually caps the cost is in ratelimit.mjs. If the quota is the thing
 * worth protecting, that is the file to read.
 *
 * Two deliberate choices here:
 *
 *   - A missing key is a configuration error, not an open door. Failing open
 *     would turn a typo into a silent, unbounded bill.
 *   - CORS is driven by an allowlist. Echoing '*' would let any site on the
 *     internet spend the quota from a visitor's browser.
 */
import { config } from './config.mjs';

const always = () => (process.env.LISTEN_API_KEY || '').trim();

function origins() {
  return config.allowedOrigins;
}

export function checkAuth(request) {
  const expected = always();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: 'server is not configured: LISTEN_API_KEY is unset',
    };
  }

  const supplied = (request.headers.get('x-listen-key') || '').trim();
  // Compare in constant time so the key cannot be recovered a character at a time.
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return { ok: false, status: 401, error: 'invalid or missing x-listen-key' };
  }

  const origin = request.headers.get('origin');
  const allowed = origins();
  // A request with no Origin header is not a browser (curl, server-to-server)
  // and the allowlist does not apply to it.
  if (origin && allowed.length && !allowed.includes('*') && !allowed.includes(origin)) {
    return { ok: false, status: 403, error: 'origin not allowed' };
  }
  return { ok: true };
}

function timingSafeEqual(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * CORS headers. When the origin is not on the allowlist the header is omitted
 * rather than filled in with a wildcard, so the browser refuses the reply.
 */
export function corsHeaders(request) {
  const origin = request.headers.get('origin');
  const allowed = origins();
  const permitted = Boolean(origin) && allowed.includes('*');
  const exact = Boolean(origin) && allowed.includes(origin);

  const headers = {
    'access-control-allow-headers': 'content-type, x-listen-key',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
    Vary: 'Origin',
  };
  if (permitted || exact) headers['access-control-allow-origin'] = permitted ? '*' : origin;
  return headers;
}
