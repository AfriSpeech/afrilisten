/**
 * Universalize African language orthography via africa-g2p (https://github.com/AfriSpeech/africa-g2p).
 *
 * Normalizes language-specific diacritics, special vowels (ɔ, ɛ), nasal letters (ŋ, ɲ),
 * and non-Latin scripts (e.g. Ge'ez in Amharic/Tigrinya) into the universal Latin representation
 * that TTS models (like Gemini Live) pronounce smoothly without pronunciation artifacts.
 *
 * Runs via a background Python worker. If Python or africa-g2p is unavailable, gracefully
 * falls back to returning the text as-is.
 */
import { spawn } from 'node:child_process';

let worker = null;

class UniversalWorker {
  constructor() {
    this.proc = null;
    this.callbacks = new Map();
    this.nextId = 1;
    this.buffer = '';
  }

  ensureStarted() {
    if (this.proc) return;
    const py = `
import sys, json
try:
    from africa_g2p import UNIVERSAL, convert_lang
except Exception:
    UNIVERSAL = None

for line in sys.stdin:
    if not line.strip(): continue
    try:
        req = json.loads(line)
        text = req.get("text", "")
        code = req.get("lang", "").lower()
        if code == "aka": code = "twi"
        elif code == "swc": code = "swh"
        if UNIVERSAL:
            try:
                res = convert_lang(text, code, UNIVERSAL)
            except Exception:
                res = text
        else:
            res = text
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
      this.proc.stdin.unref?.();
      this.proc.stdout.unref?.();
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
 * Universalize text for a given African language.
 *
 * @param {string} text
 * @param {string} langCode e.g. "aka", "twi", "yor", "hau", "amh"
 * @returns {Promise<string>}
 */
export function universalize(text, langCode) {
  if (!worker) worker = new UniversalWorker();
  return worker.convert(text, langCode);
}
