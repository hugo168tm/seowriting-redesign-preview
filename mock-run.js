/*!
 * mock-run.js — 頁面接線層
 * 依 docs/reverse-engineering/PAGE-WIRING.md：偵測頁面 → 讀原生欄位 → 跑對應呼叫序列 → 畫結果抽屜
 * 只依賴 mock-api.js（window.MockAPI）；缺失時靜靜唔做任何事。
 */
(function () {
  'use strict';
  const A = window.MockAPI;
  if (!A) return;

  /* ---------------- 頁面偵測 ---------------- */
  const path = location.pathname + location.search;
  const PAGE = /1-click|index\.html$|^\/$/.test(path) ? '1-click'
             : /bulk-generation/.test(path) ? 'bulk'
             : /super-page/.test(path) ? 'super-page'
             : /rewriter/.test(path) ? 'rewriter'
             : /brand-voice/.test(path) ? 'brand-voice'
             : null;
  if (!PAGE) return;

  /* ---------------- 欄位讀取 ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const txt = (s) => { const e = $(s); return e ? String(e.value || '').trim() : ''; };

  function selVal(name, fallback) {
    const f = document.querySelector('[data-dname="' + name + '"]');
    if (!f) return fallback || '';
    const sel = f.querySelector('.sel');
    if (sel && sel.dataset && sel.dataset.value) return sel.dataset.value;
    const v = f.querySelector('.sel-val');
    if (v) return v.textContent.trim().split('\n')[0];
    const inp = f.querySelector('input');
    if (inp && inp.value) return inp.value;
    return fallback || '';
  }

  /* 把頁面顯示值（國家名 / 語言名）map 去 mock 嘅 location / language */
  function locFromName(name) {
    const locs = A.df.locations().tasks[0].result[0].items;
    const hit = locs.find(l => l.location_name.toLowerCase() === String(name).toLowerCase());
    return {location_code: hit ? hit.location_code : 2840, location_name: name || 'United States'};
  }
  function langFromName(name) {
    const langs = A.df.languages().tasks[0].result[0].items;
    const key = String(name || '').toLowerCase();
    const hit = langs.find(l => l.language_name.toLowerCase() === key || key.indexOf(l.language_name.toLowerCase()) === 0);
    return hit ? hit.language_code : 'en';
  }
  function modelFromQuality(v) {
    const s = String(v || '').toLowerCase();
    const hit = A.MODELS.find(m => s.indexOf(m.label.toLowerCase()) === 0 || s.indexOf(m.label.toLowerCase()) !== -1);
    return hit || A.MODELS.find(m => m.id === 111);
  }

  /* 落拉選中嘅真 slug → mock 顯示用（免得抽屜寫 GPT-6 Astra 但用戶揀咗 DeepSeek） */
  const MOCK_MODEL = {
    'deepseek/deepseek-v4.1-flash-1017': { label: 'DeepSeek v4.1 Flash', credits: 0.8 },
    'openai/gpt-6-luna': { label: 'GPT-6 Luna', credits: 0.8 },
    'anthropic/claude-haiku-5.5': { label: 'Claude Haiku 5.5', credits: 0.8 },
    'z-ai/glm-5.3-flash': { label: 'GLM 5.3 Flash', credits: 0.8 },
    'google/gemini-3.8-flash': { label: 'Gemini 3.8 Flash', credits: 1.8 },
    'z-ai/glm-5.3': { label: 'GLM 5.3', credits: 2.8 },
    'anthropic/claude-sonnet-5.5': { label: 'Claude Sonnet 5.5', credits: 2.8 },
    'moonshotai/kimi-k3': { label: 'Kimi K3', credits: 2.8 },
    'openai/gpt-6.1-sol': { label: 'GPT-6.1 Sol', credits: 3.8 },
    'anthropic/claude-opus-5.5': { label: 'Claude Opus 5.5', credits: 3.8 },
    'openai/gpt-6-astra': { label: 'GPT-6 Astra', credits: 5.8 },
    'openai/gpt-6-luna|serp': { label: 'GPT-6 Luna + Real-Time SERP', credits: 1 },
    'openai/gpt-6-luna|1c': { label: 'GPT-6 Luna (1c)', credits: 1 },
    'openai/gpt-6.1-sol|serp': { label: 'GPT-6.1 Sol + Real-Time SERP', credits: 4 },
    'anthropic/claude-opus-5.5|serp': { label: 'Claude Opus 5.5 + Real-Time SERP', credits: 10 },
    'moonshotai/kimi-k3.1-pro': { label: 'Kimi K3.1 Pro', credits: 1.2 },
    'minimax/minimax-m3.1-flash': { label: 'MiniMax M3.1 Flash', credits: 0.6 },
  };
  function modelFromSlug(slug) {
    const hit = MOCK_MODEL[String(slug || '').trim()];
    if (!hit) return null;
    return { id: -1, label: hit.label, credits: hit.credits };
  }

  /* 手動開關冇開就當自動（空字串）；修：原本讀 #keyword，呢頁根本冇呢個 id */
  function manualKeyword() {
    const field = $('[data-dname="main_keyword"]');
    if (!field) return '';
    const wrap = $('[data-role="manual"]', field);
    if (!wrap || wrap.hidden) return '';
    return txt('#inp_kw');
  }

  /* ---------------- 抽屜 UI ---------------- */
  let drawer, body, headCost, headMode;

  /**
   * 抽屜標題要講真話：真 API 跑 = 「真實執行」，mock = 「模擬執行（原因）」。
   * 之前寫死「模擬執行」，所以真 key 跑完都仲顯示模擬，睇落好似冇接線。
   */
  function setDrawerMode(real, note) {
    headMode = headMode || (drawer && drawer.querySelector('#mock-mode'));
    if (!headMode) return;
    headMode.textContent = real ? '真實執行' : ('模擬執行' + (note ? '（' + note + '）' : ''));
    headMode.style.color = real ? 'var(--ink,#16181D)' : 'var(--ink-3,#767C87)';
    drawer.setAttribute('aria-label', real ? '真實執行結果' : '模擬執行結果');
  }
  function ensureDrawer() {
    if (drawer) return;
    drawer = document.createElement('div');
    drawer.id = 'mock-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', '模擬執行結果');
    drawer.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:9999',
      'width:min(560px, calc(100vw - 32px))', 'max-height:72vh', 'overflow:auto',
      'background:var(--card,#fff)', 'color:var(--ink,#16181D)',
      'border:1px solid var(--rule,#E3DFD6)', 'border-right:3px solid var(--mark,#9B2C2C)',
      'border-radius:5px', 'box-shadow:0 12px 40px -18px rgba(0,0,0,.45)',
      'font:13px/1.55 "Noto Sans TC",system-ui,sans-serif', 'display:none'
    ].join(';');
    drawer.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--rule-2,#EFEBE2)">' +
        '<strong id="mock-mode" style="font-size:13.5px">模擬執行</strong>' +
        '<span id="mock-cost" style="font-family:ui-monospace,monospace;font-size:11.5px;color:var(--ink-3,#767C87)">—</span>' +
        '<span style="flex:1"></span>' +
        '<button type="button" id="mock-close" style="border:0;background:none;font-size:16px;cursor:pointer;color:var(--ink-3,#767C87)" aria-label="關閉">×</button>' +
      '</div><div id="mock-body" style="padding:12px"></div>';
    document.body.appendChild(drawer);
    body = drawer.querySelector('#mock-body');
    headCost = drawer.querySelector('#mock-cost');
    drawer.querySelector('#mock-close').addEventListener('click', () => { drawer.style.display = 'none'; });
    /* a11y（ADR-11）：抽屜係 role="dialog" → 要 focus trap（Tab 唔可以走出抽屜）＋ ESC 關 */
    drawer.tabIndex = -1;
    drawer.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = drawer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.style.display === 'block') drawer.style.display = 'none';
    });
  }
  function open() { ensureDrawer(); drawer.style.display = 'block'; try { drawer.focus(); } catch (_) {} }
  function esc(x) { return String(x).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function money(n) { return '$' + Number(n || 0).toFixed(6); }

  function stepList(steps) {
    return '<ol style="list-style:none;margin:0 0 10px;padding:0">' + steps.map(s =>
      '<li style="display:flex;gap:8px;padding:3px 0;font-size:12.5px">' +
        '<span style="color:' + (s.ok ? 'var(--ok,#1F6F4A)' : 'var(--mark,#9B2C2C)') + '">' + (s.ok ? '✓' : '✕') + '</span>' +
        '<span style="min-width:150px;font-family:ui-monospace,monospace">' + esc(s.label) + '</span>' +
        '<span style="color:var(--ink-3,#767C87);font-family:ui-monospace,monospace">' + esc(s.detail || '') + '</span>' +
      '</li>').join('') + '</ol>';
  }
  function table(cols, rows) {
    if (!rows || !rows.length) return '';
    return '<table style="width:100%;border-collapse:collapse;font-size:11.5px;margin:6px 0 10px">' +
      '<thead><tr>' + cols.map(c => '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid var(--rule-2,#EFEBE2);font-family:ui-monospace,monospace;color:var(--ink-3,#767C87);font-weight:400">' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + r.map((c, i) => '<td style="padding:3px 6px;border-bottom:1px dotted var(--rule-2,#EFEBE2);' + (i === 0 ? 'font-family:ui-monospace,monospace' : '') + '">' + esc(c) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table>';
  }
  function section(title, html) {
    return '<div style="margin:0 0 6px"><div style="font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3,#767C87);margin:10px 0 3px">' + esc(title) + '</div>' + html + '</div>';
  }

  /* ---------------- 版本比較（ADR-11）---------------- */
  const VERDICT_LABEL = { pending: '待決定', approved: '已採用', rejected: '已拒絕', superseded: '已被取代' };
  const VERDICT_COLOR = { pending: 'var(--ink-3,#767C87)', approved: 'var(--ok,#1F6F4A)', rejected: 'var(--mark,#9B2C2C)', superseded: 'var(--ink-3,#767C87)' };
  let currentJobId = '';
  let currentVersions = [];
  let selectedVersionId = '';
  let showFull = false;
  let versionError = '';

  function stamp(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(11, 16);
  }
  function verdictOf(v) {
    const x = v && v.verdict;
    return ['pending', 'approved', 'rejected', 'superseded'].includes(x) ? x : 'pending';
  }
  function versionText(v) { return (v && v.result && typeof v.result.text === 'string') ? v.result.text : ''; }

  /* A = 最新 approved（冇就最新版本嘅前一個）；B = 揀選嘅（冇就最新版本） */
  function pairAB() {
    const list = currentVersions;
    if (list.length < 2) return null;
    const latest = list[list.length - 1];
    let a = null;
    for (let i = list.length - 1; i >= 0; i -= 1) { if (verdictOf(list[i]) === 'approved') { a = list[i]; break; } }
    if (!a) a = list[list.length - 2];
    const picked = list.find((v) => v.id === selectedVersionId);
    const b = picked && a && picked.id !== a.id ? picked : (latest.id === a.id ? a : latest);
    return { a, b: b || latest };
  }

  function starRow(v) {
    let out = '';
    for (let s = 1; s <= 5; s += 1) {
      const on = v.score === s;
      out += '<button type="button" class="v-btn" data-act="score" data-vid="' + esc(v.id) + '" data-score="' + s +
             '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + s + ' 星">' + (on ? '★' : '☆') + '</button>';
    }
    return '<span role="group" aria-label="評分" style="display:inline-flex;gap:2px">' + out + '</span>';
  }

  function versionRow(v) {
    const vd = verdictOf(v);
    const picked = v.id === selectedVersionId;
    return '<li class="v-row" data-vid="' + esc(v.id) + '">' +
      '<button type="button" class="v-btn" data-act="select" data-vid="' + esc(v.id) + '" aria-pressed="' +
        (picked ? 'true' : 'false') + '">#' + esc(v.n == null ? '—' : v.n) + '</button>' +
      '<span class="v-name" title="' + esc(v.model_key || '') + '">' + esc(v.model_key || '（未指定模型）') + '</span>' +
      '<span class="v-meta">' + esc(v.words == null ? '—' : v.words) + ' 字 · USD ' + money(v.cost && v.cost.usd_total) +
        (v.created_at ? ' · ' + esc(stamp(v.created_at)) : '') + '</span>' +
      '<span class="v-badge" style="color:' + VERDICT_COLOR[vd] + '">' + esc(VERDICT_LABEL[vd]) + '</span>' +
      (vd === 'pending'
        ? '<button type="button" class="v-btn" data-act="approve" data-vid="' + esc(v.id) + '" aria-pressed="false">批准</button>' +
          '<button type="button" class="v-btn" data-act="reject" data-vid="' + esc(v.id) + '" aria-pressed="false">拒絕</button>'
        : '') +
      starRow(v) +
      '</li>';
  }

  function diffPanel() {
    const pair = pairAB();
    if (!pair) return '<div class="v-side">至少兩個版本先可以比較。</div>';
    const Diff = window.SWDiff;
    if (!Diff || typeof Diff.diffSentences !== 'function') {
      return '<div class="v-side">diff 模組未載入（ui/diff.js）。</div>';
    }
    const ops = Diff.diffSentences(versionText(pair.a), versionText(pair.b));
    const left = [];
    const right = [];
    let changed = 0;
    for (const op of ops) {
      if (op.type === 'del') { left.push('<del>' + esc(op.text) + '</del>'); changed += 1; }
      else if (op.type === 'add') { right.push('<ins>' + esc(op.text) + '</ins>'); changed += 1; }
      else if (op.type === 'sub') {
        left.push('<del>' + esc(op.before || '') + '</del>');
        right.push('<mark>' + esc(op.text) + '</mark>');
        changed += 1;
      } else if (showFull) { left.push(esc(op.text)); right.push(esc(op.text)); }
    }
    const head = '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0">' +
      '<span class="v-meta">A #' + esc(pair.a.n == null ? '—' : pair.a.n) + ' ' + esc(pair.a.model_key || '') + '</span>' +
      '<span class="v-meta">B #' + esc(pair.b.n == null ? '—' : pair.b.n) + ' ' + esc(pair.b.model_key || '') + '</span>' +
      '<button type="button" class="v-btn" data-act="toggle-full" aria-pressed="' + (showFull ? 'true' : 'false') + '">全文</button>' +
      '<span class="v-meta">' + changed + ' 句有差異</span></div>';
    return head + '<div class="v-diff">' +
      '<div class="v-side">' + (left.join(' ') || '（無）') + '</div>' +
      '<div class="v-side">' + (right.join(' ') || '（無）') + '</div>' +
      '</div>';
  }

  function versionInner() {
    const rows = currentVersions.slice().reverse();   /* 新 → 舊（ADR-11） */
    return '<div style="font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3,#767C87);margin:10px 0 3px">' +
        '版本（' + currentVersions.length + '）</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 6px">' +
        '<button type="button" class="v-btn" data-act="rerun">再改寫（同一個 job）</button>' +
        (versionError ? '<span class="v-meta" style="color:var(--mark,#9B2C2C)">' + esc(versionError) + '</span>' : '') +
      '</div>' +
      '<ul style="list-style:none;margin:0 0 8px;padding:0">' + (rows.map(versionRow).join('') || '<li class="v-row">（冇版本）</li>') + '</ul>' +
      diffPanel();
  }

  function versionSection() {
    return '<div id="mock-versions" style="margin-top:12px;border-top:1px solid var(--rule-2,#EFEBE2);padding-top:8px">' +
      versionInner() + '</div>';
  }
  function renderVersions() {
    const el = document.getElementById('mock-versions');
    if (el) el.innerHTML = versionInner();
  }

  /* 版本操作：approve / reject / score 一律經 POST /api/version（ADR-1） */
  async function versionAction(payload) {
    versionError = '';
    try {
      const res = await fetch(window.SW_API_BASE + '/api/version', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.ok) {
        const err = json.error || {};
        versionError = (err.message || '版本操作失敗') + (err.code ? '（' + err.code + '）' : '');
      } else {
        currentVersions = json.versions || [];
      }
    } catch (e) {
      versionError = String((e && e.message) || e);
    }
    renderVersions();
  }

  function onVersionClick(e) {
    const btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!btn) return;
    const act = btn.dataset.act;
    const vid = btn.dataset.vid;
    if (act === 'select') { selectedVersionId = selectedVersionId === vid ? '' : vid; renderVersions(); return; }
    if (act === 'toggle-full') { showFull = !showFull; renderVersions(); return; }
    if (act === 'rerun') { rerun(); return; }
    if (act === 'approve' || act === 'reject') { versionAction({job_id: currentJobId, version_id: vid, action: act}); return; }
    if (act === 'score') {
      const hit = currentVersions.find((v) => v.id === vid);
      versionAction({job_id: currentJobId, version_id: vid, action: 'score',
                     score: Number(btn.dataset.score), words: hit ? hit.words : undefined});
    }
  }

  function bindVersionEvents() {
    const el = document.getElementById('mock-versions');
    if (!el || el.dataset.bound === '1') return;
    el.dataset.bound = '1';
    el.addEventListener('click', onVersionClick);
  }

  /* 再改寫（ADR-3 / ADR-9）：帶住同一個 job_id 再跑，後端會先 reject 舊 pending */
  async function rerun() {
    const mode = selVal('mode', 'rewriter');
    const text = txt('#inp_text');
    const steps = [];
    open();
    body.innerHTML = '<div style="font-size:12.5px;color:var(--ink-3,#767C87)">跑緊…</div>';
    headCost.textContent = '…';
    try {
      const out = await realRewrite(steps, mode, text, currentJobId);
      headCost.textContent = out.headerCost || '';
      body.innerHTML = stepList(steps) + out.html + (out.footerHtml || '');
    } catch (e) {
      headCost.textContent = '錯誤';
      body.innerHTML = stepList(steps) + '<pre style="font-size:11.5px;color:var(--mark,#9B2C2C);white-space:pre-wrap">' +
        esc((e && e.message) || e) + '</pre>';
    }
    bindVersionEvents();
  }

  /* ---------------- 真 API（/api/rewrite，async job mode）---------------- */
  const JOB_KEY = 'sw:rewrite:job';
  const JOB_POLL_MS = 1500;
  const JOB_MAX_MS = 10 * 60 * 1000;
  let cancelJob = null;                        /* poll 期間 set；取消時叫 */

  function saveJobId(id) { try { sessionStorage.setItem(JOB_KEY, id); } catch (_) {} }
  function clearJobId() { try { sessionStorage.removeItem(JOB_KEY); } catch (_) {} }
  function readJobId() { try { return sessionStorage.getItem(JOB_KEY) || ''; } catch (_) { return ''; } }

  /* server step 嘅 detail 可能係物件 → 攤平成字串 */
  function jobDetail(s) {
    const d = s && s.detail;
    if (d == null) return '';
    if (typeof d === 'string') return d;
    try { return JSON.stringify(d); } catch (_) { return ''; }
  }

  /* 將目前 server steps 畫落抽屜＋加「取消」掣（停 poll，唔取消後端） */
  function renderProgress(steps) {
    const btn = '<button type="button" id="mock-cancel" style="margin-top:8px;padding:6px 10px;font:12.5px/1 \'Noto Sans TC\',system-ui,sans-serif;border:1px solid var(--rule,#E3DFD6);background:var(--card,#fff);color:var(--ink,#16181D);border-radius:3px;cursor:pointer">取消（停咗輪詢，記錄保留）</button>';
    body.innerHTML = stepList(steps) + '<div style="font-size:12px;color:var(--ink-3,#767C87)">處理緊…</div>' + btn;
    const b = document.getElementById('mock-cancel');
    if (b) b.addEventListener('click', () => { if (cancelJob) cancelJob(); });
  }

  /* 由 done job 嘅 result body 砌回同一 shape 嘅 {headerCost, footerHtml, html} */
  function buildResultFromBody(json, body) {
    const kw = json.keyword, serp = json.serp, cost = json.cost, prov = json.providers || {};
    const ledger = json.ledger || {};
    const badge = (v) => v === 'real'
      ? '<span style="color:var(--ok,#1F6F4A)">真 real</span>'
      : '<span style="color:var(--ochre,#8A6100)">模擬 mock</span>';
    return {
      headerCost: 'USD ' + money(cost.usd_total) + ' · ' + String(body.model || '').split('/').pop() + ' · ' + (prov.llm || '?'),
      footerHtml:
        '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--rule-2,#EFEBE2);font-family:ui-monospace,monospace;font-size:11px;color:var(--ink-3,#767C87)">' +
          '本次：USD ' + money(cost.usd_total) + '　｜　累計：USD ' + money(ledger.total_usd) +
          (ledger.warn ? '　<span style="color:var(--mark,#9B2C2C)">※ 累計已過 $5</span>' : '') +
          '　｜　serp ' + (prov.serp || '?') + ' / llm ' + (prov.llm || '?') + '</div>',
      html:
        section('主關鍵字（' + esc(kw ? kw.source + (kw.cached ? ' · cache' : '') : 'humanizer') + '）',
          kw
            ? table(['keyword', 'volume', 'difficulty', 'score'], (kw.candidates && kw.candidates.length ? kw.candidates : [kw])
                .map(c => [c.keyword, c.volume == null ? '—' : c.volume, c.difficulty == null ? '—' : c.difficulty, c.score == null ? '—' : c.score])) +
              '<div style="font-size:11.5px;font-family:ui-monospace,monospace">' +
                (kw.cached ? 'cache 命中（今次冇打 volume / difficulty）' : '即時計算') + '</div>'
            : '<div style="font-size:12px">Humanizer 模式唔抽關鍵字</div>') +
        section('SERP 目標結構', serp
          ? table(['#', 'domain', 'title'], serp.items.slice(0, 8).map(i => [i.rank_absolute, i.domain, String(i.title).slice(0, 40)])) +
            ((serp.paa && serp.paa.length) ? '<div style="font-size:12px">' + serp.paa.map(p => '· ' + esc(p)).join('<br>') + '</div>' : '')
          : '<div style="font-size:12px">—</div>') +
        section('改寫結果（' + esc(body.model || '預設模型') + '）',
          '<pre style="white-space:pre-wrap;font-size:11.5px;max-height:200px;overflow:auto;background:var(--paper-2,#F4F2EC);padding:8px">' +
            esc(json.result.text) + '</pre>') +
        section('供應商 / 成本明細',
          '<div style="font-size:12px">SERP：' + badge(prov.serp) + '　LLM：' + badge(prov.llm) + '</div>' +
          table(['項目', 'USD'], [['serp', cost.breakdown.serp], ['volume', cost.breakdown.volume],
            ['difficulty', cost.breakdown.difficulty], ['llm', cost.breakdown.llm], ['合計', cost.usd_total]]
            .map(r => [r[0], money(r[1])])))
    };
  }

  /* 建立（或用 sessionStorage 沿用）job，再 poll 到 done/error；回 result
     reuseJobId：再改寫（ADR-3）—— 同一個 job 再跑，後端會先 reject 舊 pending 版本 */
  async function realRewrite(steps, mode, text, reuseJobId) {
    /* 原生 humanize payload = {text, lang, rm_words, readability}：冇 keyword、冇 instructions。
       rewrite 才有 main_keyword / instructions。 */
    const body = mode === 'humanizer'
      ? {
          mode,
          text,
          lang: selVal('lang', 'English (US)'),
          country: selVal('target_country', 'United States'),
          model: selVal('model', ''),
          readability: Number(window.SW_READABILITY) || 4,
          rm_words: String(window.SW_RM_WORDS || '')
        }
      : {
          mode,
          text,
          lang: selVal('lang', 'English (US)'),
          country: selVal('target_country', 'United States'),
          keyword: manualKeyword(),
          instructions: txt('#inp_inst'),
          model: selVal('model', '')
        };

    if (reuseJobId) body.job_id = reuseJobId;   /* ADR-3：同一個 job 再改寫 */

    let jobId = reuseJobId ? '' : readJobId();
    if (jobId) {
      steps.push({ok: true, label: '重新接駁任務', detail: 'job ' + jobId.slice(0, 8) + '…（reload 後自動續）'});
    } else {
      steps.push({ok: true, label: 'POST /api/rewrite', detail: mode + ' · ' + (body.model || '預設模型')});
      let res, json;
      try {
        res = await fetch(window.SW_API_BASE + '/api/rewrite', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify(body)
        });
        json = await res.json();
      } catch (e) {
        steps.push({ok: false, label: '連線失敗', detail: String((e && e.message) || e)});
        throw new Error('去唔到 ' + window.SW_API_BASE + '/api/rewrite：' + ((e && e.message) || e) +
                        '（未開 server-local.js？冇開就設 window.SW_API_BASE = \'\' 用 mock）');
      }
      if (!json.ok) {
        if (json.error && json.error.code === 'already_running' && json.error.details && json.error.details.existing_job_id) {
          jobId = json.error.details.existing_job_id;
          steps.push({ok: true, label: '沿用進行中任務', detail: (json.error.message || '') + ' · job ' + jobId.slice(0, 8) + '…'});
        } else {
          const err = json.error || {};
          steps.push({ok: false, label: err.code || ('HTTP ' + res.status), detail: err.message || ''});
          if (err.details && err.details.usd_spent) {
            steps.push({ok: false, label: '已花成本', detail: money(err.details.usd_spent)});
          }
          throw new Error((err.message || 'API 出錯') +
            (err.details && err.details.available ? '　可用模型：' + err.details.available.join(' / ') : ''));
        }
      } else {
        jobId = json.job_id || '';
      }
    }
    if (!jobId) throw new Error('API 冇回 job_id');
    saveJobId(jobId);

    return await pollToDone(steps, body, jobId);
  }

  /* 1.5s poll /api/result，逐步畫 steps；完成先砌 result、error 就 throw */
  async function pollToDone(steps, body, jobId) {
    const started = Date.now();
    let canceled = false;
    cancelJob = () => {
      canceled = true;
      clearJobId();
    };
    renderProgress([...steps]);

    while (true) {
      if (canceled) throw new Error('已取消');
      if (Date.now() - started > JOB_MAX_MS) {
        clearJobId();
        throw new Error('等待逾時（10 分鐘），請稍後再試或重新提交');
      }
      await new Promise((r) => setTimeout(r, JOB_POLL_MS));

      let json;
      try {
        const r = await fetch(window.SW_API_BASE + '/api/result?id=' + encodeURIComponent(jobId));
        json = await r.json();
      } catch (e) {
        steps.push({ok: false, label: '輪詢失敗', detail: String((e && e.message) || e)});
        continue;                              /* 瞬時錯 → 下一 round 再試 */
      }
      if (!json || !json.ok) {
        const code = json && json.error && json.error.code;
        if (code === 'job_not_found' || code === 'job_expired') {
          clearJobId();
          steps.push({ok: false, label: code || 'job 失效', detail: (json.error && json.error.message) || ''});
          throw new Error((json.error && json.error.message) || '任務已失效，請重新提交');
        }
        continue;
      }

      const prog = (json.steps || []).map((s) => ({ ok: s.ok !== false, label: s.label, detail: jobDetail(s) }));
      steps.length = 0;
      steps.push(...prog);
      renderProgress(steps);

      if (json.status === 'error') {
        clearJobId();
        const msg = (json.error && json.error.message) || '任務失敗';
        steps.push({ok: false, label: '任務失敗', detail: msg});
        if (json.error && json.error.details && json.error.details.usd_spent) {
          steps.push({ok: false, label: '已花成本', detail: money(json.error.details.usd_spent)});
        }
        throw new Error(msg);
      }
      if (json.status === 'done') {
        /* 保留 job_id：版本對比要 reload 之後都睇得返（唔再 poll，只 render）。
           只有取消／逾時／job 失效／任務出錯才清。 */
        saveJobId(jobId);
        currentJobId = jobId;
        currentVersions = Array.isArray(json.versions) ? json.versions : [];
        selectedVersionId = '';
        versionError = '';
        const rb = json.result || {};
        const cost = rb.cost || {};
        steps.push({ok: true, label: '完成', detail: 'USD ' + money(cost.usd_total) + ' · ' +
          ((rb.result && rb.result.text) ? rb.result.text.length + ' 字' : '')});
        const out = buildResultFromBody(rb, body);
        out.html += versionSection();
        prefillInputFromVersion(currentVersions);
        return out;
      }
    }
  }

  /* 版本鏈：reload 之後 textarea 係空，令「再改寫」即刻 400 text_missing。
     所以 render 完如果輸入框空，就用最新版本嘅正文填返（等於「接住上一版繼續改」）。 */
  function prefillInputFromVersion(versions) {
    const t = document.querySelector('#inp_text');
    if (!t || String(t.value || '').trim()) return;
    const latest = (versions || [])[(versions || []).length - 1];
    const text = latest && latest.result && latest.result.text;
    if (!text) return;
    t.value = text;
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* reload 自動續：sessionStorage 仲有 active job_id 就重新 poll */
  async function resumeJob() {
    const id = readJobId();
    if (!id) return;
    const steps = [];
    open();
    headCost.textContent = '…';
    try {
      /* 已完成嘅 job：唔再 poll（會多 1.5s），直接攞結果 + 版本鏈 */
      const probe = await fetch(window.SW_API_BASE + '/api/result?id=' + encodeURIComponent(id));
      const pj = await probe.json().catch(() => null);
      if (pj && pj.ok && pj.status === 'done') {
        currentJobId = id;
        currentVersions = Array.isArray(pj.versions) ? pj.versions : [];
        selectedVersionId = '';
        versionError = '';
        const rb = pj.result || {};
        const out = buildResultFromBody(rb, body);
        out.html += versionSection();
        steps.push({ok: true, label: '已完成任務', detail: 'job ' + id.slice(0, 8) + ' · ' + currentVersions.length + ' 個版本'});
        body.innerHTML = stepList(steps) + out.html + (out.footerHtml || '');
        headCost.textContent = out.headerCost || '';
        bindVersionEvents();
        prefillInputFromVersion(currentVersions);
        return;
      }
      steps.push({ok: true, label: '重新接駁任務', detail: 'job ' + id.slice(0, 8) + '…'});
      const out = await pollToDone(steps, {}, id);
      body.innerHTML = stepList(steps) + out.html + (out.footerHtml || '');
      headCost.textContent = out.headerCost || '';
      bindVersionEvents();
    } catch (e) {
      steps.push({ok: false, label: '重駁失敗', detail: String((e && e.message) || e)});
      headCost.textContent = '錯誤';
      body.innerHTML = stepList(steps) + '<pre style="font-size:11.5px;color:var(--mark,#9B2C2C);white-space:pre-wrap">' + esc((e && e.message) || e) + '</pre>';
    }
  }

  /* ---------------- 各頁流程 ---------------- */
  const runs = {
    /* 一鍵發布 */
    async '1-click'(steps) {
      const kw = txt('#main_keyword') || 'seo tools';
      const country = selVal('target_country', 'United States');
      const langName = selVal('lang', 'English (US)');
      const live = !!selVal('serp');
      const loc = locFromName(country), lc = langFromName(langName);

      const t0 = performance.now();
      const serp = A.df.serp({keyword: kw, location_code: loc.location_code, language_code: lc,
                              depth: 10, mode: live ? 'live' : 'standard'});
      const items = serp.tasks[0].result[0].items;
      steps.push({ok: true, label: 'SERP top 10' + (live ? ' (live)' : ' (standard)'),
                  detail: kw + ' · ' + country + ' · ' + items.length + ' 條 · ' + (performance.now() - t0 | 0) + 'ms'});

      const urls = items.slice(0, 10).map(i => i.url);
      const op = A.df.instantPages({urls});
      const comps = (op.tasks[0].result[0].items || []).map(it => ({
        domain: it.domain, words: it.meta.content.plain_text_word_count,
        h2: it.meta.htags.h2.length, h3: it.meta.htags.h3.length,
        score: it.onpage_score
      }));
      steps.push({ok: op.status_code === 20000, label: 'instant_pages ×10',
                  detail: comps.length + ' 頁 · 平均 ' + Math.round(comps.reduce((a, c) => a + c.words, 0) / (comps.length || 1)) + ' 字'});

      /* AUTO 尺寸由競爭頁分佈推 */
      const avgW = comps.length ? Math.round(comps.reduce((a, c) => a + c.words, 0) / comps.length) : 0;
      const avgH2 = comps.length ? Math.round(comps.reduce((a, c) => a + c.h2, 0) / comps.length) : 0;

      /* 關鍵字：一次過（唔可以逐篇打）*/
      const kws = [kw].concat(serp.tasks[0].result[0].related_searches || []).slice(0, 150);
      const vol = A.df.keywordVolume({keywords: kws, location_code: loc.location_code, language_code: lc});
      const dif = A.labsBulkKeywordDifficulty(kws, {location_code: loc.location_code, language_code: lc});
      steps.push({ok: true, label: 'search_volume + difficulty',
                  detail: kws.length + ' 字（1 個 task）'});

      /* 搜尋資料：同一個 SERP 回應，唔額外打 */
      const paa = (serp.tasks[0].result[0].people_also_ask || [])[0];
      steps.push({ok: true, label: 'PAA / related / ai_overview',
                  detail: '同一個 SERP 回應（0 額外呼叫）'});

      let yt = null;
      if (selVal('video_quantity')) {
        yt = A.df.youtube({keyword: kw, location_code: loc.location_code, language_code: lc}).tasks[0].result[0].items;
        steps.push({ok: true, label: 'youtube', detail: yt.length + ' 條'});
      }

      const model = modelFromQuality(selVal('quality'));
      const llm = await A.providers.openrouter.chat({
        model: model.id, prompt: kw, location_code: loc.location_code, language_code: lc
      });
      steps.push({ok: true, label: 'OpenRouter 正文', detail: model.label + ' · ' + llm.meta.credits + ' credits · ' + llm.meta.words + ' 字'});

      let img = null;
      if (selVal('images')) {
        img = await A.providers.kie.generate({model: 1, prompt: kw});
        steps.push({ok: img.status === 1, label: 'kie.ai 圖片', detail: img.model + ' · ' + img.creditsConsumed + ' credits'});
      }

      return {
        html:
          section('AUTO 由 SERP 推導', '<div style="font-size:12.5px">字數 ≈ <b>' + avgW + '</b>　H2 ≈ <b>' + avgH2 + '</b>（原生 AUTO 顯示 2,400–3,600 字 / 9–12 H2）</div>') +
          section('SERP top 10', table(['#', 'domain', 'title'], items.slice(0, 10).map(i => [i.rank_absolute, i.domain, String(i.title).slice(0, 42)]))) +
          section('競爭對手（instant_pages）', table(['domain', '字數', 'H2', 'H3', '分數'], comps.map(c => [c.domain, c.words, c.h2, c.h3, c.score]))) +
          section('關鍵字（1 個 task）', table(['keyword', 'volume', 'difficulty'],
            (vol.tasks[0].result[0].items || []).slice(0, 8).map((v, i) => {
              const d = (dif.tasks[0].result[0].items || [])[i];
              return [v.keyword, v.search_volume, d ? d.keyword_difficulty : '—'];
            }))) +
          (paa ? section('PAA（同一個 SERP）', '<div style="font-size:12px">' + paa.items.map(x => '· ' + esc(x.title)).join('<br>') + '</div>') : '') +
          (yt ? section('YouTube', table(['#', 'title', 'views'], yt.map(v => [v.rank_absolute, String(v.title).slice(0, 38), v.views_count]))) : '') +
          section('正文（' + esc(model.label) + '）', '<pre style="white-space:pre-wrap;font-size:11.5px;max-height:160px;overflow:auto;background:var(--paper-2,#F4F2EC);padding:8px;border-radius:3px">' + esc(llm.choices[0].message.content.slice(0, 600)) + '</pre>') +
          (img && img.url ? section('圖片（' + esc(img.model) + '）', '<img src="' + img.url + '" alt="mock" style="max-width:100%;border:1px solid var(--rule,#E3DFD6);border-radius:3px">') : '')
      };
    },

    /* 批量生成 */
    async bulk(steps) {
      const raw = txt('#inp_kws');
      const list = raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).slice(0, 100);
      const kws = list.length ? list : ['seo tools', 'seo hong kong'];
      const country = selVal('target_country', 'United States');
      const langName = selVal('lang', 'English (US)');
      const loc = locFromName(country), lc = langFromName(langName);

      if (kws.length >= 100) steps.push({ok: true, label: '上限檢查', detail: '100 篇（原生 p<100 硬上限）'});

      /* SERP 逐個（demo 只跑前 3 個，其餘只計數）*/
      const demo = kws.slice(0, 3);
      const rows = [];
      for (const k of demo) {
        const r = A.df.serp({keyword: k, location_code: loc.location_code, language_code: lc, depth: 10});
        rows.push({kw: k, items: r.tasks[0].result[0].items});
      }
      steps.push({ok: true, label: 'SERP × ' + demo.length + '（示範）',
                  detail: '實際會打 ' + kws.length + ' 次（每篇 1 次）'});

      /* 關鍵字量 + 難度：全部一次過 */
      const vol = A.df.keywordVolume({keywords: kws, location_code: loc.location_code, language_code: lc});
      const dif = A.labsBulkKeywordDifficulty(kws, {location_code: loc.location_code, language_code: lc});
      steps.push({ok: true, label: 'search_volume（1 task）', detail: kws.length + ' 字 → 只 1 次呼叫'});
      steps.push({ok: true, label: 'difficulty（1 次）', detail: kws.length + ' 字 → $0.012 + ' + (kws.length * 0.00012).toFixed(4)});

      const firstUrls = rows[0].items.slice(0, 10).map(i => i.url);
      const op = A.df.instantPages({urls: firstUrls});
      steps.push({ok: op.status_code === 20000, label: 'instant_pages（第 1 個 keyword）',
                  detail: (op.tasks[0] && op.tasks[0].result[0].items.length) + ' 頁'});

      /* 預覽 1 篇文章（其餘 N-1 篇同款，唔重複計）*/
      const model = modelFromQuality(selVal('quality'));
      const llm = await A.providers.openrouter.chat({
        model: model.id, prompt: kws[0], location_code: loc.location_code, language_code: lc
      });
      steps.push({ok: true, label: 'OpenRouter 預覽文章',
                  detail: model.label + ' · ' + llm.meta.credits + ' credits × ' + kws.length + ' 篇'});

      const perArticle = 0.0006 + 0.0015;      /* serp + 10 頁 */
      const total = perArticle * kws.length + 0.06 + (0.012 + kws.length * 0.00012);
      return {
        html:
          section('批量估算', '<div style="font-size:12.5px">' + kws.length + ' 篇 · 關鍵字呼叫 <b>2 次</b>（唔係 ' +
            (kws.length * 2) + ' 次）· 估算 <b>' + money(total) + '</b></div>') +
          section('示範 SERP（前 3 個 keyword）', rows.map(r =>
            '<div style="font-size:12px;margin:4px 0"><b>' + esc(r.kw) + '</b> → ' + r.items.slice(0, 3).map(i => esc(i.domain)).join('、') + ' …</div>').join('')) +
          section('關鍵字（1 個 task）', table(['keyword', 'volume', 'difficulty'],
            (vol.tasks[0].result[0].items || []).slice(0, 10).map((v, i) => {
              const d = (dif.tasks[0].result[0].items || [])[i];
              return [v.keyword, v.search_volume, d ? d.keyword_difficulty : '—'];
            }))) +
          section('預覽文章（' + esc(llm.meta.seowriting_label) + '，其餘 ' + (kws.length - 1) + ' 篇同款）',
            '<pre style="white-space:pre-wrap;font-size:11.5px;max-height:150px;overflow:auto;background:var(--paper-2,#F4F2EC);padding:8px">' +
            esc(llm.choices[0].message.content.slice(0, 500)) + '</pre>')
      };
    },

    /* Super Page */
    async 'super-page'(steps) {
      const kw = txt('#inp_hero') || 'seo tools';
      const country = selVal('target_country', 'United States');
      const loc = locFromName(country), lc = langFromName(selVal('lang', 'English (US)'));

      const serp = A.df.serp({keyword: kw, location_code: loc.location_code, language_code: lc, depth: 10});
      const res = serp.tasks[0].result[0];
      steps.push({ok: true, label: 'SERP 全景', detail: res.items.length + ' 條 + PAA + related + AI Overview'});

      const model = modelFromQuality(selVal('quality'));
      const llm = await A.providers.openrouter.chat({model: model.id, prompt: kw + ' CTA page', location_code: loc.location_code});
      steps.push({ok: true, label: 'OpenRouter 文案', detail: model.label + ' · ' + llm.meta.credits + ' credits'});

      let img = null;
      if (selVal('images')) {
        img = await A.providers.kie.generate({model: 1, prompt: kw});
        steps.push({ok: img.status === 1, label: 'kie.ai 圖片', detail: img.model});
      }

      return {
        html:
          section('SERP top 10', table(['#', 'domain', 'title'], res.items.map(i => [i.rank_absolute, i.domain, String(i.title).slice(0, 40)]))) +
          section('PAA / related', '<div style="font-size:12px">' +
            (res.people_also_ask || []).flatMap(g => g.items).map(x => '· ' + esc(x.title)).join('<br>') + '<br>' +
            (res.related_searches || []).map(x => '· ' + esc(x)).join('<br>') + '</div>') +
          section('CTA 文案（' + esc(model.label) + '）', '<pre style="white-space:pre-wrap;font-size:11.5px;max-height:150px;overflow:auto;background:var(--paper-2,#F4F2EC);padding:8px">' + esc(llm.choices[0].message.content.slice(0, 500)) + '</pre>') +
          (img && img.url ? section('圖片', '<img src="' + img.url + '" style="max-width:100%;border:1px solid var(--rule,#E3DFD6)">') : '')
      };
    },

    /* 改寫工具 */
    async rewriter(steps) {
      const mode = selVal('mode', 'rewriter');
      const humanize = mode === 'humanizer';
      const text = txt('#inp_text');

      /* 真 API：同源 /api/rewrite（server-local.js 本機 / Vercel 上線都係同一條路） */
      if (window.SW_API_BASE) {
        try {
          const out = await realRewrite(steps, mode, text);
          setDrawerMode(true, '');
          return out;
        } catch (e) {
          /* 後端連唔上：今次先退 mock，但**唔清** SW_API_BASE —— 下次再按會再試真 API。
             （之前清咗就變永久 mock，令頁面之後一直顯示「模擬執行」。） */
          steps.push({ok: false, label: '真 API 失敗 → 今次改用模擬', detail: String((e && e.message) || e).slice(0, 120)});
          setDrawerMode(false, '後端連唔上');
        }
      }

      const kw = manualKeyword() || 'seo tools';
      const loc = locFromName(selVal('target_country', 'United States'));
      const lc = langFromName(selVal('lang', 'English (US)'));
      const model = modelFromSlug(selVal('model', '')) || modelFromQuality(selVal('quality'));

      if (!humanize) {
        const serp = A.df.serp({keyword: kw, location_code: loc.location_code, language_code: lc, depth: 10});
        steps.push({ok: true, label: 'SERP 目標結構', detail: 'top 10 用嚟定 H2/H3 與字數'});

        const urls = serp.tasks[0].result[0].items.slice(0, 10).map(i => i.url);
        const op = A.df.instantPages({urls});
        const items = op.tasks[0].result[0].items || [];
        const avgW = Math.round(items.reduce((a, c) => a + c.meta.content.plain_text_word_count, 0) / (items.length || 1));
        const avgH2 = Math.round(items.reduce((a, c) => a + c.meta.htags.h2.length, 0) / (items.length || 1));
        steps.push({ok: true, label: '競爭結構', detail: '平均 ' + avgW + ' 字 / ' + avgH2 + ' 個 H2'});

        const llm = await A.providers.openrouter.chat({model: model.label, credits: model.credits, prompt: 'rewrite: ' + (text.slice(0, 120) || kw)});
        steps.push({ok: true, label: 'OpenRouter 改寫', detail: model.label + ' · ' + llm.meta.credits + ' credits'});

        return {
          html: section('SERP 目標', table(['#', 'domain', '字數', 'H2'], items.slice(0, 8).map((c, i) => [
                    i + 1, c.domain, c.meta.content.plain_text_word_count, c.meta.htags.h2.length]))) +
                section('改寫結果（' + esc(model.label) + '）', '<pre style="white-space:pre-wrap;font-size:11.5px;max-height:170px;overflow:auto;background:var(--paper-2,#F4F2EC);padding:8px">' + esc(llm.choices[0].message.content.slice(0, 600)) + '</pre>')
        };
      }

      steps.push({ok: true, label: 'DataForSEO 呼叫', detail: '0 次（Humanizer 純文風）'});
      const llm = await A.providers.openrouter.chat({model: model.label, credits: model.credits, prompt: 'humanize: ' + (text.slice(0, 120) || 'text')});
      steps.push({ok: true, label: 'OpenRouter 人性化', detail: model.label + ' · ' + llm.meta.credits + ' credits'});
      return {
        html: section('人性化結果（' + esc(model.label) + '）',
          '<pre style="white-space:pre-wrap;font-size:11.5px;max-height:200px;overflow:auto;background:var(--paper-2,#F4F2EC);padding:8px">' + esc(llm.choices[0].message.content.slice(0, 700)) + '</pre>')
      };
    },

    /* 品牌聲音 */
    async 'brand-voice'(steps) {
      const url = txt('#bv-url');
      const text = txt('#bv-text');
      let sample = text;

      if (url) {
        const parsed = A.df.contentParsing({url});
        sample = parsed.tasks[0].result[0].items[0].page_as_markdown;
        steps.push({ok: true, label: 'content_parsing', detail: '1 個 request（原生 Live 只收 1 task）'});
      } else {
        steps.push({ok: true, label: '樣本來源', detail: '貼上文字（0 個 API 呼叫）'});
      }

      if (sample.length < 1000) {
        steps.push({ok: false, label: '樣本長度', detail: sample.length + ' 字元（最少 1,000）'});
        return {html: section('未能側寫', '<div style="font-size:12.5px">需要最少 1,000 字元樣本；現有 ' + sample.length + '。</div>')};
      }

      const bv = await A.providers.openrouter.brandVoice({text: sample, model: 101});
      steps.push({ok: bv.status === 1, label: 'OpenRouter 側寫', detail: bv.elements_count + ' elements · ' + bv.meta.credits + ' credits'});

      return {
        html: section('品牌聲音（' + bv.elements_count + ' / ' + bv.cap + ' elements）',
          table(['#', 'element', '傾向', '信心'], bv.elements.map(e => [e.id, e.name, e.value, e.confidence])))
      };
    }
  };

  /* ---------------- 綁定按鈕 ---------------- */
  /* 品牌聲音頁唔掛原生 #save-voice：頁面自己嘅儲存流程同 mock 同時跑會卡死，
     改用我哋自己嘅浮動按鈕，唔影響原生行為。 */
  function injectBrandVoiceButton() {
    if (document.getElementById('mock-bv-btn')) return;
    const b = document.createElement('button');
    b.id = 'mock-bv-btn';
    b.type = 'button';
    b.textContent = '模擬側寫';
    b.style.cssText = [
      'position:fixed', 'left:16px', 'bottom:16px', 'z-index:9998',
      'font:13px/1 "Noto Sans TC",system-ui,sans-serif', 'padding:10px 14px',
      'border:1px solid var(--mark,#9B2C2C)', 'background:var(--mark,#9B2C2C)', 'color:#fff',
      'border-radius:3px', 'cursor:pointer', 'box-shadow:0 6px 18px -10px rgba(0,0,0,.5)'
    ].join(';');
    document.body.appendChild(b);
    b.addEventListener('click', () => trigger(b));
    return b;
  }

  function bindRun() {
    if (PAGE === 'brand-voice') { injectBrandVoiceButton(); return; }
    const btn = document.querySelector('#run');
    if (!btn) return;
    btn.addEventListener('click', () => trigger(btn), true);   /* capture：先過我哋 */
    /* ADR-5：reload 之後 sessionStorage 仲有未完 job → 自動接返同一個 job，唔使重新提交 */
    if (PAGE === 'rewriter' && window.SW_API_BASE && readJobId()) resumeJob();
  }

  async function trigger(btn) {
      if (btn.disabled) return;                       /* 頁面自己擋（升級閘 / 超限）就唔跑 */
      const before = A.usage();
      const steps = [];
      open();
      setDrawerMode(false, '');
      body.innerHTML = '<div style="font-size:12.5px;color:var(--ink-3,#767C87)">跑緊…</div>';
      headCost.textContent = '…';
      try {
        const out = await runs[PAGE](steps);
        const after = A.usage();
        const usd = +(after.total_usd - before.total_usd).toFixed(6);
        const cr = +(after.credits - before.credits).toFixed(3);
        headCost.textContent = (out && out.headerCost) ? out.headerCost : 'USD ' + money(usd) + ' · credits ' + cr;
        body.innerHTML = stepList(steps) + out.html + ((out && out.footerHtml) ? out.footerHtml :
          '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--rule-2,#EFEBE2);font-family:ui-monospace,monospace;font-size:11px;color:var(--ink-3,#767C87)">' +
            '本次：USD ' + money(usd) + ' ＋ ' + cr + ' credits　｜　累計：USD ' + money(after.total_usd) + ' ＋ ' + after.credits + ' credits</div>');
        bindVersionEvents();
      } catch (e) {
        headCost.textContent = '錯誤';
        body.innerHTML = stepList(steps) + '<pre style="font-size:11.5px;color:var(--mark,#9B2C2C);white-space:pre-wrap">' + esc(e && e.message || e) + '</pre>';
      }
  }

  /* 靜態 host（GitHub Pages 等）冇後端 → 一開頁就講清楚，免得用戶以為「按咗但冇反應」。 */
  function showStaticBanner() {
    if (window.SW_API_BASE) return;
    if (document.getElementById('static-note')) return;
    const el = document.createElement('div');
    el.id = 'static-note';
    el.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9998;max-width:min(420px,calc(100vw - 32px));' +
      'padding:8px 10px;border:1px solid var(--rule,#E3DFD6);border-left:3px solid var(--ochre,#8A6100);' +
      'background:var(--card,#fff);color:var(--ink-2,#3A3F47);font:12px/1.5 "Noto Sans TC",system-ui,sans-serif;border-radius:4px';
    el.innerHTML = '<strong>靜態預覽</strong>：呢頁冇後端，所以執行結果係模擬。' +
      '要跑真 API 請用本機 adapter（127.0.0.1:8787）或 Vercel 部署。';
    document.body.appendChild(el);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { bindRun(); showStaticBanner(); });
  } else {
    bindRun();
    showStaticBanner();
  }
})();
