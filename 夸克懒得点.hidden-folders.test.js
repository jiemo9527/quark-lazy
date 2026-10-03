const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '夸克懒得点.user.js'), 'utf8');

function makeRow(fid) {
  const classes = new Set();
  return {
    getAttribute: (name) => name === 'data-row-key' ? fid : null,
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name), toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
    get hidden() { return classes.has('qk-hidden-system-folder'); }
  };
}
function harness(enabled = true) {
  const begin = source.indexOf('  function refreshQuarkHiddenFolders() {');
  const end = source.indexOf('  function scheduleToolbarRefresh() {', begin);
  assert.ok(begin >= 0 && end > begin, 'folder filtering function is present');
  const rows = ['privacy', 'backup', 'similar-file', 'similar-dir'].map(makeRow);
  const items = [
    { fid: 'privacy', file: false, file_name: '隐私空间' },
    { fid: 'backup', file: false, file_name: '我的备份' },
    { fid: 'similar-file', file: true, file_name: '我的备份' },
    { fid: 'similar-dir', file: false, file_name: '我的备份资料' }
  ];
  const list = { memoizedProps: { selectedRowKeys: [], list: items } };
  const fileList = { __reactFiber$test: list };
  let isEnabled = enabled;
  let onList = true;
  const document = {
    querySelector: (selector) => selector === '.file-list' ? fileList : null,
    querySelectorAll: (selector) => selector === '.file-list .ant-table-tbody tr[data-row-key]' ? rows : []
  };
  const context = vm.createContext({ document, featureEnabled: () => isEnabled, shouldHandleListPage: () => onList });
  vm.runInContext(source.slice(begin, end) + '\nglobalThis.refresh = refreshQuarkHiddenFolders;', context);
  return { rows, refresh: context.refresh, setEnabled(value) { isEnabled = value; }, setOnList(value) { onList = value; }, setItems(value) { list.memoizedProps.list = value; } };
}

test('hide switch targets only exact named folders, never similarly named items or files', () => {
  assert.match(source, /\['quarkHideSystemFolders', '隐藏「隐私空间」「我的备份」文件夹'\]/);
  const h = harness();
  h.refresh();
  assert.deepEqual(h.rows.map((row) => row.hidden), [true, true, false, false]);
});

test('turning switch off immediately restores hidden rows', () => {
  const h = harness();
  h.refresh(); h.setEnabled(false); h.refresh();
  assert.deepEqual(h.rows.map((row) => row.hidden), [false, false, false, false]);
});

test('folder filtering follows current list and restores previous folders outside list route', () => {
  const h = harness();
  h.refresh();
  h.setItems([]); h.refresh();
  assert.deepEqual(h.rows.map((row) => row.hidden), [false, false, false, false]);
  h.setItems([{ fid: 'privacy', file: false, file_name: '隐私空间' }]);
  h.refresh(); h.setOnList(false); h.refresh();
  assert.deepEqual(h.rows.map((row) => row.hidden), [false, false, false, false]);
});
