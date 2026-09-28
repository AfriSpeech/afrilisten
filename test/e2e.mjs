/**
 * The whole path, against the real Gemini API.
 *
 * This mints a token with the real key, then uses ONLY the token -- never the
 * key itself -- to open a Live session and speak a piece, exactly the way the
 * browser will. That is the one thing worth proving for real: everything else
 * a browser does (chunking the page, opening the session, decoding the audio)
 * is plain JavaScript with nothing to fake, but whether Gemini actually honours
 * a token minted this way, for a session opened from outside this process,
 * can only be answered by doing it.
 *
 * Needs GEMINI_API_KEY; spends metered quota, so it is not part of `npm test`.
 * Run with: npm run test:e2e
 */
import assert from 'node:assert/strict';
import { GoogleGenAI, Modality } from '@google/genai';
import { mintToken } from '../src/lib/tokens.mjs';
import { config } from '../src/lib/config.mjs';

if (!process.env.GEMINI_API_KEY) {
  console.log('  skipped: GEMINI_API_KEY is not set');
  process.exit(0);
}

let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ok   ${name}`); }
  catch (error) { console.log(`  FAIL ${name}\n       ${error.message}`); process.exitCode = 1; }
};

console.log(`  model ${config.liveModel}, voice ${config.ttsVoice}\n`);

const minted = await mintToken({
  model: config.liveModel,
  voice: config.ttsVoice,
  uses: 2,
  expireMinutes: config.tokenExpireMinutes,
  newSessionMinutes: config.tokenNewSessionMinutes,
});

await t('a token comes back with a name and an expiry', () => {
  assert.ok(minted.token && minted.token.startsWith('auth_tokens/'), `got: ${minted.token}`);
  assert.ok(minted.expireTime, 'no expiry on the token');
});

/**
 * Speak one piece using ONLY the token, exactly as the browser will.
 *
 * `onopen` can fire before `connect()` has resolved, so the session object is
 * not always assigned yet when it does. The text waits until both the socket
 * is open and the session exists, rather than guessing with a timeout.
 */
function speakWithToken(token, text, instruction) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    let session = null;
    let socketOpen = false;
    const timer = setTimeout(() => settle(new Error('timed out waiting for the session')), 30_000);
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { session?.close(); } catch { /* already gone */ }
      if (error) reject(error); else resolve(value);
    };
    const flush = () => {
      if (!socketOpen || !session) return;
      session.sendRealtimeInput({ text: instruction ? `${instruction}\n\n${text}` : text });
    };

    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
    ai.live
      .connect({
        model: config.liveModel,
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onopen: () => { socketOpen = true; flush(); },
          onmessage: (message) => {
            const content = message?.serverContent;
            if (!content) return;
            for (const part of content.modelTurn?.parts ?? []) {
              const data = part?.inlineData?.data;
              if (data) chunks.push(Buffer.from(data, 'base64'));
            }
            if (content.turnComplete) settle(null, Buffer.concat(chunks));
          },
          onerror: (event) => settle(new Error(event?.message ?? 'socket error')),
          onclose: (event) => {
            if (!settled) settle(new Error(`closed before the turn completed (code ${event?.code ?? 'none'})`));
          },
        },
      })
      .then((opened) => { session = opened; flush(); })
      .catch((error) => settle(new Error(`connect failed: ${error.message}`)));
  });
}

const pcm = await speakWithToken(
  minted.token,
  'The weather today is sunny and warm.',
  'Translate the text below into Swahili and speak your translation aloud, in Swahili.',
);

await t('the token alone, with no API key in sight, produced real audio', () => {
  assert.ok(pcm.length > 1000, `only ${pcm.length} bytes came back`);
});

await t('the audio is 16-bit PCM, not silence', () => {
  let peak = 0;
  for (let i = 0; i < pcm.length - 1; i += 2) {
    const sample = Math.abs(pcm.readInt16LE(i));
    if (sample > peak) peak = sample;
  }
  assert.ok(peak > 1000, `peak sample ${peak}: this looks like silence`);
});

console.log(`\n  ${passed} end-to-end checks passed`);
