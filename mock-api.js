/*!
 * mock-api.js — seowriting.ai 16 個 aj 動作 + WebSocket 前綴協議嘅離線模擬層
 * 對應 docs/reverse-engineering/DATA-FLOW.md（§4 action、§5 WS、§7 store）
 * 零依賴、可離線、可用 file:// 直接開。
 *
 * 用法：
 *   <script src="mock-api.js"></script>
 *   const r = await MockAPI.post(window.sw.url, {aj:'rewrite', text:'…'});
 *   MockAPI.onFrame(f => …)            // 收 pa:/pb:/gt: 推送
 *   MockAPI.run()                       // 全部 16 個動作跑一次（self-test）
 */
(function (global) {
  'use strict';

  /* ---------- 決定性隨機（同一個 seed 出同一份資料）---------- */
  function rng(seed) {
    let s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  let rand = rng(20261025);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const int = (a, b) => a + Math.floor(rand() * (b - a + 1));

  /* ---------- 預設資料（全部虛構，唔含真實帳戶）---------- */
  const COUNTRIES = ['United States', 'United Kingdom', 'Hong Kong', 'Singapore', 'Canada', 'Australia', 'Germany', 'Japan', 'Taiwan', 'Malaysia'];
  const LANGS = ['English (US)', 'English (UK)', 'Chinese (Traditional)', 'Chinese (Simplified)', 'Japanese', 'Korean', 'German', 'French', 'Spanish', 'Vietnamese'];
  const READABILITY = [
    {id: 1, name: '5th grade, easily understood by 11-year-olds'},
    {id: 2, name: '6th grade, conversational language'},
    {id: 3, name: '7th grade, fairly easy to read'},
    {id: 4, name: '8th grade, plain language'},
    {id: 5, name: '9th grade, fairly difficult'},
    {id: 6, name: '10th grade, difficult to read'},
    {id: 7, name: '11th grade, very difficult'},
    {id: 8, name: '12th grade, college level'}
  ];
  const IMG_MODELS = [
    {id: 1, name: 'Z-Image', credits: 0},
    {id: 2, name: 'FLUX.1 Schnell', credits: 0},
    {id: 3, name: 'GPT Image 2.5', credits: 2.5},
    {id: 4, name: 'Nano Banana 2', credits: 10}
  ];
  const TITLES = [
    '2026 香港中小企 SEO 實戰指南',
    '點樣用批量生成撐起 100 頁地區落地頁',
    '品牌聲音（Brand Voice）令 AI 寫得像你',
    'Super Page 同一般落地頁嘅分別',
    '改寫工具實測：5,000 字上限下嘅品質變化'
  ];

  /* ---------- 狀態 ---------- */
  /* DataForSEO 實價（2026-10-25 官方回覆）*/
  const COST = {
    serp_standard: 0.0006,   // Standard priority 1，advanced 唔加價
    serp_priority: 0.0012,   // Standard priority 2
    serp_live: 0.002,
    onpage_page: 0.00015,    // instant_pages / content_parsing 每 task
    keyword_task: 0.06,      // Google Ads search_volume 每個 task
    paa_click: 0.00015
  };

  const state = {
    seq: 1000,
    tasks: {},                 // task_id -> {aj, status, started, result}
    docs: [],                  // 文件庫
    voices: [
      {id: 11, name: '示例品牌 · 專業', elements: 8, words: 1240},
      {id: 12, name: '示例品牌 · 輕鬆', elements: 6, words: 980}
    ],
    credits: 100,
    log: [],
    failNext: {},              // aj -> error_code
    latency: 260,
    autoEvents: 0,
    usage: {total_usd: 0, by_item: {}}
  };

  function charge(item, units, unitUsd) {
    const usd = units * unitUsd;
    state.usage.total_usd += usd;
    state.usage.by_item[item] = (state.usage.by_item[item] || 0) + usd;
    return +usd.toFixed(6);
  }

  function nextId(prefix) { state.seq += 7; return prefix + state.seq; }
  function nowIso() { return new Date().toISOString(); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ---------- WebSocket 前綴協議模擬 ---------- */
  const frameSubs = new Set();
  const callSubs = new Set();
  function onCall(fn) { callSubs.add(fn); return () => callSubs.delete(fn); }
  function emitFrame(prefix, payload) {
    state.autoEvents++;
    const frame = prefix + JSON.stringify(payload);
    frameSubs.forEach(fn => { try { fn(frame, prefix, payload); } catch (e) { /* ignore */ } });
    return frame;
  }
  function onFrame(fn) { frameSubs.add(fn); return () => frameSubs.delete(fn); }

  /* ---------- 動作實作 ---------- */
  function docFor(id) { return state.docs.find(d => d.id === id); }

  const HANDLERS = {
    run(body) {
      const doc = {
        id: nextId('doc_'),
        title: body.prompt ? String(body.prompt).slice(0, 80) : pick(TITLES),
        tool: 'super-page',
        status: 'running',
        words: 0,
        target_place: body.target_place || 'United States',
        brand_voice: body.brand_voice || null,
        img_generator: body.img_generator || null,
        created_at: nowIso()
      };
      state.docs.unshift(doc);
      charge('serp_standard', 1, COST.serp_standard);
      charge('onpage_page', 10, COST.onpage_page);
      charge('keyword_task', 1, COST.keyword_task);
      const task_id = nextId('task_');
      state.tasks[task_id] = {aj: 'run', status: 'running', doc: doc.id};
      setTimeout(() => {
        const words = int(2400, 3600);
        doc.status = 'completed';
        doc.words = words;
        state.tasks[task_id].status = 'completed';
        state.tasks[task_id].result = {doc_id: doc.id, words};
        emitFrame('pa:', {gen_tasks: state.docs.filter(d => d.status === 'running').length});
        emitFrame('gt:', {task_id: task_id, status: 'completed', doc_id: doc.id, words: words});
      }, state.latency * 6);
      return {status: 1, task_id: task_id, doc_id: doc.id};
    },

    rewrite(body) {
      if (!body.text) return {status: 0, error: 'Input Text field cannot be empty'};
      const task_id = nextId('task_');
      state.tasks[task_id] = {aj: 'rewrite', status: 'running'};
      setTimeout(() => {
        const words = String(body.text).trim().split(/\s+/).filter(Boolean).length || 120;
        const result = {
          task_id: task_id,
          status: 'completed',
          html: '<p>' + String(body.text).slice(0, 400) + ' …（已按 SERP 改寫）</p>',
          score: int(72, 94),
          words: words
        };
        state.tasks[task_id].status = 'completed';
        state.tasks[task_id].result = result;
        emitFrame('gt:', result);
      }, state.latency * 5);
      return {status: 1, task_id: task_id};
    },

    humanize(body) {
      if (!body.text) return {status: 0, error: 'Input Text field cannot be empty'};
      const task_id = nextId('task_');
      state.tasks[task_id] = {aj: 'humanize', status: 'running'};
      setTimeout(() => {
        const result = {
          task_id: task_id,
          status: 'completed',
          html: '<p>' + String(body.text).slice(0, 400) + ' …（已自然化）</p>',
          words: String(body.text).trim().split(/\s+/).filter(Boolean).length
        };
        state.tasks[task_id].status = 'completed';
        state.tasks[task_id].result = result;
        emitFrame('gt:', result);
      }, state.latency * 4);
      return {status: 1, task_id: task_id};
    },

    'get-result'(body) {
      const t = state.tasks[body.task_id];
      if (!t) return {status: 0, error: 'Task not found'};
      if (t.status !== 'completed') return {status: 0, error: 'Task is still running'};
      return {status: 1, task_id: body.task_id, data: t.result, html: t.result && t.result.html};
    },

    'get-version'(body) {
      const doc = state.docs.find(d => d.versions && d.versions.some(v => v.id === body.version)) || state.docs[0];
      const content = doc ? '<h2>' + doc.title + '</h2><p>版本內容（模擬）…</p>' : '<p>（模擬內容）</p>';
      return {status: 1, data: {content: content, doc_version_id: body.version || nextId('ver_')}};
    },

    'approve-version'(body) {
      const d = docFor(body.doc_id) || state.docs[0];
      if (d) d.status = 'completed';
      return {status: 1, version_id: body.version_id, approved: true};
    },

    'reject-version'(body) {
      return {status: 1, version_id: body.version_id, rejected: true};
    },

    update(body) {
      const d = docFor(body.doc_id) || state.docs[0];
      if (d && body.name) {
        if (body.name === 'title' || body.name === 'name') d.title = String(body.value).slice(0, 120);
        if (body.name === 'description') d.description = String(body.value).slice(0, 300);
        if (body.name === 'content') d.words = String(body.value).trim().split(/\s+/).filter(Boolean).length;
      }
      return {status: 1, saved: true, field: body.name, at: nowIso()};
    },

    'set-score'(body) {
      const d = docFor(body.doc_id) || state.docs[0];
      if (d) { d.score = Number(body.score) || 0; d.words = Number(body.words) || d.words; }
      return {status: 1, score: Number(body.score) || 0, words: Number(body.words) || 0};
    },

    get_competitors() {
      const n = int(6, 10);
      const competitors = Array.from({length: n}, (_, i) => ({
        rank_group: i + 1,
        rank_absolute: i + 1,
        type: i === 0 ? 'featured_snippet' : 'organic',
        url: 'https://example-' + (i + 1) + '.com/' + pick(['guide', 'review', 'how-to', 'best']),
        domain: 'example-' + (i + 1) + '.com',
        title: pick(TITLES),
        description: 'Competitor page snippet (mock).',
        checked: i < 3 ? 1 : 0,
        /* 以下三個係 DataForSEO 真實欄位名 */
        onpage_score: int(48, 92),
        word_count: int(800, 3200),
        h2_count: int(5, 14),
        h3_count: int(2, 9),
        images_count: int(0, 12),
        readability: {flesch_kincaid_readability_index: +(int(600, 1400) / 100).toFixed(2)}
      }));
      const cost_usd = charge('serp_standard', 1, COST.serp_standard) +
                       charge('onpage_page', n, COST.onpage_page);
      return {status: 1, competitors: competitors,
              meta: {engine: 'google', mode: 'standard/advanced + instant_pages', cost_usd: cost_usd}};
    },

    'get-serp-data'() {
      const items = Array.from({length: 10}, (_, i) => ({
        rank_group: i + 1,
        rank_absolute: i + 1,
        type: i === 0 ? 'featured_snippet' : 'organic',
        url: 'https://serp-example-' + (i + 1) + '.com',
        domain: 'serp-example-' + (i + 1) + '.com',
        title: pick(TITLES),
        description: 'SERP snippet (mock).',
        breadcrumb: 'serp-example-' + (i + 1) + '.com › blog'
      }));
      const cost_usd = charge('serp_standard', 1, COST.serp_standard);
      return {
        status: 1,
        serp: {
          items: items,
          people_also_ask: [
            {type: 'people_also_ask', items: [
              {title: 'SEO 工具邊隻好？', expanded_element: [{type: 'people_also_ask_element', title: '免費 SEO 工具夠唔夠用？'}]},
              {title: '幾耐做一次 SEO audit？'}
            ]}
          ],
          related_searches: ['seo tools free', 'seo tools hong kong', 'seo audit checklist'],
          ai_overview: {present: true, items: [{type: 'ai_overview_element', text: 'AI Overview snippet (mock).'}]},
          fetched_at: nowIso()
        },
        meta: {engine: 'google', endpoint: 'organic/live|task_get/advanced', cost_usd: cost_usd}
      };
    },

    'refresh-serp'() {
      const task_id = nextId('task_');
      state.tasks[task_id] = {aj: 'refresh-serp', status: 'running'};
      const cost_usd = charge('serp_standard', 1, COST.serp_standard);
      setTimeout(() => {
        const result = {
          task_id: task_id,
          status: 'completed',
          serp: {
            items: Array.from({length: 10}, (_, i) => ({
              rank_group: i + 1, rank_absolute: i + 1,
              type: 'organic',
              url: 'https://fresh-' + (i + 1) + '.com',
              domain: 'fresh-' + (i + 1) + '.com',
              title: pick(TITLES)
            })),
            fetched_at: nowIso()
          },
          meta: {cost_usd: cost_usd}
        };
        state.tasks[task_id].status = 'completed';
        state.tasks[task_id].result = result;
        emitFrame('gt:', result);
      }, state.latency * 4);
      return {status: 1, task_id: task_id};
    },

    seoscore(body) {
      return {status: 1, saved: true, score: int(60, 95), payload_keys: Object.keys(body.data || {})};
    },

    'text-to-image'(body) {
      const label = String(body.prompt || 'image').slice(0, 40).replace(/[<>&]/g, '');
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">' +
        '<rect width="640" height="400" fill="#F4F2EC"/><rect x="16" y="16" width="608" height="368" fill="none" stroke="#E3DFD6"/>' +
        '<text x="320" y="190" font-family="monospace" font-size="20" fill="#4C525C" text-anchor="middle">MOCK IMAGE</text>' +
        '<text x="320" y="222" font-family="monospace" font-size="14" fill="#767C87" text-anchor="middle">' + label + '</text></svg>';
      return {
        status: 1,
        data: {
          url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
          width: 640, height: 400,
          model: body.img_generator || 'Z-Image',
          style: body.style || 'natural',
          size: body.size || '1024x1024'
        }
      };
    },

    unsplash(body) {
      const q = String(body.query || 'office');
      return {
        status: 1,
        data: {
          results: Array.from({length: 9}, (_, i) => ({
            id: 'mock_' + i,
            alt: q + ' #' + (i + 1),
            author: pick(['示例攝影師 A', '示例攝影師 B', '示例攝影師 C']),
            thumb: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140"><rect width="200" height="140" fill="#E3DFD6"/><text x="100" y="76" font-family="monospace" font-size="12" fill="#767C87" text-anchor="middle">' + (i + 1) + '</text></svg>')
          })),
          total: 9,
          page: Number(body.page) || 1
        }
      };
    },

    location(body) {
      const q = String(body.q || '').toLowerCase();
      const options = COUNTRIES
        .filter(c => !q || c.toLowerCase().indexOf(q) !== -1)
        .map((c, i) => ({id: i + 1, name: c, code: c.slice(0, 2).toUpperCase()}));
      return {status: 1, options: options.length ? options : COUNTRIES.map((c, i) => ({id: i + 1, name: c}))};
    }
  };

  /* ---------- 對外 API ---------- */
  const ACTIONS = Object.keys(HANDLERS);

  async function post(url, body) {
    body = body || {};
    const aj = body.aj;
    const started = performance.now();
    await sleep(state.latency + int(0, 120));

    let response;
    if (!aj) {
      response = {status: 0, error: 'Missing aj action'};
    } else if (!HANDLERS[aj]) {
      response = {status: 0, error: 'Unknown action: ' + aj, error_code: 404};
    } else if (state.failNext[aj]) {
      const code = state.failNext[aj];
      delete state.failNext[aj];
      response = code === 201
        ? {status: 0, error_code: 201, error: 'You have no credits left'}
        : code === 1
          ? {status: 0, error_code: 1, error: 'Rewriting already in progress.'}
          : {status: 0, error_code: code, error: 'Mock injected error ' + code};
    } else {
      response = HANDLERS[aj](body);
    }

    const entry = {
      at: new Date().toISOString(),
      action: aj || '(none)',
      url: url || '(no url)',
      payload: body,
      response: response,
      ms: Math.round(performance.now() - started)
    };
    state.log.push(entry);
    callSubs.forEach(fn => { try { fn(entry); } catch (e) { /* ignore */ } });
    return response;
  }

  /* 全部 16 個動作跑一次，回報每個 action 嘅形狀檢查 */
  const DEFAULT_PAYLOADS = {
    run: {prompt: '2026 香港 SEO 指南', target_place: 'Hong Kong'},
    rewrite: {text: 'This is a sample paragraph that should be rewritten using SERP insights.', main_keyword: 'seo hong kong', lang: 'English (US)', target_place: 'Hong Kong', instructions: 'Shorten it.'},
    humanize: {text: 'This text should sound more natural after humanizing.', lang: 'English (US)', rm_words: false, readability: 4},
    'get-result': {task_id: 'task_none'},
    'get-version': {version: 'ver_1'},
    'approve-version': {version_id: 'ver_1'},
    'reject-version': {version_id: 'ver_1'},
    update: {name: 'title', value: 'Mock 標題'},
    'set-score': {score: 82, words: 2100},
    get_competitors: {},
    'get-serp-data': {},
    'refresh-serp': {},
    seoscore: {data: {title: 'x', description: 'y'}, keywords: [{value: 'seo', min: 3, max: 6}], links: [1, 2]},
    'text-to-image': {prompt: 'a desk with notebook', style: 'natural', size: '1024x1024', img_generator: 'Z-Image'},
    unsplash: {query: 'desk', page: 1},
    location: {q: 'hong'}
  };

  const EXPECT = {
    run: r => r.status === 1 && typeof r.task_id === 'string',
    rewrite: r => r.status === 1 && typeof r.task_id === 'string',
    humanize: r => r.status === 1 && typeof r.task_id === 'string',
    'get-result': r => typeof r.status === 'number',
    'get-version': r => r.status === 1 && !!r.data && typeof r.data.content === 'string',
    'approve-version': r => r.status === 1,
    'reject-version': r => r.status === 1,
    update: r => r.status === 1 && r.saved === true,
    'set-score': r => r.status === 1 && typeof r.score === 'number',
    get_competitors: r => r.status === 1 && Array.isArray(r.competitors) && r.competitors.length > 0,
    'get-serp-data': r => r.status === 1 && !!r.serp && Array.isArray(r.serp.items),
    'refresh-serp': r => r.status === 1 && typeof r.task_id === 'string',
    seoscore: r => r.status === 1,
    'text-to-image': r => r.status === 1 && !!r.data && /^data:image\//.test(r.data.url),
    unsplash: r => r.status === 1 && Array.isArray(r.data.results) && r.data.results.length === 9,
    location: r => r.status === 1 && Array.isArray(r.options) && r.options.length > 0
  };

  async function run() {
    const results = [];
    for (const aj of ACTIONS) {
      const t0 = performance.now();
      const res = await post('mock://' + aj, Object.assign({aj: aj}, DEFAULT_PAYLOADS[aj] || {}));
      let ok = false;
      try { ok = !!(EXPECT[aj] && EXPECT[aj](res)); } catch (e) { ok = false; }
      results.push({ajax: aj, ok: ok, ms: Math.round(performance.now() - t0), response: res});
    }
    return results;
  }

  global.MockAPI = {
    post: post,
    run: run,
    actions: ACTIONS,
    defaultPayloads: DEFAULT_PAYLOADS,
    onFrame: onFrame,
    onCall: onCall,
    emitFrame: emitFrame,          // 測試用：手動推一個 pa:/pb:/gt: frame
    expect: EXPECT,
    state: state,
    log: state.log,
    reset: function () {
      state.seq = 1000; state.tasks = {}; state.docs = [];
      state.log.length = 0;   /* 唔可以重新賦值，MockAPI.log 係同一個 array 嘅引用 */
      state.credits = 100; state.failNext = {}; state.autoEvents = 0;
      state.usage = {total_usd: 0, by_item: {}};
      rand = rng(20261025);
    },
    setLatency: function (ms) { state.latency = Math.max(0, Number(ms) || 0); },
    costs: COST,
    usage: function () {
      const by = {};
      Object.keys(state.usage.by_item).forEach(k => { by[k] = +state.usage.by_item[k].toFixed(6); });
      return {total_usd: +state.usage.total_usd.toFixed(6), by_item: by};
    },
    fail: function (aj, code) { state.failNext[aj] = Number(code) || 201; },
    /* 給頁面用：模擬 window.sw 契約 */
    sw: function (page) {
      return {
        url: 'https://seowriting.ai' + (page || '/tools/rewriter'),
        ws: 'wss://seowriting.ai:9502',
        apps: {editor: {id: 'root'}},
        credits: state.credits,
        sidebar: {profile: {id: '0', name: '示例帳戶', email: 'demo@example.com', letters: '示'}, builder: state.docs.length, news: 0, tariff: {group: 'Free'}},
        languages: LANGS.reduce((o, l) => (o[l] = l, o), {}),
        readability_options: READABILITY,
        generation_data: {countries: COUNTRIES, img_generators: IMG_MODELS},
        brand_voices: state.voices,
        data: {}
      };
    },
    meta: {countries: COUNTRIES, languages: LANGS, readability: READABILITY, imgModels: IMG_MODELS, titles: TITLES}
  };
})(window);
