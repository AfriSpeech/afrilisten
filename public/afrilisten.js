/**
 * AfriListen widget.
 *
 *   <script src="https://cdn.jsdelivr.net/gh/AfriSpeech/afrilisten@main/public/afrilisten.js" defer></script>
 *
 * Optional attributes:
 *   data-lang      force a starting language (an afriso code, e.g. "swa")
 *   data-position  "bottom-right" (default) or "bottom-left"
 *   data-label     button text, default "Listen"
 *   data-endpoint  a token service other than this project's own shared default
 *   data-key       the x-listen-key that endpoint expects (only needed with data-endpoint)
 *
 * With neither data-endpoint nor data-key set, this talks to AfriListen's own
 * reference deployment, on a Gemini key and daily budget shared across every
 * site using the default -- a genuine drop-in, at the cost of that shared
 * budget being the ceiling. Deploy your own instance (see DEPLOY.md) and set
 * both attributes once that is not enough, or if you would rather your
 * traffic not share a budget with anyone else's.
 *
 * The page is read in the browser rather than fetched by our server, so it
 * works on pages that block automated requests and on anything rendered by
 * JavaScript. Readability is only downloaded once someone actually clicks, so
 * a site owner pays nothing until a reader uses the button.
 *
 * The audio itself never touches the synthesis service either. This widget
 * asks it for a short-lived Gemini Live token, then opens the Live session
 * itself, straight from the browser, and speaks the page in pieces the same
 * way a server-side pipeline used to: translate each piece, collect the raw
 * PCM Gemini hands back, and join it into one clip. Nothing is compressed --
 * there is no server on the other end of that hop any more to make a
 * bandwidth trade worthwhile, so the joined PCM is wrapped in a plain WAV
 * header (44 bytes, no encoding) rather than run through an MP3 encoder.
 *
 * The finished clip is then cached in the reader's own browser (IndexedDB),
 * keyed by a hash of the exact text and language, so listening to the same
 * page again in the same language is instant and spends no Gemini quota at
 * all -- an edited page or a different language is a different key, not a
 * stale hit.
 *
 * Styles are shipped in this file on purpose: the host site's stylesheet does
 * not know about our class names, and Tailwind is not present on their page.
 */
(function () {
  'use strict';

  var script = document.currentScript ||
    document.querySelector('script[src*="afrilisten"]');
  if (!script || script.dataset.afrispeechReady) return;
  script.dataset.afrispeechReady = '1';

  /* The directory this very script was loaded from, not just its origin: the
     widget is served from a path (jsDelivr's /gh/org/repo@ref/public/...),
     not necessarily from a site's root, and Readability has to be found
     relative to that path rather than relative to the host. Stripping only
     the origin, the way an earlier version of this file did, silently broke
     the moment the widget stopped being served from a site's own root. */
  var SCRIPT_URL = script.src;
  var SCRIPT_DIR = SCRIPT_URL.slice(0, SCRIPT_URL.lastIndexOf('/') + 1);
  /* The synthesis service is a separate deployment: it spends a metered Gemini
     quota, so it lives apart from the site that embeds this widget.

     data-endpoint and data-key are both optional. With neither set, this
     widget is a true drop-in: it talks to this project's own reference
     deployment, on this project's own Gemini key and daily budget, shared
     across every site that has not set up its own. That is a deliberate
     trade this project makes so a first try costs nothing and takes one
     script tag -- see DEPLOY.md for why it is safe to default this way (the
     key here is not a secret; the daily budget is) and for the steps to
     run your own deployment instead, on your own key and your own budget,
     once that shared one is not enough. */
  var DEFAULT_SPEECH = 'https://listen.afrispeech.org';
  var DEFAULT_SPEECH_KEY = '098c7a395adcc7ed92698eece81d3fdd6ad2e5148650675e';
  var SPEECH = script.dataset.endpoint || DEFAULT_SPEECH;
  /* A browser-delivered key is not a secret: anyone can read it from the page
     source, including the default above. It exists to let the service tell
     widget traffic apart from stray calls, and nothing more.

     Nor is the service's origin allowlist a lock. An Origin header is set by
     the browser and only the browser, so curl sends none and anyone can forge
     one. The allowlist stops other people's pages from spending the quota from
     a reader's browser, which is worth having. What caps what a caller can
     actually cost is the service's rate limits, so host it somewhere that has
     them configured -- or use the default above, which already does. */
  var SPEECH_KEY = script.dataset.key || DEFAULT_SPEECH_KEY;
  var READABILITY = SCRIPT_DIR + 'afrispeech/readability.min.js';
  // An hour, not a day: long enough that picking a language does not cost a
  // request every time, short enough that a change to the list (a benchmark
  // rerun, a deployer's LISTEN_LANGUAGES) reaches an open tab on its own
  // rather than needing a cleared cache. The key carries a version so a
  // change to what gets cached here invalidates what is already stored,
  // rather than a stale shape lingering until its TTL happens to expire.
  var CATALOGUE_CACHE_KEY = 'afrilisten.languages.v3';
  var CATALOGUE_TTL = 60 * 60 * 1000;
  // Feedback is a shared, cross-deployment signal -- every widget everywhere
  // reports to the one place ratings accumulate, rather than each deployer
  // running their own separate pool that starts back at zero. This is
  // deliberately not the same as SPEECH: a deployer's own token service
  // still does the translating and speaking, on their own key and their own
  // quota, but a rating is about how well Gemini translates into a
  // language in general, which is worth pooling rather than splitting up.
  var FEEDBACK_ENDPOINT = 'https://listen.afrispeech.org';
  var MIN_CHARS = 180;
  var UNSUPPORTED = 'Sorry, this webpage is not supported.';
  // A pinned version of the browser build of @google/genai, bundled by esm.sh
  // so this stays a single script tag rather than a build step: the package
  // itself ships a browser entry point, but with a bare `p-retry` import a
  // bundler is expected to resolve, which esm.sh does on the way out.
  var GENAI_CDN = 'https://esm.sh/@google/genai@2.24.0';
  var PCM_SAMPLE_RATE = 24000;
  var PIECE_CONCURRENCY = 4;
  var PIECE_ATTEMPTS = 3;
  var PIECE_TIMEOUT_MS = 60000;

  var cfg = {
    lang: script.dataset.lang || '',
    position: script.dataset.position === 'bottom-left' ? 'left' : 'right',
    label: script.dataset.label || 'Listen',
  };

  /* ------------------------------------------------------------- catalogue */

  /** Every call to the token service goes through here. */
  function speechUrl(path) {
    return SPEECH + path;
  }

  /**
   * The language list, plus the speech settings the widget needs to chunk a
   * page itself now that it drives Gemini Live directly: the model (which has
   * to match what the token is locked to) and how much of a page to read and
   * in what size pieces. Both come from the same request so there is one
   * source of truth for them, on the service rather than baked into this file.
   */
  function loadCatalogue() {
    var fresh = readCache();
    if (fresh) return Promise.resolve(fresh);
    return fetch(speechUrl('/languages'), { headers: { accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var list = (data && data.languages) || [];
        if (!list.length) throw new Error('empty catalogue');
        var speech = (data && data.speech) || {};
        writeCache(list, speech);
        return { list: list, speech: speech };
      });
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CATALOGUE_CACHE_KEY);
      if (!raw) return null;
      var box = JSON.parse(raw);
      if (!box || !box.list || !box.list.length || !box.speech || !box.speech.model) return null;
      if (Date.now() - box.at > CATALOGUE_TTL) return null;
      return { list: box.list, speech: box.speech };
    } catch (e) { return null; }
  }

  function writeCache(list, speech) {
    try {
      localStorage.setItem(CATALOGUE_CACHE_KEY, JSON.stringify({ at: Date.now(), list: list, speech: speech }));
    } catch (e) { /* private mode; we just refetch next time */ }
  }

  /* ------------------------------------------------------------- extraction */

  var readabilityPromise = null;

  function loadReadability() {
    if (window.Readability) return Promise.resolve(window.Readability);
    if (readabilityPromise) return readabilityPromise;
    readabilityPromise = new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = READABILITY;
      tag.async = true;
      tag.onload = function () {
        if (window.Readability) resolve(window.Readability);
        else reject(new Error('Readability did not load'));
      };
      tag.onerror = function () { reject(new Error('Readability failed to load')); };
      document.head.appendChild(tag);
    });
    return readabilityPromise;
  }

  /** Read the page we are sitting on, without sending it anywhere first. */
  function readThisPage() {
    return loadReadability().then(function (Readability) {
      var clone = document.cloneNode(true);
      // Readability chokes on our own widget markup if it is left in place.
      var panels = clone.querySelectorAll('[data-afrispeech-root]');
      for (var i = 0; i < panels.length; i += 1) panels[i].remove();

      var article = new Readability(clone, { charThreshold: 200 }).parse();
      var text = (article && article.textContent ? article.textContent : '')
        .replace(/\s+/g, ' ')
        .trim();

      if (text.length < MIN_CHARS) {
        var err = new Error(UNSUPPORTED);
        err.code = 'unsupported';
        throw err;
      }

      return { text: text };
    });
  }

  /* ------------------------------------------------------------------ audio */

  function speechHeaders(extra) {
    var headers = { accept: 'application/json' };
    if (SPEECH_KEY) headers['x-listen-key'] = SPEECH_KEY;
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) headers[k] = extra[k];
    return headers;
  }

  function speechError(response, fallback) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      var err = new Error(body.error || fallback);
      err.code = body.error === UNSUPPORTED ? 'unsupported' : 'failed';
      err.status = response.status;
      throw err;
    });
  }

  /** Ask the service to translate the first 100 characters via Thai pivot and mint a token. */
  function fetchToken(text, lang, source) {
    return fetch(speechUrl('/token'), {
      method: 'POST',
      headers: speechHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ text: text, lang: lang, source: source || '', pieces: 1 }),
    }).then(function (response) {
      if (!response.ok) return speechError(response, 'We could not start a session.');
      return response.json();
    });
  }

  /**
   * Send a thumbs up or down for the language just heard. Best-effort: a
   * reader who rated the audio has already heard it, so a failed submission
   * here is not worth interrupting them over. See it at /feedback/report
   * (with the service's key) or aggregated at whatever page the deployer
   * builds over that endpoint.
   */
  function sendFeedback(languageCode, rating) {
    // Not speechUrl(): this always goes to the shared FEEDBACK_ENDPOINT, not
    // whatever token service this deployment configured, and it is public --
    // no x-listen-key, because there is no per-deployer feedback service to
    // gate access to any more.
    return fetch(FEEDBACK_ENDPOINT + '/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ languageCode: languageCode, rating: rating }),
    }).then(function (response) { return response.ok; }, function () { return false; });
  }

  /* --------------------------------------------------------- audio, cached */
  /* Listening again to a page already read costs a fresh set of Gemini Live
     sessions for no reason: the words have not changed. The finished clip is
     kept in IndexedDB (not localStorage, which cannot hold a Blob this size
     without a base64 round trip that would bloat it further), keyed by a
     hash of the exact text and language, so an edited page or a different
     language is a cache miss rather than stale or wrong audio, and nothing
     has to compare the reader's chosen language to what a cached entry was
     actually spoken in. */

  var AUDIO_DB_NAME = 'afrispeech.audio-cache';
  var AUDIO_STORE = 'clips';
  var AUDIO_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;

  function cacheKeyFor(text, languageCode) {
    if (!window.crypto || !window.crypto.subtle) return Promise.reject(new Error('no SubtleCrypto'));
    var bytes = new TextEncoder().encode(languageCode + '\u0000' + text);
    return crypto.subtle.digest('SHA-256', bytes).then(function (digest) {
      var hex = '';
      var view = new Uint8Array(digest);
      for (var i = 0; i < view.length; i += 1) {
        hex += (view[i] < 16 ? '0' : '') + view[i].toString(16);
      }
      return hex;
    });
  }

  function openAudioDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
      var req = indexedDB.open(AUDIO_DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(AUDIO_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('indexedDB open failed')); };
    });
  }

  /** The cached blob and meta for `key`, or null on a miss, an expired entry, or any failure. */
  function getCachedAudio(key) {
    return openAudioDb().then(function (db) {
      return new Promise(function (resolve) {
        var req = db.transaction(AUDIO_STORE, 'readonly').objectStore(AUDIO_STORE).get(key);
        req.onsuccess = function () {
          var entry = req.result;
          resolve(entry && Date.now() - entry.at <= AUDIO_CACHE_TTL ? entry : null);
        };
        req.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  /** Best-effort: a reader who is already hearing the audio should not be held up by this. */
  function putCachedAudio(key, blob, meta) {
    return openAudioDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(AUDIO_STORE, 'readwrite');
        tx.objectStore(AUDIO_STORE).put({ blob: blob, meta: meta, at: Date.now() }, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    }).catch(function () {});
  }

  /* ------------------------------------------------------------- clipping */

  /** Clip text to at most `limit` characters (default 100), landing on a boundary. */
  function clipToLimit(text, limit) {
    var max = limit || 100;
    var clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    var slice = clean.slice(0, max);
    var lastStop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
    if (lastStop >= max * 0.6) return slice.slice(0, lastStop + 1).trim();
    var lastSpace = slice.lastIndexOf(' ');
    if (lastSpace >= max * 0.5) return slice.slice(0, lastSpace).trim();
    return slice.trim();
  }

  /* -------------------------------------------------------- Gemini, direct */

  var genaiPromise = null;
  function loadGenai() {
    if (!genaiPromise) genaiPromise = import(GENAI_CDN);
    return genaiPromise;
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function concatBytes(arrays) {
    var total = 0;
    for (var i = 0; i < arrays.length; i += 1) total += arrays[i].length;
    var out = new Uint8Array(total);
    var offset = 0;
    for (var j = 0; j < arrays.length; j += 1) { out.set(arrays[j], offset); offset += arrays[j].length; }
    return out;
  }

  /** A plain, uncompressed WAV header: no encoder, nothing to link against. */
  function wrapWav(pcmBytes, sampleRate) {
    var blockAlign = 2; // mono, 16-bit
    var header = new ArrayBuffer(44);
    var view = new DataView(header);
    function writeStr(offset, str) {
      for (var i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
    }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + pcmBytes.length, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, pcmBytes.length, true);
    return new Blob([header, pcmBytes], { type: 'audio/wav' });
  }

  /**
   * Speak one text chunk over a Gemini Live session, streaming audio packets
   * into AudioContext as they arrive so the reader hears speech immediately.
   */
  function speakChunkStreaming(genai, tokenInfo, promptText, onPacket, onFirstAudio) {
    return new Promise(function (resolve, reject) {
      var chunks = [];
      var settled = false;
      var session = null;
      var socketOpen = false;
      var firstFired = false;
      var timer = setTimeout(function () {
        settle(new Error('Timed out waiting for speech.'));
      }, PIECE_TIMEOUT_MS);

      function settle(err, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { if (session) session.close(); } catch (e) {}
        if (err) reject(err); else resolve(value);
      }

      function flush() {
        if (!socketOpen || !session) return;
        session.sendRealtimeInput({ text: promptText });
      }

      var ai = new genai.GoogleGenAI({ apiKey: tokenInfo.token, httpOptions: { apiVersion: 'v1alpha' } });
      ai.live.connect({
        model: tokenInfo.model,
        config: { responseModalities: [genai.Modality.AUDIO] },
        callbacks: {
          onopen: function () {
            socketOpen = true;
            flush();
          },
          onmessage: function (message) {
            var content = message && message.serverContent;
            if (!content) return;
            var parts = (content.modelTurn && content.modelTurn.parts) || [];
            for (var i = 0; i < parts.length; i += 1) {
              var data = parts[i] && parts[i].inlineData && parts[i].inlineData.data;
              if (data) {
                var pcmBytes = base64ToBytes(data);
                chunks.push(pcmBytes);
                if (!firstFired) {
                  firstFired = true;
                  if (onFirstAudio) onFirstAudio();
                }
                if (onPacket) onPacket(pcmBytes);
              }
            }
            if (content.turnComplete) {
              settle(null, concatBytes(chunks));
            }
          },
          onerror: function (event) {
            settle(new Error('live: ' + ((event && event.message) || 'socket error')));
          },
          onclose: function (event) {
            if (!settled) {
              settle(new Error('live: closed before turn completed' + (event && event.code ? ' (code ' + event.code + ')' : '')));
            }
          },
        },
      }).then(function (opened) {
        session = opened;
        flush();
      }).catch(function (err) {
        settle(new Error('live: connect failed: ' + err.message));
      });
    });
  }

  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  /** A piece that fails is worth asking again: usually a dropped socket, not a bad piece. */
  function withRetry(fn, attempts) {
    function attempt(n) {
      return fn().catch(function (err) {
        if (n >= attempts) throw err;
        return wait(400 * Math.pow(2, n - 1)).then(function () { return attempt(n + 1); });
      });
    }
    return attempt(1);
  }

  /**
   * Speak `text` in `lang`: translates the article on the server in one shot,
   * receives sentence-bounded chunks, and streams audio chunk-by-chunk in real time.
   */
  function buildAudio(text, lang, languageName, source, audioCtx, onStatus) {
    return Promise.all([fetchToken(text, lang, source), loadGenai()]).then(function (results) {
      var tokenInfo = results[0];
      var genai = results[1];
      var chunks = tokenInfo.chunks && tokenInfo.chunks.length ? tokenInfo.chunks : [tokenInfo.text || text];
      var langName = tokenInfo.language || languageName || 'the target language';

      var allPcmPieces = [];
      var nextPlayTime = 0;
      var activeSources = [];

      function queuePcm(pcmBytes) {
        if (!audioCtx || !pcmBytes || pcmBytes.length < 2) return;
        try {
          var int16 = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, Math.floor(pcmBytes.byteLength / 2));
          var float32 = new Float32Array(int16.length);
          for (var i = 0; i < int16.length; i += 1) {
            float32[i] = int16[i] / 32768.0;
          }
          var audioBuf = audioCtx.createBuffer(1, float32.length, PCM_SAMPLE_RATE);
          audioBuf.getChannelData(0).set(float32);

          var src = audioCtx.createBufferSource();
          src.buffer = audioBuf;
          src.connect(audioCtx.destination);

          var now = audioCtx.currentTime;
          var start = Math.max(now, nextPlayTime);
          src.start(start);
          nextPlayTime = start + audioBuf.duration;
          activeSources.push(src);
        } catch (e) {}
      }

      function processChunk(idx) {
        if (idx >= chunks.length) {
          var fullPcm = concatBytes(allPcmPieces);
          var blob = wrapWav(fullPcm, PCM_SAMPLE_RATE);
          return Promise.resolve({
            blob: blob,
            meta: {
              language: langName,
              chars: chunks.reduce(function (acc, c) { return acc + c.length; }, 0),
              totalChars: (text || '').length,
              truncated: false,
              pieces: chunks.length,
            },
            stop: function () {
              activeSources.forEach(function (s) { try { s.stop(); } catch (e) {} });
              activeSources = [];
            },
          });
        }

        var pieceText = chunks[idx];
        var prompt = 'Pronounce the following text in ' + langName + ':\n\n' + pieceText;

        return withRetry(function () {
          return speakChunkStreaming(genai, tokenInfo, prompt, queuePcm, function onFirstAudio() {
            if (onStatus) onStatus('playing', langName, chunks.length, idx + 1);
          });
        }, PIECE_ATTEMPTS).then(function (piecePcm) {
          allPcmPieces.push(piecePcm);
          return processChunk(idx + 1);
        });
      }

      return processChunk(0);
    });
  }

  /* ------------------------------------------------------------------- view */

  var root = document.createElement('div');
  root.setAttribute('data-afrispeech-root', '');
  root.className = 'afs-listen afs-listen--' + cfg.position;

  var style = document.createElement('style');
  style.textContent = [
    '.afs-listen{position:fixed;bottom:20px;z-index:2147483000;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.4}',
    '.afs-listen--right{right:20px}','.afs-listen--left{left:20px}',
    '.afs-listen__row{display:flex;align-items:stretch;background:#fff;border:1px solid #D4DAD6;border-radius:999px;box-shadow:0 8px 24px rgba(16,24,40,.12);overflow:hidden}',
    '.afs-listen__btn{appearance:none;border:0;background:#52B788;color:#081C15;font-weight:600;font-size:14px;padding:11px 18px;cursor:pointer;display:flex;align-items:center;gap:8px;white-space:nowrap}',
    '.afs-listen__btn:hover{background:#37845F;color:#fff}','.afs-listen__btn:disabled{opacity:.65;cursor:progress}',
    '.afs-listen__btn svg{width:16px;height:16px;fill:currentColor}',
    '.afs-listen__sel{appearance:none;-webkit-appearance:none;border:0;border-left:1px solid #D4DAD6;background:#fff url(\'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="10" height="6" viewBox="0 0 10 6"%3E%3Cpath d="M1 1l4 4 4-4" fill="none" stroke="%233B4540" stroke-width="1.5"/%3E%3C/svg%3E\') no-repeat right 10px center;background-size:10px 6px;color:#3B4540;font-size:13px;padding:0 26px 0 12px;cursor:pointer;max-width:150px}',
    '.afs-listen__panel{margin-top:10px;background:#fff;border:1px solid #D4DAD6;border-radius:12px;box-shadow:0 8px 24px rgba(16,24,40,.12);padding:14px;width:300px;max-width:calc(100vw - 40px)}',
    '.afs-listen__panel[hidden]{display:none}',
    '.afs-listen__audio{width:100%;margin:2px 0 8px}',
    '.afs-listen__status{display:flex;align-items:center;gap:10px;padding:8px 0;margin:2px 0 6px}',
    '.afs-listen__status-text{font-size:13px;color:#2D6A4F;font-weight:600}',
    '.afs-listen__pulse{width:8px;height:8px;border-radius:50%;background:#52B788;animation:afs-pulse 1.2s ease-in-out infinite;flex-shrink:0}',
    '@keyframes afs-pulse{0%,100%{opacity:0.3;transform:scale(0.8)}50%{opacity:1;transform:scale(1.2)}}',
    '.afs-listen__wave{display:inline-flex;align-items:flex-end;gap:2px;height:14px;flex-shrink:0}',
    '.afs-listen__wave span{width:3px;background:#2D6A4F;border-radius:2px;animation:afs-wave 0.9s ease-in-out infinite}',
    '.afs-listen__wave span:nth-child(1){height:6px;animation-delay:0.1s}',
    '.afs-listen__wave span:nth-child(2){height:14px;animation-delay:0.3s}',
    '.afs-listen__wave span:nth-child(3){height:10px;animation-delay:0.2s}',
    '.afs-listen__wave span:nth-child(4){height:12px;animation-delay:0.4s}',
    '.afs-listen__wave span:nth-child(5){height:5px;animation-delay:0.15s}',
    '@keyframes afs-wave{0%,100%{height:3px}50%{height:14px}}',
    '.afs-listen__note{font-size:12px;color:#5F6F66;margin:0 0 6px}',
    '.afs-listen__note--warn{background:#FDF3E3;border:1px solid #E8C88A;color:#7A5410;border-radius:8px;padding:8px 10px;margin:0 0 8px}',
    '.afs-listen__err{font-size:13px;color:#9B2C2C;margin:0}','.afs-listen__link{color:#2D6A4F;font-size:12px}',
    '.afs-listen__head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}',
    '.afs-listen__lang{font-size:12px;font-weight:600;color:#2D6A4F}',
    '.afs-listen__close{border:0;background:none;color:#717E76;cursor:pointer;font-size:18px;line-height:1;padding:2px 4px}',
    '.afs-listen__rate{display:flex;align-items:center;gap:10px;margin:2px 0 8px}',
    '.afs-listen__rate-label{font-size:12px;color:#5F6F66}',
    '.afs-listen__rate-btn{appearance:none;border:1px solid #D4DAD6;background:#fff;color:#5F6F66;border-radius:8px;padding:4px 8px;cursor:pointer;line-height:1;display:inline-flex}',
    '.afs-listen__rate-btn:hover{border-color:#52B788;color:#2D6A4F}',
    '.afs-listen__rate-btn svg{width:14px;height:14px;fill:currentColor}',
    '.afs-listen__rate-btn[aria-pressed="true"]{border-color:#2D6A4F;background:#EAF3EE;color:#2D6A4F}',
    '.afs-listen__rate-btn:disabled{cursor:default;opacity:.55}',
  ].join('');

  function icon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a3.5 3.5 0 0 0-2-3.15v6.3a3.5 3.5 0 0 0 2-3.15z"/></svg>';
  }

  /** The same thumb, flipped for "down" via a viewBox transform. */
  function thumbIcon(down) {
    // The transform has to sit on an inner <g>, not the <svg> root: some
    // browsers simply ignore a transform attribute there, which is what left
    // an empty button outline with the icon rendered off in the corner.
    var open = down ? '<g transform="translate(0,24) scale(1,-1)">' : '<g>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + open +
      '<path d="M2 21h3V10H2v11zm19-11a2 2 0 0 0-2-2h-6.31l.95-4.57.03-.32a1.5 1.5 0 0 0-.44-1.06L12.17 1 6.59 6.59A2 2 0 0 0 6 8v11a2 2 0 0 0 2 2h9a2 2 0 0 0 1.83-1.2l3.02-7.05A2 2 0 0 0 22 12v-1.83z"/>' +
      '</g></svg>';
  }

  function build() {
    document.head.appendChild(style);
    document.body.appendChild(root);

    root.innerHTML =
      '<div class="afs-listen__row">' +
        '<button class="afs-listen__btn" type="button">' + icon() + '<span class="afs-listen__text">' + cfg.label + '</span></button>' +
        '<select class="afs-listen__sel" aria-label="Language"></select>' +
      '</div>' +
      '<div class="afs-listen__panel" hidden></div>';

    var button = root.querySelector('.afs-listen__btn');
    var select = root.querySelector('.afs-listen__sel');
    var panel = root.querySelector('.afs-listen__panel');

    var speechConfig = null;

    loadCatalogue().then(function (info) {
      speechConfig = info.speech;
      /* The first option is a prompt, not a choice: it carries no language and
         cannot be selected, so nothing is chosen until the reader picks. The
         catalogue is only ever the languages the service can actually speak, so
         it is not padded with English to fill the gap. */
      select.innerHTML = placeholder() + info.list.map(function (l) {
        return '<option value="' + l.code + '">' + escapeHtml(l.name) + '</option>';
      }).join('');
    }).catch(function (err) {
      /* Catalogue unreachable: there is nothing honest to offer, and quietly
         defaulting to a language the reader did not ask for is worse than
         saying so. */
      select.innerHTML = placeholder();
      /* Tell the reader, but keep the reason for whoever maintains the page: a
         reader cannot act on "not configured", a site owner can. */
      select.setAttribute('data-error', err && err.message ? err.message : 'catalogue unreachable');
      select.disabled = true;
      button.disabled = true;
      panel.hidden = false;
      panel.innerHTML = '<p class="afs-listen__note">The list of languages could not be ' +
        'loaded, so Listen is unavailable just now.</p>';
    });

    function placeholder() {
      return '<option value="" disabled selected>Select a language</option>';
    }

    button.addEventListener('click', function () { start(); });
    select.addEventListener('click', function (event) { event.stopPropagation(); });

    function start() {
      if (!select.value) {
        try { select.showPicker(); } catch (e) { select.focus(); }
        return;
      }

      var chosen = select.options[select.selectedIndex];
      var languageName = chosen ? chosen.textContent : 'audio';

      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      var audioCtx = null;
      try {
        if (AudioContextClass) {
          audioCtx = new AudioContextClass({ sampleRate: PCM_SAMPLE_RATE });
          if (audioCtx.state === 'suspended') audioCtx.resume();
        }
      } catch (e) {}

      var currentSession = null;

      function stopAndClose() {
        if (currentSession && currentSession.stop) currentSession.stop();
        if (audioCtx && audioCtx.close) try { audioCtx.close(); } catch (e) {}
        panel.hidden = true;
        reset();
      }

      function setStatus(text, showPulse, isPlaying) {
        panel.innerHTML =
          '<div class="afs-listen__head">' +
            '<span class="afs-listen__lang">' + escapeHtml(languageName) + '</span>' +
            '<button class="afs-listen__close" type="button" aria-label="Close">&times;</button>' +
          '</div>' +
          '<div class="afs-listen__status">' +
            (isPlaying
              ? '<div class="afs-listen__wave"><span></span><span></span><span></span><span></span><span></span></div>'
              : (showPulse ? '<span class="afs-listen__pulse"></span>' : '')) +
            '<span class="afs-listen__status-text">' + escapeHtml(text) + '</span>' +
          '</div>' +
          '<p class="afs-listen__note" style="margin-top:6px">Powered by ' +
            '<a class="afs-listen__link" href="https://afrispeech.org" target="_blank" rel="noopener">AfriSpeech</a></p>';
        var closeBtn = panel.querySelector('.afs-listen__close');
        if (closeBtn) closeBtn.addEventListener('click', stopAndClose);
      }

      button.disabled = true;
      button.querySelector('.afs-listen__text').textContent = 'Playing…';
      panel.hidden = false;
      setStatus('Reading page…', true, false);

      readThisPage()
        .then(function (page) {
          var langCode = select.value;
          var pageLang = (document.documentElement.lang || (document.body && document.body.getAttribute('lang')) || '')
            .toLowerCase().split('-')[0].trim();

          return cacheKeyFor(page.text, langCode)
            .catch(function () { return null; }) // no SubtleCrypto: skip the cache, not the reading
            .then(function (key) {
              return (key ? getCachedAudio(key) : Promise.resolve(null)).then(function (cached) {
                if (cached) return { blob: cached.blob, meta: cached.meta };

                setStatus('Translating to ' + languageName + '…', true, false);
                return buildAudio(page.text, langCode, languageName, pageLang, audioCtx, function onStatus(stage, lName, totalChunks, currentChunk) {
                  if (stage === 'playing') {
                    var chunkLabel = totalChunks > 1 ? ' (' + currentChunk + '/' + totalChunks + ')' : '';
                    setStatus('Playing ' + lName + chunkLabel, false, true);
                  }
                }).then(function (result) {
                  currentSession = result;
                  if (key) putCachedAudio(key, result.blob, result.meta);
                  return result;
                });
              });
            });
        })
        .then(function (result) {
          var url = URL.createObjectURL(result.blob);
          var meta = result.meta;
          var langCode = select.value;
          panel.innerHTML =
            '<div class="afs-listen__head"><span class="afs-listen__lang">' +
              escapeHtml(meta.language || 'Audio') + '</span>' +
              '<button class="afs-listen__close" type="button" aria-label="Close">&times;</button></div>' +
            '<audio class="afs-listen__audio" controls autoplay src="' + url + '"></audio>' +
            '<div class="afs-listen__rate">' +
              '<span class="afs-listen__rate-label">How did that sound?</span>' +
              '<button class="afs-listen__rate-btn" type="button" data-rating="up" aria-label="Good" aria-pressed="false">' + thumbIcon(false) + '</button>' +
              '<button class="afs-listen__rate-btn" type="button" data-rating="down" aria-label="Not good" aria-pressed="false">' + thumbIcon(true) + '</button>' +
            '</div>' +
            '<p class="afs-listen__note">Powered by ' +
              '<a class="afs-listen__link" href="https://afrispeech.org" target="_blank" rel="noopener">AfriSpeech</a></p>';

          var close = panel.querySelector('.afs-listen__close');
          close.addEventListener('click', stopAndClose);

          var rateButtons = panel.querySelectorAll('.afs-listen__rate-btn');
          var rateLabel = panel.querySelector('.afs-listen__rate-label');
          rateButtons.forEach(function (btn) {
            btn.addEventListener('click', function () {
              rateButtons.forEach(function (b) {
                b.disabled = true;
                b.setAttribute('aria-pressed', String(b === btn));
              });
              rateLabel.textContent = 'Thanks for the feedback!';
              sendFeedback(langCode, btn.getAttribute('data-rating'));
            });
          });

          reset();
        })
        .catch(function (error) {
          panel.innerHTML = error.code === 'unsupported'
            ? '<p class="afs-listen__err">' + UNSUPPORTED + '</p>'
            : '<p class="afs-listen__err">' + escapeHtml(error.message) + '</p>';
          reset();
        });
    }

    function reset() {
      button.disabled = false;
      button.querySelector('.afs-listen__text').textContent = cfg.label;
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
