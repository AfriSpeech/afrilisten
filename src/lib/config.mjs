function clampInt(name, raw, min, max, fallback) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  const clamped = Math.min(Math.max(value, min), max);
  // Silently clamping a tuning knob is worse than a loud one. Someone capacity
  // testing sets 200, gets 64, reads a clean result off it, and concludes 200
  // was fine. The clamp is still a clamp; it just says so.
  if (clamped !== value) {
    console.warn(
      `[config] ${name} is ${value}, outside ${min}-${max}. Using ${clamped} instead.`,
    );
  }
  return clamped;
}

export const config = {
  // The one model and voice. Locked into every ephemeral token this service
  // mints, so a browser holding a token cannot repoint it at a different,
  // unaudited model.
  liveModel: process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview',
  ttsVoice: process.env.GEMINI_TTS_VOICE || 'Charon',

  // Handed to the browser over /languages, so the widget knows how much of a
  // page to read and how to split it for one Gemini Live turn without either
  // number being baked into the widget file. The whole cap is translated and
  // spoken, so a larger figure is a longer recording and a larger bill rather
  // than a better one.
  maxChars: clampInt('LISTEN_MAX_CHARS', process.env.LISTEN_MAX_CHARS, 200, 5000, 2500),
  // Gemini Live will not hold a turn open long enough for a whole article, or
  // reliably for a piece much past this size, so the text is split into
  // pieces of at most this many characters.
  chunkChars: clampInt('LISTEN_TTS_CHUNK_CHARS', process.env.LISTEN_TTS_CHUNK_CHARS, 40, 250, 200),

  // How many Live sessions a minted token may start. Sized per piece with
  // headroom for one retry each, and clamped either side so a page with an
  // implausible piece count cannot mint a token good for hundreds of turns.
  tokenUsesPerPiece: clampInt('LISTEN_TOKEN_USES_PER_PIECE', process.env.LISTEN_TOKEN_USES_PER_PIECE, 1, 4, 2),
  tokenMinUses: clampInt('LISTEN_TOKEN_MIN_USES', process.env.LISTEN_TOKEN_MIN_USES, 1, 20, 4),
  tokenMaxUses: clampInt('LISTEN_TOKEN_MAX_USES', process.env.LISTEN_TOKEN_MAX_USES, 1, 100, 60),
  // How long a token may be used to send messages, and how long the browser
  // has to start its Live sessions with it. The first has to outlast the
  // second: sessions are opened once, near the start of that window.
  tokenExpireMinutes: clampInt('LISTEN_TOKEN_EXPIRE_MINUTES', process.env.LISTEN_TOKEN_EXPIRE_MINUTES, 1, 60, 10),
  tokenNewSessionMinutes: clampInt('LISTEN_TOKEN_NEW_SESSION_MINUTES', process.env.LISTEN_TOKEN_NEW_SESSION_MINUTES, 1, 10, 2),

  // Which of the full language set a deployer actually offers. Both empty
  // means everything -- narrowing is the opt-in, not something a deployer
  // wanting the full set has to ask for.
  allowedLanguages: (process.env.LISTEN_LANGUAGES || '')
    .split(',').map((v) => v.trim()).filter(Boolean),
  allowedCountries: (process.env.LISTEN_COUNTRIES || '')
    .split(',').map((v) => v.trim()).filter(Boolean),

  // The service is public, so these are what stand between the Gemini quota
  // and anyone who finds the endpoint. Set a limit to 0 to switch that one off.
  rateEnabled: process.env.LISTEN_RATE_ENABLED !== '0',
  // Per address, per minute, and per day.
  ratePerMinute: clampInt('LISTEN_RATE_PER_MINUTE', process.env.LISTEN_RATE_PER_MINUTE, 0, 600, 5),
  ratePerDay: clampInt('LISTEN_RATE_PER_DAY', process.env.LISTEN_RATE_PER_DAY, 0, 100000, 100),
  // Across everyone, per day. The per-address limits are all bypassed by
  // rotating address; this is the one that is not.
  budgetPerDay: clampInt('LISTEN_BUDGET_PER_DAY', process.env.LISTEN_BUDGET_PER_DAY, 0, 1000000, 5000),

  // Set on this project's own reference deployment only (see modal_app.py),
  // never on a self-hosted one: changes the wording of the usage notice from
  // "this is not a shared public service" to the opposite, which is only
  // true of the one deployment the widget defaults to with no data-endpoint.
  isSharedDefault: process.env.LISTEN_SHARED_DEFAULT === '1',

  apiKey: process.env.LISTEN_API_KEY || '',
  allowedOrigins: (process.env.LISTEN_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
};
