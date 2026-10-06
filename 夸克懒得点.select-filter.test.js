const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '夸克懒得点.user.js'), 'utf8');

function filter(items) {
  const begin = source.indexOf('      function shouldQuarkAutoDeselect(item) {');
  const end = source.indexOf('      function autoSelectCurrentPage() {', begin);
  assert.ok(begin >= 0 && end > begin, '夸克自动全选过滤器存在');
  const context = vm.createContext({});
  vm.runInContext(source.slice(begin, end) + '\nglobalThis.filter = shouldQuarkAutoDeselect;', context);
  return items.map((item) => context.filter(item));
}

test('自动全选后只取消匹配行，且仅执行一次', () => {
  const begin = source.indexOf('      function shouldQuarkAutoDeselect(item) {');
  const end = source.indexOf('      const SELECT_ALL_SITES = {', begin);
  const selection = ['image', 'small', 'large', 'folder'];
  const items = [
    { fid: 'image', file: true, file_name: 'cover.png' },
    { fid: 'small', file: true, file_name: 'part.mp4', size: 999 },
    { fid: 'large', file: true, file_name: 'movie.mp4', size: 10 * 1024 * 1024 },
    { fid: 'folder', file: false, file_name: 'images' }
  ];
  const clicked = [];
  const rows = items.map((item) => ({
    getAttribute: () => item.fid,
    querySelector: () => ({ get checked() { return selection.includes(item.fid); }, click() {
      clicked.push(item.fid);
      selection.splice(selection.indexOf(item.fid), 1);
    } })
  }));
  const props = { get selectedRowKeys() { return selection; }, list: items };
  const page = { document: { querySelectorAll: () => rows } };
  const context = vm.createContext({ ON_QUARK: true, location: { href: 'quark-list' }, featureEnabled: () => true,
    getQuarkListProps: () => props, getPageWindow: () => page, updateQuarkSelectionCount: () => {}, setTimeout: (fn) => fn() });
  vm.runInContext(source.slice(begin, end) + '\nglobalThis.deselect = deselectQuarkAutoExcluded;', context);
  context.deselect('quark-list');
  assert.deepEqual(clicked, ['image', 'small']);
  assert.deepEqual(selection, ['large', 'folder']);
});

test('非首屏的已选文件也取消勾选，不依赖其 DOM 行已渲染', () => {
  const begin = source.indexOf('      function shouldQuarkAutoDeselect(item) {');
  const end = source.indexOf('      const SELECT_ALL_SITES = {', begin);
  const items = Array.from({ length: 40 }, (_, i) => ({ fid: String(i), file: true,
    file_name: i === 35 ? 'cover.jpg' : 'movie.mkv', size: 20 * 1024 * 1024 }));
  let keys = items.map((item) => item.fid);
  const props = { list: items, get selectedRowKeys() { return keys; }, changeSelectedRowKeys(next) { keys = next; } };
  const context = vm.createContext({ ON_QUARK: true, location: { href: 'quark-list' }, featureEnabled: () => true,
    getQuarkListProps: () => props, getPageWindow: () => ({ document: { querySelectorAll: () => [] } }),
    updateQuarkSelectionCount: () => {}, setTimeout: (fn) => fn() });
  vm.runInContext(source.slice(begin, end) + '\nglobalThis.deselect = deselectQuarkAutoExcluded;', context);
  context.deselect('quark-list');
  assert.equal(keys.includes('35'), false);
  assert.equal(keys.length, 39);
});

test('字幕及其它非图片非视频文件不因 file_type 或体积被取消勾选', () => {
  const extensions = ['srt', 'ASS', 'ssa', 'vtt', 'sub', 'idx', 'sup', 'smi', 'zip'];
  for (const fileType of [1, 3, 0, undefined]) {
    const items = extensions.map((ext) => ({ file: true, file_name: `movie.zh-CN.${ext}`, file_type: fileType, size: 1024 }));
    assert.deepEqual(filter(items), items.map(() => false), `file_type=${fileType} 不应覆盖文件扩展名`);
  }
});

test('TXT 文件不分大小写和体积均排除，同名文件夹及 txt 非末尾扩展名保留', () => {
  assert.deepEqual(filter([
    { file: true, file_name: '说明.txt', size: 0 },
    { file: true, file_name: '说明.TXT', file_type: 1, size: 20 * 1024 * 1024 },
    { file: true, file_name: '说明.TxT', file_type: 3 },
    { file: false, file_name: '说明.txt', size: 12 },
    { file: true, file_name: '说明.txt.srt', file_type: 1, size: 12 }
  ]), [true, true, true, false, false]);
});

test('自动全选过滤图片、nfo 和不足 10 MiB 的视频，保留文件夹及其它文件', () => {
  const MB = 1024 * 1024;
  assert.deepEqual(filter([
    { file: true, file_name: 'cover.jpg', file_type: 3, size: 20 * MB },
    { file: true, file_name: 'meta.NFO', size: 100 },
    { file: true, file_name: 'sample.mkv', file_type: 1, size: 10 * MB - 1 },
    { file: true, file_name: 'movie.mkv', file_type: 1, size: 10 * MB },
    { file: true, file_name: 'movie.mp4', size: 11 * MB },
    { file: true, file_name: 'small.mp4', size: 0 },
    { file: true, file_name: 'image.png', size: 50 * MB },
    { file: false, file_name: 'poster.jpg', file_type: 3, size: 0 },
    { file: true, file_name: 'notes.txt', size: 12 }
  ]), [true, true, true, false, false, true, true, false, true]);
});
