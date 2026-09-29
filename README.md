# AfriListen

A lightweight, drop-in web widget that allows readers to listen to any web page spoken aloud in **69 African languages**.

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

- **69 Quality-Vetted African Languages**: Languages scoring 30%+ on the corpus benchmark, including Swahili, Yoruba, Amharic, Lingala, Afrikaans, Ewe, Akan, Somali, Igbo, Wolof, Kinyarwanda, Xhosa, Shona, and more.
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

AfriListen supports all **69 African languages** that score **30% or higher** on the corpus-grounded benchmark ([gemini-word-mt-bench](https://github.com/AfriSpeech/gemini-word-mt-bench)). You can view live community evaluation ratings for each language on the [Language Performance Dashboard](https://listen.afrispeech.org/feedback).

### East Africa (16)
- **Acoli** (`ach`) &bull; South Sudan, Uganda
- **Amharic** (`amh`) &bull; Ethiopia, Djibouti
- **Borana-Arsi-Guji Oromo** (`gax`) &bull; Ethiopia, Kenya
- **Congo Swahili** (`swc`) &bull; DR Congo
- **Digo** (`dig`) &bull; Kenya, Tanzania
- **Embu** (`ebu`) &bull; Kenya
- **Ganda** (`lug`) &bull; Uganda
- **Kikuyu** (`kik`) &bull; Kenya
- **Kinyarwanda** (`kin`) &bull; Rwanda, Uganda, DR Congo
- **Nyankole** (`nyn`) &bull; Uganda
- **Nyoro** (`nyo`) &bull; Uganda
- **Rundi** (`run`) &bull; Burundi, Rwanda, DR Congo
- **Somali** (`som`) &bull; Somalia, Djibouti, Ethiopia, Kenya
- **Swahili** (`swh`) &bull; Tanzania, Kenya, Uganda, Rwanda, Burundi
- **Tigrinya** (`tir`) &bull; Eritrea, Ethiopia
- **West Central Oromo** (`gaz`) &bull; Ethiopia

### West Africa (30)
- **Abron** (`abr`) &bull; Ghana, Côte d'Ivoire
- **Adangme** (`ada`) &bull; Ghana
- **Akan / Twi** (`aka`) &bull; Ghana, Togo
- **Baoulé** (`bci`) &bull; Côte d'Ivoire
- **Bassa** (`bsq`) &bull; Liberia, Sierra Leone
- **Bini** (`bin`) &bull; Nigeria
- **Dagbani** (`dag`) &bull; Ghana, Togo
- **Dyula** (`dyu`) &bull; Côte d'Ivoire, Burkina Faso, Mali
- **Efik** (`efi`) &bull; Nigeria, Cameroon
- **Ewe** (`ewe`) &bull; Ghana, Togo
- **Fanti** (`fat`) &bull; Ghana, Togo
- **Fon** (`fon`) &bull; Benin, Togo
- **Ga** (`gaa`) &bull; Ghana
- **Gen** (`gej`) &bull; Togo, Benin
- **Gun** (`guw`) &bull; Benin, Nigeria
- **Igbo** (`ibo`) &bull; Nigeria
- **Kabiyè** (`kbp`) &bull; Togo, Benin, Ghana
- **Klao** (`klu`) &bull; Liberia, Sierra Leone
- **Krio** (`kri`) &bull; Sierra Leone, The Gambia
- **Kusaal** (`kus`) &bull; Ghana, Burkina Faso
- **Maasina Fulfulde** (`ffm`) &bull; Mali, Ghana, Burkina Faso
- **Mano** (`mev`) &bull; Liberia, Guinea, Côte d'Ivoire
- **Nigerian Pidgin** (`pcm`) &bull; Nigeria
- **Nzima** (`nzi`) &bull; Ghana, Côte d'Ivoire
- **Susu** (`sus`) &bull; Guinea, Sierra Leone
- **Tiv** (`tiv`) &bull; Nigeria, Cameroon
- **Upper Guinea Crioulo** (`pov`) &bull; Guinea-Bissau, Senegal, The Gambia
- **Urhobo** (`urh`) &bull; Nigeria
- **Wolof** (`wol`) &bull; Senegal, The Gambia, Mauritania
- **Yoruba** (`yor`) &bull; Nigeria, Benin

### Southern Africa (15)
- **Afrikaans** (`afr`) &bull; South Africa, Namibia, Botswana
- **Chichewa** (`nya`) &bull; Malawi, Mozambique, Zambia, Zimbabwe
- **Kaonde** (`kqn`) &bull; Zambia, DR Congo
- **Kuanyama** (`kua`) &bull; Angola, Namibia
- **Lozi** (`loz`) &bull; Zambia, Zimbabwe, Namibia, Botswana
- **Ndonga** (`ndo`) &bull; Namibia, Angola
- **North Ndebele** (`nde`) &bull; Zimbabwe, Botswana
- **Pedi / Northern Sotho** (`nso`) &bull; South Africa, Botswana
- **Shona** (`sna`) &bull; Zimbabwe, Mozambique, Botswana
- **Southern Sotho** (`sot`) &bull; Lesotho, South Africa
- **Tsonga** (`tso`) &bull; South Africa, Mozambique, Zimbabwe, Eswatini
- **Tswana** (`tsn`) &bull; Botswana, South Africa, Zimbabwe, Namibia
- **Tumbuka** (`tum`) &bull; Malawi, Zambia
- **Venda** (`ven`) &bull; South Africa, Zimbabwe
- **Xhosa** (`xho`) &bull; South Africa, Lesotho, Botswana

### Central Africa (5)
- **Lingala** (`lin`) &bull; DR Congo, Republic of the Congo, Central African Republic
- **Luba-Lulua** (`lua`) &bull; DR Congo, Angola
- **Northeastern Dinka** (`dip`) &bull; South Sudan, Sudan
- **Sango** (`sag`) &bull; Central African Republic, Chad, DR Congo
- **Southwestern Dinka** (`dik`) &bull; South Sudan, Sudan

### Indian Ocean & Islands (3)
- **Morisyen** (`mfe`) &bull; Mauritius
- **Plateau Malagasy** (`plt`) &bull; Madagascar
- **Seselwa Creole French** (`crs`) &bull; Seychelles

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
