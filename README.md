# AfriListen

A lightweight, drop-in web widget that allows readers to listen to any web page spoken aloud in **457 African languages**.

Zero setup. No framework required. No build step. Works out of the box on any website with a single `<script>` tag.

---

## Quick Start

Paste this into the `<head>` or before the closing `</body>` tag of any web page:

```html
<script
  src="https://cdn.jsdelivr.net/gh/AfriSpeech/afrilisten@main/public/afrilisten.js"
  defer></script>
```

**That's it!** A floating **Listen** button will appear on the bottom-right of your page. When readers click it, they can select their language and hear the page read aloud immediately.

By default, the widget connects to AfriListen's shared community service — no API keys, accounts, or backend setup required.

---

## Features

- **450+ African Languages**: Broad coverage across the continent, including Swahili, Yoruba, Amharic, Zulu, Hausa, Akan (Twi/Fante), Igbo, Somali, Oromo, Lingala, Wolof, and hundreds more.
- **Direct Browser Synthesis**: Gemini Live translates and speaks directly in the reader's browser — your website server handles zero audio bandwidth.
- **Instant Replay Cache**: Audio is saved in the reader's browser (IndexedDB). Listening to the same page again is instantaneous and uses zero extra data or quota.
- **Reader Feedback**: Built-in thumbs up/down rating buttons let readers rate translation and speech quality, helping improve African language support.
- **Mobile & Desktop Ready**: Responsive floating player with language search, audio playback controls, and customizable positioning.
- **Fast & Lightweight**: Zero external stylesheets or fonts. Mozilla Readability and speech libraries are lazy-loaded only when the reader clicks Listen.

---

## Customization Options

You can customize the button's language, position, and label using `data-*` attributes on the `<script>` tag:

```html
<script
  src="https://cdn.jsdelivr.net/gh/AfriSpeech/afrilisten@main/public/afrilisten.js"
  data-lang="swh"
  data-position="bottom-left"
  data-label="Listen"
  defer></script>
```

| Attribute | Default | Description |
| :--- | :--- | :--- |
| `data-lang` | *(picker)* | Pre-select a default language code (e.g. `swh` for Swahili, `yor` for Yoruba, `hau` for Hausa, `aka` for Akan). |
| `data-position` | `bottom-right` | Position on the screen: `bottom-right` or `bottom-left`. |
| `data-label` | `Listen` | Custom text for the button (e.g. `Listen`, `Soma`, `Kasa`). |
| `data-endpoint` | *(shared default)* | Optional: URL of your own self-hosted backend. See [DEPLOY.md](DEPLOY.md). |
| `data-key` | *(shared default)* | Optional: API key for your self-hosted backend (`x-listen-key`). |

---

## Supported Languages

AfriListen supports **457 African languages** qualified through benchmark evaluations ([gemini-word-mt-bench](https://github.com/AfriSpeech/gemini-word-mt-bench)).

Popular supported languages include:

- **East Africa**: Swahili (`swh`), Amharic (`amh`), Somali (`som`), Oromo (`orm`), Tigrinya (`tir`), Kinyarwanda (`kin`), Luganda (`lug`)
- **West Africa**: Yoruba (`yor`), Hausa (`hau`), Igbo (`ibo`), Akan / Twi / Fante (`aka`), Wolof (`wol`), Ewe (`ewe`), Fulah (`ful`)
- **Southern Africa**: Zulu (`zul`), Xhosa (`xho`), Shona (`sna`), Afrikaans (`afr`), Sesotho (`sot`), Chichewa (`nya`)
- **Central Africa**: Lingala (`lin`), Sango (`sag`), Kongo (`kon`), Cameroon Pidgin (`wes`)
- **Islands**: Malagasy (`mlg`), Seselwa Creole (`crs`), Mauritian Creole (`mfe`)
- *...and over 400 additional indigenous and regional languages.*

The widget automatically loads and displays the latest available language catalogue when opened.

---

## Self-Hosting & Advanced Usage

AfriListen works out of the box on our free shared community tier. If your site has high traffic or you prefer a private deployment with your own Gemini API key and custom rate limits:

- **Self-Hosting on Modal ($0/mo)**: Deploy your own token service in minutes. Free tier available. See [DEPLOY.md](DEPLOY.md).
- **Custom Player (API Reference)**: Build a custom audio player UI instead of using the drop-in widget. See [DEPLOY.md#building-a-custom-player-api-reference](DEPLOY.md#building-a-custom-player-api-reference).
- **Language Filtering**: Restrict the language dropdown to specific countries or language codes. See [DEPLOY.md#choosing-which-languages-to-offer](DEPLOY.md#choosing-which-languages-to-offer).
- **Translation Quality Feedback**: View how readers rate translations across languages. See [DEPLOY.md#feedback](DEPLOY.md#feedback).

---

## License

MIT © [AfriSpeech](https://github.com/AfriSpeech)
