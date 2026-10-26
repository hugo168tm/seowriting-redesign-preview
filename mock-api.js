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
    labs_task: 0.012,        // Labs「ALL OTHER ENDPOINTS」每個 task
    labs_item: 0.00012,      // …而且每個 keyword 再計
    paa_click: 0.00015,
    serp_youtube: 0.002     // YouTube SERP Live（假設同 Google Live 同價，待官方頁確認）
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
    if (typeof unitUsd !== 'number' || !isFinite(unitUsd)) unitUsd = 0;
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

  /* ---------- DataForSEO Labs：bulk keyword difficulty（原生 app 冇，係新產品要加嘅呼叫）---------- */
  function labsBulkKeywordDifficulty(keywords, opts) {
    opts = opts || {};
    const list = (Array.isArray(keywords) ? keywords : [keywords]).slice(0, 1000);
    const started = performance.now();
    const taskCost = charge('labs_task', 1, COST.labs_task);
    const itemCost = charge('labs_keyword_difficulty', list.length, COST.labs_item);
    const items = list.map(k => ({
      se_type: 'google',
      keyword: String(k).toLowerCase(),
      keyword_difficulty: int(3, 92)          // 0-100 對數尺度
    }));
    const response = {
      version: '0.1.mock',
      status_code: 20000,
      status_message: 'Ok.',
      cost: +(taskCost + itemCost).toFixed(6),
      tasks_count: 1,
      tasks_error: 0,
      tasks: [{
        id: nextId('labs_'),
        status_code: 20000,
        status_message: 'Ok.',
        path: ['v3', 'dataforseo_labs', 'google', 'bulk_keyword_difficulty', 'live'],
        data: {
          api: 'dataforseo_labs',
          function: 'bulk_keyword_difficulty',
          se_type: 'google',
          location_code: opts.location_code || 2840,
          language_code: opts.language_code || 'en',
          keywords: list
        },
        result: [{
          se_type: 'google',
          location_code: opts.location_code || 2840,
          language_code: opts.language_code || 'en',
          total_count: items.length,
          items_count: items.length,
          items: items
        }]
      }]
    };
    state.log.push({
      at: new Date().toISOString(),
      action: 'labs:bulk_keyword_difficulty',
      url: 'https://api.dataforseo.com/v3/dataforseo_labs/google/bulk_keyword_difficulty/live',
      payload: {keywords: list, location_code: opts.location_code || 2840, language_code: opts.language_code || 'en'},
      response: response,
      ms: Math.round(performance.now() - started)
    });
    callSubs.forEach(fn => { try { fn(state.log[state.log.length - 1]); } catch (e) { /* ignore */ } });
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

  /* ==================================================================
   * DataForSEO 端點層 — 「其他工具」（PHP 表單那批）實際要打嘅呼叫
   * 每個都回官方 envelope shape：{version,status_code,cost,tasks:[{...,result:[...]}]}
   * 價格同官方定價頁一致（2026-10-25）
   * ================================================================== */

  function dfoEnvelope(pathArr, data, result, cost) {
    return {
      version: '0.1.mock',
      status_code: 20000,
      status_message: 'Ok.',
      cost: +Number(cost).toFixed(6),
      tasks_count: 1,
      tasks_error: 0,
      tasks: [{
        id: nextId('dfo_'),
        status_code: 20000,
        status_message: 'Ok.',
        path: pathArr,
        data: data,
        result: [result]
      }]
    };
  }

  function hostOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return String(u); }
  }

  const DF = {
    /* GET /v3/serp/google/locations — 免費 */
    locations() {
      return dfoEnvelope(['v3', 'serp', 'google', 'locations'],
        {api: 'serp', function: 'locations', se: 'google'},
        {location_type: 'Country', items: COUNTRIES.map((c, i) => ({
          location_code: 2000 + i, location_name: c,
          country_iso_code: c.slice(0, 2).toUpperCase(),
          location_type: 'Country', location_code_parent: null
        }))}, 0);
    },

    /* GET /v3/serp/google/languages — 免費 */
    languages() {
      return dfoEnvelope(['v3', 'serp', 'google', 'languages'],
        {api: 'serp', function: 'languages', se: 'google'},
        {items: LANGS.map(l => ({language_name: l, language_code: l.slice(0, 2).toLowerCase()}))}, 0);
    },

    /* POST /v3/serp/google/organic/live/advanced（或 standard task_post）
       opts: {keyword, location_code=2840, language_code='en', device='desktop',
              depth=10, priority=1, mode='standard'|'live'} */
    serp(opts) {
      opts = opts || {};
      const depth = Math.min(Number(opts.depth) || 10, 200);
      const priority = Number(opts.priority) || 1;
      const mode = opts.mode === 'live' ? 'live' : 'standard';
      let unit = mode === 'live' ? COST.serp_live : (priority === 2 ? COST.serp_priority : COST.serp_standard);
      // depth 超過 10：每多一頁（10 個結果）加一個 SERP 費用
      const pages = Math.ceil(depth / 10);
      const cost = unit * pages;
      charge(mode === 'live' ? 'serp_live' : 'serp_standard', pages, unit);

      const items = Array.from({length: depth}, (_, i) => ({
        type: i === 0 ? 'featured_snippet' : (i === 4 ? 'people_also_ask' : 'organic'),
        rank_group: i + 1,
        rank_absolute: i + 1,
        domain: 'competitor-' + (i + 1) + '.com',
        title: 'Competitor ' + (i + 1) + ' — ' + (opts.keyword || 'seo'),
        url: 'https://competitor-' + (i + 1) + '.com/article-' + (i + 1),
        description: 'Snippet (mock) for rank ' + (i + 1) + '.',
        breadcrumb: 'competitor-' + (i + 1) + '.com › blog'
      }));
      const result = {
        keyword: opts.keyword || 'seo tools',
        type: 'organic',
        se_domain: 'google.com',
        location_code: Number(opts.location_code) || 2840,
        language_code: opts.language_code || 'en',
        check_url: 'https://www.google.com/search?q=' + encodeURIComponent(opts.keyword || 'seo tools'),
        datetime: nowIso(),
        spell: null,
        item_types: ['featured_snippet', 'organic', 'people_also_ask', 'related_searches', 'ai_overview'],
        se_results_count: 12300000,
        items: items,
        people_also_ask: [{type: 'people_also_ask', items: [
          {type: 'people_also_ask_element', title: 'SEO 工具邊隻好？'},
          {type: 'people_also_ask_element', title: '免費 SEO 工具夠唔夠？'}
        ]}],
        related_searches: ['seo tools free', 'seo tools hong kong', 'seo audit checklist'],
        ai_overview: {type: 'ai_overview', items: [{type: 'ai_overview_element', text: 'AI Overview (mock).'}]}
      };
      return dfoEnvelope(
        ['v3', 'serp', 'google', 'organic', mode === 'live' ? 'live' : 'task_post', 'advanced'],
        {api: 'serp', function: 'organic', se: 'google', keyword: opts.keyword,
         location_code: Number(opts.location_code) || 2840, language_code: opts.language_code || 'en',
         device: opts.device || 'desktop', depth: depth, priority: priority},
        result, cost);
    },

    /* POST /v3/on_page/instant_pages
       opts: {urls:[...]} — 一 request 最多 20 tasks；同 domain 最多 5 條 */
    instantPages(opts) {
      opts = opts || {};
      const urls = (Array.isArray(opts.urls) ? opts.urls : [opts.urls]).filter(Boolean);
      const seen = {};
      const overDomain = [];
      urls.forEach(u => { const h = hostOf(u); seen[h] = (seen[h] || 0) + 1; if (seen[h] > 5) overDomain.push(h); });
      if (urls.length > 20) {
        return {version: '0.1.mock', status_code: 40501, status_message: 'Too many tasks in one request (max 20).',
                tasks_count: 0, tasks_error: 0, tasks: [], cost: 0};
      }
      if (overDomain.length) {
        return {version: '0.1.mock', status_code: 40501,
                status_message: 'Duplicate crawl host: more than 5 URLs of the same domain in one request (' + overDomain[0] + '). Split into sequential batches.',
                tasks_count: 0, tasks_error: 0, tasks: [], cost: 0};
      }
      const cost = charge('onpage_page', urls.length, COST.onpage_page);
      const items = urls.map(u => ({
        url: u,
        domain: hostOf(u),
        onpage_score: int(48, 95),
        meta: {
          title: 'Mock page ' + hostOf(u),
          htags: {h1: [1], h2: Array.from({length: int(5, 14)}, (_, i) => 'H2 ' + (i + 1)),
                  h3: Array.from({length: int(2, 9)}, (_, i) => 'H3 ' + (i + 1))},
          images_count: int(0, 18),
          content: {
            plain_text_word_count: int(800, 3600),
            flesch_kincaid_readability_index: +(int(600, 1400) / 100).toFixed(2),
            automated_readability_index: +(int(600, 1500) / 100).toFixed(2)
          }
        }
      }));
      return dfoEnvelope(['v3', 'on_page', 'instant_pages'],
        {api: 'on_page', function: 'instant_pages', urls: urls},
        {crawl_progress: 'finished', crawl_status: 200, items_count: items.length, items: items}, cost);
    },

    /* POST /v3/keywords_data/google_ads/search_volume/task_post（Standard 每個 task $0.06）*/
    keywordVolume(opts) {
      opts = opts || {};
      const list = (Array.isArray(opts.keywords) ? opts.keywords : [opts.keywords]).slice(0, 1000);
      const cost = charge('keyword_task', 1, COST.keyword_task);
      const items = list.map(k => ({
        keyword: String(k),
        location_code: Number(opts.location_code) || 2840,
        language_code: opts.language_code || 'en',
        search_volume: int(40, 40000),
        competition: pick(['LOW', 'MEDIUM', 'HIGH']),
        competition_index: int(1, 100),
        low_top_of_page_bid: +(int(10, 400) / 100).toFixed(2),
        high_top_of_page_bid: +(int(400, 1800) / 100).toFixed(2),
        cpc: +(int(20, 600) / 100).toFixed(2)
      }));
      return dfoEnvelope(['v3', 'keywords_data', 'google_ads', 'search_volume', 'task_post'],
        {api: 'keywords_data', function: 'search_volume', keywords: list},
        {location_code: Number(opts.location_code) || 2840, language_code: opts.language_code || 'en',
         items_count: items.length, items: items}, cost);
    },

    /* POST /v3/on_page/content_parsing/live（每個 Live 呼叫只 1 個 task）*/
    contentParsing(opts) {
      opts = opts || {};
      const url = Array.isArray(opts.urls) ? opts.urls[0] : (opts.url || String(opts));
      if (Array.isArray(opts.urls) && opts.urls.length > 1) {
        return {version: '0.1.mock', status_code: 40501,
                status_message: 'content_parsing/live accepts exactly one task per request.',
                tasks_count: 0, tasks_error: 0, tasks: [], cost: 0};
      }
      const cost = charge('onpage_page', 1, COST.onpage_page);
      return dfoEnvelope(['v3', 'on_page', 'content_parsing', 'live'],
        {api: 'on_page', function: 'content_parsing', url: url, markdown_view: true},
        {items_count: 1, items: [{
          url: url, domain: hostOf(url),
          page_as_markdown: '## ' + hostOf(url) + '\n\nMock article body in markdown…',
          page_content: {header: 'Mock header', main_topic: ['seo'], plain_text: 'Mock plain text…'}
        }]}, cost);
    },

    /* POST /v3/serp/youtube/organic/live/advanced */
    youtube(opts) {
      opts = opts || {};
      const cost = charge('serp_youtube', 1, COST.serp_live);
      const items = Array.from({length: 5}, (_, i) => ({
        type: 'youtube_video',
        rank_group: i + 1, rank_absolute: i + 1,
        video_id: 'mockVid' + (i + 1) + 'XyZ',
        title: 'Mock YouTube ' + (i + 1) + ' — ' + (opts.keyword || 'seo'),
        channel_name: 'Mock Channel ' + (i + 1),
        views_count: int(1200, 900000),
        duration_time: '0:' + String(int(10, 59)).padStart(2, '0'),
        duration_time_seconds: int(60, 1800)
      }));
      return dfoEnvelope(['v3', 'serp', 'youtube', 'organic', 'live', 'advanced'],
        {api: 'serp', function: 'youtube', keyword: opts.keyword, location_code: Number(opts.location_code) || 2840},
        {keyword: opts.keyword, items_count: items.length, items: items}, cost);
    }
  };

  /* ---------- 每個工具實際要嘅呼叫序列 ---------- */
  const TOOL_PIPELINE = {
    '1-click': ['serp', 'instantPages', 'keywordVolume', 'bulkKeywordDifficulty', 'youtube'],
    'bulk': ['serp', 'instantPages', 'keywordVolume', 'bulkKeywordDifficulty'],
    'super-page': ['serp'],
    'rewriter': ['serp'],
    'brand-voice': ['contentParsing']
  };

  async function pipeline(tool, input) {
    input = input || {};
    const steps = TOOL_PIPELINE[tool];
    if (!steps) throw new Error('未知工具：' + tool);
    const keyword = input.keyword || 'seo tools';
    const loc = input.location_code || 2840;
    const lang = input.language_code || 'en';
    const out = {tool: tool, keyword: keyword, location_code: loc, language_code: lang, calls: [], cost_usd: 0};
    let serp = null;

    for (const step of steps) {
      let res, cost = 0;
      if (step === 'serp') {
        res = DF.serp({keyword: keyword, location_code: loc, language_code: lang, depth: 10});
        cost = res.cost;
        serp = res.tasks[0].result[0];
        out.serp = {
          items: serp.items.map(i => ({rank_absolute: i.rank_absolute, type: i.type, url: i.url, domain: i.domain, title: i.title})),
          people_also_ask: serp.people_also_ask,
          related_searches: serp.related_searches,
          ai_overview: serp.ai_overview
        };
      } else if (step === 'instantPages') {
        const urls = (serp ? serp.items : []).slice(0, 10).map(i => i.url);
        res = DF.instantPages({urls: urls});
        cost = res.cost;
        out.competitors = (res.tasks[0].result[0].items || []).map(it => ({
          url: it.url, domain: it.domain, onpage_score: it.onpage_score,
          word_count: it.meta.content.plain_text_word_count,
          h2_count: it.meta.htags.h2.length,
          h3_count: it.meta.htags.h3.length,
          images_count: it.meta.images_count,
          readability: it.meta.content.flesch_kincaid_readability_index
        }));
      } else if (step === 'keywordVolume') {
        const kws = [keyword].concat(serp ? serp.related_searches.slice(0, 5) : []);
        res = DF.keywordVolume({keywords: kws, location_code: loc, language_code: lang});
        cost = res.cost;
        out.keywords = {volume: res.tasks[0].result[0].items};
      } else if (step === 'bulkKeywordDifficulty') {
        const kws = (out.keywords ? out.keywords.volume.map(v => v.keyword) : [keyword]);
        res = labsBulkKeywordDifficulty(kws, {location_code: loc, language_code: lang});
        cost = res.cost;
        out.keywords = out.keywords || {};
        out.keywords.difficulty = res.tasks[0].result[0].items;
      } else if (step === 'youtube') {
        res = DF.youtube({keyword: keyword, location_code: loc, language_code: lang});
        cost = res.cost;
        out.youtube = res.tasks[0].result[0].items;
      } else if (step === 'contentParsing') {
        const urls = input.urls || ['https://example.com/source-1'];
        out.parsed = [];
        for (const u of urls) {
          const r1 = DF.contentParsing({url: u});
          cost += r1.cost;
          out.calls.push({endpoint: 'content_parsing/live', url: u, cost: r1.cost});
          out.parsed.push(r1.tasks[0].result[0].items[0]);
        }
        out.cost_usd = +(out.cost_usd + cost).toFixed(6);
        continue;
      } else {
        continue;
      }
      out.calls.push({endpoint: step, cost: cost});
      out.cost_usd = +(out.cost_usd + cost).toFixed(6);
    }
    return out;
  }

  /* 6 個端點嘅形狀自測 */
  function dfSelfTest() {
    const checks = [];
    const t = (name, fn) => {
      try { const v = fn(); checks.push({endpoint: name, ok: !!v, okv: v}); }
      catch (e) { checks.push({endpoint: name, ok: false, error: String(e && e.message || e)}); }
    };
    t('serp/google/locations', () => DF.locations().tasks[0].result[0].items.length > 0);
    t('serp/google/languages', () => DF.languages().tasks[0].result[0].items.length > 0);
    t('serp/google/organic/advanced', () => {
      const r = DF.serp({keyword: 'seo', depth: 10});
      return r.tasks[0].result[0].items.length === 10 && !!r.tasks[0].result[0].people_also_ask;
    });
    t('on_page/instant_pages', () => {
      const r = DF.instantPages({urls: Array.from({length: 10}, (_, i) => 'https://c' + i + '.com/x')});
      const it = r.tasks[0].result[0].items[0];
      return typeof it.meta.content.plain_text_word_count === 'number' && Array.isArray(it.meta.htags.h2);
    });
    t('on_page/instant_pages (同域>5 → 40501)', () => {
      const r = DF.instantPages({urls: Array.from({length: 10}, () => 'https://same.com/x')});
      return r.status_code === 40501;
    });
    t('keywords_data/search_volume', () => {
      const r = DF.keywordVolume({keywords: ['a', 'b', 'c']});
      return r.tasks[0].result[0].items.length === 3;
    });
    t('labs/bulk_keyword_difficulty', () => {
      const r = labsBulkKeywordDifficulty(['a', 'b']);
      return typeof r.tasks[0].result[0].items[0].keyword_difficulty === 'number';
    });
    t('on_page/content_parsing/live', () => {
      const r = DF.contentParsing({url: 'https://x.com/a'});
      return typeof r.tasks[0].result[0].items[0].page_as_markdown === 'string';
    });
    t('serp/youtube/organic', () => {
      const r = DF.youtube({keyword: 'seo'});
      return r.tasks[0].result[0].items[0].video_id != null;
    });
    return checks;
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
    labsBulkKeywordDifficulty: labsBulkKeywordDifficulty,
    df: DF,
    toolPipeline: TOOL_PIPELINE,
    pipeline: pipeline,
    dfSelfTest: dfSelfTest,
    labs: {
      bulkKeywordDifficulty: labsBulkKeywordDifficulty,
      endpoint: 'https://api.dataforseo.com/v3/dataforseo_labs/google/bulk_keyword_difficulty/live',
      pricePerTask: 0.012,
      pricePerKeyword: 0.00012,
      priceExample: {keywords150: 0.03, keywords1000: 0.132},
      maxKeywords: 1000
    },
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
