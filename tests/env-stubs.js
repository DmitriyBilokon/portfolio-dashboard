// Заглушки браузерного окружения (минимум, чтобы app*.js/desk*.js загрузились без DOM и сети).
// Общие для JSC-раннера tests/run-app.js (читает через rd() + eval) и node-стенда tests/ledger-copy.js (vm).
// ES5, без зависимостей от раннера; ALL (сид данных) задаёт сам раннер.
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
    // upsert chainable: .upsert(...).select(...) — pushState читает вернувшийся rev
    upsert:function(){ var p=Promise.resolve({data:[],error:null}); p.select=function(){return Promise.resolve({data:[],error:null});}; return p; },
    insert:function(){return Promise.resolve({error:null});} }; },
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
