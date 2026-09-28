/**
 * Minting ephemeral Gemini Live tokens.
 *
 * The browser talks to Gemini Live directly once it has one of these: no
 * server sits in the middle of the audio, and the page's text never crosses
 * this service at all. What still has to happen here, server-side, is this
 * one call, because minting a token is the only place the real, long-lived
 * GEMINI_API_KEY is needed.
 *
 * Everything the token is allowed to do is decided here and locked into it —
 * the model, the voice, that it may only produce audio, and the fixed system
 * instruction that tells Gemini to translate and read rather than converse —
 * so a browser holding the token cannot repurpose it into a general chat
 * session or point it at a different, unaudited model. `uses` and
 * `expireTime` bound it further: a token is good for a fixed number of Live
 * sessions and expires shortly after, so a leaked token is a small, short-lived
 * thing rather than a standing credential.
 */
import { GoogleGenAI } from '@google/genai';

const TTS_SYSTEM_INSTRUCTION =
  'You are a text-to-speech engine for people who cannot read the screen. You are sent '
  + 'text, sometimes preceded by a context line telling you to translate it into a named '
  + 'language before speaking. When there is a context line, translate the text that '
  + 'follows into the language it names and read only your translation aloud, in that '
  + 'language and no other. When there is no context line, read the text aloud exactly '
  + 'as written, in the language it is written in. Do not summarise it, do not discuss '
  + 'it, do not answer it, do not add anything beyond what you were asked to speak, and '
  + 'do not read the context line out loud. Speak only the words you were asked to '
  + 'speak, in that order.';

function defaultClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('tokens: GEMINI_API_KEY is not set');
  // Ephemeral tokens are v1alpha only, for both minting and for the session
  // the browser later opens with the token.
  return new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
}

/**
 * @param {object} options
 * @param {string} options.model
 * @param {string} options.voice
 * @param {number} options.uses               Live sessions this token may start
 * @param {number} options.expireMinutes      minutes the token may be used to send messages
 * @param {number} options.newSessionMinutes  minutes the browser has to start its sessions
 * @returns {Promise<{token: string, expireTime: string}>}
 */
export async function mintToken({
  model,
  voice,
  uses,
  expireMinutes,
  newSessionMinutes,
  client = defaultClient(),
} = {}) {
  const now = Date.now();
  const expireTime = new Date(now + expireMinutes * 60_000).toISOString();
  const token = await client.authTokens.create({
    config: {
      uses,
      expireTime,
      newSessionExpireTime: new Date(now + newSessionMinutes * 60_000).toISOString(),
      liveConnectConstraints: {
        model,
        config: {
          responseModalities: ['AUDIO'],
          systemInstruction: TTS_SYSTEM_INSTRUCTION,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      },
    },
  });

  if (!token?.name) throw new Error('tokens: Gemini did not return a token');
  // The response itself does not echo expireTime back, so what is reported
  // here is what was asked for rather than what the response confirms.
  return { token: token.name, expireTime };
}
