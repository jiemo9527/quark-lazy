const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '夸克懒得点.user.js'), 'utf8');
const TARGET = 'https://pan.quark.cn/list#/list/all';

function run(href, readyState = 'complete') {
  const location = new URL(href);
  const nodes = [];
  const listeners = {};
  const body = { appendChild(node) { nodes.push(node); node.isConnected = true; } };
  const document = {
    readyState, body,
    addEventListener(type, callback) { listeners[type] = callback; },
    getElementById(id) { return nodes.find((node) => node.id === id) || null; },
    createElement(tag) {
      return { tag, style: {}, dataset: {},
        addEventListener(type, callback) { this[type] = callback; } };
    }
  };
  vm.runInNewContext(script, { location, window: { location }, document, URL, URLSearchParams, console });
  return { location, document, nodes, listeners };
}

test('教父 root and nested pages show one top-right return button that navigates in the current tab', () => {
  assert.match(script, /^\/\/ @match\s+\*:\/\/www\.xn--wcv59z\.com\/\*/m);
  for (const href of ['https://www.教父.com/', 'https://www.教父.com/movie', 'https://www.教父.com/movie/episode']) {
    const page = run(href);
    const button = page.nodes.find((node) => node.tag === 'button');
    assert.ok(button, href);
    assert.equal(button.textContent, '返回夸克网盘');
    assert.equal(button.style.position, 'fixed');
    assert.equal(button.style.top, '20px');
    assert.equal(button.style.right, '20px');
    button.click();
    assert.equal(page.location.href, TARGET);
    assert.equal(page.nodes.filter((node) => node.tag === 'button').length, 1);
  }
});

test('button waits for document ready and ignores unrelated hosts', () => {
  const page = run('https://www.教父.com/movie', 'loading');
  assert.equal(page.nodes.length, 0);
  page.listeners.DOMContentLoaded();
  assert.equal(page.nodes.filter((node) => node.tag === 'button').length, 1);
  assert.equal(run('https://else.example/movie').nodes.length, 0);
});
