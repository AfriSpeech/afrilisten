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
 */
export async function recordFeedback({ languageCode, rating }) {
  const dir = dirFor(languageCode);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${randomUUID()}.json`);
  await writeFile(file, JSON.stringify({ languageCode, rating, at: new Date().toISOString() }));
}

/**
 * Per-language counts, for the deployer's own report.
 *
 * @returns {Promise<Record<string, {up: number, down: number, total: number, upRate: number}>>}
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
    for (const name of files) {
      const parsed = await readFile(path.join(dir, name), 'utf8')
        .then((text) => JSON.parse(text))
        .catch(() => null);
      if (!parsed) continue; // a file half-written when read loses one vote, not the count
      if (parsed.rating === 'up') up += 1;
      else if (parsed.rating === 'down') down += 1;
    }
    const total = up + down;
    if (total === 0) continue;
    report[code] = { up, down, total, upRate: Math.round((up / total) * 1000) / 10 };
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
 * Render a complete, self-contained dashboard webpage for language performance.
 *
 * @param {Record<string, {up: number, down: number, total: number, upRate: number}>} report
 * @param {Array<{code: string, name: string, countries: string[]}>} languages
 * @returns {string} HTML document
 */
export function renderFeedbackPage(report = {}, languages = []) {
  const languageMap = new Map();
  for (const l of languages) languageMap.set(l.code, l);

  // Compile full list of languages, joining report data where available
  const items = languages.map((lang) => {
    const r = report[lang.code] || { up: 0, down: 0, total: 0, upRate: null };
    return {
      code: lang.code,
      name: lang.name,
      countries: lang.countries || [],
      up: r.up,
      down: r.down,
      total: r.total,
      upRate: r.upRate,
    };
  });

  // Calculate totals
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
  <title>AfriListen — Language Performance & Feedback</title>
  <meta name="description" content="Live translation and speech quality metrics across African languages.">
  <style>
    :root {
      --primary: #2D6A4F;
      --primary-hover: #1B4332;
      --primary-subtle: #E8F5EE;
      --bg: #F7FAF8;
      --card-bg: #FFFFFF;
      --border: #D8E2DC;
      --border-light: #EBF0ED;
      --text: #16241D;
      --text-muted: #57685F;
      --success: #2D6A4F;
      --warning: #C07D1E;
      --danger: #B93838;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.05);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.06);
      --radius: 12px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px 16px;
    }
    .container {
      max-width: 1140px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 28px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }
    .brand-icon {
      background: var(--primary);
      color: #fff;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 16px;
    }
    h1 {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--text);
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 14px;
    }
    .header-links {
      display: flex;
      gap: 10px;
    }
    .btn-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--primary);
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 12px;
      text-decoration: none;
      font-weight: 500;
      transition: all 0.15s ease;
    }
    .btn-link:hover {
      background: var(--primary-subtle);
      border-color: var(--primary);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px 20px;
      box-shadow: var(--shadow-sm);
    }
    .stat-title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 4px;
      font-weight: 600;
    }
    .stat-val {
      font-size: 28px;
      font-weight: 800;
      color: var(--text);
      line-height: 1.2;
    }
    .stat-meta {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .controls {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px 18px;
      margin-bottom: 20px;
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      align-items: center;
      justify-content: space-between;
      box-shadow: var(--shadow-sm);
    }
    .search-box {
      flex: 1;
      min-width: 240px;
      position: relative;
    }
    .search-input {
      width: 100%;
      padding: 9px 12px 9px 34px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 14px;
      background: #FAFCFB;
      outline: none;
      transition: border-color 0.15s;
    }
    .search-input:focus {
      border-color: var(--primary);
      background: #fff;
    }
    .search-icon {
      position: absolute;
      left: 11px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      pointer-events: none;
      font-size: 13px;
    }
    .filter-tabs {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .tab-btn {
      appearance: none;
      background: #F1F5F2;
      border: 1px solid transparent;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .tab-btn:hover {
      background: var(--border-light);
      color: var(--text);
    }
    .tab-btn.active {
      background: var(--primary);
      color: #fff;
      font-weight: 600;
    }
    .sort-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .sort-label {
      font-size: 13px;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .sort-select {
      padding: 6px 10px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 13px;
      background: #fff;
      outline: none;
      cursor: pointer;
    }
    .results-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 12px;
      padding: 0 4px;
    }
    .lang-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 14px;
    }
    .lang-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px 18px;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .lang-card:hover {
      box-shadow: var(--shadow-md);
      transform: translateY(-1px);
    }
    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
      gap: 8px;
    }
    .lang-title-group {
      flex: 1;
    }
    .lang-name {
      font-size: 16px;
      font-weight: 700;
      color: var(--text);
      display: inline-block;
      margin-right: 6px;
    }
    .code-badge {
      display: inline-block;
      font-family: monospace;
      font-size: 11px;
      font-weight: 600;
      background: var(--primary-subtle);
      color: var(--primary);
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid #C8E3D4;
    }
    .countries-list {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 3px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      font-size: 12px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
      white-space: nowrap;
    }
    .badge-success { background: #E8F5EE; color: var(--success); border: 1px solid #B8E0CC; }
    .badge-warning { background: #FEF6EB; color: var(--warning); border: 1px solid #F5DDB9; }
    .badge-danger  { background: #FDE8E8; color: var(--danger);  border: 1px solid #F5B8B8; }
    .badge-neutral { background: #F1F5F2; color: var(--text-muted); border: 1px solid var(--border); }
    .progress-bar-bg {
      background: #EBF0ED;
      height: 6px;
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 10px;
    }
    .progress-bar-fill {
      height: 100%;
      border-radius: 999px;
      transition: width 0.3s ease;
    }
    .fill-success { background: var(--success); }
    .fill-warning { background: var(--warning); }
    .fill-danger  { background: var(--danger); }
    .card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: var(--text-muted);
      border-top: 1px solid var(--border-light);
      padding-top: 10px;
      margin-top: 4px;
    }
    .vote-counts {
      display: flex;
      gap: 10px;
    }
    .vote-up { color: var(--success); font-weight: 600; }
    .vote-down { color: var(--danger); font-weight: 600; }
    .empty-state {
      text-align: center;
      padding: 48px 16px;
      color: var(--text-muted);
      grid-column: 1 / -1;
      background: var(--card-bg);
      border: 1px dashed var(--border);
      border-radius: var(--radius);
    }
    footer {
      margin-top: 40px;
      text-align: center;
      font-size: 13px;
      color: var(--text-muted);
      border-top: 1px solid var(--border);
      padding-top: 20px;
    }
    footer a { color: var(--primary); text-decoration: none; font-weight: 500; }
    footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <div class="brand">
          <div class="brand-icon">AL</div>
          <h1>AfriListen Performance</h1>
        </div>
        <p class="subtitle">Live community evaluation and translation quality across African languages</p>
      </div>
      <div class="header-links">
        <a href="/feedback/report?format=json" class="btn-link" target="_blank" rel="noopener">
          <span>{ }</span> Raw JSON API
        </a>
        <a href="https://github.com/AfriSpeech/afrilisten" class="btn-link" target="_blank" rel="noopener">
          GitHub
        </a>
      </div>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-title">Total Ratings</div>
        <div class="stat-val">${totalVotes.toLocaleString()}</div>
        <div class="stat-meta">Community evaluations</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Approval Rate</div>
        <div class="stat-val">${overallAvg}%</div>
        <div class="stat-meta">Overall positive feedback</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Languages Rated</div>
        <div class="stat-val">${ratedCount}</div>
        <div class="stat-meta">With at least 1 evaluation</div>
      </div>
      <div class="stat-card">
        <div class="stat-title">Supported Languages</div>
        <div class="stat-val">${languages.length}</div>
        <div class="stat-meta">African languages available</div>
      </div>
    </div>

    <div class="controls">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" id="searchInput" class="search-input" placeholder="Search by language, code, or country..." autocomplete="off">
      </div>
      <div class="filter-tabs">
        <button type="button" class="tab-btn active" data-filter="rated">Evaluated Only (<span id="ratedCount">${ratedCount}</span>)</button>
        <button type="button" class="tab-btn" data-filter="all">All Languages (<span id="allCount">${languages.length}</span>)</button>
        <button type="button" class="tab-btn" data-filter="top">Top Rated (≥80%)</button>
        <button type="button" class="tab-btn" data-filter="needs-work">Needs Work (&lt;70%)</button>
      </div>
      <div class="sort-group">
        <label for="sortSelect" class="sort-label">Sort:</label>
        <select id="sortSelect" class="sort-select">
          <option value="highest">Highest Approval</option>
          <option value="most">Most Ratings</option>
          <option value="name">Alphabetical (A–Z)</option>
        </select>
      </div>
    </div>

    <div class="results-header">
      <span id="resultsCount">Showing languages...</span>
    </div>

    <div class="lang-grid" id="langGrid"></div>

    <footer>
      <p>Powered by <a href="https://github.com/AfriSpeech/afrilisten">AfriListen</a> &bull; Community-driven translation & speech evaluation for African languages &bull; MIT License</p>
    </footer>
  </div>

  <script>
    (function () {
      const ITEMS = ${JSON.stringify(items)};
      const grid = document.getElementById('langGrid');
      const searchInput = document.getElementById('searchInput');
      const sortSelect = document.getElementById('sortSelect');
      const resultsCount = document.getElementById('resultsCount');
      const tabBtns = document.querySelectorAll('.tab-btn');

      let currentFilter = 'rated';
      let currentQuery = '';
      let currentSort = 'highest';

      function getBadgeClass(rate, total) {
        if (total === 0 || rate === null) return 'badge-neutral';
        if (rate >= 80) return 'badge-success';
        if (rate >= 60) return 'badge-warning';
        return 'badge-danger';
      }

      function getFillClass(rate, total) {
        if (total === 0 || rate === null) return '';
        if (rate >= 80) return 'fill-success';
        if (rate >= 60) return 'fill-warning';
        return 'fill-danger';
      }

      function escapeText(str) {
        return String(str || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function renderCard(item) {
        const hasVotes = item.total > 0;
        const rateLabel = hasVotes ? (item.upRate + '%') : 'No ratings';
        const badgeClass = getBadgeClass(item.upRate, item.total);
        const fillClass = getFillClass(item.upRate, item.total);
        const percentWidth = hasVotes ? Math.max(item.upRate, 3) : 0;
        const countries = item.countries && item.countries.length ? item.countries.slice(0, 5).join(', ') + (item.countries.length > 5 ? ' +' + (item.countries.length - 5) : '') : 'African region';

        return '<div class="lang-card">' +
          '<div>' +
            '<div class="card-top">' +
              '<div class="lang-title-group">' +
                '<span class="lang-name">' + escapeText(item.name) + '</span>' +
                '<span class="code-badge">' + escapeText(item.code) + '</span>' +
                '<div class="countries-list">' + escapeText(countries) + '</div>' +
              '</div>' +
              '<span class="badge ' + badgeClass + '">' + rateLabel + '</span>' +
            '</div>' +
            '<div class="progress-bar-bg">' +
              '<div class="progress-bar-fill ' + fillClass + '" style="width:' + percentWidth + '%;"></div>' +
            '</div>' +
          '</div>' +
          '<div class="card-footer">' +
            '<div class="vote-counts">' +
              '<span class="vote-up">👍 ' + item.up + '</span>' +
              '<span class="vote-down">👎 ' + item.down + '</span>' +
            '</div>' +
            '<span>' + item.total + ' ' + (item.total === 1 ? 'rating' : 'ratings') + '</span>' +
          '</div>' +
        '</div>';
      }

      function applyFilterAndSort() {
        let filtered = ITEMS.filter(function (item) {
          // Tab filter
          if (currentFilter === 'rated' && item.total === 0) return false;
          if (currentFilter === 'top' && (item.total === 0 || item.upRate < 80)) return false;
          if (currentFilter === 'needs-work' && (item.total === 0 || item.upRate >= 70)) return false;

          // Search query
          if (currentQuery) {
            const q = currentQuery.toLowerCase();
            const matchName = item.name.toLowerCase().includes(q);
            const matchCode = item.code.toLowerCase().includes(q);
            const matchCountry = item.countries.some(function (c) { return c.toLowerCase().includes(q); });
            if (!matchName && !matchCode && !matchCountry) return false;
          }
          return true;
        });

        // Sorting
        filtered.sort(function (a, b) {
          if (currentSort === 'highest') {
            if ((b.upRate ?? -1) !== (a.upRate ?? -1)) return (b.upRate ?? -1) - (a.upRate ?? -1);
            return b.total - a.total;
          }
          if (currentSort === 'most') {
            if (b.total !== a.total) return b.total - a.total;
            return (b.upRate ?? -1) - (a.upRate ?? -1);
          }
          if (currentSort === 'name') {
            return a.name.localeCompare(b.name);
          }
          return 0;
        });

        resultsCount.textContent = 'Showing ' + filtered.length + ' of ' + ITEMS.length + ' languages';

        if (!filtered.length) {
          grid.innerHTML = '<div class="empty-state">' +
            '<p style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">No languages match your filter</p>' +
            '<p style="font-size: 13px;">Try clearing the search query or switching to "All Languages".</p>' +
          '</div>';
          return;
        }

        grid.innerHTML = filtered.map(renderCard).join('');
      }

      searchInput.addEventListener('input', function (e) {
        currentQuery = e.target.value.trim();
        applyFilterAndSort();
      });

      sortSelect.addEventListener('change', function (e) {
        currentSort = e.target.value;
        applyFilterAndSort();
      });

      tabBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          tabBtns.forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          currentFilter = btn.getAttribute('data-filter');
          applyFilterAndSort();
        });
      });

      // Initial render
      applyFilterAndSort();
    })();
  </script>
</body>
</html>`;
}
