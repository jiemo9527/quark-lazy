const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '夸克懒得点.user.js'), 'utf8');

function block(begin, end) {
  const a = source.indexOf(begin), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing ${begin}`);
  return source.slice(a, b);
}
function harness(site, enabled = true) {
  const saved = { red: [], orange: [] };
  const rendered = [];
  const context = vm.createContext({
    SITE_HOST: site, Set,
    location: { href: `https://${site}/s/example`, pathname: '/s/example' },
    featureEnabled: (key) => { assert.equal(key, ({ '115.com': '115ShareSharerFilter', 'pan.baidu.com': 'baiduShareSharerFilter', 're0.me': '115ShareSharerFilter' })[site]); return enabled; },
    getBlockedList: () => saved.red, getWarningList: () => saved.orange,
    setBlockedList: (items) => { saved.red = items; }, setWarningList: (items) => { saved.orange = items; },
    getEntrySite: (u) => u.site, siteLabel: (s) => s,
    computeStringHash: (s) => `hash:${s}`,
    showBlockedOverlay: (u) => rendered.push(['red', u.name]),
    showWarningToast: (u) => rendered.push(['orange', u.name]),
    showShareSourceControls: () => {},
    document: { body: {}, getElementById: () => ({ dataset: { sharer: '115.com|hash:115:42|甲' }, replaceChildren() {}, append() {} }), createElement: () => ({ style: {}, dataset: {}, replaceChildren() {}, append() {} }) },
    URL, URLSearchParams,
    notifyToast: () => {},
    WebDAV: { push() {} }
  });
  const filterBlock = block('  const shareFilterKeys = {', '  // 115 保存记录：');
  vm.runInContext(filterBlock + '\nglobalThis.filter = applyShareSourceFilter;', context);
  return { filter: context.filter, saved, rendered };
}

test('115/百度/天翼/139/迅雷/123/UC each have a dedicated share-filter switch', () => {
  for (const [site, key] of Object.entries({
    '115.com': '115ShareSharerFilter', 'drive.uc.cn': 'ucShareSharerFilter',
    'pan.baidu.com': 'baiduShareSharerFilter', 'yun.139.com': 'mcloudShareSharerFilter',
    'cloud.189.cn': 'tcloudShareSharerFilter', 'pan.xunlei.com': 'xunleiShareSharerFilter',
    'yun.123pan.cn': '123panShareSharerFilter'
  })) {
    assert.ok(source.includes(`'${site}': [['${key}', '分享来源红/橙名单过滤']`));
  }
});

test('filter uses the saved site exact sharer name and stable hash', () => {
  const h = harness('115.com');
  h.saved.red.push({ site: '115.com', name: '甲', hash: 'hash:115:42', sharerId: '42' });
  h.saved.orange.push({ site: '115.com', name: '乙', hash: 'hash:115:43', sharerId: '43' });
  assert.equal(h.filter({ name: '甲', id: '42', site: '115.com' }), 'blocked');
  assert.equal(h.filter({ name: '乙', id: '43', site: '115.com' }), 'warning');
  assert.deepEqual(h.rendered, [['red', '甲'], ['orange', '乙']]);
  assert.equal(h.filter({ name: '甲', id: '999', site: '115.com' }), 'allow');
});

test('filter does not cross-match sites, disable switch or guess identity from absent IDs', () => {
  const h = harness('115.com');
  h.saved.red.push({ site: 'pan.baidu.com', name: '甲', hash: 'hash:115:42' });
  assert.equal(h.filter({ name: '甲', id: '42', site: '115.com' }), 'allow');
  assert.equal(h.filter({ name: '甲', site: '115.com' }), 'unknown');
  assert.equal(harness('115.com', false).filter({ name: '甲', id: '42', site: '115.com' }), 'disabled');
});

test('share-source UI offers red/orange controls before saving and persists site-scoped identity', () => {
  assert.match(source, /function showShareSourceControls\(/);
  assert.match(source, /setBlockedList\([\s\S]*setWarningList\(/);
  assert.match(source, /showShareSourceControls\(user\)/);
});

test('115 share pages no longer show the bottom-right sharer list controls', () => {
  const nodes = new Map();
  const make = (tag) => ({ tag, style: {}, dataset: {}, children: [], append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; } });
  const context = vm.createContext({
    SITE_HOST: '115cdn.com',
    document: { body: { appendChild(el) { nodes.set(el.id, el); } }, getElementById: (id) => nodes.get(id), createElement: make },
    featureEnabled: () => true, siteLabel: () => '115', getEntrySite: (u) => u.site
  });
  vm.runInContext(block('  const shareFilterKeys = {', '  // 各网盘按站点分别匹配分享者') + '\nglobalThis.show = showShareSourceControls;', context);
  context.show({ name: '阿***斯', site: '115.com', hash: 'h1', sharerId: '90001241' });
  assert.equal(nodes.get('qk-share-source-controls'), undefined);
});

test('red/amber actions from share page update the same-site lists and display immediate feedback', () => {
  const nodes = new Map();
  const make = (tag) => ({ tag, style: {}, dataset: {}, children: [], append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; } });
  const blocked = [], warnings = [], shown = [];
  const context = vm.createContext({
    SITE_HOST: 'pan.baidu.com',
    document: { body: { appendChild(el) { nodes.set(el.id, el); } }, getElementById: (id) => nodes.get(id), createElement: make },
    featureEnabled: (key) => { assert.equal(key, 'baiduShareSharerFilter'); return true; }, siteLabel: () => '百度', getEntrySite: (u) => u.site,
    getBlockedList: () => blocked, getWarningList: () => warnings,
    setBlockedList: (list) => { blocked.splice(0, blocked.length, ...list); },
    setWarningList: (list) => { warnings.splice(0, warnings.length, ...list); },
    showBlockedOverlay: (u) => shown.push(['blocked', u.name]),
    showWarningToast: (u) => shown.push(['warning', u.name]),
    WebDAV: { push() {} }
  });
  vm.runInContext(block('  const shareFilterKeys = {', '  // 各网盘按站点分别匹配分享者') + '\nglobalThis.show = showShareSourceControls;', context);
  const user = { name: '甲', site: 'pan.baidu.com', hash: 'h1' };
  context.show(user);
  const controls = nodes.get('qk-share-source-controls');
  assert.deepEqual(controls.children.slice(1).map((el) => el.textContent), ['加入红名单', '加入橙名单']);
  controls.children[1].onclick();
  assert.equal(blocked.length, 1);
  controls.children[2].onclick();
  assert.equal(blocked.length, 0);
  assert.equal(warnings.length, 1);
  assert.deepEqual(shown, [['blocked', '甲'], ['warning', '甲']]);
});

test('masked or nonnumeric 115 user IDs are ignored even when masked names collide', () => {
  const h = harness('115.com');
  h.saved.red.push({ site: '115.com', name: 'a******b', hash: 'hash:115:a******b', sharerId: 'a******b' });
  assert.equal(h.filter({ site: '115.com', name: 'a******b', id: 'a******b' }), 'unknown');
  assert.equal(h.filter({ site: '115.com', name: 'a******b', id: 'not-an-id' }), 'unknown');
  assert.deepEqual(h.rendered, []);
});

test('115 list does not match hash-only legacy entries; must retain exact numeric sharerId', () => {
  const h = harness('115.com');
  h.saved.red.push({ site: '115.com', name: 'a******b', hash: 'hash:115:42' });
  assert.equal(h.filter({ site: '115.com', name: 'a******b', id: '42' }), 'allow');
  h.saved.red[0].sharerId = '42';
  assert.equal(h.filter({ site: '115.com', name: 'another mask', id: '42' }), 'blocked');
});

test('115 matching numeric ID does not override a different explicit sharerId', () => {
  const h = harness('115.com');
  h.saved.red.push({ site: '115.com', name: '甲', hash: 'hash:115:42', sharerId: '99' });
  assert.equal(h.filter({ site: '115.com', name: '甲', id: '42' }), 'allow');
});

test('115 masked display names do not determine identity; stable user_id alone does', () => {
  const h = harness('115.com');
  h.saved.red.push({ site: '115.com', name: 'a******b', hash: 'hash:115:42', sharerId: '42' });
  assert.equal(h.filter({ site: '115.com', name: 'a******b', id: '99' }), 'allow');
  assert.equal(h.filter({ site: '115.com', name: 'another mask', id: '42' }), 'blocked');
  assert.equal(h.filter({ site: '115.com', name: 'a******b', id: 'a******b' }), 'unknown');
});

test('115 accepts a stable numeric sharer ID even when nickname is absent; avoids stale masked-name matching', () => {
  const h = harness('115.com');
  h.saved.red.push({ site: '115.com', name: 'a******b', hash: 'hash:115:42', sharerId: '42' });
  assert.equal(h.filter({ site: '115.com', name: '', id: '42' }), 'blocked');
  assert.equal(h.filter({ site: '115.com', name: 'a******b', id: '' }), 'unknown');
});

test('Baidu stable share_uk matches despite display-name changes and rejects masked IDs', () => {
  const h = harness('pan.baidu.com');
  h.saved.red.push({ site: 'pan.baidu.com', name: '旧昵称', hash: 'hash:baidu:123456' });
  assert.equal(h.filter({ site: 'pan.baidu.com', name: '新昵称', id: '123456' }), 'blocked');
  assert.equal(h.filter({ site: 'pan.baidu.com', name: '旧昵称', id: '1***6' }), 'unknown');
});

test('115 identity survives cloud-list normalization and deduplicates by numeric ID', () => {
  const context = vm.createContext({
    computeStringHash: (s) => `hash:${s}`,
    getEntrySite: (u) => u.site || '115.com',
    GM_getValue: () => null
  });
  const start = source.indexOf('    normalizeUserItem: function (u) {');
  const end = source.indexOf('    normalizeLogs: function (logs) {', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext('globalThis.webdav = {' + source.slice(start, end) + '};', context);
  const user = context.webdav.normalizeUserItem({ site: '115.com', name: 'a******b', hash: 'hash:115:42', sharerId: '42' });
  assert.equal(user.sharerId, '42');
  assert.equal(context.webdav.userKey(user), '115.com::id:42');
  const legacy = context.webdav.normalizeUserItem({ site: '115.com', name: 'a******b', hash: 'hash:115:42' });
  assert.equal(legacy.sharerId, undefined);
  assert.notEqual(context.webdav.userKey(legacy), context.webdav.userKey(user));
});

test('115 save log uses numeric user_id as sharer, not masked nickname', () => {
  const entries = [];
  const context = vm.createContext({
    location: { href: 'https://115cdn.com/s/abc' },
    recordShareSaveLog: (entry) => entries.push(entry),
    is115SharerId: (id) => /^\d+$/.test(String(id || '')),
    computeStringHash: (s) => `hash:${s}`
  });
  vm.runInContext(block('  function record115SaveLog(', '  // 百度分享者信息') + '\nglobalThis.record = record115SaveLog;', context);
  context.record({ share: 'abc', code: '1234', title: '标题', user: { user_id: '10090897', user_name: '1***7' } });
  assert.equal(entries[0].name, '10090897');
  assert.equal(entries[0].sharerId, '10090897');
  assert.equal(entries[0].hash, 'hash:115:10090897');
});

test('115 log with no verified user ID does not use masked nickname as sharer', () => {
  const entries = [];
  const context = vm.createContext({
    location: { href: 'https://115cdn.com/s/abc' },
    recordShareSaveLog: (entry) => entries.push(entry),
    is115SharerId: (id) => /^\d+$/.test(String(id || '')),
    computeStringHash: (s) => `hash:${s}`
  });
  vm.runInContext(block('  function record115SaveLog(', '  // 百度分享者信息') + '\nglobalThis.record = record115SaveLog;', context);
  context.record({ share: 'abc', title: '标题', user: { user_name: '1***7' } });
  assert.equal(entries[0].name, '');
  assert.equal(entries[0].hash, '');
  assert.equal(entries[0].sharerId, undefined);
});

test('115 saved log preserves numeric sharer ID for red/amber list action', () => {
  assert.match(source, /sharerId: entry\.sharerId/);
  assert.match(source, /hash: validUserId \? computeStringHash\(`115:\$\{userId\}`\)/);
  assert.match(source, /sharerId: String\(userId\)/);
});

test('115 source check from RE0 uses 115 feature key rather than the origin host', () => {
  const h = harness('re0.me');
  h.saved.red.push({ site: '115.com', name: '甲', hash: 'hash:115:42', sharerId: '42' });
  assert.equal(h.filter({ site: '115.com', name: '甲', id: '42' }), 'blocked');
});

test('115 on 115cdn maps its settings to 115.com without misrouting other sites', () => {
  const context = vm.createContext({ URL, SITE_HOST: '115cdn.com', canonicalHost: (host) => host });
  vm.runInContext(block('  function getEntrySite(', '  // 日志分三类：') + '\nglobalThis.pick = (list) => getSiteEntries(list, is115RelatedHost() ? "115.com" : SITE_HOST);', context);
  const result = context.pick([{ site: '115.com', name: '甲' }, { site: 'pan.baidu.com', name: '乙' }]);
  assert.deepEqual(Array.from(result, (item) => item.name), ['甲']);
});

test('115cdn and RE0 menu expose 115 lists and filter settings without RPC mount', () => {
  assert.match(source, /function is115RelatedHost\(/);
  assert.match(source, /GM_registerMenuCommand\('设置', \(\) => RpcHelper\.openSettings\(\)\)/);
  assert.match(source, /getSiteEntries\([\s\S]*115\.com/);
});

test('duplicate by share code across 115 aliases and extraction codes, but not other domains', () => {
  const context = vm.createContext({
    URL,
    getLogs: () => [
      { kind: 'save', site: '115.com', url: 'https://115.com/s/abc?password=old1' },
      { kind: 'save', site: '115.com', url: 'https://115cdn.com/s/xyz?password=new1' },
      { kind: 'save', site: 'pan.baidu.com', url: 'https://115cdn.com/s/other' }
    ],
    getLogKind: (x) => x.kind, getEntrySite: (x) => x.site
  });
  vm.runInContext(block('  function get115ShareCode(', '  const pending115Transfers = new Set();') + '\nglobalThis.saved = has115SavedShare;', context);
  assert.equal(context.saved('abc'), true);
  assert.equal(context.saved('xyz'), true);
  assert.equal(context.saved('other'), false);
  assert.equal(context.saved('ab'), false);
});

test('HDHive one-click transfer re-saves a recorded share and keeps the button clickable', () => {
  const start = source.indexOf('    async function finishTransfer(parsed, button, sourceUrl) {');
  const body = source.slice(start, source.indexOf('    function watchJob(', start));
  assert.ok(start > 0);
  assert.match(body, /曾保存过[\s\S]*正在再次转存/);
  assert.doesNotMatch(body, /has115SavedShare\([^)]*\)\)\s*(return|throw)/);
  assert.match(body, /setBusy\(button, ''\);\s*button\.textContent = result\.already/);
  const version = source.match(/\/\/ @version\s+([\d.]+)/);
  assert.ok(version && Number(version[1]) >= 1.03, '脚本版本不应低于此功能引入版本');
});

test('HDHive one-click transfer targets /ovo, resolved only after sharer check passes', async () => {
  for (const [decision, expected] of [['allow', ['snap', 'ovo', 'receive:98']], ['blocked', ['snap']]]) {
    const actions = [];
    const context = vm.createContext({
      URL, URLSearchParams, getLogs: () => [], location: { href: 'https://re0.me/resource/115/abc' }, SITE_HOST: 're0.me',
      gm115Json: async (method, url, body) => {
        if (method === 'GET') { actions.push('snap'); return { state: true, data: { userinfo: { user_id: '42' }, list: [] } }; }
        actions.push(`receive:${body.get('cid')}`); return { state: true };
      },
      resolve115OvoFolder: async () => { actions.push('ovo'); return '98'; },
      applyShareSourceFilter: () => decision, shareFilterEnabled: () => true, show115ShareIdentity: () => {},
      record115SaveLog: () => {}, notifyToast: () => {}
    });
    vm.runInContext(block('  function get115ShareCode(', '  const shareFilterKeys = {').replace(/  async function find115OvoFolder\(\)[\s\S]*?\n  const pending115Transfers/, '  const pending115Transfers') + '\nglobalThis.transfer = doHdhiveTransfer;', context);
    const run = context.transfer({ share: 'abc', code: '1234' }, 'https://re0.me/x', { ovo: true });
    if (decision === 'blocked') await assert.rejects(run, /红名单/); else assert.equal((await run).cid, '98');
    assert.deepEqual(actions, expected);
  }
});

test('HDHive call sites request /ovo and return button opens it', () => {
  const finish = source.slice(source.indexOf('    async function finishTransfer('), source.indexOf('    function watchJob('));
  assert.match(finish, /doHdhiveTransfer\(parsed, sourceUrl, \{ ovo: true \}\)/);
  assert.match(finish, /showHdhiveReturnButton\(\{ cid: result\.cid \}\)/);
  assert.match(source, /doHdhiveTransfer\(parsed, jobs\[token\]\.source, \{ ovo: true \}\)\s*\.then\(\(result\) => showHdhiveReturnButton\(\{ cid: result\.cid, sameWindow: true, persistent: true \}\)\)/);
  assert.doesNotMatch(source, /转存到 115 根目录；会消耗/);
});

test('115 quick transfer allows saving a share already recorded before', async () => {
  const requests = [];
  const context = vm.createContext({
    URL, URLSearchParams, location: { href: 'https://re0.me/resource/115/abc' },
    gm115Json: async (method) => { requests.push(method); return method === 'GET' ? { state: true, data: { userinfo: { user_id: '42', user_name: '甲' }, list: [] } } : { state: true }; },
    applyShareSourceFilter: () => 'allow', shareFilterEnabled: () => true, show115ShareIdentity: () => {},
    getLogs: () => [{ site: '115.com', kind: 'save', url: 'https://115cdn.com/s/abc?password=1234' }],
    getLogKind: (x) => x.kind, getEntrySite: (x) => x.site,
    record115SaveLog: () => {}, notifyToast: () => {}
  });
  vm.runInContext(block('  function get115ShareCode(', '  const shareFilterKeys = {') + '\nglobalThis.transfer = doHdhiveTransfer;', context);
  await context.transfer({ share: 'abc', code: '1234' });
  assert.deepEqual(requests, ['GET', 'POST']);
});

test('115 quick transfer does not mistake a different share or unrelated RPC log for duplicate', async () => {
  const requests = [];
  const context = vm.createContext({
    URL, URLSearchParams, location: { href: 'https://re0.me/resource/115/abc' },
    gm115Json: async (method) => { requests.push(method); return method === 'GET' ? { state: true, data: { userinfo: { user_id: '42', user_name: '甲' }, list: [] } } : { state: true }; },
    applyShareSourceFilter: () => 'allow', shareFilterEnabled: () => true, show115ShareIdentity: () => {},
    getLogs: () => [{ site: '115.com', kind: 'rpc', url: 'https://115cdn.com/s/abc' }, { site: '115.com', kind: 'save', url: 'https://115cdn.com/s/abcd' }],
    getLogKind: (x) => x.kind, getEntrySite: (x) => x.site,
    record115SaveLog: () => {}, notifyToast: () => {}
  });
  vm.runInContext(block('  function get115ShareCode(', '  const shareFilterKeys = {') + '\nglobalThis.transfer = doHdhiveTransfer;', context);
  await context.transfer({ share: 'abc', code: '1234' });
  assert.deepEqual(requests, ['GET', 'POST']);
});

test('concurrent 115 one-click transfers of same share cannot both POST receive', async () => {
  const requests = [];
  let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  const context = vm.createContext({
    URL, URLSearchParams, getLogs: () => [], location: { href: 'https://re0.me/' },
    gm115Json: async (method) => { requests.push(method); if (method === 'GET') { await gate; return { state: true, data: { userinfo: { user_id: '42', user_name: '甲' }, list: [] } }; } return { state: true }; },
    applyShareSourceFilter: () => 'allow', show115ShareIdentity: () => {},
    record115SaveLog: () => {}, notifyToast: () => {}
  });
  vm.runInContext(block('  function get115ShareCode(', '  const shareFilterKeys = {') + '\nglobalThis.transfer = doHdhiveTransfer;', context);
  const first = context.transfer({ share: 'abc', code: '1234' });
  await assert.rejects(context.transfer({ share: 'abc', code: '1234' }), /正在转存/);
  resume(); await first;
  assert.deepEqual(requests, ['GET', 'POST']);
});

test('115 quick transfer checks snap identity before POST receive, including on RE0 host', async () => {
  const requests = [];
  const context = vm.createContext({
    URL, URLSearchParams, getLogs: () => [], location: { href: 'https://re0.me/resource/115/abc' }, SITE_HOST: 're0.me',
    gm115Json: async (method, url) => {
      requests.push([method, url]);
      if (method === 'GET') return { state: true, data: { userinfo: { user_id: '42', user_name: 'a******b' }, list: [{ cid: '10' }] } };
      return { state: true };
    },
    applyShareSourceFilter: ({ site, id }) => { assert.equal(site, '115.com'); assert.equal(id, '42'); return 'blocked'; },
    show115ShareIdentity: () => {},
    record115SaveLog: () => { throw new Error('must not log blocked share'); },
    notifyToast: () => {}
  });
  vm.runInContext(block('  function get115ShareCode(', '  const shareFilterKeys = {') + '\nglobalThis.transfer = doHdhiveTransfer;', context);
  await assert.rejects(context.transfer({ share: 'abc', code: '1234' }), /红名单/);
  assert.deepEqual(requests.map(([method]) => method), ['GET']);
});

test('115 quick transfer with filter enabled refuses missing sharer ID before POST', async () => {
  const requests = [];
  const context = vm.createContext({
    URL, URLSearchParams, getLogs: () => [],
    gm115Json: async (method) => { requests.push(method); return { state: true, data: { userinfo: { user_name: 'a******b' }, list: [] } }; },
    applyShareSourceFilter: () => 'unknown', shareFilterEnabled: () => true, show115ShareIdentity: () => {},
    record115SaveLog: () => {}, notifyToast: () => {}, location: { href: 'https://re0.me/resource/115/abc' }
  });
  vm.runInContext(block('  function get115ShareCode(', '  const shareFilterKeys = {') + '\nglobalThis.transfer = doHdhiveTransfer;', context);
  await assert.rejects(context.transfer({ share: 'abc', code: '1234' }), /无法核实/);
  assert.deepEqual(requests, ['GET']);
});

test('115 quick transfer sends amber warning but allows receive; disabled filter does not interfere', async () => {
  for (const decision of ['warning', 'disabled']) {
    const requests = [];
    const context = vm.createContext({
      URL, URLSearchParams, getLogs: () => [], location: { href: 'https://re0.me/resource/115/abc' }, SITE_HOST: 're0.me',
      gm115Json: async (method) => { requests.push(method); return method === 'GET' ? { state: true, data: { userinfo: { user_id: '42', user_name: 'a******b' }, list: [] } } : { state: true }; },
      applyShareSourceFilter: () => decision, show115ShareIdentity: () => {}, record115SaveLog: () => {}, notifyToast: () => {}
    });
    vm.runInContext(block('  function get115ShareCode(', '  const shareFilterKeys = {') + '\nglobalThis.transfer = doHdhiveTransfer;', context);
    await context.transfer({ share: 'abc', code: '1234' });
    assert.deepEqual(requests, ['GET', 'POST']);
  }
});

test('metadata listeners evaluate sharers before save, with UC sharepage and 115 snap support', () => {
  assert.match(source, /conf\.info\.test\(url\)[\s\S]*applyShareSourceFilter/);
  assert.match(source, /share\/snap[\s\S]*applyShareSourceFilter/);
  assert.ok(source.includes('share\\/sharepage\\/detail') && source.includes("site: 'drive.uc.cn'"));
  assert.match(source, /function installBaiduShareSourceFilter\(/);
});
