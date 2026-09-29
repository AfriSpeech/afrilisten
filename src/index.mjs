/**
 * AfriListen: token service.
 *
 * Four routes:
 *
 *   GET  /languages       the language list, the speech settings, and the usage notice
 *   POST /token            mint a short-lived Gemini Live token
 *   POST /feedback         a thumbs up or down on one language's audio
 *   GET  /feedback/report  per-language rating counts, public
 *
 * This is the whole server. The page's text never reaches it: the widget
 * reads the page in the reader's own browser, chunks it there, and opens a
 * Gemini Live session directly from the browser for each piece, using a token
 * minted here. That is only possible because Gemini Live supports ephemeral,
 * scoped tokens for exactly this: a browser can hold a Live session open
 * itself, so the audio is never proxied through a server that would otherwise
 * have to hold every reader's connection open for the length of a synthesis.
 *
 * What still has to happen server-side is minting the token, because that is
 * the one call that needs the real, long-lived GEMINI_API_KEY. Everything the
 * token may do — the model, the voice, that it can only produce audio — is
 * locked in at that point; see src/lib/tokens.mjs.
 *
 * Feedback is deliberately not behind the shared key, unlike /token: every
 * widget everywhere reports to one deployment of this service (see
 * FEEDBACK_ENDPOINT in the widget), because a rating is a signal about how
 * well Gemini translates into a language in general, not something specific
 * to one deployer's audience. Pooling it is the point, and "public" means
 * exactly that: anyone can read /feedback/report, not just whoever is
 * running this instance.
 */
import { checkAuth, corsHeaders } from './lib/auth.mjs';
import { checkFlood, claimBudget } from './lib/ratelimit.mjs';
import { mintToken } from './lib/tokens.mjs';
import { recordFeedback, feedbackReport, renderFeedbackPage } from './lib/feedback.mjs';
import { languageCatalogue, findSpeechLanguage, scopedLanguages, OFFERED_LANGUAGES } from './lib/languages.mjs';
import { translateViaThai, clipToLimit } from './lib/translate.mjs';
import { chunkBySentences } from './lib/chunk.mjs';
import { toIpa } from './lib/ipa.mjs';
import { config } from './lib/config.mjs';

export const ALLOWED_VOICES = new Set(['Charon', 'Puck', 'Kore', 'Fenrir', 'Aoede']);

/* Shown to anyone integrating against this deployment. Two different
 * messages, because two different things are true depending on which
 * deployment is answering:
 *
 *   - This project's own reference deployment (LISTEN_SHARED_DEFAULT=1, set
 *     only in modal_app.py) is what the widget talks to with no
 *     data-endpoint set, and is deliberately a shared public service: that
 *     is what makes the widget a genuine drop-in. Its budget is shared and
 *     not vetted per site, which is worth saying plainly rather than letting
 *     an integrator assume otherwise.
 *   - Anyone else's deployment is not shared, runs on their own key, and its
 *     budget is bounded by the plan they chose rather than by this project.
 */
const USAGE_NOTICE = config.isSharedDefault ? {
  status: 'shared-default',
  message:
    'This is AfriListen\'s own reference deployment, and the widget talks to it by default '
    + 'when a page sets no data-endpoint. It is deliberately a shared public service: the '
    + 'Gemini key and the daily budget behind it are shared across every site using the '
    + 'default, unvetted per site, so heavy or important traffic should not depend on it '
    + 'being there. It never sees the text of the page being read: it only mints short-lived '
    + 'tokens, and the audio is produced by a Gemini Live session the browser opens for itself.',
  production:
    'Deploy your own instance with your own Gemini API key, as DEPLOY.md sets out (a basic '
    + 'deployment costs $0 too), and set data-endpoint/data-key on the script tag to point the '
    + 'widget at it instead of this shared default.',
} : {
  status: 'self-hosted',
  message:
    'This endpoint is not a shared public service. It belongs to whoever deployed this '
    + 'code, runs on their own Gemini API key, and spends their own quota, so what it can '
    + 'serve is bounded by the plan they chose rather than by this project. It never sees '
    + 'the text of the page being read: it only mints short-lived tokens, and the audio is '
    + 'produced by a Gemini Live session the browser opens for itself.',
  production:
    'Deploy your own instance with your own paid Gemini API key, as DEPLOY.md sets out, and '
    + 'point the widget at it. Keep the paid key server-side: a key placed in browser code is '
    + 'readable by anyone who loads the page, and they can spend your quota at your expense.',
};

/* What the reader is told when a token cannot be minted, which is not what the
 * log says: the raw error is Google's, not something a reader can act on. */
export function describe(error) {
  const message = String(error?.message ?? error ?? '');
  if (/quota|rate limit|RESOURCE_EXHAUSTED|\b429\b|\b503\b|UNAVAILABLE|overloaded|capacity/i.test(message)) {
    return 'The speech service is busy just now. Please try again in a moment.';
  }
  return 'The speech service could not be reached. Please try again in a moment.';
}

/** Render a refusal from either limit, the same way for both. */
function limitResponse(limit, cors) {
  return Response.json(
    { error: limit.error },
    {
      status: limit.status,
      headers: {
        ...cors,
        'retry-after': String(limit.retryAfter ?? 60),
        'x-listen-limit': limit.scope ?? '',
      },
    },
  );
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    /* The list of languages, and the settings the widget needs to chunk a page
       itself: how much to read and how big a piece Gemini Live will hold in
       one turn. Free, and not behind the key, because a client needs it before
       it has anything else. Guessing a language code is worse than it sounds:
       an unrecognised one is not refused, it falls back to English, so a
       reader who asked for one language is quietly given another. The origin
       allowlist still applies. */
    if (url.pathname === '/languages' && (request.method === 'GET' || request.method === 'HEAD')) {
      return Response.json(
        {
          notice: USAGE_NOTICE,
          languages: languageCatalogue(scopedLanguages(config.allowedLanguages, config.allowedCountries)),
          speech: {
            model: config.liveModel,
            maxChars: config.maxChars,
            chunkChars: config.chunkChars,
          },
        },
        { headers: { ...cors, 'cache-control': 'public, max-age=3600' } },
      );
    }

    /* Public, deliberately, and so checked before the key gate below: see the
       file header on why feedback is pooled across every deployment rather
       than gated per-deployer the way /token is. */
    if (url.pathname === '/feedback' && request.method === 'POST') {
      // No Gemini quota is spent recording an opinion about audio already
      // paid for, so only the flood guard applies, not a budget.
      const flood = await checkFlood(request);
      if (!flood.ok) return limitResponse(flood, cors);

      let body;
      try {
        body = JSON.parse(await request.clone().text());
      } catch {
        return Response.json({ error: 'invalid JSON' }, { status: 400, headers: cors });
      }

      const language = findSpeechLanguage(body?.languageCode);
      if (!language) {
        return Response.json({ error: 'unknown languageCode' }, { status: 400, headers: cors });
      }
      if (body?.rating !== 'up' && body?.rating !== 'down') {
        return Response.json({ error: "rating must be \"up\" or \"down\"" }, { status: 400, headers: cors });
      }

      const voice = (typeof body?.voice === 'string' && ALLOWED_VOICES.has(body.voice.trim()))
        ? body.voice.trim()
        : (config.ttsVoice || 'Kore');

      await recordFeedback({ languageCode: language.code, rating: body.rating, voice });
      return Response.json({ ok: true }, { headers: cors });
    }

    if ((url.pathname === '/feedback' || url.pathname === '/performance') && (request.method === 'GET' || request.method === 'HEAD')) {
      const report = await feedbackReport();
      const html = renderFeedbackPage(report, OFFERED_LANGUAGES);
      return new Response(request.method === 'HEAD' ? null : html, {
        headers: {
          ...cors,
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    if (url.pathname === '/feedback/report' && (request.method === 'GET' || request.method === 'HEAD')) {
      const report = await feedbackReport();
      const accept = request.headers.get('accept') || '';
      const wantsHtml = url.searchParams.get('format') === 'html' || accept.includes('text/html');

      if (wantsHtml) {
        const html = renderFeedbackPage(report, OFFERED_LANGUAGES);
        return new Response(request.method === 'HEAD' ? null : html, {
          headers: {
            ...cors,
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      }

      return Response.json(request.method === 'HEAD' ? null : { report }, { headers: { ...cors, 'cache-control': 'no-store' } });
    }

    // Cheapest gate first: reject before doing any work.
    const auth = checkAuth(request);
    if (!auth.ok) {
      return Response.json({ error: auth.error }, { status: auth.status, headers: cors });
    }

    if ((url.pathname === '/token' || url.pathname === '/speak') && request.method === 'POST') {
      /* What is being protected is the Gemini quota, and it is spent the
         moment a token is minted, so this is the only route that is limited. */
      const flood = await checkFlood(request);
      if (!flood.ok) return limitResponse(flood, cors);

      let body = {};
      if ((request.headers.get('content-type') || '').includes('application/json')) {
        const raw = await request.clone().text();
        if (raw.length <= 20_000) {
          try { body = JSON.parse(raw) ?? {}; } catch { body = {}; }
        }
      }
      if (typeof body !== 'object' || Array.isArray(body) || body === null) body = {};

      const budget = await claimBudget(request);
      if (!budget.ok) return limitResponse(budget, cors);

      // Resolve target language (defaults to Swahili if unknown)
      const targetLang = findSpeechLanguage(body.lang || body.languageCode)
        || findSpeechLanguage(body.locale ? defaultForLocale(body.locale) : null)
        || findSpeechLanguage('swh');

      let sourceGoogle = 'auto';
      if (body.source && typeof body.source === 'string' && body.source.trim() && body.source !== 'auto') {
        const sourceMatch = findSpeechLanguage(body.source.trim());
        sourceGoogle = sourceMatch ? sourceMatch.google : body.source.trim().toLowerCase().split('-')[0];
      }

      let originalTranslation = '';
      let chunks = [];

      if (body.text && typeof body.text === 'string' && body.text.trim()) {
        const clipped = clipToLimit(body.text, config.maxChars || 1000);
        try {
          // If source matches target or is detected as target, translateViaThai skips the Thai hop
          const trans = await translateViaThai(clipped, targetLang?.google || 'sw', sourceGoogle, config.maxChars || 1000);
          originalTranslation = trans.text || clipped;
        } catch {
          originalTranslation = clipped;
        }
        // Chunk strictly along sentence boundaries so each piece fits a Gemini Live turn cleanly
        chunks = chunkBySentences(originalTranslation, config.chunkChars || 200);
      }
      if (!chunks.length && originalTranslation) chunks = [originalTranslation];

      if (chunks.length && targetLang?.code) {
        chunks = await Promise.all(chunks.map((c) => toIpa(c, targetLang.code)));
      }

      const pieces = Math.max(1, Math.min(40, chunks.length || Number.parseInt(body.pieces, 10) || 1));
      const uses = Math.min(config.tokenMaxUses, Math.max(config.tokenMinUses, pieces * config.tokenUsesPerPiece));

      const requestedVoice = typeof body.voice === 'string' ? body.voice.trim() : '';
      const chosenVoice = ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : (config.ttsVoice || 'Kore');

      let minted;
      try {
        minted = await mintToken({
          model: config.liveModel,
          voice: chosenVoice,
          uses,
          expireMinutes: config.tokenExpireMinutes,
          newSessionMinutes: config.tokenNewSessionMinutes,
        });
      } catch (error) {
        return Response.json({ error: describe(error) }, { status: 503, headers: cors });
      }

      return Response.json(
        {
          token: minted.token,
          model: config.liveModel,
          voice: chosenVoice,
          expireTime: minted.expireTime,
          uses,
          chunks,
          isIpa: true,
          text: originalTranslation,
          language: targetLang?.name || 'Swahili',
          languageCode: targetLang?.code || 'swh',
        },
        { headers: cors },
      );
    }

    return Response.json({ error: 'not found' }, { status: 404, headers: cors });
  },
};
