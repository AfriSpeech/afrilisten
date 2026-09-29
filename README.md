# AfriListen

A lightweight, drop-in web widget that allows readers to listen to any web page spoken aloud in **51 African languages**.

**Built primarily for websites in high-resource languages (e.g. English, French, Arabic, Portuguese, etc.):** your site does not need to be in an African language. AfriListen translates the text via Google Translate (using a semantic Thai pivot), chunks it along sentence boundaries, and streams native-sounding speech in real time via Gemini Live. It works just as seamlessly on sites already written in an African language.

Zero setup. No framework required. No build step. Works out of the box on any website with a single `<script>` tag.

> **Live Demo:** See AfriListen in action on the [AfriSpeech website](https://afrispeech.org/about/) — look for the floating **Listen** button in the bottom corner.

---

## Supported Languages

AfriListen supports **51 African languages** powered by Google Translate with real-time audio streamed through Gemini Live. Live community quality scores are available on the [Language Performance Dashboard](https://listen.afrispeech.org/feedback).

- **East Africa (12):** Swahili (`swh`), Amharic (`amh`), Somali (`som`), Oromo (`orm`), Tigrinya (`tir`), Kinyarwanda (`kin`), Rundi (`run`), Acholi (`ach`), Alur (`alz`), Kiga (`cgg`), Luo (`luo`), Afar (`aar`).
- **West Africa (15):** Yoruba (`yor`), Hausa (`hau`), Igbo (`ibo`), Twi (`aka`), Ewe (`ewe`), Wolof (`wol`), Fon (`fon`), Ga (`gaa`), Baoulé (`bci`), Bambara (`bam`), Dyula (`dyu`), Krio (`kri`), Susu (`sus`), Tiv (`tiv`), Kanuri (`knc`).
- **Southern Africa (13):** Zulu (`zul`), Xhosa (`xho`), Afrikaans (`afr`), Shona (`sna`), Chichewa (`nya`), Tswana (`tsn`), Tsonga (`tso`), Pedi (`nso`), Southern Sotho (`sot`), Swati (`ssw`), Venda (`ven`), Tumbuka (`tum`), Ndau (`ndc`).
- **Central Africa (7):** Lingala (`lin`), Sango (`sag`), Tshiluba (`lua`), Kituba (`ktu`), Dinka (`din`), Nuer (`nus`), Dombe (`dov`).
- **Indian Ocean & Islands (3):** Malagasy (`mlg`), Mauritian Creole (`mfe`), Seychellois Creole (`crs`).

The widget automatically loads and displays the latest available language catalogue when opened.

---

## Quick Start

Paste this into the `<head>` or before the closing `</body>` tag of any web page:

```html
<script
  src="https://cdn.jsdelivr.net/gh/AfriSpeech/afrilisten@main/public/afrilisten.js"
  defer></script>
```

**That's it!** A floating **Listen** button will appear on the bottom-right of your page. When readers click it, they can select their language and hear the page read aloud immediately.

> **Usage Note:** The ready-to-integrate drop-in widget connects to AfriListen's shared community service by default and is intended for **basic and non-commercial use** (personal blogs, non-profits, testing, and evaluation). For high-traffic, production, or commercial websites, it is recommended to set up your own server using the code provided in this repository so you have dedicated capacity, your own rate limits, and full control over quotas. See [Self-Hosting & Commercial Use](#self-hosting--commercial-use).

---

## Features

- **51 Major African Languages**: Broad coverage including Swahili, Yoruba, Hausa, Amharic, Zulu, Igbo, Akan/Twi, Oromo, Somali, Wolof, Kinyarwanda, Xhosa, Shona, and more.
- **High-Quality Translation**: Translated via Google Translate with a semantic Thai pivot (`source -> th -> target`) before audio generation.
- **Real-Time Streaming Playback**: Streams audio as packets arrive over WebSocket — the reader starts hearing speech in ~300ms without waiting for the full article to finish.
- **Direct Browser Streaming**: Gemini Live speaks directly to the reader's browser — zero audio proxying through your server.
- **Instant Replay Cache**: Audio is saved in the reader's browser (IndexedDB). Listening to the same page again is instantaneous and uses zero extra data or quota.
- **Reader Feedback**: Built-in thumbs up/down rating buttons let readers rate translation and speech quality, helping improve African language support.
- **Mobile & Desktop Ready**: Responsive floating player with language search, audio playback controls, and customizable positioning.
- **Fast & Lightweight**: Zero external stylesheets or fonts. Mozilla Readability and speech libraries are lazy-loaded only when the reader clicks Listen.

---

## How It Reads Your Website

- **Websites in High-Resource Languages (Primary Use Case):** Your website does not need to be written in an African language! Most web content across Africa and worldwide is published in high-resource languages (such as English, French, Arabic, Portuguese, etc.). When a reader clicks Listen on your page, AfriListen translates each section on the fly and speaks it aloud in their selected African mother tongue.
- **Websites Already in an African Language:** If your website is already written in one of the 51 supported African languages (e.g. an article published in Swahili, Yoruba, or Amharic), AfriListen reads the text directly aloud in that language, or can translate it into any of the other 50 African languages if the reader prefers.

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

## Self-Hosting & Commercial Use

The shared community endpoint is intended for basic and non-commercial websites. For commercial websites, high-traffic publications, or sites requiring dedicated capacity:

- **Deploy Your Own Server (Recommended for Commercial Sites)**: Run your own server using the provided code on Coolify (Docker), Modal, or any VPS in minutes. It runs on your own Gemini API key with custom rate limits and zero shared quota contention. See [DEPLOY.md](DEPLOY.md).
- **Custom Player (API Reference)**: Build a custom audio player UI instead of using the drop-in widget. See [DEPLOY.md#building-a-custom-player-api-reference](DEPLOY.md#building-a-custom-player-api-reference).
- **Language Filtering**: Restrict the language dropdown to specific countries or language codes. See [DEPLOY.md#choosing-which-languages-to-offer](DEPLOY.md#choosing-which-languages-to-offer).
- **Translation Quality Feedback**: View how readers rate translations across languages. See [DEPLOY.md#feedback](DEPLOY.md#feedback).

---

## License

MIT © [AfriSpeech](https://github.com/AfriSpeech)
