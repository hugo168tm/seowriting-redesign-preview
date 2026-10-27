/*!
 * ui/diff.js — 零依賴句子級 diff（spec §4.6 / ADR-12）。
 *
 * 點解係 classic script 而唔係 ESM（ADR-15，repo 證據裁決）：
 *   1. `server-local.js` 嘅 resolveStatic() 只 serve `ui/`，而 file:// 之下
 *      `<script type="module">` 會被 CORS policy 擋 → 瀏覽器側一定要 classic + window 掛載。
 *   2. `package.json` 有 `"type": "module"` → Node 對呢個檔一樣當 **ESM**，
 *      所以 `require()` 攞唔到，`import` 亦唔會有 `module.exports`。
 *      → 測試（`tests/diff.test.js`）改用 `node:vm` 嘅 `runInThisContext` 載入本檔，
 *        喺同一個 realm 執行，`deepStrictEqual` 就唔會被「另一個 Array.prototype」搞亂。
 * `module.exports` 分支純粹係防禦性雙寫法，喺本 repo 實際唔會行到。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SWDiff = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 超過呢個句數就降級做段落級，保證 LCS 嘅 O(n·m) 唔會喺長文爆炸。 */
  const MAX_SENTENCES = 400;
  /** 降級之後，每幾多句當一「段」。 */
  const SENTENCES_PER_BLOCK = 20;

  const ENDERS = '。！？；…!?;.';
  const CLOSERS = '"\'”’）)】」』';

  /** 切句：句尾標點保留；換行係硬邊界；句內空白正規化；空 → []。 */
  function splitSentences(text) {
    const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const out = [];
    let buf = '';
    /* 正規化空白：模型輸出常有雙空格／全角空格，唔壓嘅話「冇改」都會被判成改寫；
       CJK 標點前面亦唔應該有空格（中文排版慣例）。 */
    const flush = () => {
      const t = buf.replace(/\s+/g, ' ').replace(/\s+([。！？；…）】」』”’])/g, '$1').trim();
      if (t) out.push(t);
      buf = '';
    };
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      if (ch === '\n') { flush(); continue; }
      buf += ch;
      if (ENDERS.indexOf(ch) === -1) continue;
      while (i + 1 < s.length && CLOSERS.indexOf(s[i + 1]) !== -1) { buf += s[i + 1]; i += 1; }
      flush();
    }
    flush();
    return out;
  }

  /** 降級用：每 SENTENCES_PER_BLOCK 句併成一塊。 */
  function toBlocks(text) {
    const sentences = splitSentences(text);
    if (sentences.length <= SENTENCES_PER_BLOCK) return sentences;
    const blocks = [];
    for (let i = 0; i < sentences.length; i += SENTENCES_PER_BLOCK) {
      blocks.push(sentences.slice(i, i + SENTENCES_PER_BLOCK).join(''));
    }
    return blocks;
  }

  /** LCS 長度表（由尾向前填），Int32Array 省記憶。 */
  function lcsTable(a, b) {
    const n = a.length;
    const m = b.length;
    const dp = new Array(n + 1);
    for (let i = 0; i <= n; i += 1) dp[i] = new Int32Array(m + 1);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    return dp;
  }

  /** 兩串單位（句／段）比對：連續嘅刪同加按位置配對成 sub（改寫），剩低嘅先係 del / add。 */
  function diffUnits(A, B) {
    const dp = lcsTable(A, B);
    const ops = [];
    let dels = [];
    let adds = [];
    const flush = () => {
      const paired = Math.min(dels.length, adds.length);
      for (let k = 0; k < paired; k += 1) ops.push({ type: 'sub', text: adds[k], before: dels[k] });
      for (let k = paired; k < dels.length; k += 1) ops.push({ type: 'del', text: dels[k] });
      for (let k = paired; k < adds.length; k += 1) ops.push({ type: 'add', text: adds[k] });
      dels = [];
      adds = [];
    };

    let i = 0;
    let j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { flush(); ops.push({ type: 'same', text: A[i] }); i += 1; j += 1; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { dels.push(A[i]); i += 1; }
      else { adds.push(B[j]); j += 1; }
    }
    while (i < A.length) { dels.push(A[i]); i += 1; }
    while (j < B.length) { adds.push(B[j]); j += 1; }
    flush();
    return ops;
  }

  /**
   * 句子級 diff。回 `{type:'same'|'del'|'add'|'sub', text, before?}`：
   *   same = 冇改；del = 刪走（text = 舊句）；add = 新增（text = 新句）；
   *   sub  = 改寫（text = 新句、before = 舊句）。
   * 句數 > MAX_SENTENCES 就降級做段落級（每 20 句一段），行同一條 LCS。
   */
  function diffSentences(a, b) {
    const A = splitSentences(a);
    const B = splitSentences(b);
    if (A.length > MAX_SENTENCES || B.length > MAX_SENTENCES) return diffUnits(toBlocks(a), toBlocks(b));
    return diffUnits(A, B);
  }

  return { MAX_SENTENCES, splitSentences, toBlocks, diffSentences };
}));
