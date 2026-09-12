// Регрессионный раннер для app.js — гоняет РЕАЛЬНЫЕ функции под заглушками
// браузерного окружения через osascript -l JavaScript (JavaScriptCore).
// Запуск: см. tests/run.sh
ObjC.import('Foundation');
function rd(p){ var s = $.NSString.stringWithContentsOfFileEncodingError($(p), $.NSUTF8StringEncoding, null); return s && s.js ? s.js : ''; }

// ── Заглушки браузерных глобалов (минимум, чтобы app.js загрузился) — общие с tests/ledger-copy.js ──
eval(rd('tests/env-stubs.js'));
globalThis.ALL = {data:{}, rankings:{}, sma:{}};

// ── Мини-фреймворк (результаты собираем в globalThis.__res) ──
globalThis.__res = [];
globalThis.__eq = function(n,g,e){ var p=JSON.stringify(g)===JSON.stringify(e); __res.push({n:n,p:p,i:p?'':('got '+JSON.stringify(g)+' exp '+JSON.stringify(e))}); };
globalThis.__ok = function(n,c,i){ __res.push({n:n,p:!!c,i:c?'':(i||'falsy')}); };
globalThis.__approx = function(n,g,e,eps){ var p=(typeof g==='number')&&Math.abs(g-e)<=(eps||0.01); __res.push({n:n,p:p,i:p?'':('got '+g+' exp '+e)}); };

// ── Грузим реальный signals.js + chart.js + app.js…app-5.js + desk.js + desk-gloss.js (в порядке как в index.html; без авто-boot/deskBoot) + фикстуры и кейсы в ОДНОМ eval ──
var appSrc = ['signals.js','chart.js','app.js','app-2.js','app-3.js','app-4.js','app-5.js','desk-selection.js','desk-journal.js','desk.js','desk-gloss.js'].map(function(f){ return rd(f).replace(/\n(boot|deskBoot)\(\);\s*$/, '\n'); }).join('\n');
var caseSrc = rd('tests/fixtures-signals.js') + '\n;\n' + rd('tests/cases-app.js');
try { eval(appSrc + '\n;\n' + caseSrc); }
catch(e){ __res.push({n:'EVAL app.js', p:false, i:String(e && e.message || e)}); }

var fail = __res.filter(function(r){return !r.p;});
var out = 'APP TESTS: ' + (__res.length-fail.length) + '/' + __res.length + ' passed' + (fail.length?(' — '+fail.length+' FAILED'):'') + '\n';
__res.forEach(function(r){ out += (r.p?'  ok    ':'  FAIL  ') + r.n + (r.p?'':('  — '+r.i)) + '\n'; });
out;
