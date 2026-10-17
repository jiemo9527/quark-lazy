const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '夸克懒得点.user.js'), 'utf8');
function slice(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}
function harness(stored = {}) {
  const dom = new JSDOM('<button data-qk-load-all-button></button>', { url: 'https://pan.quark.cn/list#/list/all' });
  const all = { size: 50, list: [], total: 100, loading: false, bigLoading: false };
  const calls = [];
  let ready = true, fail = false;
  const store = { getState: () => ({ file: { all, listType: 'all' } }), dispatch: { file: {
    changeListFile: (args) => { calls.push(['size', args.size]); all.size = args.size; },
    loadTableFiles: async (args) => { calls.push(['load', args.fid]); if (fail) throw Error('network'); all.list = Array.from({ length: all.size === 50 ? 50 : 100 }, (_, i) => ({ fid: String(i) })); }
  } } };
  const Runtime = { listLoadAllRunning: false, listFlowDone: new Set() };
  const context = vm.createContext({ window: dom.window, document: dom.window.document, Runtime,
    GM_getValue: (key, fallback) => stored[key] ?? fallback, GM_setValue: (key, value) => { stored[key] = value; },
    LIST_LOAD_ALL: { uiPageSize: 50, apiMaxSize: 2000 }, FLOW: { selectorWaitMs: 100, listAutoCheckDelayMs: 0 },
    console: { log() {}, warn() {} }, Date,
    sleep: async () => {}, hasPendingSourceClick: () => false, notifyToast: () => {},
    shouldHandleListPage: () => true });
  vm.runInContext(slice('  function getPageWindow()', '  function sleep(') +
    slice('  async function handleListPage()', '  function scheduleHandle(') +
    '\nglobalThis.loadAll = ensureListLoadAll; globalThis.restore = restoreListPaging; globalThis.active = isListLoadAllActive; globalThis.handle = handleListPage;', context);
  context.findQuarkStore = () => ready ? store : null;
  const buttonCode = slice('          const loadAllLabel =', '          if (manualLoad.parentElement');
  context.manualLoad = dom.window.document.querySelector('button');
  vm.runInContext(buttonCode, context);
  return { dom, context, Runtime, all, calls, stored, button: context.manualLoad,
    ready: (value) => { ready = value; }, fail: (value) => { fail = value; } };
}

test('夸克点击加载全部后立即刷新，状态在等待 React 前已保存，初始化自动恢复', async () => {
  const stored = {}, first = harness(stored);
  let release;
  try {
    first.ready(false);
    first.context.sleep = () => new Promise((resolve) => { release = resolve; });
    const pending = first.button.onclick();
    const refreshed = harness(stored);
    try {
      assert.equal(refreshed.context.active(), true, '刷新后应保持开启，不能依赖新页面默认 size=50');
      assert.equal(refreshed.button.textContent, '还原分页加载');
      await refreshed.context.handle();
      assert.equal(refreshed.all.size, 2000);
      assert.equal(refreshed.all.list.length, 100);
      assert.equal(refreshed.calls.filter(([kind]) => kind === 'load').length, 1);
      await refreshed.context.handle();
      assert.equal(refreshed.calls.filter(([kind]) => kind === 'load').length, 1, '重复 DOM 事件不重复加载');
    } finally { refreshed.dom.window.close(); }
    first.ready(true); release(); await pending;
  } finally { first.dom.window.close(); }
});

test('夸克主动还原分页后刷新保持关闭，默认也不自动加载', async () => {
  const stored = {}, h = harness(stored);
  try {
    await h.context.handle();
    assert.equal(h.calls.length, 0);
    await h.button.onclick();
    assert.equal(h.context.active(), true);
    await h.button.onclick();
    assert.equal(h.context.active(), false);
    assert.equal(h.all.size, 50);
    const refreshed = harness(stored);
    try {
      assert.equal(refreshed.button.textContent, '加载全部文件');
      await refreshed.context.handle(); assert.equal(refreshed.calls.length, 0);
    } finally { refreshed.dom.window.close(); }
  } finally { h.dom.window.close(); }
});

test('夸克加载失败不丢开启状态、不无限重试；关闭即使失败也持久保存', async () => {
  const stored = {}, h = harness(stored);
  try {
    h.fail(true); await h.button.onclick();
    assert.equal(h.context.active(), true);
    assert.equal(h.button.textContent, '还原分页加载');
    await h.context.handle(); await h.context.handle();
    assert.equal(h.calls.filter(([kind]) => kind === 'load').length, 1);
    const refreshed = harness(stored);
    try {
      await refreshed.context.handle();
      assert.equal(refreshed.all.size, 2000);
      assert.equal(refreshed.all.list.length, 100);
    } finally { refreshed.dom.window.close(); }
    await h.button.onclick(); assert.equal(h.context.active(), false);
    assert.equal(h.button.textContent, '加载全部文件');
  } finally { h.dom.window.close(); }
});

test('夸克开启后换目录自动恢复，不处理回收站/分享页，等待时换目录不发旧请求', async () => {
  const h = harness();
  try {
    await h.button.onclick();
    const fid = 'a'.repeat(32);
    h.dom.window.location.hash = `/list/all/${fid}-folder`;
    await h.context.handle();
    assert.deepEqual(h.calls.filter(([kind]) => kind === 'load').map((x) => x[1]), ['0', fid]);
    h.dom.window.location.hash = '/list/recycle';
    await h.context.handle();
    assert.equal(h.calls.filter(([kind]) => kind === 'load').length, 2);
    assert.equal(await h.context.loadAll(), false);
    h.dom.window.location.hash = '/list/all'; h.ready(false);
    let release; h.context.sleep = () => new Promise((resolve) => { release = resolve; });
    const pending = h.context.loadAll();
    h.dom.window.location.hash = `/list/all/${fid}-folder`;
    release(); assert.equal(await pending, false);
    assert.equal(h.Runtime.listLoadAllRunning, false);
    assert.equal(h.calls.filter(([kind]) => kind === 'load').length, 2);
  } finally { h.dom.window.close(); }
});
