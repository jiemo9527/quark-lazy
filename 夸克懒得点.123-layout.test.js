const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '夸克懒得点.user.js'), 'utf8');

function mount123(html) {
  const start = '        if (ON_123PAN) {\r\n          // 首页工具栏';
  const a = source.indexOf(start) >= 0 ? source.indexOf(start) : source.indexOf(start.replace(/\r/g, ''));
  const b = source.indexOf('        let targetParent = null;', a);
  assert.ok(a >= 0 && b > a, '123 首页独立行挂载分支存在');
  const dom = new JSDOM(html, { url: 'https://yun.123pan.cn/?homeFilePath=1' });
  const { document } = dom.window;
  const container = document.createElement('div');
  container.id = 'qk-rpc-container';
  let synced = 0;
  const context = vm.createContext({ document, container, ON_123PAN: true, syncUIState: () => synced++ });
  const mounted = vm.runInContext(`(() => { ${source.slice(a, b)} return false; })`, context);
  return { dom, document, container, mount: () => mounted(), get synced() { return synced; } };
}

const HOME = '<main><div class="homeClass"><div class="home-operator homeWebOperator"><div class="home-operator-button-group"><div class="file-operator-group"></div></div><div class="home-operator-group"></div></div><div class="home-nav"></div><div class="home-content"></div></div></main>';

test('123 首页把 RPC 按钮组放在工具栏下方独立一行，不挤进固定高度工具栏', () => {
  const h = mount123(HOME);
  try {
    h.mount();
    const row = h.document.querySelector('.qk-rpc-123-row');
    assert.ok(row, '创建独立行');
    assert.equal(h.container.parentElement, row);
    assert.equal(row.previousElementSibling, h.document.querySelector('.home-operator'));
    assert.equal(row.nextElementSibling, h.document.querySelector('.home-nav'));
    assert.equal(h.document.querySelector('.home-operator').contains(h.container), false, '不得插入原工具栏');
    assert.equal(h.synced, 1);
  } finally { h.dom.window.close(); }
});

test('123 首页重复挂载及工具栏重绘后只保留一行', () => {
  const h = mount123(HOME);
  try {
    h.mount();
    h.mount();
    const old = h.document.querySelector('.home-operator');
    const fresh = old.cloneNode(true);
    old.replaceWith(fresh);
    h.mount();
    const rows = h.document.querySelectorAll('.qk-rpc-123-row');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].previousElementSibling, fresh);
    assert.equal(h.container.parentElement, rows[0]);
  } finally { h.dom.window.close(); }
});

test('123 分享页没有首页工具栏时交回原挂载逻辑', () => {
  const h = mount123('<div class="single-file-sharing-container-content-file-operate"></div>');
  try {
    assert.equal(h.mount(), false);
    assert.equal(h.document.querySelector('.qk-rpc-123-row'), null);
    assert.equal(h.synced, 0);
  } finally { h.dom.window.close(); }
});

test('123 独立行样式不对旧工具栏选择器保留插入入口', () => {
  assert.ok(source.includes('.qk-rpc-123-row {'), '独立行样式存在');
  assert.equal(source.includes("'.home-operator .home-operator-button-group"), false, '不再插入首页按钮组');
});
