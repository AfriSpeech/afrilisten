# AfriListen

Drop one script tag on your site and readers get a **Listen** button that allows them to hear the
content of the website spoken aloud in 457 African languages. No build step, no framework, no SDK to install.

## How this works

There is no audio server. The widget reads the page in the reader's own
browser, splits it into pieces, and speaks each piece by opening a **Gemini
Live** session directly from the browser — Gemini translates the piece and
speaks the translation in the same turn. The only thing a server is for is
minting the short-lived token that lets the browser do that without ever
holding the real Gemini key: a small token service, not a synthesis pipeline.
Nobody's server ever sees the page's text or the resulting audio.

## Add it to your page

Put this in the `<head>` of any page with article text on it:

```html
<script
  src="https://cdn.jsdelivr.net/gh/AfriSpeech/afrilisten@main/public/afrilisten.js"
  defer></script>
```

That is the whole integration — genuinely nothing else. A button appears in
the corner, pressing it reads the page, and once the audio is ready a thumbs
up/down sits under the player so a reader can say whether it sounded right.
With no `data-endpoint` set, the widget talks to this project's own reference
deployment: **AfriListen's Gemini key, on a shared daily budget, with no
account or setup required on your side.** That is a deliberate trade so a
first try — or a small site that just wants the feature — costs nothing and
takes one script tag.

The shared budget is generous but not unlimited, and it is not vetted per
site: anyone can point a page at the default. If your traffic is more than
occasional, or you would rather not share a budget with every other site
using the default, run your own instance on your own Gemini key — it costs
$0 for a basic deployment too (two free tiers stack; see
[What this costs](DEPLOY.md#what-this-costs)) and takes about five minutes.
See [Running it yourself](#running-it-yourself) for the steps, then set
`data-endpoint` (and `data-key`) to point the widget at it instead:

```html
<script
  src="https://cdn.jsdelivr.net/gh/AfriSpeech/afrilisten@main/public/afrilisten.js"
  data-endpoint="https://your-own-deployment.modal.run"
  data-key="your-own-key"
  defer></script>
```

Feedback is the one thing that does **not** move to your own deployment even
then: every widget everywhere — default or self-hosted — reports to the same
public pool, because a rating is a signal about how well Gemini translates
into a language in general, not something specific to one site's readers. See
[Feedback](DEPLOY.md#feedback) in DEPLOY.md.

The script src above points at `main` in this repository, not a pinned
release, so a page using it picks up whatever was last pushed here — there is
nothing to bump on your side when the widget changes. Two caches sit between a
push and a reader actually getting it, and they behave differently:

- **jsDelivr's own CDN cache** refreshes `@main` roughly every 12 hours on its
  own, or within a couple of minutes of
  [a purge request](https://www.jsdelivr.com/tools/purge) after a push —
  purge both `public/afrilisten.js` and
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

The page is read **in the reader's browser**, not fetched by anyone's server,
so it works on pages that block automated requests and on anything rendered by
JavaScript. Readability and the Gemini client library are only downloaded once
someone actually presses the button. The finished clip is then cached in the
reader's own browser (IndexedDB), keyed by the exact text and language, so
listening to the same page again is instant and costs no quota at all —
editing the page or picking a different language is a fresh key, not stale
audio.

### Options

All optional, set on the script tag:

```html
<script
  src="https://cdn.jsdelivr.net/gh/AfriSpeech/afrilisten@main/public/afrilisten.js"
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
| `data-endpoint` | this project's shared deployment | A token service you run yourself instead. See [Running it yourself](#running-it-yourself). |
| `data-key`      | this project's shared key | The `x-listen-key` your own deployment expects. Only needed with `data-endpoint`. |

### Before you go live with your own deployment

**Which sites may use a service is that service's decision, not yours.**
`LISTEN_ALLOWED_ORIGINS` is enforced as a CORS check, and a page on an origin
that is not allowed gets no error you can read: the page loads, the button
appears, and pressing it does nothing. Worth knowing about, because it is the
one thing that can stop an integration working and it fails quietly. This
does not apply to the shared default, which has to accept any origin to be a
genuine drop-in.

If you run your own service, narrow it to the origins you expect. See
[DEPLOY.md](DEPLOY.md).

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
element — that is all `public/afrilisten.js` in this repository does,
and it is worth reading directly for the full, working version (retrying a
failed piece, running a few at a time, the WAV header).

## The languages

457, chosen by measurement rather than guesswork: a language is offered when
Gemini scored medium tier or better (at least 30% pass) translating into it in
[gemini-word-mt-bench](https://github.com/AfriSpeech/gemini-word-mt-bench), a
word-level round-trip-translation benchmark run across every living language
afriso attributes to an African country. A short, specific list is cut from
that regardless of score — Arabic's many varieties, Spanish, Yiddish, Eastern
Yiddish, Ladino — because the benchmark's criterion is "spoken in an African
country," which nets a few colonial and diaspora languages along with the
rest. Everything else that clears the bar is in, including languages that are
Indo-European or Austronesian by family but are mother tongues of African
populations rather than imports: Malagasy, Afrikaans, and creoles like Krio,
Kabuverdianu and Cameroon Pidgin.

Not going through a separate translation service any more is what makes this
list possible: it used to be bounded by which languages Google Translate
supported, and now it is bounded only by how well Gemini itself translates
into a language, which the benchmark measures directly rather than assumes.

```js
const { languages } = await fetch(`${BASE}/languages`).then((r) => r.json());
```

`code` is the AfriSpeech code you pass as the translate-to language. `google`
is a provider code carried over from when this list was built around Google
Translate; it is still returned for the languages that had one, and still
accepted, so existing integrations keep working, but nothing in the current
pipeline reads it — a language added since has its own iso639_3 code there
instead, since there never was a Google Translate association to carry.
The service is the only authority on this list, so read it from `/languages`
rather than hardcoding it or this README's count, which will drift as the
benchmark is rerun. `scripts/build-languages.mjs` regenerates it from a fresh
benchmark run and afriso's current data with `npm run build:speech-data`.

A deployer can narrow this to a subset — specific languages, specific
countries, or everything — with `LISTEN_LANGUAGES` / `LISTEN_COUNTRIES`; see
[DEPLOY.md](DEPLOY.md).

One thing worth knowing: **there is one voice, and it is not a native speaker
of any of these languages.** Gemini Live reads the page in the target
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

For a basic site, running your own costs **$0**: the deployment documented
there fits inside Modal's free monthly compute credit, and Gemini's Live API
free tier needs no billing account. See [What this
costs](DEPLOY.md#what-this-costs) for the numbers.

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
