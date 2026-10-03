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
const tick = () => new Promise((resolve) => setImmediate(resolve));

function saveHarness() {
  const dom = new JSDOM('<button class="share-save">保存到网盘</button>', { url: 'https://pan.quark.cn/s/abc' });
  const logs = [], pushes = [];
  let user = { name: '名单中的分享者', hash: 'stable-user' };
  const context = vm.createContext({ window: dom.window, document: dom.window.document, location: dom.window.location,
    MutationObserver: dom.window.MutationObserver, Runtime: { shareFlowRunning: false }, SITE_HOST: 'pan.quark.cn',
    SELECTORS: { saveButton: ['.share-save'], confirmButton: ['.confirm-btn'] },
    shouldHandleSharePage: () => /^\/s\//.test(dom.window.location.pathname),
    getTargetSharerInfo: () => user, getFileTitle: () => '分享标题', getLogs: () => logs,
    getLogKind: (entry) => entry.kind || 'save', MAX_LOGS: 3000,
    setLogs: (next) => logs.splice(0, logs.length, ...next), formatTime: () => '2026-10-03 12:00:00',
    recordShareSaveLog: (entry) => { const kept = logs.filter((x) => x.url !== entry.url); logs.splice(0, logs.length, entry, ...kept); pushes.push(entry); },
    WebDAV: { push: () => pushes.push('push') }, console
  });
  vm.runInContext(slice('  function findSaveSuccessEl()', '  async function waitForSaveSuccess(') +
    slice('  function recordLog(', '  function showBlockedOverlay(') +
    '\nif (typeof installQuarkShareSaveLogger === "function") installQuarkShareSaveLogger();', context);
  return { dom, context, logs, pushes, setUser: (next) => { user = next; } };
}

test('警告/屏蔽分享者临时允许后手动保存，只有成功提示出现才写保存记录', async () => {
  const h = saveHarness();
  h.dom.window.document.querySelector('button').click();
  await tick();
  assert.equal(h.logs.length, 0, '点击保存但没有成功，不得写入');
  h.dom.window.document.body.insertAdjacentHTML('beforeend', '<span class="text">保存成功</span>');
  await tick();
  assert.equal(h.logs.length, 1, '手动成功也应记录，不依赖自动流程和名单判定');
  assert.equal(h.logs[0].name, '名单中的分享者');
  assert.equal(h.logs[0].hash, 'stable-user');
  assert.equal(h.logs[0].url, 'https://pan.quark.cn/s/abc');
  assert.equal(h.logs[0].title, '分享标题');
  h.dom.window.document.body.appendChild(h.dom.window.document.createElement('div'));
  await tick();
  assert.equal(h.pushes.length, 1, '无关 DOM 更新不能反复记日志/同步');
  h.dom.window.close();
});

function viewerHarness(embedded = true) {
  const dom = new JSDOM('<div id="host"></div>', { url: 'https://pan.quark.cn/list' });
  let logs = [{ kind: 'save', time: 't1', site: 'pan.quark.cn', name: '甲', hash: 'u1', title: '夸克保存', url: 'https://pan.quark.cn/s/a' },
    { kind: 'save', time: 't2', site: '115.com', name: '42', hash: 'u2', sharerId: '42', title: '115保存', url: 'https://115cdn.com/s/a' },
    { kind: 'rpc', time: 't3', site: 'pan.quark.cn', title: '下载文件', files: ['下载文件'], status: '已发送 1', url: 'https://pan.quark.cn/list' }];
  let failures = [{ id: 'f1', time: 't4', site: 'pan.quark.cn', name: '失败文件', reason: '超时', pageUrl: 'https://pan.quark.cn/list', call: {} }];
  let pushes = 0;
  const retried = [], blocked = [], warnings = [];
  const context = vm.createContext({
    getBlockedList: () => structuredClone(blocked), getWarningList: () => structuredClone(warnings),
    setUserListFromLog: (user, mode) => {
      const same = (item) => item.site === user.site && item.hash === user.hash;
      for (const list of [blocked, warnings]) { const i = list.findIndex(same); if (i >= 0) list.splice(i, 1); }
      (mode === 'blocked' ? blocked : warnings).push(user); return true;
    }, document: dom.window.document, window: dom.window, Set,
    getLogs: () => structuredClone(logs), setLogs: (next) => { logs = structuredClone(next); },
    getRpcFailures: () => structuredClone(failures), setRpcFailures: (next) => { failures = structuredClone(next); },
    getLogKind: (entry) => entry.kind || 'save', getEntrySite: (entry) => entry.site,
    siteLabel: (site) => site, RPC_FAILURE_TYPE_LABELS: { timeout: '超时' }, rpcFailureType: () => 'timeout',
    RpcHelper: { canRefetch: () => false, retryFailures: (ids) => { if (ids === null) return true; retried.push(Array.from(ids)); return Promise.resolve(); } },
    WebDAV: { normalizeUserItem: (user) => user, push: () => pushes++ },
    notifyToast: () => {}, qkNotice: () => true, GM_setClipboard: () => {} });
  vm.runInContext(slice('  function showLogViewer(host)', '  function showSyncResult(') + '\nglobalThis.show = showLogViewer;', context);
  context.show(embedded ? dom.window.document.getElementById('host') : undefined);
  const box = dom.window.document.querySelector('[data-qk-log-center]');
  return { dom, box, retried, blocked, warnings, get logs() { return logs; }, get failures() { return failures; }, get pushes() { return pushes; },
    addLog: (entry) => logs.unshift(entry), addFailure: (entry) => failures.unshift(entry),
    button: (text) => [...box.querySelectorAll('button')].find((el) => el.textContent.startsWith(text)),
    rows: () => [...box.querySelectorAll('[data-qk-log-row]')] };
}

test('刷新日志只重新读取存储与渲染，保留筛选、搜索和当前日志类型，不刷新页面', () => {
  for (const embedded of [true, false]) {
    const h = viewerHarness(embedded);
    const refresh = h.button('刷新日志');
    assert.ok(refresh, '日志页缺少刷新日志按钮');
    const site = h.box.querySelector('select'), search = h.box.querySelector('input:not([type="checkbox"])');
    site.value = 'pan.quark.cn'; site.onchange();
    search.value = '夸克'; search.oninput();
    h.addLog({ kind: 'save', time: 't5', site: 'pan.quark.cn', title: '新夸克保存', url: 'https://pan.quark.cn/s/new' });
    assert.equal(h.rows().length, 1);
    refresh.click();
    assert.equal(h.rows().length, 2);
    assert.equal(site.value, 'pan.quark.cn'); assert.equal(search.value, '夸克');
    assert.equal(h.dom.window.location.href, 'https://pan.quark.cn/list');
    assert.equal(h.pushes, 0, '刷新不上传/拉取 WebDAV，不改日志');
    h.dom.window.close();
  }
});


test('旧成功提示、失败提示和未发起保存的页面变化不产生保存记录', async () => {
  const h = saveHarness(), doc = h.dom.window.document;
  doc.body.insertAdjacentHTML('beforeend', '<span class="text">保存成功</span>'); await tick();
  assert.equal(h.logs.length, 0);
  doc.querySelector('button').click(); doc.body.appendChild(doc.createElement('div')); await tick();
  assert.equal(h.logs.length, 0, '不能把上一轮成功提示当成这次成功');
  doc.querySelector('span').textContent = '保存失败'; await tick();
  assert.equal(h.logs.length, 0);
  doc.querySelector('span').textContent = '保存成功'; await tick();
  assert.equal(h.logs.length, 1, '复用提示节点仍可检测新的成功');
  h.dom.window.close();
});

test('自动保存不会被手动监听器重复记日志，换分享地址后不串记录', async () => {
  const h = saveHarness(), doc = h.dom.window.document;
  h.context.Runtime.shareFlowRunning = true;
  doc.querySelector('button').click(); doc.body.insertAdjacentHTML('beforeend', '<span class="text">保存成功</span>'); await tick();
  assert.equal(h.logs.length, 0);
  h.context.Runtime.shareFlowRunning = false; doc.querySelector('span').remove(); await tick();
  doc.querySelector('button').click(); h.dom.window.history.pushState({}, '', '/s/other');
  doc.body.insertAdjacentHTML('beforeend', '<span class="text">保存成功</span>'); await tick();
  assert.equal(h.logs.length, 0, '旧分享的待保存状态不能记到新地址');
  h.dom.window.close();
});

test('没有分享者信息也记录真实手动成功，再次保存仍按原规则更新同链接记录', async () => {
  const h = saveHarness(), doc = h.dom.window.document;
  h.setUser(null);
  for (let i = 0; i < 2; i++) {
    doc.querySelector('span')?.remove(); await tick();
    doc.querySelector('button').click(); doc.body.insertAdjacentHTML('beforeend', '<span class="text">保存成功</span>'); await tick();
  }
  assert.equal(h.logs.length, 1); assert.equal(h.logs[0].name, ''); assert.equal(h.pushes.length, 2);
  h.dom.window.close();
});

test('清空只处理当前筛选分类，失败记录单条删除也同步', () => {
  const h = viewerHarness();
  const site = h.box.querySelector('select'); site.value = 'pan.quark.cn'; site.onchange();
  h.button('清空当前列表').click();
  assert.deepEqual(h.logs.map((x) => x.title), ['115保存', '下载文件']);
  h.box.querySelector('[data-kind="fail"]').click();
  h.rows()[0].querySelectorAll('button')[2].click();
  assert.equal(h.failures.length, 0); assert.equal(h.pushes, 2);
  h.dom.window.close();
});

for (const kind of ['save', 'rpc', 'fail']) {
  test(`${kind} 支持勾选删除一条且不影响其它分类，删除后同步`, () => {
    const h = viewerHarness();
    h.box.querySelector(`[data-kind="${kind}"]`).click();
    const row = h.rows()[0], pick = row.querySelector('input[type="checkbox"]');
    assert.ok(pick, `${kind} 缺少勾选框`);
    pick.click();
    assert.equal(h.button('删除选中').disabled, false);
    h.button('删除选中').click();
    assert.equal(h.rows().length, kind === 'save' ? 1 : 0);
    assert.equal(h.logs.length, kind === 'fail' ? 3 : 2);
    assert.equal(h.failures.length, kind === 'fail' ? 0 : 1);
    assert.equal(h.pushes, 1);
    assert.equal(h.button('删除选中').disabled, true);
    h.dom.window.close();
  });
}

test('筛选后全选只删除当前可见的保存记录，并保留新产生的记录', () => {
  const h = viewerHarness();
  const site = h.box.querySelector('select'); site.value = 'pan.quark.cn'; site.onchange();
  h.button('全选/取消').click();
  h.addLog({ kind: 'save', time: 'new', site: 'pan.quark.cn', title: '新产生', url: 'https://pan.quark.cn/s/new' });
  h.button('删除选中').click();
  assert.deepEqual(h.logs.map((x) => x.title), ['新产生', '115保存', '下载文件']);
  h.dom.window.close();
});

test('切换搜索后不保留隐藏行的勾选，刷新保留仍存在的选中记录', () => {
  const h = viewerHarness();
  const pick = h.rows()[0].querySelector('input[type="checkbox"]');
  assert.ok(pick); pick.click();
  h.button('刷新日志').click();
  assert.equal(h.rows()[0].querySelector('input[type="checkbox"]').checked, true);
  const search = h.box.querySelector('input:not([type="checkbox"])'); search.value = '115'; search.oninput();
  assert.equal(h.button('删除选中').disabled, true);
  h.button('删除选中').click();
  assert.equal(h.logs.length, 3);
  h.dom.window.close();
});

test('保存记录操作列显示已屏蔽/已警告，点击另一名单立即更新', () => {
  const h = viewerHarness();
  h.blocked.push({ site: 'pan.quark.cn', name: '甲', hash: 'u1' });
  h.warnings.push({ site: '115.com', name: '旧昵称', hash: 'u2', sharerId: '42' });
  h.button('刷新日志').click();
  assert.match(h.rows()[0].lastElementChild.textContent, /已屏蔽/);
  assert.match(h.rows()[1].lastElementChild.textContent, /已警告/);
  const warn = [...h.rows()[0].querySelectorAll('button')].find((b) => b.textContent === '警告');
  warn.click();
  assert.match(h.rows()[0].lastElementChild.textContent, /已警告/);
  assert.doesNotMatch(h.rows()[0].lastElementChild.textContent, /已屏蔽/);
  const active = [...h.rows()[0].querySelectorAll('button')].find((b) => b.textContent === '已警告');
  assert.ok(active.disabled, '已有状态不可重复添加，另一名单仍可切换');
  h.dom.window.close();
});

test('名单状态不跨站匹配，115 只按可信 sharerId，刷新移除后恢复操作', () => {
  const h = viewerHarness();
  h.blocked.push({ site: 'pan.baidu.com', name: '甲', hash: 'u1' }, { site: '115.com', hash: 'u2', sharerId: '99' });
  h.button('刷新日志').click();
  for (const row of h.rows()) assert.doesNotMatch(row.lastElementChild.textContent, /已屏蔽|已警告/);
  h.blocked[1].sharerId = '42'; h.button('刷新日志').click();
  assert.match(h.rows()[1].lastElementChild.textContent, /已屏蔽/);
  h.blocked.length = 0; h.button('刷新日志').click();
  assert.doesNotMatch(h.rows()[1].lastElementChild.textContent, /已屏蔽/);
  h.dom.window.close();
});

test('失败记录勾选重试仍传递原失败 ID', async () => {
  const h = viewerHarness(); h.box.querySelector('[data-kind="fail"]').click();
  h.rows()[0].querySelector('input[type="checkbox"]').click();
  h.button('重试选中').click(); await tick();
  assert.deepEqual(h.retried, [['f1']]);
  h.dom.window.close();
});
