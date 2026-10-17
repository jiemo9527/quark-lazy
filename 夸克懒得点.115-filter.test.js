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
const wait = (dom, ms = 600) => new Promise((resolve) => dom.window.setTimeout(resolve, ms));

function harness(initialFeatures = {}) {
  const dom = new JSDOM('<div><div class="qk-rpc-115-row"></div></div><input type="checkbox" title="全选当前页"><section><header><input type="checkbox"></header><div class="file-list-wrap"></div></section>', { url: 'https://115.com/storage/allfiles?cid=1' });
  const { document } = dom.window;
  const files = [{ fid: '1', pc: 'p1', n: 'Keep.MKV' }, { fid: '2', pc: 'p2', n: 'Other.mkv' }];
  let selected = [];
  const list = document.querySelector('.file-list-wrap');
  const header = document.querySelector('header input');
  const toolbar = document.querySelector('input[title]');
  const props = { files, on_selection_change: (next) => { selected = [...next]; render(); } };
  function render() {
    props.selected_files = selected;
    list.replaceChildren(...files.map((file) => {
      const row = document.createElement('div');
      row.className = 'file-list-item'; row.dataset.fileId = file.fid;
      const checked = selected.includes(file);
      // Captured 115 DOM: selecting a row removes the second child and React resets className.
      row.innerHTML = `<div class="file-list-item"><div><div class="checkbox-area"><input type="checkbox"></div><span class="file-name-responsive" title="${file.n}">${file.n}</span></div>${checked ? '' : '<div class="expanded-space"></div>'}</div>`;
      const cb = row.querySelector('input'); cb.checked = checked;
      cb.__reactFiber$test = { memoizedProps: {}, return: { memoizedProps: { file }, return: { memoizedProps: props } } };
      cb.addEventListener('change', () => props.on_selection_change(cb.checked ? [...selected, file] : selected.filter((x) => x !== file)));
      return row;
    }));
    header.checked = toolbar.checked = selected.length === files.length;
  }
  function nativeAll(event) { props.on_selection_change(event.target.checked ? files : []); }
  header.addEventListener('change', nativeAll); toolbar.addEventListener('change', nativeAll);
  render();
  const stored = { qk_feature_options: { '115TraverseFolders': false, ...initialFeatures } };
  let pushes = 0;
  const context = vm.createContext({ window: dom.window, document, location: dom.window.location, SITE_HOST: '115.com',
    URLSearchParams: dom.window.URLSearchParams, MutationObserver: dom.window.MutationObserver,
    setTimeout: dom.window.setTimeout.bind(dom.window), clearTimeout: dom.window.clearTimeout.bind(dom.window),
    getPageWindow: () => dom.window, safeSegment: (x) => x,
    FEATURE_OPTIONS_KEY: 'qk_feature_options', GM_getValue: (key, fallback) => stored[key] ?? fallback,
    GM_setValue: (key, value) => { stored[key] = value; }, WebDAV: { push: () => pushes++ } });
  vm.runInContext(slice('  const featureEnabled =', '  const REDIRECT_PENDING_KEY'), context);
  // Load real outer helpers, if present, without starting unrelated site features.
  const helpers = source.indexOf('  function get115FilterKeyword(');
  if (helpers >= 0) vm.runInContext(source.slice(helpers, source.indexOf('  function install115FileFilter()', helpers)), context);
  vm.runInContext(slice('  function install115FileFilter()', '  // 115 新版把 F5') + '\ninstall115FileFilter();', context);
  vm.runInContext(slice('      function one15SelectedFiles()', '      // 列出 115 目录') +
    slice('      async function collect115Files(', '      async function one15GetDownloadUrl(') +
    '\nglobalThis.collect = async () => collect115Files(one15SelectedFiles());', context);
  vm.runInContext(slice('      async function runFreshSend(', '      // ===== 重试：') + '\nglobalThis.send = runFreshSend;', context);
  const makeSettings = () => {
    Object.assign(context, { ON_115_AUX: false, ON_115: true, ON_QUARK: false,
      createRpcSoundSwitch: () => document.createElement('div'), isAutoSaveEnabled: () => false, setAutoSaveEnabled: () => {} });
    return vm.runInContext('(() => {' + slice('        const siteFeatures =', '        const switchTab =') + 'return featurePage; })()', context);
  };
  return { dom, document, context, files, props, header, toolbar, stored, makeSettings, get pushes() { return pushes; }, get selected() { return selected; },
    filter: async (text) => { const input = document.querySelector('.qk-115-filter-input'); input.value = text; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await wait(dom); } };
}

test('115 筛选后列表表头全选，React 重绘也只能将匹配文件交给 RPC 收集器', async () => {
  const h = harness();
  try {
    await h.filter('KEEP');
    h.header.click();
    await wait(h.dom, 750);
    assert.deepEqual(Array.from(await h.context.collect(), (x) => x.name), ['Keep.MKV']);
    assert.deepEqual(h.selected.map((x) => x.n), ['Keep.MKV'], '必须同步 115 原生选区，不能只在 RPC 末端丢弃');
    const other = h.document.querySelector('[data-file-id="2"]');
    assert.ok(other.matches('.qk-115-file-hidden-by-filter') || other.querySelector('.qk-115-file-hidden-by-filter'), '重绘后未匹配行仍须隐藏');
  } finally { h.dom.window.close(); }
});

for (const entry of ['header', 'toolbar']) {
  test(`115 ${entry}全选立即发送只产生匹配任务，再次全选可取消，替换控件后仍有效`, async () => {
    const h = harness();
    try {
      await h.filter('keep');
      // Replace the native control, as React does during toolbar changes.
      const old = h[entry], control = old.cloneNode(true); old.replaceWith(control);
      control.click();
      assert.deepEqual(h.selected.map((x) => x.n), ['Keep.MKV']);
      const delivered = [], errors = [];
      Object.assign(h.context, { sending: false, resolveActive: () => ({ rpc: { name: 'test' }, dir: '/downloads' }),
        setBusy: () => {}, setSendText: () => {}, QUARK_CONFIRM_OVER: 100, probeRpc: async () => ({ ok: true }),
        resetSessionFailures: () => {}, recordRpcLog: () => {}, notifyToast: () => {}, playRpcResultSound: () => {},
        console: { error: (...args) => errors.push(args), warn: () => {} },
        deliverJobs: async (_rpc, jobs) => { delivered.push(...jobs); return { ok: jobs, failed: [] }; } });
      await h.context.send({ label: '115', collect: h.context.collect, nameOf: (f) => f.name, ident: (f) => ({ pickCode: f.pickCode }) });
      assert.deepEqual(errors, []);
      assert.deepEqual(delivered.map((x) => x.name), ['Keep.MKV']);
      control.click();
      assert.equal(h.selected.length, 0);
    } finally { h.dom.window.close(); }
  });
}

test('115 已经全选后输入筛选，同步原生选区；隐藏标记丢失也不能扩大 RPC 范围', async () => {
  const h = harness();
  try {
    h.props.on_selection_change(h.files);
    await h.filter('keep');
    assert.deepEqual(h.selected.map((x) => x.n), ['Keep.MKV']);
    h.props.on_selection_change(h.files);
    h.document.querySelectorAll('.qk-115-file-hidden-by-filter').forEach((el) => el.classList.remove('qk-115-file-hidden-by-filter'));
    assert.deepEqual(Array.from(await h.context.collect(), (x) => x.name), ['Keep.MKV']);
    await wait(h.dom);
    assert.deepEqual(h.selected.map((x) => x.n), ['Keep.MKV']);
    h.document.querySelector('.qk-115-filter-clear').click();
    h.toolbar.click();
    assert.deepEqual(Array.from(await h.context.collect(), (x) => x.name), ['Keep.MKV', 'Other.mkv']);
  } finally { h.dom.window.close(); }
});

test('115 筛选开关默认开启，关闭立即还原列表与原生全选/RPC，保存后可重新开启', async () => {
  const h = harness();
  try {
    const settings = h.makeSettings(); h.document.body.appendChild(settings);
    const row = [...settings.querySelectorAll('label')].find((el) => el.textContent.includes('关键词过滤'));
    assert.ok(row, '115专属缺少关键词过滤开关');
    const toggle = row.querySelector('input'); assert.equal(toggle.checked, true);
    await h.filter('keep'); h.header.click();
    const input = h.document.querySelector('.qk-115-filter-input');
    input.value = 'other'; input.dispatchEvent(new h.dom.window.Event('input', { bubbles: true }));
    toggle.click();
    assert.equal(h.stored.qk_feature_options['115FileFilter'], false);
    assert.equal(h.pushes, 1);
    assert.equal(h.document.querySelector('.qk-115-filter-row'), null);
    assert.equal(h.document.querySelectorAll('.qk-115-file-hidden-by-filter').length, 0);
    h.toolbar.click();
    assert.deepEqual(Array.from(await h.context.collect(), (x) => x.name), ['Keep.MKV', 'Other.mkv']);
    await wait(h.dom);
    assert.equal(h.selected.length, 2, '旧的防抖任务不得继续取消选中');
    const reopened = h.makeSettings(); h.document.body.appendChild(reopened);
    const reopenedToggle = [...reopened.querySelectorAll('label')].find((el) => el.textContent.includes('关键词过滤')).querySelector('input');
    assert.equal(reopenedToggle.checked, false);
    reopenedToggle.click();
    assert.equal(h.pushes, 2);
    assert.equal(h.document.querySelector('.qk-115-filter-input').value, '');
    await h.filter('keep');
    assert.deepEqual(Array.from(await h.context.collect(), (x) => x.name), ['Keep.MKV']);
  } finally { h.dom.window.close(); }
});

test('115 保存为关闭时首次加载不创建筛选框、不限制 RPC', async () => {
  const h = harness({ '115FileFilter': false });
  try {
    assert.equal(h.document.querySelector('.qk-115-filter-row'), null);
    h.toolbar.click();
    assert.equal((await h.context.collect()).length, 2);
  } finally { h.dom.window.close(); }
});

test('115 无匹配全选不发送；切换目录不能沿用旧关键词', async () => {
  const h = harness();
  try {
    await h.filter('missing'); h.toolbar.click();
    assert.equal((await h.context.collect()).length, 0);
    h.dom.window.history.pushState({}, '', '?cid=2');
    h.props.on_selection_change(h.files);
    assert.equal((await h.context.collect()).length, 2);
    await wait(h.dom);
    assert.equal(h.document.querySelector('.qk-115-filter-input').value, '');
  } finally { h.dom.window.close(); }
});
