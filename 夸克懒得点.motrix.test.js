const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parse } = require('shell-quote');
const source = fs.readFileSync(path.join(__dirname, '夸克懒得点.user.js'), 'utf8');
const begin = source.indexOf('      function formatMotrixCommand(');
const end = source.indexOf('      async function copySelectedLinks(', begin);
// Cross-platform Bash tokenization; does not require a local Motrix installation or its private bundle.
function getFormatter() { assert.ok(begin >= 0 && end > begin, 'Motrix formatter exists'); const ctx=vm.createContext({}); vm.runInContext(source.slice(begin,end)+'\nglobalThis.format=formatMotrixCommand;',ctx);return ctx.format; }
function check(command) {
  const args = parse(command);
  assert.equal(args[0], 'curl');
  const result = { urls: [], headers: {} };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-L' || arg === '-g') continue;
    const value = args[++i];
    assert.equal(typeof value, 'string');
    if (arg === '--url') result.urls.push(value);
    else if (arg === '-o') result.filename = value;
    else if (arg === '-H') { const at = value.indexOf(':'); assert.ok(at > 0); result.headers[value.slice(0, at)] = value.slice(at + 1).trim(); }
    else assert.fail(`Unexpected curl argument: ${arg}`);
  }
  return result;
}
test('Motrix parses a single Quark link with cookie, UA and referer', () => {
  const format=getFormatter();
  const url='https://dl-pc-sz.pds.quark.cn/download?Signature=a%2Fb&callback-var=xyz';
  const command=format([{link:url,options:{out:'movie.mkv','user-agent':'QuarkPC/6.9',referer:'https://pan.quark.cn/',header:['Cookie: sid=a;b=c']}}]);
  assert.equal(command.split('\n').length,1);
  const parsed=check(command);assert.equal(parsed.urls[0],url);assert.equal(parsed.headers.Cookie,'sid=a;b=c');assert.equal(parsed.headers['User-Agent'],'QuarkPC/6.9');assert.equal(parsed.filename,'movie.mkv');
});
test('two Quark links import as ONE Motrix command with 2 tasks (no -o)', () => {
 const format=getFormatter(), a='https://cdn.test/download?fid=1',b='https://cdn.test/download?fid=2';
 const command=format([{link:a,options:{out:'a.mp4',header:['Cookie: sid=a']}},{link:b,options:{out:'b.mp4',header:['Cookie: sid=a']}}]);
 const parsed=check(command);assert.equal(parsed.urls.length,2);assert.deepEqual([...parsed.urls],[a,b]);assert.equal(parsed.filename,undefined);assert.equal(parsed.headers.Cookie,'sid=a');
});
test('different per-file headers cannot be represented by one Motrix task input',()=>{
 const format=getFormatter();assert.throws(()=>format([{link:'https://x.test/a',options:{header:['Cookie: a=1']}},{link:'https://x.test/b',options:{header:['Cookie: a=2']}}]),/分别复制/);
});
test('Motrix preserves apostrophes in actual-style filename and URL', () => {
 const format=getFormatter();
 const url="https://dl-pc-sz.pds.quark.cn/download?response-content-disposition=It's%20here&Signature=a%2Bb";
 const command=format([{link:url,options:{out:"A.Mortal's.Journey.mkv",header:["Cookie: sid=x"]}}]);
 const parsed=check(command);
 assert.equal(parsed.urls[0],url);
 assert.equal(parsed.filename,"A.Mortal's.Journey.mkv");
});
test('remove URL-only button; label the Bash command copy button',()=>{
 assert.doesNotMatch(source,/container\.appendChild\(btnCopyLinks\)/);
 assert.match(source,/btnCopyCommand\.textContent = '复制Bash命令'/);
 assert.match(source,/btnCopyCommand\.onclick = \(\) => copySelectedLinks\(pageAdapter\)/);
});
