const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '夸克懒得点.user.js'), 'utf8');
function slice(start, end) { const a=source.indexOf(start), b=source.indexOf(end,a); assert.ok(a>=0&&b>a,start);return source.slice(a,b); }

test('115 auxiliary settings expose existing automatic-save-main-flow switch', () => {
  assert.match(source, /autoCheckbox\.checked = isAutoSaveEnabled\(\)/);
  assert.match(source, /autoCheckbox\.onchange = \(\) => \{ setAutoSaveEnabled\(autoCheckbox\.checked\)/);
  assert.match(source, /启用自动转存主流程（115 常规分享保存到 \/ovo）/);
});

test('ovo root directory is resolved by exact folder name, not a similarly named item', async () => {
  const calls=[];
  const context=vm.createContext({ gm115Json:async (m,u)=>{calls.push([m,u]);return {state:true,data:[{cid:'12',n:'ovoo'},{fid:'22',n:'ovo'},{cid:'98',n:'ovo'}]};} });
  vm.runInContext(slice('  async function find115OvoFolder()', '  const pending115Transfers = new Set();')+'\nglobalThis.resolve = resolve115OvoFolder;',context);
  assert.equal(await context.resolve(),'98');
  assert.equal(calls.length,1);
  assert.match(calls[0][1],/webapi\.115\.com\/files\?/);
});

test('root ovo lookup fails closed when first page does not cover all folders', async () => {
  const context=vm.createContext({ gm115Json:async()=>({state:true,data:[{cid:'11',n:'other'}],count:1001}) });
  vm.runInContext(slice('  async function find115OvoFolder()', '  const pending115Transfers = new Set();')+'\nglobalThis.resolve=resolve115OvoFolder;',context);
  await assert.rejects(context.resolve(),/完整|ovo/);
});

test('ovo lookup searches later root-directory pages before deciding folder is missing', async () => {
  const calls=[];
  const context=vm.createContext({gm115Json:async(m,u)=>{calls.push(u);return u.includes('offset=0')?{state:true,count:2,data:[{cid:'11',n:'other'}]}:{state:true,count:2,data:[{cid:'98',n:'ovo'}]};}});
  vm.runInContext(slice('  async function find115OvoFolder()', '  const pending115Transfers = new Set();')+'\nglobalThis.resolve=resolve115OvoFolder;',context);
  assert.equal(await context.resolve(),'98');
  assert.equal(calls.length,2);
  assert.match(calls[1],/offset=1/);
});

test('missing ovo is created at 115 root after a complete root listing', async () => {
  const calls=[];
  const context=vm.createContext({URLSearchParams, gm115Json:async (m,u,body)=>{calls.push([m,u,body&&body.toString()]);
    return m==='GET'?{state:true,count:1,data:[{cid:'11',n:'other'}]}:{state:true,cid:'77'};} });
  vm.runInContext(slice('  async function find115OvoFolder()', '  const pending115Transfers = new Set();')+'\nglobalThis.resolve = resolve115OvoFolder;',context);
  assert.equal(await context.resolve(),'77');
  assert.deepEqual(calls.map(x=>x[0]),['GET','POST']);
  assert.match(calls[1][1],/webapi\.115\.com\/files\/add/);
  assert.equal(calls[1][2],'pid=0&cname=ovo');
});

test('ovo created concurrently elsewhere is re-read instead of failing', async () => {
  let listed=0;
  const context=vm.createContext({URLSearchParams, gm115Json:async (m)=>{
    if(m==='POST') return {state:false,errno:20004,error:'该目录名称已存在。'};
    listed++; return listed===1?{state:true,count:0,data:[]}:{state:true,count:1,data:[{cid:'55',n:'ovo'}]};} });
  vm.runInContext(slice('  async function find115OvoFolder()', '  const pending115Transfers = new Set();')+'\nglobalThis.resolve = resolve115OvoFolder;',context);
  assert.equal(await context.resolve(),'55');
});

test('ovo is never created when root listing is incomplete or creation fails', async () => {
  const calls=[];
  const context=vm.createContext({URLSearchParams, gm115Json:async (m)=>{calls.push(m);return m==='GET'?{state:false}:{state:true,cid:'1'};} });
  vm.runInContext(slice('  async function find115OvoFolder()', '  const pending115Transfers = new Set();')+'\nglobalThis.resolve = resolve115OvoFolder;',context);
  await assert.rejects(context.resolve(),/根目录/);
  assert.deepEqual(calls,['GET']);
  const c2=vm.createContext({URLSearchParams, gm115Json:async (m)=>m==='GET'?{state:true,count:0,data:[]}:{state:false,error:'空间不足'} });
  vm.runInContext(slice('  async function find115OvoFolder()', '  const pending115Transfers = new Set();')+'\nglobalThis.resolve = resolve115OvoFolder;',c2);
  await assert.rejects(c2.resolve(),/创建.*ovo.*空间不足/);
});

test('automatic share saves to resolved ovo CID and records successful save', async () => {
  const calls=[], logs=[];
  const c=vm.createContext({URL,URLSearchParams,location:{href:'https://115cdn.com/s/abc?password=1234'},
    gm115Json:async(m,u,body)=>{calls.push({m,u,body});return m==='GET'&&u.includes('share/snap')?{state:true,data:{userinfo:{user_id:'42',user_name:'1***2'},list:[{fid:'123'}]}}:{state:true};},
    resolve115OvoFolder:async()=> '98', applyShareSourceFilter:()=> 'allow', show115ShareIdentity:()=>{},
    getLogs:()=>[],notifyToast:()=>{},record115SaveLog:x=>logs.push(x),shareFilterEnabled:()=>true});
  vm.runInContext(slice('  function get115ShareCode(', '  const shareFilterKeys = {')+'\nglobalThis.transfer=doHdhiveTransfer;',c);
  await c.transfer({share:'abc',code:'1234'},undefined,{destinationCid:'98'});
  assert.equal(calls.find(x=>x.m==='POST').body.get('cid'),'98');
  assert.equal(logs.length,1);
});

test('regular 115 autosave starts only on share routes and HDHive handoff remains first', () => {
  const start=source.indexOf('  install115ShareSaveLogger();');
  const end=source.indexOf('  install115DeleteFirst();',start);
  const body=source.slice(start,end);
  assert.ok(body.indexOf('relay115ShareForHdhive()') < body.indexOf('autoSave115SharePage()'));
  assert.match(body,/\^\\\/s\\\//);
  assert.match(body,/DOMContentLoaded/);
});

test('disabled automatic save leaves 115 page untouched', async () => {
  const actions=[];
  const c=vm.createContext({location:{href:'https://115cdn.com/s/abc?password=1234',hostname:'115cdn.com',pathname:'/s/abc'},SITE_HOST:'115cdn.com',
    isAutoSaveEnabled:()=>false,gm115Json:()=>actions.push('snap'),document:{body:{},querySelectorAll:()=>[]}});
  vm.runInContext(slice('  async function autoSave115SharePage()', '  // UC 分享详情接口')+'\nglobalThis.run=autoSave115SharePage;',c);
  await c.run();assert.deepEqual(actions,[]);
});

test('115 auto flow ignores pending same-tab HDHive handoff', async () => {
  const actions=[];
  const c=vm.createContext({location:{href:'https://115cdn.com/s/abc?password=1234',pathname:'/s/abc'},SITE_HOST:'115cdn.com',
    isAutoSaveEnabled:()=>true,has115SavedShare:()=>false,getHdhiveJobs:()=>({a:{status:'pending',mode:'same-tab'}}),parse115Share:()=>({share:'abc',code:'1234'}),
    gm115Json:()=>actions.push('snap'),document:{body:{},querySelectorAll:()=>[]}});
  vm.runInContext(slice('  async function autoSave115SharePage()', '  // UC 分享详情接口')+'\nglobalThis.run=autoSave115SharePage;',c);
  await c.run();assert.deepEqual(actions,[]);
});

test('enabled 115 auto flow confirms access code then transfers to ovo only once', async () => {
  const actions=[];
  const buttons=[{textContent:'确定',click(){actions.push('confirm');this.done=true;}}];
  const c=vm.createContext({URL,URLSearchParams,SITE_HOST:'115cdn.com',location:{href:'https://115cdn.com/s/abc?password=1234',hostname:'115cdn.com',pathname:'/s/abc'},
    isAutoSaveEnabled:()=>true,has115SavedShare:()=>false,getHdhiveJobs:()=>({}),parse115Share:()=>({share:'abc',code:'1234'}),
    gm115Json:async()=>({state:true,data:{userinfo:{user_id:'42',user_name:'1***2'},list:[]}}),
    applyShareSourceFilter:()=> 'allow',resolve115OvoFolder:async()=> '98',
    document:{body:{},querySelector:()=>({value:'1234'}),querySelectorAll:()=>buttons},sleep:async()=>{},
    doHdhiveTransfer:async (_p,_s,opts)=>{actions.push(`receive:${opts.destinationCid}`);return {already:false};},notifyToast:()=>{},showHdhiveReturnButton:()=>{},setTimeout:()=>{}});
  vm.runInContext(slice('  async function autoSave115SharePage()', '  // UC 分享详情接口')+'\nglobalThis.run=autoSave115SharePage;',c);
  await c.run();
  assert.deepEqual(actions,['confirm','receive:98']);
});

test('already-saved 115 share is saved again to ovo with a notice', async () => {
  const actions=[], toasts=[];
  const c=vm.createContext({URL,URLSearchParams,SITE_HOST:'115cdn.com',location:{href:'https://115cdn.com/s/abc?password=1234',hostname:'115cdn.com',pathname:'/s/abc'},
    isAutoSaveEnabled:()=>true,has115SavedShare:()=>true,
    find115SavedShareLog:()=>({time:'2026-09-29 10:00:00',title:'某剧'}),
    getHdhiveJobs:()=>({}),parse115Share:()=>({share:'abc',code:'1234'}),
    gm115Json:async()=>{actions.push('snap');return {state:true,data:{userinfo:{user_id:'42'}}};},
    applyShareSourceFilter:()=> 'allow',resolve115OvoFolder:async()=> '98',
    document:{body:{},querySelector:()=>({value:'1234'}),querySelectorAll:()=>[{textContent:'确定',click:()=>actions.push('confirm')}]},
    doHdhiveTransfer:async(_p,_s,o)=>{actions.push(`receive:${o.destinationCid}`);return {};},showHdhiveReturnButton:()=>{},notifyToast:(m,l)=>toasts.push([m,l])});
  vm.runInContext(slice('  async function autoSave115SharePage()', '  // UC 分享详情接口')+'\nglobalThis.run=autoSave115SharePage;',c);
  await c.run();
  assert.deepEqual(actions,['snap','confirm','receive:98']);
  assert.match(toasts[0][0],/曾保存过.*2026-09-29 10:00:00.*再次/);
});

test('blocked or unverifiable sharer on 115 page gets a visible reason', async () => {
  for (const [decision, pattern] of [['blocked',/红名单/],['unknown',/无法核实/]]) {
    const toasts=[];
    const c=vm.createContext({URL,URLSearchParams,SITE_HOST:'115cdn.com',location:{href:'https://115cdn.com/s/abc?password=1234',pathname:'/s/abc'},
      isAutoSaveEnabled:()=>true,has115SavedShare:()=>false,getHdhiveJobs:()=>({}),parse115Share:()=>({share:'abc',code:'1234'}),
      gm115Json:async()=>({state:true,data:{userinfo:{}}}),applyShareSourceFilter:()=>decision,shareFilterEnabled:()=>true,
      document:{body:{},querySelectorAll:()=>[]},doHdhiveTransfer:()=>{throw Error('no');},notifyToast:(m)=>toasts.push(m)});
    vm.runInContext(slice('  async function autoSave115SharePage()', '  // UC 分享详情接口')+'\nglobalThis.run=autoSave115SharePage;',c);
    await c.run();
    assert.equal(toasts.length,1);
    assert.match(toasts[0],pattern);
  }
});

test('successful 115cdn auto save shows a same-window return button to the ovo folder', async () => {
  const shown=[];
  const c=vm.createContext({URL,URLSearchParams,SITE_HOST:'115cdn.com',location:{href:'https://115cdn.com/s/abc?password=1234',hostname:'115cdn.com',pathname:'/s/abc'},
    isAutoSaveEnabled:()=>true,has115SavedShare:()=>false,getHdhiveJobs:()=>({}),parse115Share:()=>({share:'abc',code:'1234'}),
    gm115Json:async()=>({state:true,data:{userinfo:{user_id:'42'}}}),applyShareSourceFilter:()=> 'allow',resolve115OvoFolder:async()=> '98',
    document:{body:{},querySelector:()=>null,querySelectorAll:()=>[]},
    doHdhiveTransfer:async()=>({already:false}),notifyToast:()=>{},showHdhiveReturnButton:(o)=>shown.push(o)});
  vm.runInContext(slice('  async function autoSave115SharePage()', '  // UC 分享详情接口')+'\nglobalThis.run=autoSave115SharePage;',c);
  await c.run();
  assert.deepEqual(JSON.parse(JSON.stringify(shown)),[{cid:'98',sameWindow:true,persistent:true}]);
});

test('return button navigates the current window to the given 115 folder and can stay visible', () => {
  let appended=null, timers=0, opened=0;
  const loc={href:'https://115cdn.com/s/abc'};
  const c=vm.createContext({location:loc,window:{open:()=>opened++},setTimeout:()=>timers++,
    document:{querySelectorAll:()=>[],createElement:()=>({dataset:{},style:{},remove(){}}),body:{appendChild:(el)=>{appended=el;}}}});
  vm.runInContext(slice('  function showHdhiveReturnButton(', '  function gm115Json(')+'\nglobalThis.show=showHdhiveReturnButton;',c);
  c.show({cid:'98',sameWindow:true,persistent:true});
  assert.equal(appended.textContent,'返回115');
  assert.equal(timers,0);
  appended.onclick();
  assert.equal(opened,0);
  assert.equal(loc.href,'https://115.com/?cid=98&offset=0&mode=wangpan');
});

test('115 auto flow does not click confirmation when sharer is not allowed', async () => {
  const actions=[];
  const c=vm.createContext({URL,URLSearchParams,SITE_HOST:'115cdn.com',location:{href:'https://115cdn.com/s/abc?password=1234',hostname:'115cdn.com',pathname:'/s/abc'},
    isAutoSaveEnabled:()=>true,featureEnabled:()=>true,has115SavedShare:()=>true,
    getHdhiveJobs:()=>({}),parse115Share:()=>({share:'abc',code:'1234'}),
    gm115Json:async()=>{actions.push('snap');return {state:true,data:{userinfo:{user_id:'42',user_name:'1***2'},list:[]}};},
    applyShareSourceFilter:()=> 'blocked',document:{body:{},querySelectorAll:()=>[{textContent:'确定',click:()=>actions.push('confirm')} ]},
    doHdhiveTransfer:()=>actions.push('receive'),notifyToast:()=>{},setTimeout:()=>{}});
  vm.runInContext(slice('  async function autoSave115SharePage()', '  // UC 分享详情接口')+'\nglobalThis.run=autoSave115SharePage;',c);
  await c.run();
  assert.deepEqual(actions,['snap']);
});

test('blocked 115 share is never confirmed or sent to receive API', async () => {
  const actions=[];
  const c=vm.createContext({URL,URLSearchParams,SITE_HOST:'115cdn.com',location:{href:'https://115cdn.com/s/abc?password=1234',hostname:'115cdn.com',pathname:'/s/abc'},
    isAutoSaveEnabled:()=>true,featureEnabled:()=>true,has115SavedShare:()=>false,
    getHdhiveJobs:()=>({}),parse115Share:()=>({share:'abc',code:'1234'}),
    gm115Json:async()=>{actions.push('snap');return {state:true,data:{userinfo:{user_id:'42',user_name:'1***2'},list:[]}};},
    applyShareSourceFilter:()=> 'blocked',document:{body:{},querySelectorAll:()=>[{textContent:'确定',click:()=>actions.push('confirm')} ]},
    doHdhiveTransfer:()=>actions.push('receive'),notifyToast:()=>{},setTimeout:()=>{}});
  vm.runInContext(slice('  async function autoSave115SharePage()', '  // UC 分享详情接口')+'\nglobalThis.run=autoSave115SharePage;',c);
  await c.run();
  assert.deepEqual(actions,['snap']);
});
