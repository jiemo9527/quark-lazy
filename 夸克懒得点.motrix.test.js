const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync('E:/Pro_PY/油猴脚本/夸克懒得点.user.js', 'utf8');
const begin = source.indexOf('      function formatMotrixCommand(');
const end = source.indexOf('      async function copySelectedLinks(', begin);
// Parser extracted from installed Motrix app.asar, the exact version shown in user's screenshot.
const motrix = fs.readFileSync('C:/Users/Administrator/AppData/Local/hermes/cache/scratch/motrix-extracted/dist/renderer/assets/index-CqOlBjHM.js', 'utf8');
const parserStart = motrix.indexOf('var qae=/');
const parserEnd = motrix.indexOf(',Qae={id:`builtin:json`', parserStart);
const parser = vm.createContext({ Bm: (s) => s.length > 1048576 || new TextEncoder().encode(s).length > 1048576 });
assert.ok(parserStart >= 0 && parserEnd > parserStart);
vm.runInContext(motrix.slice(parserStart, parserEnd) + ';globalThis.parse=Zae.tryInterpret;', parser);
function getFormatter() { assert.ok(begin >= 0 && end > begin, 'Motrix formatter exists'); const ctx=vm.createContext({}); vm.runInContext(source.slice(begin,end)+'\nglobalThis.format=formatMotrixCommand;',ctx);return ctx.format; }
function check(command) {const result=parser.parse(command);assert.ok(result && !result.rejected, 'Motrix rejected command');return result;}
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
