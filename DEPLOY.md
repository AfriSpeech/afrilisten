# Deploying the token service

How to run the token service, what it needs in its environment, and how to
point the website widget at it. The service itself is described in
[README.md](README.md); this file is only about getting it running somewhere.

## What this actually is

A small Node HTTP service with two routes, `GET /languages` and
`POST /token`. It never sees a reader's page text and never produces audio:
the browser does both, by opening a Gemini Live session directly once it has
a token from here. See `src/index.mjs` and `src/lib/tokens.mjs`.

That makes this cheap to run and simple to reason about: there is no queue, no
shared cache, no audio pipeline, and nothing here is metered by how long a
synthesis takes, because none happens here.

## Whose key is it

**The key is one you supply.** It is the one thing you cannot share, whether
or not it costs money. Whoever deployed an instance owns it, and
`GET /languages` returns a `notice` saying so.

- `GEMINI_API_KEY` is what mints tokens. It never leaves this service's
  environment; browsers only ever receive the short-lived tokens minted
  from it.
- **No billing account is required.** The Live API has a free tier, and a key
  from [Google AI Studio](https://aistudio.google.com/apikey) with no billing
  attached works. What that tier does not have is a generous rate limit: it is
  metered *more* tightly than a paid key, not less, and Google does not
  publish "unlimited" anything for it — this project measured 8 concurrent
  Live sessions served and 16 with 11 refused for quota on one key, which is
  the honest ceiling to plan around rather than an assumption.

For a real deployment, the difference from a demo is entirely in these:

- The key is created by you, and whichever tier it is on, you accept what
  happens when its limit is hit.
- It is a secret, never a variable in a config file and never anything in
  browser code.
- `LISTEN_RATE_*` and `LISTEN_BUDGET_PER_DAY` are set to limits you chose. The
  defaults bound the damage; they are not access control. They are what
  actually caps this deployment's cost — or, on a free-tier key, what keeps a
  quiet burst of traffic from exhausting it for everyone — because each one
  bounds how many tokens, and so how many Gemini Live sessions, can be minted.
- If the key is on a paid tier, turn on a budget alert in AI Studio. This
  service is reachable by the public and Gemini bills by output audio, so the
  alert is how you find out before the invoice does.

## Requirements

- Node 20 or newer (`@google/genai` requires it). The test suite and
  `server.mjs` run on it.
- A Gemini API key with the Live model and ephemeral tokens enabled.
- Something to run a small, always-on (or scale-to-zero) Node process behind a
  public HTTPS URL. This repository is deployed on [Modal](https://modal.com);
  see below.

There is deliberately nothing else: no Redis, no queue service, no workflow
runner. An earlier version of this service needed all three, because it ran
the whole synthesis itself and had to hold that open across a platform that
could not hold a single request open long enough. Minting a token is one fast
call, so none of that machinery is needed here.

## Required configuration

| Variable | Secret | What it is |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes | Mints tokens. |
| `LISTEN_API_KEY` | yes | The key the widget sends as `x-listen-key`. Without it every request is refused with a 503. |
| `LISTEN_ALLOWED_ORIGINS` | no | Comma separated origins allowed to call the service, for example `https://example.com,https://www.example.com`. |
| `PORT` | no | Defaults to `8787`. |
| `HOST` | no | Defaults to `0.0.0.0`. |

`LISTEN_ALLOWED_ORIGINS` is not optional in practice even though nothing
crashes without it. The allowlist is only enforced when it is non-empty, so
leaving it unset lets any site on the internet mint tokens from a reader's
browser and spend the Gemini quota. The browser will refuse to *read* the
reply, but the token is already minted by then. The rate limits are what cap
the cost.

## Optional tuning

Every one of these has a working default in `src/lib/config.mjs`. Out-of-range
values are clamped rather than rejected, so a typo quietly becomes the default.

| Variable | Default | Range | What it does |
| --- | --- | --- | --- |
| `GEMINI_LIVE_MODEL` | `gemini-3.1-flash-live-preview` | | The one model. Locked into every token minted, and returned to the widget over `/languages` so it can connect with the same id. |
| `GEMINI_TTS_VOICE` | `Zephyr` | | The voice. Also locked into every token. |
| `LISTEN_MAX_CHARS` | `1000` | 200 to 1000 | Ceiling on how much of a page the widget reads. Sent to the browser over `/languages`; enforced there, since the service never sees the text to enforce it itself. |
| `LISTEN_TTS_CHUNK_CHARS` | `250` | 40 to 250 | How big a piece the widget splits a page into. Gemini Live will not reliably hold a turn open past this. |
| `LISTEN_TOKEN_USES_PER_PIECE` | `2` | 1 to 4 | How many Live sessions one piece is budgeted, headroom for one retry included. |
| `LISTEN_TOKEN_MIN_USES` / `LISTEN_TOKEN_MAX_USES` | `4` / `40` | 1–20 / 1–100 | Floor and ceiling on a token's use count, regardless of the piece count a caller claims. |
| `LISTEN_TOKEN_EXPIRE_MINUTES` | `10` | 1 to 60 | How long a token may be used to send messages. |
| `LISTEN_TOKEN_NEW_SESSION_MINUTES` | `2` | 1 to 10 | How long the browser has to start its Live sessions with a token. Shorter than `LISTEN_TOKEN_EXPIRE_MINUTES`, since sessions are opened once, near the start. |
| `LISTEN_RATE_ENABLED` | on | set `0` to switch off | Turns the per-address limits off. |
| `LISTEN_RATE_PER_MINUTE` | `5` | 0 to 600 | Per address, per minute. 0 switches that limit off. |
| `LISTEN_RATE_PER_DAY` | `100` | 0 to 100000 | Per address, per day. 0 switches that limit off. |
| `LISTEN_BUDGET_PER_DAY` | `5000` | 0 to 1000000 | Tokens minted across everyone, per day. The per-address limits are all bypassed by rotating address; this is the one that is not. 0 removes the cap. |
| `LISTEN_HELD_BACK_LANGUAGES` | empty | | Comma separated codes to hide from the picker. |

Full list with defaults in [`.env.example`](.env.example).

## Deploying on Modal

This is how the deployed instance actually runs. `modal_app.py` builds a small
Debian image with Node installed, bakes in this repository, and runs
`server.mjs` behind `@modal.web_server`, which holds the container's port open
and proxies requests to it — the same handler `npm start` runs locally.

```sh
pip install modal
modal setup                     # once, to authenticate this machine

modal secret create afrispeech-listen-secrets \
  GEMINI_API_KEY=<your key> \
  LISTEN_API_KEY=<a key you generate for the widget> \
  LISTEN_ALLOWED_ORIGINS=<your site's origin, or a comma-separated list>

modal deploy modal_app.py
```

The deploy prints the public URL, of the form
`https://<your-modal-username>--afrispeech-listen-serve.modal.run`. That is
`PUBLIC_LISTEN_ENDPOINT` for the website (see below).

To change a setting, update the secret (`modal secret create ... ` again
recreates it) or add a plain environment variable to the image in
`modal_app.py`, then `modal deploy modal_app.py` again. `modal app logs
afrispeech-listen` tails the running container.

### What this costs

Free, for a basic site, on both ends:

- **Modal.** `modal_app.py` asks for the smallest footprint Modal allows
  (0.125 CPU core, 128 MiB memory) and keeps exactly one container warm at
  all times (`min_containers=1`), so a reader never pays a cold-start delay.
  At Modal's published per-second rate, that works out to roughly **$5 a
  month** — comfortably inside the **$30/month free compute** Modal's
  Starter plan includes, so this runs at $0 out of pocket unless traffic
  grows enough to need more than one warm container.
- **Gemini.** No billing account is required — the Live API has a free tier,
  so a plain [AI Studio](https://aistudio.google.com/apikey) key works. What
  it does not have is a generous rate limit (see [Whose key is
  it](#whose-key-is-it)), which is exactly what `LISTEN_RATE_*` and
  `LISTEN_BUDGET_PER_DAY` exist to stay inside of.

That is two free tiers stacked, not one: Modal's covers the container,
Gemini's covers the tokens it mints. Set `min_containers=0` instead if you
would rather trade the occasional reader-facing cold start (roughly a second
or two for this image) for not running a container continuously at all.

### Running it anywhere else

Nothing about the service is Modal-specific. `server.mjs` adapts the same
`fetch`-shaped handler in `src/index.mjs` to Node's `http` server, so any
platform that can run a Node process behind a public HTTPS URL works:

```sh
git clone https://github.com/AfriSpeech/web-tts
cd web-tts
cp .env.example .env    # then fill in GEMINI_API_KEY and LISTEN_API_KEY
npm install
npm test
npm start               # node server.mjs, reads .env, listens on :8787
```

Put a reverse proxy or platform load balancer in front of it for TLS, and set
`LISTEN_ALLOWED_ORIGINS` to your real origin before it is public.

## Verifying a deployment

```sh
# 43 languages, plus the speech settings the widget needs
curl -s https://<host>/languages | head -c 200

# no key is refused
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<host>/token

# a token comes back, locked to the configured model
curl -s -X POST https://<host>/token \
  -H 'content-type: application/json' -H 'x-listen-key: <key>' \
  -d '{"pieces":2}'
# -> { "token": "auth_tokens/...", "model": "...", "expireTime": "...", "uses": 4 }
```

Those should answer `200`, `401`, and a token payload. A run that passes all
three still has to be checked against the real Live API to prove the token
actually works, because that is the one thing this service cannot verify about
itself — it never opens the session the browser will:

```sh
npm run test:e2e   # mints a token, then uses ONLY that token (not the key)
                    # to open a Live session and speak a piece, exactly as
                    # the browser will; decodes the PCM back to check it is
                    # not silence.
```

## Pointing the website at it

The widget takes two values from the site build, both public:

| Website variable | Meaning |
| --- | --- |
| `PUBLIC_LISTEN_ENDPOINT` | The token service's URL, for example the Modal URL above. |
| `PUBLIC_LISTEN_API_KEY` | The same value as `LISTEN_API_KEY` on the service. |

`PUBLIC_LISTEN_API_KEY` is not a secret. Every visitor can read it from the page
source; it is a label saying "this is widget traffic". What keeps other
people's pages from minting tokens against your quota is `LISTEN_ALLOWED_ORIGINS`
on the service, plus the rate limits.

`PUBLIC_LISTEN_ENDPOINT` is required, and there is deliberately no fallback baked
into the widget. A build with a page that enables the widget and no endpoint
fails, rather than shipping a button that cannot work:

    PUBLIC_LISTEN_ENDPOINT is not set, but this page enables the Listen widget
    (/about/). Set it to the URL of the token service, or pass
    listen={false} to opt this page out.

## Development

```bash
npm test                  # the unit suite, no network or keys needed
npm run test:e2e          # real Gemini: mints a token and speaks with it
```

| | |
| --- | --- |
| `src/index.mjs` | Routes: `/languages`, `/token`. |
| `src/lib/tokens.mjs` | Mints ephemeral Gemini Live tokens, locked to a model, voice and audio-only output. |
| `src/lib/auth.mjs` | The shared key and the origin allowlist. |
| `src/lib/ratelimit.mjs` | Per-address and shared-budget limits on minting. |
| `src/lib/languages.mjs` | The 43-language catalogue. |
| `test/` | One file per area, each runnable on its own. |
| `public/afrispeech-listen.js` | The actual client: reads the page, chunks it, mints a token, and speaks each piece over its own Gemini Live session. Served to embedders straight from this repo via jsDelivr; see the README. |
| `public/afrispeech/readability.min.js` | Vendored copy of Mozilla's Readability, used by the widget to extract article text. Kept alongside the widget so the two are always the same version. |
