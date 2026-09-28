/**
 * AfriSpeech Listen widget.
 *
 *   <script src="https://cdn.jsdelivr.net/gh/AfriSpeech/web-tts@main/public/afrispeech-listen.js" defer></script>
 *
 * Optional attributes:
 *   data-lang      force a starting language (an afriso code, e.g. "swa")
 *   data-position  "bottom-right" (default) or "bottom-left"
 *   data-label     button text, default "Listen"
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
 * Styles are shipped in this file on purpose: the host site's stylesheet does
 * not know about our class names, and Tailwind is not present on their page.
 */
(function () {
  'use strict';

  var script = document.currentScript ||
    document.querySelector('script[src*="afrispeech-listen"]');
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
     quota, so it lives apart from the site that embeds this widget. */
  // No default host. Base.astro fails the build when a page enables the widget
  // without PUBLIC_LISTEN_ENDPOINT, so an empty value here means the markup was
  // hand-edited rather than that a default is missing.
  var SPEECH = script.dataset.endpoint;
  /* A browser-delivered key is not a secret: anyone can read it from the page
     source. It exists to let the service tell widget traffic apart from stray
     calls, and nothing more.

     Nor is the service's origin allowlist a lock. An Origin header is set by
     the browser and only the browser, so curl sends none and anyone can forge
     one. The allowlist stops other people's pages from spending the quota from
     a reader's browser, which is worth having. What caps what a caller can
     actually cost is the service's rate limits, so host it somewhere that has
     them configured. */
  var SPEECH_KEY = script.dataset.key || '';
  var READABILITY = SCRIPT_DIR + 'afrispeech/readability.min.js';
  var CATALOGUE_TTL = 24 * 60 * 60 * 1000;
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

  /* Every call to the service goes through here. With no endpoint set, fetch
     would be handed "undefined/languages", which resolves against the reader's
     own site and comes back as HTML, so the failure would look like a network
     problem instead of the misconfiguration it is. */
  function speechUrl(path) {
    if (!SPEECH) throw new Error('no data-endpoint on the script tag');
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
      var raw = localStorage.getItem('afrispeech.languages');
      if (!raw) return null;
      var box = JSON.parse(raw);
      if (!box || !box.list || !box.list.length || !box.speech || !box.speech.model) return null;
      if (Date.now() - box.at > CATALOGUE_TTL) return null;
      return { list: box.list, speech: box.speech };
    } catch (e) { return null; }
  }

  function writeCache(list, speech) {
    try {
      localStorage.setItem('afrispeech.languages', JSON.stringify({ at: Date.now(), list: list, speech: speech }));
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

  /** Ask the service for a short-lived Gemini Live token, sized to `pieces`. */
  function fetchToken(pieces) {
    return fetch(speechUrl('/token'), {
      method: 'POST',
      headers: speechHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ pieces: pieces }),
    }).then(function (response) {
      if (!response.ok) return speechError(response, 'We could not start a session.');
      return response.json();
    });
  }

  /* --------------------------------------------------------- text, chunked */
  /* Ported from the pipeline that used to run server-side: split at most
     `limit` characters, never mid-sentence if it can be helped, so a piece
     never comes back with an audible seam or a chopped-off word. */

  var TERMINATOR = '.!?…';

  function splitSentences(text) {
    var out = [];
    var current = '';
    for (var i = 0; i < text.length; i += 1) {
      current += text[i];
      if (TERMINATOR.indexOf(text[i]) === -1) continue;
      while (i + 1 < text.length && /["'’”)\]]/.test(text[i + 1])) { current += text[++i]; }
      while (i + 1 < text.length && /\s/.test(text[i + 1])) { current += text[++i]; }
      out.push(current.trim());
      current = '';
    }
    if (current.trim()) out.push(current.trim());
    return out.filter(Boolean);
  }

  function splitOversized(sentence, maxChars) {
    var pieces = [];
    var rest = sentence.trim();
    while (rest.length > maxChars) {
      var window = rest.slice(0, maxChars + 1);
      var cut = Math.max(window.lastIndexOf('; '), window.lastIndexOf(', '), window.lastIndexOf(': '));
      if (cut > maxChars * 0.4) {
        pieces.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1).trim();
        continue;
      }
      var space = window.lastIndexOf(' ');
      var at = space > 0 ? space : maxChars;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
    return pieces;
  }

  function splitForSynthesis(text, maxChars) {
    var clean = String(text || '').trim();
    if (!clean) return [];
    var limit = Math.max(40, Math.floor(maxChars));

    var packed = [];
    var current = '';
    var sentences = splitSentences(clean);
    for (var i = 0; i < sentences.length; i += 1) {
      var sentence = sentences[i];
      if (current && current.length + 1 + sentence.length <= limit) {
        current += ' ' + sentence;
      } else {
        if (current) packed.push(current);
        current = sentence;
      }
    }
    if (current) packed.push(current);

    var out = [];
    for (var j = 0; j < packed.length; j += 1) {
      if (packed[j].length <= limit) out.push(packed[j]);
      else out = out.concat(splitOversized(packed[j], limit));
    }
    return out;
  }

  /** Keep at most `limit` characters, preferring to land on a full stop. */
  function truncateToLimit(text, limit) {
    var clean = String(text || '').replace(/\s+/g, ' ').trim();
    var totalChars = clean.length;
    if (totalChars <= limit) return { text: clean, truncated: false, totalChars: totalChars };

    var window = clean.slice(0, limit);
    var lastStop = Math.max(
      window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '),
      window.lastIndexOf('。'), window.lastIndexOf('।'),
    );

    var cut;
    if (lastStop >= limit * 0.8) {
      cut = window.slice(0, lastStop + 1);
    } else {
      var lastSpace = window.lastIndexOf(' ');
      cut = lastSpace > limit * 0.5 ? window.slice(0, lastSpace) : window;
    }
    return { text: cut.trim(), truncated: true, totalChars: totalChars };
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
   * Speak one piece over a Gemini Live session opened with the ephemeral
   * token, and resolve with the raw PCM Gemini hands back.
   *
   * `onopen` can fire before `connect()` resolves, so the session object is
   * not always assigned when it does; the text waits for both.
   */
  function speakPiece(genai, tokenInfo, instruction, text) {
    return new Promise(function (resolve, reject) {
      var chunks = [];
      var settled = false;
      var session = null;
      var socketOpen = false;
      var timer = setTimeout(function () { settle(new Error('Timed out waiting for audio.')); }, PIECE_TIMEOUT_MS);

      function settle(err, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { if (session) session.close(); } catch (e) { /* already gone */ }
        if (err) reject(err); else resolve(value);
      }
      function flush() {
        if (!socketOpen || !session) return;
        session.sendRealtimeInput({ text: instruction ? instruction + '\n\n' + text : text });
      }

      var ai = new genai.GoogleGenAI({ apiKey: tokenInfo.token, httpOptions: { apiVersion: 'v1alpha' } });
      ai.live.connect({
        model: tokenInfo.model,
        config: { responseModalities: [genai.Modality.AUDIO] },
        callbacks: {
          onopen: function () { socketOpen = true; flush(); },
          onmessage: function (message) {
            var content = message && message.serverContent;
            if (!content) return;
            var parts = (content.modelTurn && content.modelTurn.parts) || [];
            for (var i = 0; i < parts.length; i += 1) {
              var data = parts[i] && parts[i].inlineData && parts[i].inlineData.data;
              if (data) chunks.push(base64ToBytes(data));
            }
            if (content.turnComplete) settle(null, concatBytes(chunks));
          },
          onerror: function (event) { settle(new Error('live: ' + ((event && event.message) || 'socket error'))); },
          onclose: function (event) {
            if (!settled) settle(new Error('live: closed before the turn completed' + (event && event.code ? ' (code ' + event.code + ')' : '')));
          },
        },
      }).then(function (opened) { session = opened; flush(); })
        .catch(function (err) { settle(new Error('live: connect failed: ' + err.message)); });
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

  /** At most `limit` pieces spoken at once, results back in original order. */
  function inParallel(items, limit, worker) {
    return new Promise(function (resolve, reject) {
      if (!items.length) return resolve([]);
      var results = new Array(items.length);
      var next = 0;
      var active = 0;
      var failed = false;

      function pump() {
        if (failed) return;
        if (next >= items.length && active === 0) { resolve(results); return; }
        while (!failed && active < limit && next < items.length) {
          (function (index, item) {
            active += 1;
            worker(item, index).then(function (value) {
              results[index] = value;
              active -= 1;
              pump();
            }, function (err) {
              if (!failed) { failed = true; reject(err); }
            });
          })(next, items[next]);
          next += 1;
        }
      }
      pump();
    });
  }

  /**
   * Read `text` aloud in `lang`: chunk it, mint a token sized to the piece
   * count, speak every piece over its own Live session (a few at a time),
   * and join the raw audio into one clip. `speech` is the settings block from
   * /languages, fetched once when the widget first loaded the catalogue.
   */
  function buildAudio(text, lang, languageName, speech) {
    var maxChars = (speech && speech.maxChars) || 1000;
    var chunkChars = (speech && speech.chunkChars) || 250;

    var capped = truncateToLimit(text, maxChars);
    var pieces = splitForSynthesis(capped.text, chunkChars);
    var instruction = lang
      ? ('Translate the text below into ' + languageName + ' and speak your translation aloud, in ' + languageName + '.')
      : '';

    return Promise.all([fetchToken(pieces.length), loadGenai()]).then(function (results) {
      var tokenInfo = results[0];
      var genai = results[1];

      return inParallel(pieces, PIECE_CONCURRENCY, function (piece) {
        return withRetry(function () { return speakPiece(genai, tokenInfo, instruction, piece); }, PIECE_ATTEMPTS);
      }).then(function (pcmPieces) {
        var pcm = concatBytes(pcmPieces);
        var blob = wrapWav(pcm, PCM_SAMPLE_RATE);
        return {
          blob: blob,
          meta: {
            language: languageName || 'Audio',
            chars: capped.text.length,
            totalChars: capped.totalChars,
            truncated: capped.truncated,
            pieces: pieces.length,
          },
        };
      });
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
    /* An indeterminate bar, not a percentage: nothing here can honestly report
       "40% done" (a piece either has not started, or it has finished), so the
       bar promises only that work is happening, not how much is left. */
    '.afs-listen__bar{position:relative;overflow:hidden;height:4px;border-radius:999px;background:#E7ECE9;margin:0 0 10px}',
    '.afs-listen__bar::after{content:"";position:absolute;top:0;left:-40%;height:100%;width:40%;border-radius:999px;background:#52B788;animation:afs-listen-slide 1.1s ease-in-out infinite}',
    '@keyframes afs-listen-slide{0%{left:-40%}50%{left:60%}100%{left:100%}}',
    '@media (prefers-reduced-motion: reduce){.afs-listen__bar::after{animation:none;left:0;width:100%;opacity:.5}}',
    '.afs-listen__note{font-size:12px;color:#5F6F66;margin:0 0 6px}',
    '.afs-listen__note--warn{background:#FDF3E3;border:1px solid #E8C88A;color:#7A5410;border-radius:8px;padding:8px 10px;margin:0 0 8px}',
    '.afs-listen__err{font-size:13px;color:#9B2C2C;margin:0}','.afs-listen__link{color:#2D6A4F;font-size:12px}',
    '.afs-listen__head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}',
    '.afs-listen__lang{font-size:12px;font-weight:600;color:#2D6A4F}',
    '.afs-listen__close{border:0;background:none;color:#717E76;cursor:pointer;font-size:18px;line-height:1;padding:2px 4px}',
  ].join('');

  function icon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a3.5 3.5 0 0 0-2-3.15v6.3a3.5 3.5 0 0 0 2-3.15z"/></svg>';
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
        panel.hidden = false;
        panel.innerHTML = '<p class="afs-listen__note">Choose a language to read this ' +
          'page in, then press Listen again.</p>';
        return;
      }
      button.disabled = true;
      button.querySelector('.afs-listen__text').textContent = 'Preparing…';
      panel.hidden = false;
      panel.innerHTML = '<div class="afs-listen__bar"></div><p class="afs-listen__note">Reading this page…</p>';

      readThisPage()
        .then(function (page) {
          // Gemini Live translates and speaks in one turn now, so a full page
          // is a matter of seconds rather than the minute or two the old
          // translate-then-speak pipeline needed. Say that once, naming the
          // language they picked, and let the bar carry the wait rather than
          // a countdown that cannot honestly report progress mid-piece.
          var chosen = select.options[select.selectedIndex];
          var languageName = chosen ? chosen.textContent : 'audio';
          panel.innerHTML = '<div class="afs-listen__bar"></div><p class="afs-listen__note">Making a ' +
            escapeHtml(languageName) + ' recording. It will start playing on its own.</p>';
          return buildAudio(page.text, select.value, languageName, speechConfig);
        })
        .then(function (result) {
          var url = URL.createObjectURL(result.blob);
          var meta = result.meta;
          panel.innerHTML =
            '<div class="afs-listen__head"><span class="afs-listen__lang">' +
              escapeHtml(meta.language || 'Audio') + '</span>' +
              '<button class="afs-listen__close" type="button" aria-label="Close">&times;</button></div>' +
            (meta.truncated
              ? '<p class="afs-listen__note afs-listen__note--warn">This page was long, so we read only the first ' +
                meta.chars.toLocaleString() + ' of ' + meta.totalChars.toLocaleString() + ' characters.</p>'
              : '') +
            '<audio class="afs-listen__audio" controls autoplay src="' + url + '"></audio>' +
              // Attribution, not documentation. The old link was built from
              // ORIGIN, which is wherever this script happens to be served from, so
              // on a staging deploy it pointed at that deploy's about page. The
              // brand's home is fixed, so point there instead.
              '<p class="afs-listen__note">Powered by ' +
                '<a class="afs-listen__link" href="https://afrispeech.org" target="_blank" rel="noopener">AfriSpeech</a></p>';
          var close = panel.querySelector('.afs-listen__close');
          close.addEventListener('click', function () {
            panel.hidden = true;
            URL.revokeObjectURL(url);
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
