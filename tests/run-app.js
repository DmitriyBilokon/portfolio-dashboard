// Регрессионный раннер для app.js — гоняет РЕАЛЬНЫЕ функции под заглушками
// браузерного окружения через osascript -l JavaScript (JavaScriptCore).
// Запуск: см. tests/run.sh
ObjC.import('Foundation');
function rd(p){ var s = $.NSString.stringWithContentsOfFileEncodingError($(p), $.NSUTF8StringEncoding, null); return s && s.js ? s.js : ''; }

// ── Заглушки браузерных глобалов (минимум, чтобы app.js загрузился) ──
var noop = function(){};
var classListStub = { add:noop, remove:noop, toggle:noop, contains:function(){return false;} };
function mkEl(){ return {
  addEventListener:noop, removeEventListener:noop, appendChild:noop, removeChild:noop, remove:noop,
  setAttribute:noop, removeAttribute:noop, getAttribute:function(){return null;},
  classList:classListStub, style:{}, dataset:{}, children:[], childNodes:[],
  innerHTML:'', textContent:'', value:'', checked:false, scrollTop:0, scrollHeight:0, disabled:false,
  querySelector:function(){return null;}, querySelectorAll:function(){return [];},
  getElementsByClassName:function(){return [];}, focus:noop, click:noop, closest:function(){return null;},
  insertBefore:noop, contains:function(){return false;}, cloneNode:function(){return mkEl();},
  getBoundingClientRect:function(){return {top:0,left:0,width:0,height:0,bottom:0,right:0};}, parentNode:null
}; }
var sbStub = {
  auth:{ getSession:function(){return Promise.resolve({data:{session:null}});}, onAuthStateChange:noop,
    signInWithPassword:function(){return Promise.resolve({data:{},error:null});}, signOut:function(){return Promise.resolve({});} },
  from:function(){ return {
    select:function(){ return { eq:function(){ return { maybeSingle:function(){return Promise.resolve({data:null,error:null});} }; },
      limit:function(){return Promise.resolve({data:[],error:null});},
      order:function(){return {limit:function(){return Promise.resolve({data:[],error:null});}};} }; },
    upsert:function(){return Promise.resolve({error:null});}, insert:function(){return Promise.resolve({error:null});} }; },
  channel:function(){ var c={on:function(){return c;},subscribe:function(){return c;}}; return c; },
  removeChannel:noop, rpc:function(){return Promise.resolve({data:null,error:null});}
};
globalThis.document = {
  getElementById:function(){return mkEl();}, querySelector:function(){return null;}, querySelectorAll:function(){return [];},
  createElement:function(){return mkEl();}, createElementNS:function(){return mkEl();},
  addEventListener:noop, removeEventListener:noop, getElementsByClassName:function(){return [];},
  documentElement:{dataset:{},classList:classListStub,style:{}}, body:mkEl(), head:mkEl(), hidden:false, cookie:''
};
globalThis.window = { supabase:{createClient:function(){return sbStub;}}, addEventListener:noop, removeEventListener:noop,
  location:{href:'',hostname:'localhost',search:''}, matchMedia:function(){return {matches:false,addEventListener:noop,addListener:noop};},
  devicePixelRatio:1, innerWidth:1200, innerHeight:800 };
globalThis.navigator = {language:'ru-RU', userAgent:'test'};
globalThis.localStorage = {getItem:function(){return null;}, setItem:noop, removeItem:noop, clear:noop};
globalThis.sessionStorage = globalThis.localStorage;
globalThis.fetch = function(){ return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve({});},text:function(){return Promise.resolve('');}}); };
globalThis.crypto = {randomUUID:function(){return '00000000-0000-0000-0000-000000000000';}, getRandomValues:function(a){return a;}};
globalThis.setTimeout = function(){return 0;}; globalThis.clearTimeout = noop;
globalThis.setInterval = function(){return 0;}; globalThis.clearInterval = noop;
globalThis.requestAnimationFrame = function(){return 0;};
globalThis.alert = noop; globalThis.confirm = function(){return true;}; globalThis.prompt = function(){return null;};
globalThis.ALL = {data:{}, rankings:{}, sma:{}};

// ── Мини-фреймворк (результаты собираем в globalThis.__res) ──
globalThis.__res = [];
globalThis.__eq = function(n,g,e){ var p=JSON.stringify(g)===JSON.stringify(e); __res.push({n:n,p:p,i:p?'':('got '+JSON.stringify(g)+' exp '+JSON.stringify(e))}); };
globalThis.__ok = function(n,c,i){ __res.push({n:n,p:!!c,i:c?'':(i||'falsy')}); };
globalThis.__approx = function(n,g,e,eps){ var p=(typeof g==='number')&&Math.abs(g-e)<=(eps||0.01); __res.push({n:n,p:p,i:p?'':('got '+g+' exp '+e)}); };

// ── Грузим реальный app.js (+ app-2.js, в порядке как в index.html; без авто-boot) + кейсы в ОДНОМ eval ──
var appSrc = (rd('app.js') + '\n' + rd('app-2.js')).replace(/\nboot\(\);\s*$/, '\n');
var caseSrc = rd('tests/cases-app.js');
try { eval(appSrc + '\n;\n' + caseSrc); }
catch(e){ __res.push({n:'EVAL app.js', p:false, i:String(e && e.message || e)}); }

var fail = __res.filter(function(r){return !r.p;});
var out = 'APP TESTS: ' + (__res.length-fail.length) + '/' + __res.length + ' passed' + (fail.length?(' — '+fail.length+' FAILED'):'') + '\n';
__res.forEach(function(r){ out += (r.p?'  ok    ':'  FAIL  ') + r.n + (r.p?'':('  — '+r.i)) + '\n'; });
out;
