/**
 * Convert African language orthography to IPA via africa-g2p (https://github.com/AfriSpeech/africa-g2p).
 *
 * Runs via a background Python worker. If Python or africa-g2p is unavailable, gracefully
 * falls back to returning the text as-is.
 */
import { spawn } from 'node:child_process';

let worker = null;

class IpaWorker {
  constructor() {
    this.proc = null;
    this.callbacks = new Map();
    this.nextId = 1;
    this.buffer = '';
  }

  ensureStarted() {
    if (this.proc) return;
    const py = `
import sys, json, re
try:
    import africa_g2p
except Exception:
    africa_g2p = None

eng_g2p = None
if africa_g2p:
    try:
        eng_g2p = africa_g2p.EnglishG2P('eng-gb')
    except Exception:
        try:
            eng_g2p = africa_g2p.EnglishG2P()
        except Exception:
            pass

# Load British English dictionary if available, with fallbacks
english_words = set()
for path in ['/usr/share/dict/british-english', '/usr/share/dict/words', '/usr/share/dict/american-english']:
    try:
        with open(path) as f:
            english_words = {line.strip().lower() for line in f if len(line.strip()) >= 3}
            if english_words: break
    except Exception:
        pass

AFRICAN_STOPWORDS = {
    'me', 'wo', 'no', 'so', 'pa', 'ba', 'da', 'ne', 'mu', 'ho', 'yi', 'de', 'na', 'sa', 'se', 'nti',
    'kasa', 'ye', 'bi', 'ma', 'we', 'te', 'sen', 'nso', 'ara', 'nyinaa', 'akwaaba', 'ya', 'wa',
    'za', 'kwa', 'ni', 'la', 'cha', 'vya', 'katika', 'huyu', 'hapa', 'yake', 'yao', 'yangu',
    'yetu', 'gani', 'nani', 'wapi', 'lini', 'kama', 'jambo', 'habari', 'asante', 'karibu', 'sana',
    'ti', 'awon', 'kan', 'fun', 'lati', 'wipe', 'pe', 'bayi', 'bawo', 'ina', 'yau', 'gobe', 'sannu'
}

AFRICAN_SPECIAL_CHARS = set('ɛɔɗɓƙƴŋɲẹọṣịụṅáàèéìíòóùúãõâêîôû')

def is_english_token(token, lang):
    w_low = token.lower()
    # 1. Non-latin (Ge'ez, Arabic, etc) -> never English
    if re.search(r'[\u1200-\u137F\u0600-\u06FF]', token):
        return False
    # 2. African diacritics / special characters -> never English
    if any(c in AFRICAN_SPECIAL_CHARS for c in w_low):
        return False
    # 3. Known African common words -> never English
    if w_low in AFRICAN_STOPWORDS:
        return False
    # 4. Acronyms (e.g. WHO, BBC, UN, COVID, NGO, CEO, AI)
    if len(token) >= 2 and token.isupper() and token.isalpha():
        return True
    # 5. Invalid characters in target language (e.g. Twi lacks c not in ch, v, x, z, q, j)
    if lang in ('twi', 'aka') and re.search(r'[vxzqj]|c(?!h)', w_low):
        return True
    # 6. English dictionary lookup (length >= 4 to avoid tiny cross-linguistic collisions)
    if len(w_low) >= 4 and w_low in english_words:
        return True
    return False

def convert_to_ipa_hybrid(text, lang):
    if not africa_g2p or not text:
        return text
    tokens = re.split(r'([^\\W\\d_]+)', text)
    has_english = False
    for t in tokens:
        if re.match(r'^[^\\W\\d_]+$', t) and is_english_token(t, lang):
            has_english = True
            break
    if not has_english:
        try:
            return africa_g2p.convert_to_ipa(text, lang)
        except Exception:
            return text

    # Process mixed text token by token
    result = []
    word_cache = {}
    for t in tokens:
        if not t:
            continue
        if re.match(r'^[^\\W\\d_]+$', t):
            if t in word_cache:
                result.append(word_cache[t])
                continue
            if is_english_token(t, lang) and eng_g2p:
                try:
                    ipa_word = eng_g2p.convert(t).strip()
                except Exception:
                    ipa_word = africa_g2p.convert_to_ipa(t, lang)
            else:
                try:
                    ipa_word = africa_g2p.convert_to_ipa(t, lang)
                except Exception:
                    ipa_word = t
            word_cache[t] = ipa_word
            result.append(ipa_word)
        else:
            result.append(t)
    return ''.join(result)

for line in sys.stdin:
    if not line.strip(): continue
    try:
        req = json.loads(line)
        text = req.get("text", "")
        code = req.get("lang", "").lower()
        if code == "aka": code = "twi"
        elif code == "swc": code = "swh"
        res = convert_to_ipa_hybrid(text, code)
        sys.stdout.write(json.dumps({"id": req.get("id"), "text": res}) + "\\n")
        sys.stdout.flush()
    except Exception:
        sys.stdout.write(json.dumps({"id": req.get("id", 0), "text": text}) + "\\n")
        sys.stdout.flush()
`;
    try {
      this.proc = spawn('python3', ['-u', '-c', py], { stdio: ['pipe', 'pipe', 'ignore'] });
      this.proc.stdout.on('data', (chunk) => {
        this.buffer += chunk.toString('utf8');
        let idx;
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, idx).trim();
          this.buffer = this.buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const resp = JSON.parse(line);
            const cb = this.callbacks.get(resp.id);
            if (cb) {
              this.callbacks.delete(resp.id);
              cb(resp.text);
            }
          } catch {}
        }
      });
      this.proc.on('error', () => { this.proc = null; });
      this.proc.on('exit', () => { this.proc = null; });
      this.proc.stdin?.unref?.();
      this.proc.stdout?.unref?.();
      this.proc.unref?.();
    } catch {
      this.proc = null;
    }
  }

  convert(text, lang) {
    if (!text) return Promise.resolve(text || '');
    return new Promise((resolve) => {
      try {
        this.ensureStarted();
        if (!this.proc) return resolve(text);
        const id = this.nextId++;
        const timer = setTimeout(() => {
          this.callbacks.delete(id);
          resolve(text);
        }, 3000);
        this.callbacks.set(id, (res) => {
          clearTimeout(timer);
          resolve(res);
        });
        this.proc.stdin.write(JSON.stringify({ id, text, lang: lang || '' }) + '\n');
      } catch {
        resolve(text);
      }
    });
  }
}

/**
 * Convert text to IPA for a given African language code.
 *
 * @param {string} text
 * @param {string} langCode e.g. "aka", "twi", "yor", "hau", "amh", "swh"
 * @returns {Promise<string>}
 */
export function toIpa(text, langCode) {
  if (!worker) worker = new IpaWorker();
  return worker.convert(text, langCode);
}
