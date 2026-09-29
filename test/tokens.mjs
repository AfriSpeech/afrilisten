/**
 * Minting ephemeral Gemini Live tokens.
 *
 * Driven through a stub client so this costs nothing and runs offline. What
 * matters is what gets locked into the token: the model, the voice, that it
 * may only produce audio, and a bounded use count and expiry, since those are
 * the only things standing between a browser holding this token and a
 * general-purpose Gemini session on someone else's key.
 *
 * Run with: node test/tokens.mjs
 */
import assert from 'node:assert/strict';
import { mintToken } from '../src/lib/tokens.mjs';

function stubClient(token) {
  const calls = [];
  return {
    calls,
    authTokens: { create: async (params) => { calls.push(params); return token; } },
  };
}

let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ok   ${name}`); }
  catch (error) { console.log(`  FAIL ${name}\n       ${error.message}`); process.exitCode = 1; }
};

await t('the model, voice and response modality are locked into the token', async () => {
  // The response itself does not echo expireTime back (confirmed against the
  // real API), so the token's reported expiry is what was asked for, not
  // whatever a stub response happens to contain.
  const client = stubClient({ name: 'auth_tokens/abc' });
  const result = await mintToken({
    model: 'gemini-3.1-flash-live-preview', voice: 'Charon',
    uses: 6, expireMinutes: 10, newSessionMinutes: 2, client,
  });
  assert.equal(result.token, 'auth_tokens/abc');
  assert.equal(result.expireTime, client.calls[0].config.expireTime);

  const sent = client.calls[0].config;
  assert.equal(sent.uses, 6);
  assert.equal(sent.liveConnectConstraints.model, 'gemini-3.1-flash-live-preview');
  assert.deepEqual(sent.liveConnectConstraints.config.responseModalities, ['AUDIO']);
  assert.equal(
    sent.liveConnectConstraints.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
    'Charon',
  );
  assert.match(sent.liveConnectConstraints.config.systemInstruction, /translate/i,
    'the system instruction must tell Gemini to translate, not just repeat what it is sent');
});

await t('expireTime and newSessionExpireTime are real timestamps, not durations', async () => {
  const client = stubClient({ name: 'auth_tokens/abc' });
  const before = Date.now();
  await mintToken({ model: 'm', voice: 'v', uses: 1, expireMinutes: 10, newSessionMinutes: 2, client });
  const sent = client.calls[0].config;
  assert.ok(new Date(sent.expireTime).getTime() > before, 'expireTime is not in the future');
  assert.ok(new Date(sent.newSessionExpireTime).getTime() > before, 'newSessionExpireTime is not in the future');
  assert.ok(
    new Date(sent.expireTime).getTime() > new Date(sent.newSessionExpireTime).getTime(),
    'a token must be able to send messages for longer than it can start new sessions',
  );
});

await t('a response with no token name is an error, not a silent success', async () => {
  const client = stubClient({});
  await assert.rejects(
    mintToken({ model: 'm', voice: 'v', uses: 1, expireMinutes: 1, newSessionMinutes: 1, client }),
    /did not return a token/,
  );
});

await t('minting with no key and no client override fails clearly', async () => {
  const original = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await assert.rejects(
      mintToken({ model: 'm', voice: 'v', uses: 1, expireMinutes: 1, newSessionMinutes: 1 }),
      /GEMINI_API_KEY/,
    );
  } finally {
    if (original) process.env.GEMINI_API_KEY = original;
  }
});

console.log(`\n  ${passed} token checks passed`);
