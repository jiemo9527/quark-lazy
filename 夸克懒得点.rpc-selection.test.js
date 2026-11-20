const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '夸克懒得点.user.js'), 'utf8');

function block(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}

function harness(host, stored, settings = makeSettings()) {
  const dom = new JSDOM('<select id="server"></select><select id="path"></select><button></button>', { url: `https://${host}/` });
  const { document } = dom.window;
  const selectServer = document.querySelector('#server'), selectPath = document.querySelector('#path');
  let pushes = 0;
  const context = vm.createContext({ location: dom.window.location, document, settings, selectServer, selectPath,
    btnSend: document.querySelector('button'), WIN_DEFAULT_PATH: '/downloads',
    GM_getValue: (key, fallback) => Object.hasOwn(stored, key) ? structuredClone(stored[key]) : fallback,
    GM_setValue: (key, value) => { stored[key] = structuredClone(value); },
    WebDAV: { push: () => pushes++ }, console: { log() {} } });
  vm.runInContext(block('  function canonicalHost(', '  const STORAGE_KEY =') +
    block('    const ACTIVE_KEY =', '    const ON_QUARK =') +
    block('      function getPathById(', '      // ===== 夸克独立发送') +
    block('      selectServer.onchange =', '      btnSend.onclick =') + '\nsyncUIState();', context);
  function change(select, value) {
    select.value = value;
    assert.equal(select.value, value, '测试选项必须存在');
    select.dispatchEvent(new dom.window.Event('change'));
  }
  return { dom, context, selectServer, selectPath, settings, get pushes() { return pushes; },
    chooseServer: (index) => change(selectServer, String(index)), choosePath: (dir) => change(selectPath, dir),
    sync: () => vm.runInContext('syncUIState()', context),
    active: () => JSON.parse(vm.runInContext('JSON.stringify({ rpcId: resolveActive().rpc.id, dir: resolveActive().dir })', context)) };
}

function makeSettings() {
  return {
    rpcConfigs: ['a', 'b', 'c'].map((id) => ({ id, name: id, domain: `https://${id}.example.test`, port: '443' })),
    downloadPaths: ['a', 'b', 'c'].flatMap((id) => [1, 2].map((n) => ({ id: `${id}${n}`, path: `/downloads/${id}${n}` }))),
    rpcPathBindings: Object.fromEntries(['a', 'b', 'c'].map((id) => [id, { pathIds: [`${id}1`, `${id}2`], defaultPathId: `${id}1` }]))
  };
}

const SITES = ['pan.quark.cn', 'drive.uc.cn', 'cloud.189.cn', 'pan.xunlei.com', 'yun.139.com',
  'yun.123pan.cn', '115.com', 'pan.baidu.com', 'www.guangyapan.com'];

function syncHarness(stored) {
  const context = vm.createContext({
    WEBDAV_CONF_KEY: 'webdav_config', STORAGE_KEY: 'blocked_users_v2', WARNING_KEY: 'warning_users_v2',
    LOG_KEY: 'auto_save_logs', SYNC_AUDIT_KEY: 'sync_audit_logs', AUTO_SAVE_ENABLED_KEY: 'auto_save_enabled',
    FEATURE_OPTIONS_KEY: 'qk_feature_options', RPC_FAILURE_KEY: 'rpc_failure_records_v1',
    GM_getValue: (key, fallback) => Object.hasOwn(stored, key) ? structuredClone(stored[key]) : fallback,
    GM_setValue: (key, value) => { stored[key] = structuredClone(value); },
    RpcHelper: { reloadSettings() {} }
  });
  vm.runInContext(block('  const SITE_LABELS =', '  function siteLabel(') +
    block('  const SYNC_EXCLUDED_KEYS =', '  const WebDAV =') +
    '\nglobalThis.sync = {' + block('    applyRemoteSettings: function', '    applyCloudData: function') + '};', context);
  return { collect: () => JSON.parse(vm.runInContext('JSON.stringify(collectSyncValues())', context)),
    restore: (data) => context.sync.applyRemoteSettings(data) };
}

test('各网盘分别记住 RPC 服务器及路径，刷新和其它网盘切换均不串用', () => {
  const stored = {}, pages = [];
  try {
    for (const [i, site] of SITES.entries()) {
      const h = harness(site, stored); pages.push(h);
      assert.deepEqual(h.active(), { rpcId: 'a', dir: '/downloads/a1' }, `${site} 首次进入使用默认值`);
      const index = i % 2 + 1, id = h.settings.rpcConfigs[index].id;
      h.chooseServer(index); h.choosePath(`/downloads/${id}2`);
      assert.equal(h.pushes, 2, '实际下拉事件沿用 WebDAV 同步');
    }
    for (const [i, site] of SITES.entries()) {
      const expected = { rpcId: i % 2 ? 'c' : 'b', dir: `/downloads/${i % 2 ? 'c' : 'b'}2` };
      pages[i].sync();
      assert.deepEqual(pages[i].active(), expected, `${site} 已打开页面不受其它网盘影响`);
      const fresh = harness(site, stored); pages.push(fresh);
      assert.deepEqual(fresh.active(), expected, `${site} 刷新后保持自己的选择`);
      assert.equal(fresh.selectServer.value, String(i % 2 + 1));
      assert.equal(fresh.selectPath.value, expected.dir);
    }
  } finally { pages.forEach((h) => h.dom.window.close()); }
});

test('各站选择随完整快照备份恢复，缺少 GM_listValues 时仍完整收集', () => {
  const stored = {}, pages = [];
  try {
    for (const site of SITES) {
      const h = harness(site, stored); pages.push(h);
      h.chooseServer(1); h.choosePath('/downloads/b2');
    }
    const values = syncHarness(stored).collect();
    const restored = {};
    syncHarness(restored).restore({ values });
    for (const site of SITES) {
      const h = harness(site, restored); pages.push(h);
      assert.deepEqual(h.active(), { rpcId: 'b', dir: '/downloads/b2' }, `${site} 恢复自己的选择`);
    }
  } finally { pages.forEach((h) => h.dom.window.close()); }
});

for (const [main, mirror] of [['pan.baidu.com', 'yun.baidu.com'],
  ['yun.123pan.cn', 'www.123pan.com'], ['yun.123pan.cn', 'www.123684.com'],
  ['yun.123pan.cn', 'www.123865.com'], ['yun.123pan.cn', 'www.123912.com'], ['yun.123pan.cn', 'www.123952.com']]) {
  test(`${mirror} 与同网盘主站共用选择`, () => {
    const stored = {}, a = harness(main, stored);
    let b;
    try {
      a.chooseServer(1); a.choosePath('/downloads/b2');
      b = harness(mirror, stored);
      assert.deepEqual(b.active(), { rpcId: 'b', dir: '/downloads/b2' });
      b.chooseServer(2); a.sync();
      assert.deepEqual(a.active(), { rpcId: 'c', dir: '/downloads/c1' });
    } finally { a.dom.window.close(); b?.dom.window.close(); }
  });
}

test('旧版全局选择不串入新网盘，服务器删除后只修复当前网盘', () => {
  const stored = { rpc_active_v1: { rpcId: 'c', dir: '/downloads/legacy' } };
  const a = harness('pan.quark.cn', stored), b = harness('115.com', stored);
  let fresh;
  try {
    assert.deepEqual(a.active(), { rpcId: 'a', dir: '/downloads/a1' });
    a.chooseServer(1); b.chooseServer(2); b.choosePath('/downloads/c2');
    const settings = makeSettings(); settings.rpcConfigs.reverse();
    fresh = harness('pan.quark.cn', stored, settings);
    assert.deepEqual(fresh.active(), { rpcId: 'b', dir: '/downloads/b1' }, '按稳定 ID 恢复，不使用旧下标');
    fresh.settings.rpcConfigs = fresh.settings.rpcConfigs.filter((rpc) => rpc.id !== 'b'); fresh.sync();
    assert.deepEqual(fresh.active(), { rpcId: 'c', dir: '/downloads/c1' });
    b.sync(); assert.deepEqual(b.active(), { rpcId: 'c', dir: '/downloads/c2' }, '修复不影响另一网盘的路径');
    assert.deepEqual(stored.rpc_active_v1, { rpcId: 'c', dir: '/downloads/legacy' }, '不改写旧版兼容数据');
  } finally { a.dom.window.close(); b.dom.window.close(); fresh?.dom.window.close(); }
});
