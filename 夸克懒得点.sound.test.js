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
function soundHarness() {
  const stored = {}, calls = { contexts: 0, notes: 0, timers: 0 };
  function AudioContext() {
    calls.contexts++; this.state = 'running'; this.currentTime = 0; this.destination = {};
    this.createOscillator = () => ({ frequency: {}, connect() {}, start() { calls.notes++; }, stop() {} });
    this.createGain = () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} });
  }
  const context = vm.createContext({ window: { AudioContext }, console, setTimeout: () => calls.timers++,
    GM_getValue: (key, fallback) => stored[key] ?? fallback, GM_setValue: (key, value) => { stored[key] = value; },
    FEATURE_OPTIONS_KEY: 'qk_feature_options' });
  vm.runInContext(block('  const featureEnabled =', '  const REDIRECT_PENDING_KEY') +
    block('  function playRpcResultSound()', '  function setLogs(') + '\nglobalThis.play = playRpcResultSound;', context);
  return { context, calls, stored };
}
test('关闭提示音后所有调用静音且不创建 AudioContext；重新开启立即恢复', () => {
  const h = soundHarness();
  h.stored.qk_feature_options = { rpcFailureSound: false };
  h.context.play();
  assert.equal(h.calls.contexts, 0);
  assert.equal(h.calls.notes, 0);
  assert.equal(h.calls.timers, 0);
  vm.runInContext("setFeatureEnabled('rpcFailureSound', true)", h.context);
  h.context.play();
  assert.equal(h.calls.contexts, 1);
  assert.equal(h.calls.notes, 4);
});
test('未配置音效开关保持原有默认开启行为', () => {
  const h = soundHarness(); h.context.play();
  assert.equal(h.calls.contexts, 1); assert.equal(h.calls.notes, 4);
});

test('设置中的提示音开关即时保存、重新打开保持状态，并随 WebDAV 同步', () => {
  const h = soundHarness();
  const dom = new JSDOM('<div id="settings"></div>');
  h.context.document = dom.window.document;
  let pushes = 0; h.context.WebDAV = { push: () => pushes++ };
  if (source.includes('  function createRpcSoundSwitch()')) {
    vm.runInContext(block('  function createRpcSoundSwitch()', '  function showSettingsPanel(') + '\nglobalThis.makeSwitch = createRpcSoundSwitch;', h.context);
  }
  assert.equal(typeof h.context.makeSwitch, 'function', '缺少设置中的音效开关');
  const row = h.context.makeSwitch(); dom.window.document.body.appendChild(row);
  assert.match(row.textContent, /RPC 失败提示音/);
  const input = row.querySelector('input[type="checkbox"]'); assert.ok(input.checked);
  input.click();
  assert.equal(h.stored.qk_feature_options.rpcFailureSound, false);
  assert.equal(pushes, 1); h.context.play(); assert.equal(h.calls.contexts, 0);
  const reopened = h.context.makeSwitch();
  assert.equal(reopened.querySelector('input').checked, false);
  input.click(); h.context.play(); assert.equal(h.calls.contexts, 1); assert.equal(pushes, 2);
  dom.window.close();
});

test('所有网盘专属设置都挂载共同音效开关，本站功能全选不修改音效', () => {
  const begin = source.indexOf("        const featurePage = document.createElement('div');");
  const end = source.indexOf('        if (features.length)', begin);
  assert.ok(begin > 0 && end > begin);
  assert.match(source.slice(begin, end), /featurePage\.appendChild\(createRpcSoundSwitch\(\)\)/);
  assert.match(source, /quickSection\.appendChild\(createRpcSoundSwitch\(\)\)/);
});
