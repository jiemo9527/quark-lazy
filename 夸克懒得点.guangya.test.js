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
function token(sub, expires = Math.floor(Date.now() / 1000) + 3600) {
  return ['e30', Buffer.from(JSON.stringify({ sub, exp: expires })).toString('base64url'), 'signature'].join('.');
}
function harness(fetchImpl, stored = {}) {
  const dom = new JSDOM('', { url: 'https://www.guangyapan.com/#/home/restore' });
  dom.window.AbortSignal = AbortSignal;
  const webToken = token('test-account');
  dom.window.localStorage.setItem('credentials_test', JSON.stringify({ access_token: webToken, sub: 'test-account' }));
  const calls = [];
  dom.window.fetch = async (url, options) => { calls.push({ url, ...options }); return fetchImpl(calls.at(-1), calls.length); };
  let pushes = 0;
  const context = vm.createContext({ document: dom.window.document, URL, Date, atob,
    getPageWindow: () => dom.window, crypto: require('node:crypto').webcrypto,
    GM_xmlhttpRequest: (options) => {
      const call = { url: options.url, method: options.method, headers: options.headers, body: options.data };
      calls.push(call);
      Promise.resolve().then(() => fetchImpl(call, calls.length)).then(async (r) => {
        options.onload({ status: r.status, responseText: JSON.stringify(await r.json()) });
      }, options.onerror);
      return { abort() {} };
    },
    GM_getValue: (key, fallback) => stored[key] ?? fallback,
    GM_setValue: (key, value) => { stored[key] = value; }, WebDAV: { push: () => pushes++ } });
  vm.runInContext(block('      const GUANGYA_API =', '      // ===== RPC 发送') +
    '\nglobalThis.getLink = guangyaGetDownloadUrl; globalThis.makeAuthSettings = typeof createGuangyaAuthSettings === "function" ? createGuangyaAuthSettings : undefined;', context);
  return { dom, context, calls, stored, webToken, get pushes() { return pushes; } };
}
const response = (data, code = 0, status = 200) => ({ status, ok: status >= 200 && status < 300,
  json: async () => ({ code, msg: code ? 'request rejected' : 'success', data }) });

test('光鸭网页失败后使用同账号客户端凭据取链，成功即停止', async () => {
  const clientToken = token('test-account', Math.floor(Date.now() / 1000) + 7200);
  const h = harness((call) => call.headers.Authorization === `Bearer ${clientToken}` && call.headers.dt === '5'
    ? response({ signedURL: 'https://download.example.test/file' }) : response({}, 254),
  { guangya_client_auth_v1: { access_token: clientToken, sub: 'test-account' } });
  try {
    assert.equal(await h.context.getLink('test-file'), 'https://download.example.test/file');
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[0].headers.dt, '4'); assert.equal(h.calls[1].headers.dt, '5');
    assert.equal(h.calls[1].headers.Authorization, `Bearer ${clientToken}`);
    assert.deepEqual(JSON.parse(h.calls[1].body), { fileId: 'test-file' });
  } finally { h.dom.window.close(); }
});

test('网页成功不触发客户端通道；每次新取链仍从网页开始', async () => {
  const h = harness(() => response({ signedURL: 'https://download.example.test/web' }));
  try {
    await h.context.getLink('a'); await h.context.getLink('b');
    assert.equal(h.calls.length, 2);
    assert.ok(h.calls.every((call) => call.headers.dt === '4'));
  } finally { h.dom.window.close(); }
});

for (const failure of ['network', 'http', 'business-string', 'empty-link', 'invalid-json']) {
  test(`${failure} 失败只切换一次备用通道`, async () => {
    const h = harness((call, count) => {
      if (count > 1) return response({ downloadUrl: 'https://download.example.test/client' });
      if (failure === 'network') throw new Error('network');
      if (failure === 'http') return response({ signedURL: 'https://download.example.test/invalid' }, 0, 503);
      if (failure === 'business-string') return response({}, '254');
      if (failure === 'invalid-json') return { status: 200, ok: true, json: async () => { throw new Error('invalid'); } };
      return response({ signedURL: 'javascript:invalid' });
    }, { guangya_client_auth_v1: { access_token: token('test-account') } });
    try {
      assert.equal(await h.context.getLink('test-file'), 'https://download.example.test/client');
      assert.equal(h.calls.length, 2);
      assert.ok(h.calls.every((call) => call.signal instanceof AbortSignal));
    } finally { h.dom.window.close(); }
  });
}

for (const [label, saved, expected] of [
  ['未配置', null, /未配置客户端/],
  ['过期', { access_token: token('test-account', 1) }, /已过期/],
  ['异账号', { access_token: token('another-account') }, /账号不一致/]
]) {
  test(`客户端${label}不发送备用请求，保留双通道失败原因`, async () => {
    const h = harness(() => response({}, 254), { guangya_client_auth_v1: saved });
    try {
      await assert.rejects(h.context.getLink('test-file'), (e) => /网页：.*254/.test(e.message) && expected.test(e.message));
      assert.equal(h.calls.length, 1);
    } finally { h.dom.window.close(); }
  });
}

test('两个通道均失败后停止，不递归重试', async () => {
  const h = harness(() => response({}, 254), { guangya_client_auth_v1: { access_token: token('test-account') } });
  try {
    await assert.rejects(h.context.getLink('test-file'), /双通道取链失败.*网页：.*254.*客户端：.*254/);
    assert.equal(h.calls.length, 2);
  } finally { h.dom.window.close(); }
});

test('授权界面移除手动 Token 导入，已登录收起表单且保留原凭据', () => {
  const value = token('test-account'), stored = { guangya_client_auth_v1: { access_token: value, refresh_token: 'fixture' } };
  const h = harness(() => { throw new Error('界面不应发送请求'); }, stored);
  try {
    const s = h.context.makeAuthSettings(); h.dom.window.document.body.append(s);
    assert.equal(s.querySelector('[aria-label="光鸭客户端 Access Token"]'), null);
    assert.equal(s.querySelector('details'), null);
    assert.equal(s.querySelector('[data-guangya-login-form]').hidden, true);
    assert.match(s.querySelector('[data-guangya-auth-badge]').textContent, /已授权/);
    const buttons = [...s.querySelectorAll('button')];
    buttons.find((b) => b.textContent === '重新登录').click();
    assert.equal(s.querySelector('[data-guangya-login-form]').hidden, false);
    buttons.find((b) => b.textContent === '取消登录').click();
    assert.equal(s.querySelector('[data-guangya-login-form]').hidden, true);
    assert.equal(stored.guangya_client_auth_v1.access_token, value);
    buttons.find((b) => b.textContent === '清除授权').click();
    assert.equal(stored.guangya_client_auth_v1, null);
    assert.equal(s.querySelector('[data-guangya-login-form]').hidden, false);
    assert.equal(h.pushes, 1); assert.equal(h.calls.length, 0);
  } finally { h.dom.window.close(); }
});

test('网页凭据过期但仍可识别同账号时，允许有效客户端备用通道', async () => {
  const h = harness(() => response({ signedURL: 'https://download.example.test/client' }),
    { guangya_client_auth_v1: { access_token: token('test-account') } });
  h.dom.window.localStorage.setItem('credentials_test', JSON.stringify({ access_token: h.webToken, expires_at: '2000-01-01T00:00:00Z' }));
  try {
    assert.equal(await h.context.getLink('test-file'), 'https://download.example.test/client');
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].headers.dt, '5');
  } finally { h.dom.window.close(); }
});

test('双通道回退接入真实发送流程，每个文件只构造一个 RPC 任务', async () => {
  const h = harness((call) => call.headers.dt === '5'
    ? response({ signedURL: 'https://download.example.test/file' }) : response({}, 254),
  { guangya_client_auth_v1: { access_token: token('test-account') } });
  const sent = [], errors = [];
  Object.assign(h.context, { sending: false, QUARK_LINK_BATCH: 20, QUARK_CONFIRM_OVER: 100,
    resolveActive: () => ({ rpc: { name: 'test' }, dir: '/downloads' }),
    joinDir: (dir) => dir, setBusy() {}, setSendText() {}, resetSessionFailures() {}, recordRpcLog() {}, notifyToast() {},
    playRpcResultSound() {}, probeRpc: async () => ({ ok: true }),
    console: { warn() {}, error: (...args) => errors.push(args) },
    aria2Multicall: async (_rpc, calls) => { sent.push(...calls); return calls.map(() => ['test-gid']); },
    classifyRpcResult: () => ({ ok: true }) });
  vm.runInContext(block('      function buildAddUri(', '      function summarizeFailures(') +
    block('      function settleLinks(', '      const ADAPTERS =') +
    block('      async function runFreshSend(', '      // ===== 重试：') + '\nglobalThis.send = runFreshSend;', h.context);
  try {
    await h.context.send({ label: '光鸭', collect: async () => [{ fileId: 'test-file', name: 'example.mkv' }],
      nameOf: (f) => f.name, ident: (f) => f, options: (f) => ({ out: f.name }),
      getLinks: (files) => h.context.getLink(files[0].fileId).then((link) => [{ link }]) });
    assert.deepEqual(errors, []); assert.equal(h.calls.length, 2); assert.equal(sent.length, 1);
    assert.equal(sent[0].methodName, 'aria2.addUri');
    assert.deepEqual(Array.from(sent[0].params[0]), ['https://download.example.test/file']);
  } finally { h.dom.window.close(); }
});

test('短信验证码登录按钮完成凭据保存，不自动发送、不保存手机号验证码', async () => {
  const raw = (data) => ({ status: 200, json: async () => data });
  const h = harness((call) => {
    if (call.url.endsWith('/shield/captcha/init')) return raw({ captcha_token: 'captcha-fixture' });
    if (call.url.endsWith('/auth/verification')) return raw({ verification_id: 'verification-fixture', is_user: true });
    if (call.url.endsWith('/auth/verification/verify')) return raw({ verification_token: 'verified-fixture' });
    if (call.url.endsWith('/auth/signin')) return raw({ access_token: token('test-account'), refresh_token: 'refresh-fixture' });
    throw new Error('Unexpected endpoint');
  });
  try {
    const section = h.context.makeAuthSettings(); h.dom.window.document.body.append(section);
    assert.equal(h.calls.length, 0);
    const phone = section.querySelector('input[type="tel"]'); assert.ok(phone, '缺少手机号输入框');
    phone.value = '13800000000';
    await [...section.querySelectorAll('button')].find((b) => b.textContent === '获取验证码').onclick();
    assert.equal(h.calls.length, 2);
    assert.ok(!h.stored.guangya_client_auth_v1);
    section.querySelector('[aria-label="短信验证码"]').value = '123456';
    await [...section.querySelectorAll('button')].find((b) => b.textContent === '验证码登录').onclick();
    assert.equal(h.calls.length, 4);
    assert.equal(h.stored.guangya_client_auth_v1.refresh_token, 'refresh-fixture');
    assert.equal(section.querySelector('[data-guangya-login-form]').hidden, true);
    assert.equal(section.querySelector('[data-guangya-auth-badge]').textContent, '已授权');
    assert.equal(phone.value, '');
    assert.equal(section.querySelector('[aria-label="短信验证码"]').value, '');
    const reopened = h.context.makeAuthSettings();
    assert.equal(reopened.querySelector('[data-guangya-login-form]').hidden, true);
    assert.ok(!JSON.stringify(h.stored).includes('13800000000'));
    assert.ok(!JSON.stringify(h.stored).includes('123456'));
    assert.equal(h.pushes, 1);
  } finally { h.dom.window.close(); }
});

test('未获取短信时真实点击验证码登录会明确提示而非静默禁用', () => {
  const h = harness(() => { throw new Error('不应发出请求'); });
  try {
    const s = h.context.makeAuthSettings(); h.dom.window.document.body.append(s);
    const login = [...s.querySelectorAll('button')].find((b) => b.textContent === '验证码登录');
    login.click();
    assert.match(s.querySelector('[role="status"]').textContent, /请先.*获取验证码/);
    assert.equal(login.disabled, false);
    assert.equal(h.calls.length, 0);
  } finally { h.dom.window.close(); }
});

test('短信发送后手机号未变化的输入事件不丢失会话，改号后点击登录说明原因', async () => {
  const h = harness((call) => ({ status: 200, json: async () => call.url.endsWith('/shield/captcha/init')
    ? { captcha_token: 'fixture' } : { verification_id: 'fixture' } }));
  try {
    const s = h.context.makeAuthSettings(); h.dom.window.document.body.append(s);
    const phone = s.querySelector('input[type="tel"]');
    const button = (text) => [...s.querySelectorAll('button')].find((b) => b.textContent === text);
    phone.value = '13800000000'; await button('获取验证码').onclick();
    phone.dispatchEvent(new h.dom.window.Event('input', { bubbles: true }));
    button('验证码登录').click();
    assert.match(s.querySelector('[role="status"]').textContent, /请输入短信验证码/);
    phone.value = '13900000000'; phone.dispatchEvent(new h.dom.window.Event('input', { bubbles: true }));
    button('验证码登录').click();
    assert.match(s.querySelector('[role="status"]').textContent, /手机号已更改.*重新获取验证码/);
    assert.equal(h.calls.length, 2);
  } finally { h.dom.window.close(); }
});

test('并发取链遇到到期凭据只续期一次，刷新后保持自动备用通道', async () => {
  let refreshes = 0;
  const h = harness((call) => {
    if (call.url.includes('account.guangyapan.com')) { refreshes++; return { status: 200, json: async () => ({ access_token: token('test-account'), refresh_token: 'rotated-fixture', expires_in: 3600 }) }; }
    return call.headers.dt === '13' ? response({ signedURL: 'https://download.example.test/client' }) : response({}, 254);
  }, { guangya_client_auth_v1: { access_token: token('test-account', 1), refresh_token: 'refresh-fixture', client_id: 'atcFkeidp8ndm9yC', device_id: 'device-fixture', dt: '13' } });
  try {
    assert.deepEqual(await Promise.all([h.context.getLink('a'), h.context.getLink('b')]), ['https://download.example.test/client', 'https://download.example.test/client']);
    assert.equal(refreshes, 1);
    assert.equal(h.stored.guangya_client_auth_v1.refresh_token, 'rotated-fixture');
    assert.equal(h.pushes, 1);
  } finally { h.dom.window.close(); }
});

test('客户端返回 401 后续期并只重试一次，避免无限循环', async () => {
  let clientCalls = 0, refreshes = 0;
  const h = harness((call) => {
    if (call.url.includes('account.guangyapan.com')) { refreshes++; return { status: 200, json: async () => ({ access_token: token('test-account', Math.floor(Date.now() / 1000) + 7200), refresh_token: 'rotated-fixture' }) }; }
    if (call.headers.dt === '4') return response({}, 254);
    clientCalls++;
    return clientCalls === 1 ? response({}, 0, 401) : response({ signedURL: 'https://download.example.test/client' });
  }, { guangya_client_auth_v1: { access_token: token('test-account'), refresh_token: 'refresh-fixture', client_id: 'atcFkeidp8ndm9yC', device_id: 'device-fixture', dt: '13' } });
  try {
    assert.equal(await h.context.getLink('a'), 'https://download.example.test/client');
    assert.equal(clientCalls, 2); assert.equal(refreshes, 1);
  } finally { h.dom.window.close(); }
});

test('取消或关闭短信登录期间的迟到响应不保存凭据', async () => {
  for (const mode of ['cancel', 'remove', 'clear']) {
    let finish;
    const h = harness((call) => {
      if (call.url.endsWith('/shield/captcha/init')) return { status: 200, json: async () => ({ captcha_token: 'fixture' }) };
      if (call.url.endsWith('/auth/verification')) return { status: 200, json: async () => ({ verification_id: 'fixture' }) };
      if (call.url.endsWith('/auth/verification/verify')) return { status: 200, json: async () => ({ verification_token: 'fixture' }) };
      return new Promise((resolve) => { finish = () => resolve({ status: 200, json: async () => ({ access_token: token('test-account'), refresh_token: 'fixture' }) }); });
    });
    try {
      const s = h.context.makeAuthSettings(); h.dom.window.document.body.append(s);
      const button = (name) => [...s.querySelectorAll('button')].find((b) => b.textContent === name);
      s.querySelector('input[type="tel"]').value = '13800000000'; await button('获取验证码').onclick();
      s.querySelector('[aria-label="短信验证码"]').value = '123456';
      const pending = button('验证码登录').onclick();
      while (!finish) await new Promise((resolve) => setImmediate(resolve));
      if (mode === 'remove') s.remove(); else button(mode === 'cancel' ? '取消登录' : '清除授权').click();
      finish(); await pending;
      assert.ok(!h.stored.guangya_client_auth_v1, mode);
    } finally { h.dom.window.close(); }
  }
});

test('人机验证或未注册账号立即停止，不自动注册或继续发送', async () => {
  for (const scenario of ['captcha', 'unregistered']) {
    const h = harness((call) => ({ status: 200, json: async () => call.url.endsWith('/shield/captcha/init')
      ? (scenario === 'captcha' ? { url: 'https://account.guangyapan.com/verify', captcha_token: 'fixture' } : { captcha_token: 'fixture' })
      : { verification_id: 'fixture', is_user: false } }));
    try {
      const s = h.context.makeAuthSettings(); h.dom.window.document.body.append(s);
      s.querySelector('input[type="tel"]').value = '13800000000';
      await [...s.querySelectorAll('button')].find((b) => b.textContent === '获取验证码').onclick();
      assert.equal(h.calls.length, scenario === 'captcha' ? 1 : 2);
      const login = [...s.querySelectorAll('button')].find((b) => b.textContent === '验证码登录');
      assert.equal(login.disabled, false); login.click();
      assert.match(s.querySelector('[role="status"]').textContent, scenario === 'captcha' ? /官方人机验证/ : /尚未注册/);
      assert.ok(!h.stored.guangya_client_auth_v1);
    } finally { h.dom.window.close(); }
  }
});

test('续期被清除时不恢复旧授权，失效刷新令牌只尝试一次', async () => {
  let finish;
  const saved = { access_token: token('test-account', 1), refresh_token: 'fixture', client_id: 'atcFkeidp8ndm9yC' };
  const h = harness((call) => call.url.includes('account.guangyapan.com')
    ? new Promise((resolve) => { finish = () => resolve({ status: 200, json: async () => ({ access_token: token('test-account'), refresh_token: 'new-fixture' }) }); })
    : response({}, 254), { guangya_client_auth_v1: saved });
  try {
    const pending = h.context.getLink('a');
    while (!finish) await new Promise((resolve) => setImmediate(resolve));
    const s = h.context.makeAuthSettings(); h.dom.window.document.body.append(s);
    [...s.querySelectorAll('button')].find((b) => b.textContent === '清除授权').click();
    finish(); await assert.rejects(pending, /授权已变化/); assert.equal(h.stored.guangya_client_auth_v1, null);
  } finally { h.dom.window.close(); }
  let count = 0;
  const bad = harness((call) => {
    if (call.url.includes('account.guangyapan.com')) { count++; return { status: 400, json: async () => ({ error: 'invalid_grant' }) }; }
    return response({}, 254);
  }, { guangya_client_auth_v1: { ...saved } });
  try {
    await assert.rejects(bad.context.getLink('a'), /invalid_grant/);
    await assert.rejects(bad.context.getLink('b'), /重新登录/);
    assert.equal(count, 1);
  } finally { bad.dom.window.close(); }
});

test('客户端完整凭据支持 WebDAV 备份恢复、无 GM_listValues 回退及清除同步', () => {
  const stored = { guangya_client_auth_v1: { access_token: 'access-fixture', refresh_token: 'refresh-fixture', device_id: 'device-fixture', expires_at: 1234 }, safe_setting: true };
  const constants = { WEBDAV_CONF_KEY: 'webdav_config', STORAGE_KEY: 'blocked_users_v2', WARNING_KEY: 'warning_users_v2',
    LOG_KEY: 'auto_save_logs', SYNC_AUDIT_KEY: 'sync_audit_logs', AUTO_SAVE_ENABLED_KEY: 'auto_save_enabled',
    FEATURE_OPTIONS_KEY: 'qk_feature_options', RPC_FAILURE_KEY: 'rpc_failure_records_v1', SITE_LABELS: {},
    GM_listValues: () => Object.keys(stored),
    GM_getValue: (key, fallback) => Object.hasOwn(stored, key) ? stored[key] : fallback,
    GM_setValue: (key, value) => { stored[key] = value; }, RpcHelper: { reloadSettings() {} } };
  const context = vm.createContext(constants);
  vm.runInContext(block('  const SYNC_EXCLUDED_KEYS =', '  const WebDAV =') +
    '\nglobalThis.collect = collectSyncValues; globalThis.sync = {' +
    block('    applyRemoteSettings: function', '    applyCloudData: function') + '};', context);
  const snapshot = context.collect();
  assert.equal(JSON.stringify(snapshot.guangya_client_auth_v1), JSON.stringify(stored.guangya_client_auth_v1));
  assert.equal(snapshot.safe_setting, true);
  delete context.GM_listValues;
  assert.equal(JSON.stringify(context.collect().guangya_client_auth_v1), JSON.stringify(stored.guangya_client_auth_v1));
  context.sync.applyRemoteSettings({ values: { guangya_client_auth_v1: { access_token: 'remote-fixture', refresh_token: 'remote-refresh-fixture' }, safe_setting: false } });
  assert.equal(stored.guangya_client_auth_v1.access_token, 'remote-fixture');
  assert.equal(stored.guangya_client_auth_v1.refresh_token, 'remote-refresh-fixture');
  assert.equal(stored.safe_setting, false);
  context.sync.applyRemoteSettings({ values: { guangya_client_auth_v1: null } });
  assert.equal(stored.guangya_client_auth_v1, null);
  assert.equal(context.collect().guangya_client_auth_v1, null);
});

