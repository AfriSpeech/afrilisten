/**
 * Per-language feedback: a thumbs up or down on the audio just played.
 *
 * Stored as one small file per rating, not appended to a shared log. Modal
 * Volumes -- where this lives in production -- commit in the background
 * every few seconds and use last-write-wins on a shared file: two ratings
 * written around the same moment from different containers could silently
 * drop one. Two different files never conflict, whatever the timing, so a
 * directory of small per-rating files is the shape that is actually safe to
 * write concurrently, at the cost of the report doing more reading than a
 * single running tally would.
 *
 * With no LISTEN_FEEDBACK_DIR set, this falls back to a temp directory so
 * local development works with no configuration; it just does not persist
 * across restarts there, which is fine off a Volume.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.env.LISTEN_FEEDBACK_DIR || path.join(os.tmpdir(), 'afrilisten-feedback');

function dirFor(languageCode) {
  // One directory per language, so the report can list a single language's
  // ratings without reading every other language's files to filter them out.
  return path.join(ROOT, languageCode);
}

/**
 * @param {object} options
 * @param {string} options.languageCode an AfriSpeech code, e.g. "swh"
 * @param {"up"|"down"} options.rating
 * @param {string} [options.voice="Kore"]
 */
export async function recordFeedback({ languageCode, rating, voice = 'Kore' }) {
  const dir = dirFor(languageCode);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${randomUUID()}.json`);
  await writeFile(file, JSON.stringify({ languageCode, rating, voice, at: new Date().toISOString() }));
}

/**
 * Per-language counts and voice breakdowns, for the public report.
 *
 * @returns {Promise<Record<string, {up: number, down: number, total: number, upRate: number, voices: Record<string, {up: number, down: number, total: number, upRate: number}>}>>}
 */
export async function feedbackReport() {
  const report = {};
  let languageCodes;
  try {
    languageCodes = await readdir(ROOT);
  } catch (error) {
    if (error.code === 'ENOENT') return report; // nothing rated yet
    throw error;
  }

  for (const code of languageCodes) {
    const dir = dirFor(code);
    const files = await readdir(dir).catch(() => []);
    let up = 0;
    let down = 0;
    const voices = {};
    for (const name of files) {
      const parsed = await readFile(path.join(dir, name), 'utf8')
        .then((text) => JSON.parse(text))
        .catch(() => null);
      if (!parsed) continue; // a file half-written when read loses one vote, not the count
      const v = parsed.voice || 'Kore';
      if (!voices[v]) voices[v] = { up: 0, down: 0, total: 0, upRate: null };

      if (parsed.rating === 'up') {
        up += 1;
        voices[v].up += 1;
      } else if (parsed.rating === 'down') {
        down += 1;
        voices[v].down += 1;
      }
      voices[v].total = voices[v].up + voices[v].down;
      voices[v].upRate = voices[v].total > 0
        ? Math.round((voices[v].up / voices[v].total) * 1000) / 10
        : null;
    }
    const total = up + down;
    if (total === 0) continue;
    report[code] = {
      up,
      down,
      total,
      upRate: Math.round((up / total) * 1000) / 10,
      voices,
    };
  }
  return report;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render a clean, research-grade evaluation dashboard for language performance.
 *
 * @param {Record<string, {up: number, down: number, total: number, upRate: number}>} report
 * @param {Array<{code: string, name: string, countries: string[]}>} languages
 * @returns {string} HTML document
 */
export function renderFeedbackPage(report = {}, languages = []) {
  // Compile list of languages with feedback stats
  const items = languages.map((lang) => {
    const r = report[lang.code] || { up: 0, down: 0, total: 0, upRate: null, voices: {} };
    return {
      code: lang.code,
      name: lang.name,
      countries: lang.countries || [],
      up: r.up,
      down: r.down,
      total: r.total,
      upRate: r.upRate,
      voices: r.voices || {},
    };
  });

  let totalVotes = 0;
  let totalUp = 0;
  let ratedCount = 0;
  for (const [_, r] of Object.entries(report)) {
    totalVotes += r.total;
    totalUp += r.up;
    if (r.total > 0) ratedCount += 1;
  }
  const overallAvg = totalVotes > 0 ? (Math.round((totalUp / totalVotes) * 1000) / 10).toFixed(1) : '—';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AfriListen — Language Evaluation Benchmark</title>
  <meta name="description" content="Live crowdsourced translation and speech quality metrics across African languages.">
  <style>
    :root {
      --bg: #FFFFFF;
      --text: #0F172A;
      --muted: #64748B;
      --border: #E2E8F0;
      --border-dark: #CBD5E1;
      --surface: #F8FAFC;
      --primary: #0F172A;
      --accent: #15803D;
      --accent-muted: #166534;
      --accent-bg: #F0FDF4;
      --warn: #B45309;
      --bad: #B91C1C;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-feature-settings: "tnum" 1, "cv02" 1;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 32px 20px;
    }
    .wrapper {
      max-width: 1040px;
      margin: 0 auto;
    }
    header {
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }
    .meta-org {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      color: var(--muted);
      margin-bottom: 6px;
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text);
      margin-bottom: 8px;
    }
    .desc {
      color: var(--muted);
      font-size: 14px;
      max-width: 780px;
      line-height: 1.6;
    }
    .links {
      margin-top: 12px;
      display: flex;
      gap: 16px;
      font-size: 13px;
    }
    .links a {
      color: var(--accent-muted);
      text-decoration: none;
      font-weight: 500;
    }
    .links a:hover {
      text-decoration: underline;
    }
    .metrics-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 24px;
      padding: 14px 18px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      margin-bottom: 24px;
    }
    .metric {
      display: flex;
      flex-direction: column;
    }
    .metric-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      font-weight: 600;
    }
    .metric-val {
      font-size: 20px;
      font-weight: 700;
      color: var(--text);
    }
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
    }
    .search-input {
      width: 280px;
      padding: 7px 12px;
      border: 1px solid var(--border-dark);
      border-radius: 6px;
      font-size: 13px;
      background: #FFFFFF;
      outline: none;
      font-family: inherit;
    }
    .search-input:focus {
      border-color: var(--text);
    }
    .toggle-group {
      display: inline-flex;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--surface);
    }
    .toggle-btn {
      appearance: none;
      border: none;
      background: transparent;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 500;
      color: var(--muted);
      cursor: pointer;
      border-right: 1px solid var(--border);
    }
    .toggle-btn:last-child {
      border-right: none;
    }
    .toggle-btn.active {
      background: #FFFFFF;
      color: var(--text);
      font-weight: 600;
    }
    .table-container {
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow-x: auto;
      background: #FFFFFF;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }
    thead {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
    th {
      padding: 10px 14px;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    th:hover {
      color: var(--text);
    }
    td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
      white-space: nowrap;
    }
    tr:last-child td {
      border-bottom: none;
    }
    tr:hover td {
      background: #F8FAFC;
    }
    .lang-col {
      font-weight: 600;
      color: var(--text);
    }
    .code-col {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      color: var(--muted);
    }
    .countries-col {
      color: var(--muted);
      font-size: 12px;
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .num-col {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    th.num-col {
      text-align: right;
    }
    .rate-cell {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
    }
    .rate-bar-bg {
      width: 60px;
      height: 4px;
      background: var(--border);
      border-radius: 2px;
      overflow: hidden;
    }
    .rate-bar-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 2px;
    }
    .rate-bar-fill.warn { background: var(--warn); }
    .rate-bar-fill.bad { background: var(--bad); }
    .rate-text {
      font-weight: 600;
      min-width: 44px;
      text-align: right;
    }
    .rate-text.unrated {
      font-weight: 400;
      color: var(--muted);
    }
    .positive { color: var(--accent-muted); }
    .negative { color: var(--bad); }
    .empty-msg {
      text-align: center;
      padding: 36px 16px;
      color: var(--muted);
      font-size: 13px;
    }
    footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 12px;
      color: var(--muted);
    }
    footer a {
      color: inherit;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <header>
      <div class="meta-org">AfriSpeech Research &bull; AfriListen</div>
      <h1>Language Evaluation Benchmark</h1>
      <p class="desc">
        Live community evaluation metrics for speech translation across African languages.
        Text is translated via Google Translate (Thai pivot) and narrated through Gemini Live.
      </p>
      <div class="links">
        <a href="/feedback/report?format=json" target="_blank" rel="noopener">Raw JSON API</a>
        <a href="https://github.com/AfriSpeech/afrilisten" target="_blank" rel="noopener">GitHub Repository</a>
        <a href="https://afrispeech.org" target="_blank" rel="noopener">AfriSpeech.org</a>
      </div>
    </header>

    <div class="metrics-bar">
      <div class="metric">
        <span class="metric-label">Evaluated Languages</span>
        <span class="metric-val">${ratedCount}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Total Supported</span>
        <span class="metric-val">${languages.length}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Total Evaluations</span>
        <span class="metric-val">${totalVotes.toLocaleString()}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Mean Approval Rate</span>
        <span class="metric-val">${overallAvg}%</span>
      </div>
    </div>

    <div class="toolbar">
      <input type="text" id="searchInput" class="search-input" placeholder="Filter by language, code, or country..." autocomplete="off">
      <div class="toggle-group">
        <button type="button" class="toggle-btn active" data-filter="rated">Evaluated (${ratedCount})</button>
        <button type="button" class="toggle-btn" data-filter="all">All Languages (${languages.length})</button>
      </div>
    </div>

    <div class="table-container">
      <table id="langTable">
        <thead>
          <tr>
            <th data-sort="name">Language</th>
            <th data-sort="code">ISO 639-3</th>
            <th>Countries</th>
            <th class="num-col" data-sort="up">Positive</th>
            <th class="num-col" data-sort="down">Negative</th>
            <th class="num-col" data-sort="total">Total</th>
            <th class="num-col" data-sort="upRate">Approval Rate</th>
          </tr>
        </thead>
        <tbody id="tableBody"></tbody>
      </table>
    </div>

    <footer>
      <span>AfriListen Evaluation Engine</span>
      <span>Public Benchmark API</span>
    </footer>
  </div>

  <script>
    (function () {
      const DATA = ${JSON.stringify(items)};
      const tbody = document.getElementById('tableBody');
      const searchInput = document.getElementById('searchInput');
      const toggleBtns = document.querySelectorAll('.toggle-btn');
      const headers = document.querySelectorAll('th[data-sort]');

      let currentFilter = 'rated';
      let searchQuery = '';
      let sortKey = 'upRate';
      let sortAsc = false;

      function escapeHtml(str) {
        return String(str || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function render() {
        let rows = DATA.filter(function (item) {
          if (currentFilter === 'rated' && item.total === 0) return false;
          if (searchQuery) {
            const q = searchQuery.toLowerCase();
            const matchName = item.name.toLowerCase().includes(q);
            const matchCode = item.code.toLowerCase().includes(q);
            const matchCountry = item.countries.some(function (c) { return c.toLowerCase().includes(q); });
            if (!matchName && !matchCode && !matchCountry) return false;
          }
          return true;
        });

        rows.sort(function (a, b) {
          let va = a[sortKey];
          let vb = b[sortKey];

          if (sortKey === 'upRate') {
            va = a.total > 0 ? a.upRate : -1;
            vb = b.total > 0 ? b.upRate : -1;
          } else if (typeof va === 'string') {
            return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
          }

          if (va !== vb) {
            return sortAsc ? va - vb : vb - va;
          }
          return b.total - a.total;
        });

        if (!rows.length) {
          tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">No matching languages found.</td></tr>';
          return;
        }

        tbody.innerHTML = rows.map(function (item) {
          const hasRate = item.total > 0 && item.upRate !== null;
          let rateClass = '';
          if (hasRate) {
            if (item.upRate >= 80) rateClass = '';
            else if (item.upRate >= 60) rateClass = 'warn';
            else rateClass = 'bad';
          }
          const countries = item.countries && item.countries.length ? item.countries.join(', ') : '—';
          const rateDisplay = hasRate ? (item.upRate + '%') : '—';

          let voiceBreakdown = '';
          if (item.voices && Object.keys(item.voices).length) {
            const vparts = Object.entries(item.voices).map(function (pair) {
              const vname = pair[0];
              const vdata = pair[1];
              const vrate = vdata.total > 0 ? (vdata.upRate + '%') : '—';
              return vname + ': ' + vrate + ' (n=' + vdata.total + ')';
            });
            voiceBreakdown = '<div style="font-size:11px;color:var(--muted);margin-top:2px;font-weight:400">' + escapeHtml(vparts.join(' · ')) + '</div>';
          }

          return '<tr>' +
            '<td class="lang-col">' + escapeHtml(item.name) + voiceBreakdown + '</td>' +
            '<td class="code-col">' + escapeHtml(item.code) + '</td>' +
            '<td class="countries-col" title="' + escapeHtml(countries) + '">' + escapeHtml(countries) + '</td>' +
            '<td class="num-col positive">' + (item.up ? ('+' + item.up) : '0') + '</td>' +
            '<td class="num-col negative">' + (item.down ? ('-' + item.down) : '0') + '</td>' +
            '<td class="num-col">' + item.total + '</td>' +
            '<td class="num-col">' +
              '<div class="rate-cell">' +
                (hasRate ? '<div class="rate-bar-bg"><div class="rate-bar-fill ' + rateClass + '" style="width:' + item.upRate + '%;"></div></div>' : '') +
                '<span class="rate-text ' + (hasRate ? '' : 'unrated') + '">' + rateDisplay + '</span>' +
              '</div>' +
            '</td>' +
          '</tr>';
        }).join('');
      }

      searchInput.addEventListener('input', function (e) {
        searchQuery = e.target.value.trim();
        render();
      });

      toggleBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          toggleBtns.forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          currentFilter = btn.getAttribute('data-filter');
          render();
        });
      });

      headers.forEach(function (th) {
        th.addEventListener('click', function () {
          const key = th.getAttribute('data-sort');
          if (sortKey === key) {
            sortAsc = !sortAsc;
          } else {
            sortKey = key;
            sortAsc = key === 'name' || key === 'code';
          }
          render();
        });
      });

      render();
    })();
  </script>
</body>
</html>`;
}
