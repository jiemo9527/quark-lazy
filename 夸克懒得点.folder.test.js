const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '夸克懒得点.user.js'), 'utf8');
const folder = { fid: 'folder', file: false, file_name: '剧集' };
const direct = { fid: 'direct', file: true, file_name: '直接.mkv' };
const tree = {
  folder: [{ fid: 'sub', file: false, file_name: '第二层' }, { fid: 'one', file: true, file_name: '01.mkv' }],
  sub: [{ fid: 'two', file: true, file_name: '02.mkv' }]
};

function collectHarness(enabled) {
  const begin = source.indexOf('      function safeSegment(name) {');
  const end = source.indexOf('      // PC 客户端 UA', begin);
  assert.ok(begin >= 0 && end > begin);
  const visited = [];
  const context = vm.createContext({
    featureEnabled: (key) => {
      assert.equal(key, 'quarkTraverseFolders');
      return enabled;
    },
    quarkListDir: async (fid) => { visited.push(fid); return tree[fid]; }
  });
  vm.runInContext(source.slice(begin, end) + '\nglobalThis.collect = collectQuarkFiles;', context);
  return { collect: context.collect, visited };
}

const fids = (files) => Array.from(files, (file) => [file.fid, file.rel]);

test('enabled or unset folder traversal recursively includes child files with relative paths', async () => {
  assert.match(source, /\['quarkTraverseFolders', '勾选文件夹时递归发送其中的文件（RPC）'\]/);
  const harness = collectHarness(true);
  assert.deepEqual(fids(await harness.collect([folder, direct])), [
    ['two', '剧集/第二层'], ['one', '剧集'], ['direct', '']
  ]);
  assert.deepEqual(harness.visited, ['folder', 'sub']);
});

test('disabled folder traversal skips directories but keeps directly checked files', async () => {
  const harness = collectHarness(false);
  assert.deepEqual(fids(await harness.collect([folder, direct])), [['direct', '']]);
  assert.deepEqual(harness.visited, []);
});

test('disabled folder traversal and only selected folders collects no files', async () => {
  const harness = collectHarness(false);
  assert.deepEqual(fids(await harness.collect([folder])), []);
  assert.deepEqual(harness.visited, []);
});
