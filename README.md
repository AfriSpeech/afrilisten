# AfriSpeech Listen

Turn any web page into audio, in the reader's own language.

Drop one script tag on your site and readers get a **Listen** button that reads
the page they are on, translated into any of 43 African languages and spoken
aloud. No build step, no framework, no SDK to install.

## How this works

There is no audio server. The widget reads the page in the reader's own
browser, splits it into pieces, and speaks each piece by opening a **Gemini
Live** session directly from the browser — Gemini translates the piece and
speaks the translation in the same turn. The only thing a server is for is
minting the short-lived token that lets the browser do that without ever
holding the real Gemini key: a small token service, not a synthesis pipeline.
Nobody's server ever sees the page's text or the resulting audio.

## Before you integrate this: it is your endpoint, not a shared one

This repository is code to deploy, not a service to point at. Whoever runs an
instance pays for the tokens it mints, so what an instance can serve is bounded
by their plan rather than by anyone else's. `GET /languages` carries the same
statement as `notice`, so an integration reads it rather than has to know it:

```json
{ "notice": { "status": "self-hosted", "message": "...", "production": "..." } }
```

The short version is in [Running it yourself](#running-it-yourself) below: deploy
it with your own key, and keep it server-side.

## Add it to your page

Put this in the `<head>` of any page with article text on it:

```html
<script
  src="https://cdn.jsdelivr.net/gh/AfriSpeech/web-tts@main/public/afrispeech-listen.js"
  data-endpoint="https://listen.example.org"
  defer></script>
```

That is the whole integration. A button appears in the corner, and pressing it
reads the page.

The script src above points at `main` in this repository, not a pinned
release, so a page using it picks up whatever was last pushed here — there is
nothing to bump on your side when the widget changes. Two caches sit between a
push and a reader actually getting it, and they behave differently:

- **jsDelivr's own CDN cache** refreshes `@main` roughly every 12 hours on its
  own, or within a couple of minutes of
  [a purge request](https://www.jsdelivr.com/tools/purge) after a push —
  purge both `public/afrispeech-listen.js` and
  `public/afrispeech/readability.min.js` if you change either.
- **The reader's own browser** then caches whatever it fetched for **7 days**
  (`max-age=604800`, jsDelivr's header, not something this repository sets),
  regardless of what the CDN is serving by then. A purge does not reach a
  browser that already has a copy; only that reader's own cache expiring, or
  them clearing it, does.

So "always latest" is true for a reader's *first* fetch, not for a week after
that. Pin a commit instead (`@<sha>` in place of `@main`) if you want a
specific, unambiguous version — jsDelivr treats a commit-pinned URL as
immutable and serves it consistently everywhere with no propagation delay,
which is also the quickest way to tell whether something is a real bug or
just an unrefreshed cache.

`data-endpoint` is the token service, not an audio server, and it is yours to
run: see [Running it yourself](#running-it-yourself). There is no default for
it: a script tag without one gets a widget that cannot reach a service, which
is a confusing thing to hand someone, so it says so on the language list
instead of failing quietly.

The page is read **in the reader's browser**, not fetched by anyone's server,
so it works on pages that block automated requests and on anything rendered by
JavaScript. Readability and the Gemini client library are only downloaded once
someone actually presses the button.

### Options

All optional, set on the script tag:

```html
<script
  src="https://cdn.jsdelivr.net/gh/AfriSpeech/web-tts@main/public/afrispeech-listen.js"
  data-lang="swh"
  data-position="bottom-left"
  data-label="Soma"
  defer></script>
```

| Attribute       | Default   | What it does                                              |
| --------------- | --------- | --------------------------------------------------------- |
| `data-lang`     | reader's  | Start in this language instead of asking. An AfriSpeech code, e.g. `swh`. |
| `data-position` | `bottom-right` | `bottom-right` or `bottom-left`.                       |
| `data-label`    | `Listen`  | The button text.                                           |
| `data-endpoint` | none, required | The token service to call. There is no default.      |
| `data-key`      | none      | A browser key, if you run your own deployment.             |

### Before you go live

**Which sites may use a service is that service's decision, not yours.**
`LISTEN_ALLOWED_ORIGINS` is enforced as a CORS check, and a page on an origin
that is not allowed gets no error you can read: the page loads, the button
appears, and pressing it does nothing. Worth knowing about, because it is the
one thing that can stop an integration working and it fails quietly.

If you run your own service — which is the only way to run one — narrow it to
the origins you expect. See [DEPLOY.md](DEPLOY.md).

Check which situation you are in by loading your page and watching the network
tab for the `/languages` request the widget makes on load. A `200` means you are
allowed. A CORS error, or no request at all, means you are not.

That same response carries the `notice` field, and a service you did not deploy
will say so there.

## Build your own player

The widget is a thin client over two things: this service, and Gemini Live
itself. If you would rather build the button yourself, this is the whole
contract.

Base URL: `https://listen.example.org` — use whatever address your deployment
publishes to.

### 1. List the languages and the speech settings

```http
GET /languages
```

```json
{
  "languages": [ { "code": "swh", "name": "Swahili", "google": "sw", "countries": ["KE", "TZ"] } ],
  "speech": { "model": "gemini-3.1-flash-live-preview", "maxChars": 1000, "chunkChars": 250 }
}
```

Free, and not behind the key, because a client needs it before it has anything
else. `speech.model` is not a suggestion — it is what every minted token is
locked to, so a session opened with a different model id will be refused.
`maxChars`/`chunkChars` are how much of a page to read and how big a piece
Gemini Live will hold in one turn; **fetch these rather than hardcoding them.**

### 2. Mint a token

```http
POST /token
x-listen-key: <your key>
content-type: application/json

{ "pieces": 4 }
```

`pieces` is a hint — roughly how many pieces you are about to speak — used
only to size how many Live sessions the token is good for. There is no `text`
field: the service never sees the page.

```json
{ "token": "auth_tokens/…", "model": "gemini-3.1-flash-live-preview", "expireTime": "…", "uses": 8 }
```

The token is short-lived and locked to one model, one voice, and audio-only
output, so holding it is not the same as holding your Gemini key.

### 3. Speak, directly from the browser

Split the text into pieces of at most `chunkChars`, then open one Gemini Live
session per piece with the `@google/genai` browser SDK, using the token as the
API key:

```js
import { GoogleGenAI, Modality } from 'https://esm.sh/@google/genai@2.24.0';

const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
const session = await ai.live.connect({
  model, // the model from /token, exactly
  config: { responseModalities: [Modality.AUDIO] },
  callbacks: {
    onopen: () => session.sendRealtimeInput({
      text: `Translate the text below into ${languageName} and speak your translation aloud, in ${languageName}.\n\n${piece}`,
    }),
    onmessage: (message) => {
      for (const part of message.serverContent?.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) /* base64 PCM16, 24 kHz mono — collect it */;
      }
      if (message.serverContent?.turnComplete) session.close();
    },
  },
});
```

Join the raw PCM from every piece, in order, and either play it through the Web
Audio API or wrap it in a 44-byte WAV header and hand it to an `<audio>`
element — that is all `public/afrispeech-listen.js` in this repository does,
and it is worth reading directly for the full, working version (retrying a
failed piece, running a few at a time, the WAV header).

## The languages

43, chosen because they are the ones with speakers, not the ones with the
best models. The page is translated into the reader's language and then spoken
in full, so what comes back is the page rather than a summary of it.

```js
const { languages } = await fetch(`${BASE}/languages`).then((r) => r.json());
```

`code` is the AfriSpeech code you pass as the translate-to language. `google` is
a provider code carried over from when this list was built around Google
Translate; it is still returned, and still accepted, so existing integrations
keep working, but nothing in the current pipeline reads it.
The service is the only authority on this list, so read it from `/languages`
rather than hardcoding it; the 43 currently returned are:

Afrikaans, Akan, Amharic, Baoulé, Bemba (Zambia), Chichewa, Dinka, Dombe,
Dyula, Ewe, Fon, Fulah, Igbo, Kinyarwanda, Kongo, Krio, Lingala,
Luo (Kenya and Tanzania), Malagasy, Ndau, Nuer, Oromo, Pedi, Rundi, Sango,
Seselwa Creole French, Shona, Somali, South Ndebele, Southern Sotho,
Standard Moroccan Tamazight, Swahili (individual language), Swati, Tigrinya,
Tiv, Tsonga, Tswana, Tumbuka, Venda, Wolof, Xhosa, Yoruba, Zulu.

One thing worth knowing: **there is one voice, and it is not a native speaker
of any of these 43 languages.** Gemini Live reads the page in the target
language with a voice chosen for clarity, which produces the right words with
an accent a speaker of that language would not use. There is no per-language
voice to select from, so the claim cannot honestly be made that a given
language has been heard pronounced correctly. Where that matters, the route to
fix it is a voice per language, not a better prompt.

## Running it yourself

The widget is the same either way; what changes is who owns the key.

The server is a small Node service — see [DEPLOY.md](DEPLOY.md) for a Modal
deployment — that does exactly one thing: mint an ephemeral Gemini Live token
per reader, scoped to a model, a voice, audio-only output, and a bounded number
of sessions. There is nothing else to run: no Redis, no queue, no audio
pipeline, because the audio never passes through it.

That means this is metered the way Live is: on one key, 8 concurrent sessions
were all served and 16 had 11 refused for quota. See [DEPLOY.md](DEPLOY.md) for
the full list of configuration and a verified end-to-end check.

### The key stays on your server

Get a key from [Google AI Studio](https://aistudio.google.com/apikey). No
billing account is required — the Live API has a free tier — but a free-tier
key is metered *more* tightly, not less, which is exactly why the rate limits
below matter regardless of which kind of key you use. The key never leaves the
token service's environment; what it hands out is short-lived, scoped tokens,
never the key itself.

Two rules, in the order they will bite you:

1. **Never put the Gemini key in browser code.** The widget only ever holds
   the shared client key (not a secret, just a traffic label) and the tokens
   the service mints for it. The Gemini key is a server secret.
2. **Set your own rate limits.** The defaults (5 per minute per address, 100 per
   day, and a daily budget) are what protect the key from being exhausted by
   more traffic than it can serve — this is what bounds how many tokens, and
   so how many Live sessions, a caller can start. If the key is on a paid tier,
   also turn on a budget alert in AI Studio: turns are billed by output audio,
   and this endpoint is reachable by the public, so the alert is how you find
   out before the bill does.

### Or just call Gemini yourself

If you would rather not run this service, the widget can point at anything
that answers `GET /languages` and `POST /token` the same way. A small
serverless function that mints an ephemeral token is enough — see
[DEPLOY.md](DEPLOY.md) and `src/lib/tokens.mjs`. Keep the Gemini key in that
function's environment, never in the page.

## Licence

MIT. See [LICENSE](LICENSE).
