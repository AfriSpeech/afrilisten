# AfriListen

A lightweight, drop-in web widget that allows readers to listen to any web page spoken aloud in **69 African languages**.

**Built primarily for websites in high-resource languages (e.g. English, French, Arabic, Portuguese, etc.)** — your site does not need to be in an African language. AfriListen bridges the digital language divide by translating and narrating text live into a reader's native African language. It works just as seamlessly on sites already written in an African language (reading the text directly aloud or translating across languages).

Zero setup. No framework required. No build step. Works out of the box on any website with a single `<script>` tag.

---

## Supported Languages

AfriListen supports all **69 African languages** that score **30% or higher** on the corpus-grounded benchmark ([gemini-word-mt-bench](https://github.com/AfriSpeech/gemini-word-mt-bench)). Live community quality scores are available on the [Language Performance Dashboard](https://listen.afrispeech.org/feedback).

- **East Africa (16):** Acoli (`ach`), Amharic (`amh`), Borana-Arsi-Guji Oromo (`gax`), Congo Swahili (`swc`), Digo (`dig`), Embu (`ebu`), Ganda (`lug`), Kikuyu (`kik`), Kinyarwanda (`kin`), Nyankole (`nyn`), Nyoro (`nyo`), Rundi (`run`), Somali (`som`), Swahili (`swh`), Tigrinya (`tir`), West Central Oromo (`gaz`).
- **West Africa (30):** Abron (`abr`), Adangme (`ada`), Akan / Twi (`aka`), Baoulé (`bci`), Bassa (`bsq`), Bini (`bin`), Dagbani (`dag`), Dyula (`dyu`), Efik (`efi`), Ewe (`ewe`), Fanti (`fat`), Fon (`fon`), Ga (`gaa`), Gen (`gej`), Gun (`guw`), Igbo (`ibo`), Kabiyè (`kbp`), Klao (`klu`), Krio (`kri`), Kusaal (`kus`), Maasina Fulfulde (`ffm`), Mano (`mev`), Nigerian Pidgin (`pcm`), Nzima (`nzi`), Susu (`sus`), Tiv (`tiv`), Upper Guinea Crioulo (`pov`), Urhobo (`urh`), Wolof (`wol`), Yoruba (`yor`).
- **Southern Africa (15):** Afrikaans (`afr`), Chichewa (`nya`), Kaonde (`kqn`), Kuanyama (`kua`), Lozi (`loz`), Ndonga (`ndo`), North Ndebele (`nde`), Pedi / Northern Sotho (`nso`), Shona (`sna`), Southern Sotho (`sot`), Tsonga (`tso`), Tswana (`tsn`), Tumbuka (`tum`), Venda (`ven`), Xhosa (`xho`).
- **Central Africa (5):** Lingala (`lin`), Luba-Lulua (`lua`), Northeastern Dinka (`dip`), Sango (`sag`), Southwestern Dinka (`dik`).
- **Indian Ocean & Islands (3):** Morisyen (`mfe`), Plateau Malagasy (`plt`), Seselwa Creole French (`crs`).

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

By default, the widget connects to AfriListen's shared community service — no API keys, accounts, or backend setup required.

---

## Features

- **69 Quality-Vetted African Languages**: Languages scoring 30%+ on the corpus benchmark, including Swahili, Yoruba, Amharic, Lingala, Afrikaans, Ewe, Akan, Somali, Igbo, Wolof, Kinyarwanda, Xhosa, Shona, and more.
- **Direct Browser Synthesis**: Gemini Live translates and speaks directly in the reader's browser — your website server handles zero audio bandwidth.
- **Instant Replay Cache**: Audio is saved in the reader's browser (IndexedDB). Listening to the same page again is instantaneous and uses zero extra data or quota.
- **Reader Feedback**: Built-in thumbs up/down rating buttons let readers rate translation and speech quality, helping improve African language support.
- **Mobile & Desktop Ready**: Responsive floating player with language search, audio playback controls, and customizable positioning.
- **Fast & Lightweight**: Zero external stylesheets or fonts. Mozilla Readability and speech libraries are lazy-loaded only when the reader clicks Listen.

---

## How It Reads Your Website

- **Websites in High-Resource Languages (Primary Use Case):** Your website does not need to be written in an African language! Most web content across Africa and worldwide is published in high-resource languages (such as English, French, Arabic, Portuguese, etc.). When a reader clicks Listen on your page, AfriListen translates each section on the fly and speaks it aloud in their selected African mother tongue.
- **Websites Already in an African Language:** If your website is already written in one of the 69 supported African languages (e.g. an article published in Swahili, Yoruba, or Amharic), AfriListen reads the text directly aloud in that language, or can translate it into any of the other 68 African languages if the reader prefers.

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

## Self-Hosting & Advanced Usage

AfriListen works out of the box on our free shared community tier. If your site has high traffic or you prefer a private deployment with your own Gemini API key and custom rate limits:

- **Self-Hosting on Modal ($0/mo)**: Deploy your own token service in minutes. Free tier available. See [DEPLOY.md](DEPLOY.md).
- **Custom Player (API Reference)**: Build a custom audio player UI instead of using the drop-in widget. See [DEPLOY.md#building-a-custom-player-api-reference](DEPLOY.md#building-a-custom-player-api-reference).
- **Language Filtering**: Restrict the language dropdown to specific countries or language codes. See [DEPLOY.md#choosing-which-languages-to-offer](DEPLOY.md#choosing-which-languages-to-offer).
- **Translation Quality Feedback**: View how readers rate translations across languages. See [DEPLOY.md#feedback](DEPLOY.md#feedback).

---

## License

MIT © [AfriSpeech](https://github.com/AfriSpeech)
