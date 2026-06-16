// Регрессионный раннер для telegram-notify.js (Cloudflare Worker).
// Грузит реальный исходник (export default → var) и гоняет чистые функции.
ObjC.import('Foundation');
function rd(p){ var s = $.NSString.stringWithContentsOfFileEncodingError($(p), $.NSUTF8StringEncoding, null); return s && s.js ? s.js : ''; }

globalThis.__res = [];
globalThis.__eq = function(n,g,e){ var p=JSON.stringify(g)===JSON.stringify(e); __res.push({n:n,p:p,i:p?'':('got '+JSON.stringify(g)+' exp '+JSON.stringify(e))}); };
globalThis.__ok = function(n,c,i){ __res.push({n:n,p:!!c,i:c?'':(i||'falsy')}); };
globalThis.__approx = function(n,g,e,eps){ var p=(typeof g==='number')&&Math.abs(g-e)<=(eps||0.01); __res.push({n:n,p:p,i:p?'':('got '+g+' exp '+e)}); };

var src = rd('telegram-notify.js').replace(/^export default/m, 'var __mod =');
var caseSrc = rd('tests/cases-worker.js');
try { eval(src + '\n;\n' + caseSrc); }
catch(e){ __res.push({n:'EVAL worker', p:false, i:String(e && e.message || e)}); }

var fail = __res.filter(function(r){return !r.p;});
var out = 'WORKER TESTS: ' + (__res.length-fail.length) + '/' + __res.length + ' passed' + (fail.length?(' — '+fail.length+' FAILED'):'') + '\n';
__res.forEach(function(r){ out += (r.p?'  ok    ':'  FAIL  ') + r.n + (r.p?'':('  — '+r.i)) + '\n'; });
out;
