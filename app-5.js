// ── 📜 Сделки портфеля: купля/продажа с реализованным P&L по продаже ──
const pfPortShort=tab=>{const k=tab||PF3_KEY;return k===AIP_KEY?'AI':String(TAB_LABEL(k)||k).replace(/^Portfolio\s*\((.+)\)$/i,'$1')};
// Лайв-превью комиссии в блоке «💸 Сделка» карточки.
function pfTrPreview(ccy){
  const el=document.getElementById('pfTrFee');if(!el)return;
  const q=parseFloat((document.getElementById('pfTrQty')||{}).value),p=parseFloat((document.getElementById('pfTrPrice')||{}).value);
  if(!(q>0)||!(p>0)){el.textContent='';return;}
  const amt=q*p,fb=tradeFeeNative(ccy,amt,true),fs=tradeFeeNative(ccy,amt,false);
  el.innerHTML=`${RT('Сумма','Amount')}: <b>${pf3Fmt(amt,2)} ${ccy}</b> · ${RT('комиссия','fee')} ${RT('покупка','buy')} ~${pf3Fmt(fb.total,2)} ${ccy} → ${RT('итого','total')} ${pf3Fmt(amt+fb.total,2)} ${ccy} · ${RT('продажа','sell')} ~${pf3Fmt(fs.total,2)} ${ccy}`;
}
function pfTrade(act){
  const ri=pf3SelIdx(),d=pf3D();if(ri<0||!d)return;const r=d.rows[ri];if(!r)return;
  const qty=parseFloat((document.getElementById('pfTrQty')||{}).value),price=parseFloat((document.getElementById('pfTrPrice')||{}).value);
  if(!(qty>0)||!(price>0)){toast(RT('Укажите количество и цену сделки','Enter trade quantity and price'),true);return;}
  const tk=String(r[2]||'').trim().toUpperCase(),ccy=r[8]||'USD',fx=FX[ccy]||1;
  const curQty=parseFloat(r[6])||0,avg=parseFloat(r[9])||0;
  let plNative=null,tq=qty,feeNative=0;
  if(act==='sell'){
    tq=Math.min(qty,curQty);
    if(!(tq>0)){toast(RT('Нет позиции для продажи','No position to sell'),true);return;}
    feeNative=tradeFeeNative(ccy,tq*price,false).total;
    plNative=Math.round(((price-avg)*tq-feeNative)*100)/100;   // P&L нетто, за вычетом комиссии продажи
    r[6]=Math.round((curQty-tq)*1e6)/1e6;   // уменьшаем позицию, средняя не меняется
    if(d.cashFree!=null&&d.cashFree!=='')d.cashFree=Math.round(((parseFloat(d.cashFree)||0)+pf3Cv(d,(tq*price-feeNative)*fx))*100)/100;   // выручка − комиссия → кэш
  }else{
    feeNative=tradeFeeNative(ccy,qty*price,true).total;
    const nq=curQty+qty;
    r[9]=Math.round((avg*curQty+price*qty)/nq*100)/100;   // новая средняя (без комиссии)
    r[6]=nq;
    if(d.cashFree!=null&&d.cashFree!=='')d.cashFree=Math.round(((parseFloat(d.cashFree)||0)-pf3Cv(d,(qty*price+feeNative)*fx))*100)/100;   // сумма + комиссия с кэша
  }
  PF_TRADES.push({id:'tr'+Date.now()+'_'+Math.floor(Math.random()*1e4),tab:v3Key,tk,name:String(r[1]||tk),ccy,act,qty:tq,price,plNative,feeNative,date:new Date().toISOString().slice(0,10)});
  recalcPF(ri,v3Key);scheduleSave();renderPF3();
  toast((act==='sell'?'🔴 '+RT('Продано','Sold'):'🟢 '+RT('Куплено','Bought'))+` ${pf3Fmt(tq)} × ${pf3Fmt(price,2)} ${ccy}`+(feeNative?` · ${RT('комиссия','fee')} ${pf3Fmt(feeNative,2)} ${ccy}`:'')+(plNative!=null?` · P&L ${plNative>=0?'+':''}${pf3Money(d,plNative*fx)}`:''));
}
// ── 🛒 Покупка с карточки в ВЫБРАННЫЙ портфель (любая акция, в т.ч. из индексных вкладок) ──
// Чистая функция средней (genomsnittsmetoden, без учёта комиссии — паритет с pfTrade): покрыта тестом.
function pfApplyBuy(cur, qty, price){
  const curQty=parseFloat(cur&&cur.qty)||0, avg=parseFloat(cur&&cur.avg)||0;
  const nq=curQty+qty;
  return {qty:Math.round(nq*1e6)/1e6, avg:nq>0?Math.round((avg*curQty+price*qty)/nq*100)/100:0};
}
// Список целевых портфелей (мои/семейные, без AI) для выпадашки.
function pfBuyTargets(){return Object.keys(DATA).filter(k=>pf3MyPort(k)).map(k=>({key:k,label:TAB_LABEL(k)||k}));}
// Живое превью: сумма + комиссия + итого; эквивалент в базовой валюте портфеля и предупреждение по кэшу.
function pfCardBuyPreview(ccy){
  const el=document.getElementById('pfBuyPreview');if(!el)return;
  const g=id=>document.getElementById(id);
  const d=DATA[(g('pfBuyPort')||{}).value];
  let qty=parseFloat((g('pfBuyQty')||{}).value),price=parseFloat((g('pfBuyPrice')||{}).value);
  const amt=parseFloat((g('pfBuyAmt')||{}).value);
  if(!(price>0)&&amt>0&&qty>0)price=amt/qty;
  if(!(qty>0)||!(price>0)){el.textContent='';return;}
  const fee=tradeFeeNative(ccy,qty*price,true).total,total=qty*price+fee,fx=FX[ccy]||1;
  let s=`${RT('Сумма','Amount')}: <b>${pf3Fmt(qty*price,2)} ${ccy}</b> · ${RT('комиссия','fee')} ~${pf3Fmt(fee,2)} ${ccy} → ${RT('итого','total')} <b>${pf3Fmt(total,2)} ${ccy}</b>`;
  if(d){const cash=parseFloat(d.cashFree);if(isFinite(cash)){const after=cash-pf3Cv(d,total*fx);s+=` · ${RT('кэш после','cash after')} ${pf3Fmt(after,0)} ${pf3Base(d)}`+(after<0?` <span class="pf3-down">⚠️ ${RT('в минус','negative')}</span>`:'');}}
  el.innerHTML=s;
}
// Исполнение: найти/создать позицию в выбранном портфеле, обновить кэш, записать сделку.
function pfCardBuy(){
  if(!can('action.add_position'))return;
  const g=id=>document.getElementById(id);
  const key=(g('pfBuyPort')||{}).value,d=DATA[key];
  if(!d||!pf3MyPort(key)){toast(RT('Выберите портфель','Select a portfolio'),true);return;}
  const cr=pf3D().rows[pf3SelIdx()];if(!cr)return;
  const tk=String(cr[2]||'').trim().toUpperCase();if(!tk)return;
  let qty=parseFloat((g('pfBuyQty')||{}).value),price=parseFloat((g('pfBuyPrice')||{}).value);
  const amt=parseFloat((g('pfBuyAmt')||{}).value);
  if(!(price>0)&&amt>0&&qty>0)price=Math.round(amt/qty*1e6)/1e6;
  if(!(qty>0)||!(price>0)){toast(RT('Укажите количество и цену (или сумму)','Enter quantity and price (or amount)'),true);return;}
  const date=(g('pfBuyDate')||{}).value||new Date().toISOString().slice(0,10);
  let ri=(d.rows||[]).findIndex(r=>String(r[2]||'').trim().toUpperCase()===tk);
  const ccy=(ri>=0?(d.rows[ri][8]||cr[8]):cr[8])||'USD';
  if(ri<0){   // создать новую позицию (паттерн pf3-строки; метрики дозаполнятся при обновлении цен)
    const row=new Array(d.headers.length).fill('');
    row[0]=d.rows.length+1;row[1]=String(cr[1]||tk);row[2]=tk;row[3]=cr[3]||'';row[4]=cr[4]||'';row[5]=cr[5]||'';
    row[6]=0;row[7]=parseFloat(cr[7])||price;row[8]=ccy;row[9]=0;row[10]=0;row[11]=0;row[12]=0;row[13]=0;
    d.rows.push(row);d.count=d.rows.length;ri=d.rows.length-1;
  }
  const r=d.rows[ri],fee=tradeFeeNative(ccy,qty*price,true).total,fx=FX[ccy]||1;
  const res=pfApplyBuy({qty:parseFloat(r[6])||0,avg:parseFloat(r[9])||0},qty,price);
  r[9]=res.avg;r[6]=res.qty;
  if(!(parseFloat(r[7])>0))r[7]=price;   // дать цену, пока не обновили живую
  if(d.cashFree!=null&&d.cashFree!=='')d.cashFree=Math.round(((parseFloat(d.cashFree)||0)-pf3Cv(d,(qty*price+fee)*fx))*100)/100;   // сумма + комиссия с кэша
  PF_TRADES.push({id:'tr'+Date.now()+'_'+Math.floor(Math.random()*1e4),tab:key,tk,name:String(r[1]||tk),ccy,act:'buy',qty,price,plNative:null,feeNative:fee,date});
  recalcPF(ri,key);scheduleSave();renderPF3();
  toast('🟢 '+RT('Куплено','Bought')+` ${pf3Fmt(qty)} × ${pf3Fmt(price,2)} ${ccy} → ${TAB_LABEL(key)}`+(fee?` · ${RT('комиссия','fee')} ${pf3Fmt(fee,2)} ${ccy}`:''));
}
function pfTradeDel(id){
  const i=PF_TRADES.findIndex(t=>t.id===id);if(i<0)return;
  if(!confirm(RT('Удалить запись о сделке? (позиция и кэш НЕ изменятся)','Delete this trade record? (position & cash stay)')))return;
  PF_TRADES.splice(i,1);scheduleSave();renderPF3();
}
// filterTk — компактная история одной бумаги (карточка); без него — все сделки портфеля.
// Источник: PF_TRADES (семейные портфели) или AI_PORT.trades (AI-портфель, read-only).
function pfTradesHTML(filterTk){
  const d=pf3D();
  const fk=filterTk!==undefined?String(filterTk).toUpperCase():null;
  const isAi=v3Key===AIP_KEY;
  let src;
  if(isAi){
    src=((AI_PORT&&AI_PORT.trades)||[]).map((t,idx)=>({id:t.id||('ai'+(t.ts||idx)),tab:AIP_KEY,tk:String(t.ticker||'').toUpperCase(),name:t.name||t.ticker,ccy:t.ccy||'SEK',act:t.action,qty:t.qty,price:t.price,plSEK:typeof t.plSEK==='number'?t.plSEK:null,date:t.ts?new Date(t.ts).toISOString().slice(0,10):'',note:t.trigger||'',ord:t.ts||idx,ai:1}));
  }else{
    src=PF_TRADES.map((t,idx)=>({...t,plSEK:t.plNative!=null?t.plNative*(FX[t.ccy]||1):null,ord:idx}));
  }
  const mine=src.filter(t=>(t.tab||PF3_KEY)===v3Key&&(!fk||String(t.tk).toUpperCase()===fk))
    .sort((a,b)=>(a.date<b.date?1:a.date>b.date?-1:(b.ord>a.ord?1:-1)));
  let realizedSEK=0,hasSell=false;
  const rows=mine.map(t=>{
    const plSEK=t.plSEK;
    if(plSEK!=null){realizedSEK+=plSEK;hasSell=true;}
    const cls=plSEK==null?'':plSEK>=0?'pf3-up':'pf3-down';
    const feeTxt=t.feeNative?` · ${RT('комис.','fee')} ${pf3Fmt(t.feeNative,1)} ${t.ccy}`:(typeof t.feeSEK==='number'&&t.feeSEK?` · ${RT('комис.','fee')} ${pf3Fmt(t.feeSEK,0)} kr`:'');
    const sub=fk?(t.date+feeTxt+(t.note?' · '+t.note:'')):`${t.tk} · ${t.date}${feeTxt}${isAi?(t.note?' · '+t.note:''):` · <span class="sim-port">💼 ${pfPortShort(t.tab)}</span>`}`;
    return`<div class="sim-trow tr-row">
      <span class="tr-act ${t.act}">${t.act==='sell'?'🔴 '+RT('Продажа','Sell'):'🟢 '+RT('Покупка','Buy')}</span>
      <span class="pf3-row-name">${fk?'':`<b>${t.name||t.tk}</b>`}<span>${sub}</span></span>
      <span class="tr-qty">${pf3Fmt(t.qty)} × ${pf3Fmt(t.price,2)} ${t.ccy}</span>
      <span class="tr-pl ${cls}">${plSEK!=null?(plSEK>=0?'+':'')+pf3Money(d,plSEK):'—'}</span>
      ${isAi?'':`<button class="pf3-del" onclick="pfTradeDel('${t.id}')" title="${RT('Удалить запись','Delete record')}">🗑</button>`}
    </div>`;
  }).join('');
  const tot=hasSell?`<span class="pf3-asof">${RT('Реализованный P&L','Realized P&L')}: <b class="${realizedSEK>=0?'pf3-up':'pf3-down'}">${realizedSEK>=0?'+':''}${pf3Money(d,realizedSEK)}</b></span>`:'';
  // Форма «внести запись в журнал» (только полный журнал семейного портфеля):
  // пишет ТОЛЬКО историю, не меняя позиции/кэш — для ручного восстановления сделок.
  const addForm=(!fk&&!isAi&&pf3MyPort(v3Key)&&can('action.edit_trades'))?`
    <details class="tr-add">
      <summary>➕ ${RT('Внести сделку заново (позиция + журнал, кэш не трогаю)','Re-enter a trade (position + journal, cash untouched)')}</summary>
      <div class="tr-add-form">
        <select id="pfTrAct"><option value="buy">🟢 ${RT('Покупка','Buy')}</option><option value="sell">🔴 ${RT('Продажа','Sell')}</option></select>
        <input id="pfTrTk" placeholder="${RT('Тикер','Ticker')}" autocomplete="off">
        <input id="pfTrRq" type="number" step="any" min="0" placeholder="${RT('Кол-во','Qty')}">
        <input id="pfTrRp" type="number" step="any" min="0" placeholder="${RT('Цена','Price')}">
        <input id="pfTrCcy" placeholder="${RT('Валюта','Ccy')}" value="USD" style="width:64px;text-transform:uppercase">
        <input id="pfTrRd" type="date" value="${new Date().toISOString().slice(0,10)}">
        <button class="pf3-btn" onclick="pfTradeAddRecord()">${RT('Внести','Add')}</button>
      </div>
      <div class="pf3-reco-note">${RT('Обновляет количество и среднюю по тикеру (создаёт позицию, если её нет) и пишет в журнал. Свободный кэш НЕ меняется. Вводите сделки по порядку: сначала покупки, потом продажи. P&L по продаже считается от средней автоматически. Валюта берётся из существующей позиции, если она есть.','Updates qty and average by ticker (creates the position if missing) and writes the journal. Free cash is NOT changed. Enter trades in order: buys first, then sells. Sell P&L is computed from the average automatically. Currency comes from the existing position if present.')}</div>
    </details>`:'';
  const importBtn=(!fk&&!isAi&&pf3MyPort(v3Key)&&can('action.edit_trades'))?`<label class="pf3-btn pf3-btn-sm tr-import" title="${RT('Импорт сделок из CSV (date, action, ticker, qty, price, ccy, fee)','Import trades from CSV (date, action, ticker, qty, price, ccy, fee)')}">📥 ${RT('Импорт CSV','Import CSV')}<input type="file" accept=".csv,text/csv" style="display:none" onchange="pfImportTradesCSV(this)"></label>`:'';
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>📜 ${RT('История сделок','Trade history')}${fk?'':' — '+TAB_LABEL(v3Key)}</span><span class="tr-hd-r">${tot}${importBtn}</span></div>
    ${mine.length?`<div class="sim-list">${rows}</div>`:`<div class="pf3-empty">${isAi?RT('AI-портфель ещё не совершал сделок — он торгует автономно по стратегии.','The AI portfolio has not traded yet — it trades autonomously by its strategy.'):RT('Сделок пока нет. Купите или продайте в блоке «💸 Сделка» в карточке акции.','No trades yet. Buy or sell in the «💸 Trade» box on a stock card.')}</div>`}
    ${addForm}
  </section>`;
}
// Ручной повторный ввод сделки: пересобирает позицию (кол-во/средняя) + журнал,
// но НЕ трогает свободный кэш. Создаёт позицию по тикеру, если её нет.
function pfTradeAddRecord(){
  if(!pf3MyPort(v3Key))return;
  const g=id=>document.getElementById(id);
  const act=(g('pfTrAct')&&g('pfTrAct').value)||'buy';
  const tk=String((g('pfTrTk')&&g('pfTrTk').value)||'').trim().toUpperCase();
  const qty=parseFloat(g('pfTrRq')&&g('pfTrRq').value)||0;
  const price=parseFloat(g('pfTrRp')&&g('pfTrRp').value)||0;
  const date=(g('pfTrRd')&&g('pfTrRd').value)||new Date().toISOString().slice(0,10);
  let ccyIn=String((g('pfTrCcy')&&g('pfTrCcy').value)||'').trim().toUpperCase();
  if(!tk||!(qty>0)||!(price>0)){toast(RT('Укажите тикер, количество и цену','Enter ticker, qty and price'),true);return;}
  const d=pf3D();
  let ri=(d.rows||[]).findIndex(r=>String(r[2]||'').trim().toUpperCase()===tk);
  if(ri<0){
    if(act==='sell'){toast(RT('Нет позиции для продажи — сначала внесите покупку','No position to sell — add a buy first'),true);return;}
    // создать минимальную позицию (метрики/сектор дозаполнятся при обновлении цен)
    const row=new Array(d.headers.length).fill('');
    row[0]=d.rows.length+1;row[1]=tk;row[2]=tk;row[3]='';row[4]='';row[5]='';
    row[6]=0;row[7]=price;row[8]=ccyIn||'USD';row[9]=0;row[10]=0;row[11]=0;row[12]=0;row[13]=0;
    d.rows.push(row);d.count=d.rows.length;ri=d.rows.length-1;
  }
  const r=d.rows[ri],ccy=r[8]||ccyIn||'USD';
  const curQty=parseFloat(r[6])||0,avg=parseFloat(r[9])||0;
  let plNative=null,tq=qty;
  if(act==='sell'){
    tq=Math.min(qty,curQty);
    if(!(tq>0)){toast(RT('Нет позиции для продажи','No position to sell'),true);return;}
    plNative=Math.round((price-avg)*tq*100)/100;
    r[6]=Math.round((curQty-tq)*1e6)/1e6;   // средняя не меняется
  }else{
    const nq=curQty+qty;
    r[9]=Math.round((avg*curQty+price*qty)/nq*100)/100;   // новая средняя
    r[6]=nq;
    if(!(parseFloat(r[7])>0))r[7]=price;   // дать цену, пока не обновили живую
  }
  PF_TRADES.push({id:'tr'+Date.now()+'_'+Math.floor(Math.random()*1e4),tab:v3Key,tk,name:String(r[1]||tk),ccy,act,qty:tq,price,plNative,date});
  recalcPF(ri,v3Key);scheduleSave();renderPF3();
  toast((act==='sell'?'🔴 '+RT('Продажа внесена','Sell recorded'):'🟢 '+RT('Покупка внесена','Buy recorded'))+` · ${pf3Fmt(tq)} × ${pf3Fmt(price,2)} ${ccy}`+(plNative!=null?` · P&L ${plNative>=0?'+':''}${pf3Money(d,plNative*(FX[ccy]||1))}`:'')+' · '+RT('кэш не изменён','cash unchanged'));
}

// ── 🧾 Налоговый отчёт + 📥 CSV-импорт сделок ───────────────────────────────
// Чистый движок (покрыт тестом): сделки сортируются по тикеру хронологически,
// продажи сопоставляются с покупками. Методы: 'avg' — средняя цена
// (genomsnittsmetoden — корректно для шведского K4 и совпадает с журналом),
// 'fifo' — первый-пришёл-первый-ушёл (для сверки). Комиссия покупки входит в
// себестоимость, комиссия продажи уменьшает выручку. Возвращает записи-продажи.
let _taxMethod='avg';
function pfTaxLots(trades, method){
  const recs=[],byTk={};
  const list=(trades||[]).slice().sort((a,b)=>{const da=String(a.date||''),db=String(b.date||'');return da<db?-1:da>db?1:((a.ord||0)-(b.ord||0));});
  for(const t of list){
    const tk=String(t.tk||'').toUpperCase();if(!tk)continue;
    const q=Math.abs(parseFloat(t.qty)||0);if(!(q>0))continue;
    const price=parseFloat(t.price)||0,fee=Math.abs(parseFloat(t.fee)||0);
    const st=byTk[tk]||(byTk[tk]={qty:0,cost:0,lots:[]});
    if(t.act==='sell'){
      let cost=0;
      if(method==='fifo'){let need=q;while(need>1e-9&&st.lots.length){const lot=st.lots[0],take=Math.min(need,lot.q);cost+=take*lot.cps;lot.q-=take;need-=take;if(lot.q<=1e-9)st.lots.shift();}st.qty=Math.max(0,st.qty-q);}
      else{const cps=st.qty>0?st.cost/st.qty:0;cost=cps*q;st.cost=Math.max(0,st.cost-cost);st.qty=Math.max(0,st.qty-q);}
      const proceeds=q*price-fee,gain=proceeds-cost;
      recs.push({trade:t,tk,name:t.name||tk,ccy:t.ccy||'SEK',date:t.date||'',year:String(t.date||'').slice(0,4)||'—',qty:q,proceeds:Math.round(proceeds*100)/100,cost:Math.round(cost*100)/100,gain:Math.round(gain*100)/100});
    }else{const cpsIncl=price+(q>0?fee/q:0);st.qty+=q;st.cost+=q*price+fee;st.lots.push({q,cps:cpsIncl});}
  }
  return recs;
}
// Журнал семейного портфеля → формат движка.
function pfTaxTrades(tab){return (PF_TRADES||[]).filter(e=>(e.tab||PF3_KEY)===(tab||v3Key)).map((e,i)=>({tk:e.tk,name:e.name,ccy:e.ccy,act:e.act,qty:e.qty,price:e.price,fee:e.feeNative,date:e.date,ord:i,_e:e}));}
// Пересчёт реализованного P&L журнала по средней цене (после импорта) — чтобы
// сумма «Реализованный P&L» осталась консистентной (тот же метод, что у pfTrade).
function pfRecalcRealized(tab){
  const trades=pfTaxTrades(tab);
  trades.forEach(t=>{if(t._e&&t._e.act==='sell')t._e.plNative=null;});
  pfTaxLots(trades,'avg').forEach(r=>{if(r.trade&&r.trade._e)r.trade._e.plNative=Math.round(r.gain*100)/100;});
}
const _taxNormDate=s=>{s=String(s||'').trim();let m;if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);if(m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/))return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;return s.slice(0,10);};
// Парсер CSV сделок: автоопределение разделителя (,/;), гибкие заголовки (ru/en/sv).
function pfParseTradesCSV(text){
  const lines=String(text||'').split(/\r?\n/).filter(l=>l.trim());if(lines.length<2)return 0;
  const delim=(lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length?';':',';
  const split=l=>{const out=[];let cur='',q=false;for(let i=0;i<l.length;i++){const c=l[i];if(c==='"'){if(q&&l[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===delim&&!q){out.push(cur);cur='';}else cur+=c;}out.push(cur);return out.map(s=>s.trim());};
  const head=split(lines[0]).map(h=>h.toLowerCase().replace(/^﻿/,''));
  const col=(...names)=>{for(const n of names){const i=head.indexOf(n);if(i>=0)return i;}return -1;};
  const ci={date:col('date','дата','datum'),act:col('action','действие','type','тип','side','transaktion'),tk:col('ticker','тикер','symbol','инструмент'),qty:col('qty','quantity','кол-во','количество','shares','antal','volym'),price:col('price','цена','kurs','pris'),ccy:col('ccy','currency','валюта','valuta'),fee:col('fee','комиссия','courtage','avgift','commission')};
  if(ci.tk<0||ci.qty<0||ci.price<0)return 0;
  const num=s=>{const n=parseFloat(String(s||'').replace(/\s/g,'').replace(',','.'));return isFinite(n)?n:0;};
  const today=new Date().toISOString().slice(0,10);let n=0;
  for(let i=1;i<lines.length;i++){
    const c=split(lines[i]);if(!c.length)continue;
    const tk=String(c[ci.tk]||'').trim().toUpperCase();if(!tk)continue;
    const rawQ=num(c[ci.qty]),qty=Math.abs(rawQ),price=num(c[ci.price]);if(!(qty>0)||!(price>0))continue;
    const av=String(ci.act>=0?c[ci.act]:'').trim().toLowerCase();
    const act=/sell|прода|s[äa]lj|sale|^s$/.test(av)?'sell':/buy|покуп|k[öo]p|^b$/.test(av)?'buy':(rawQ<0?'sell':'buy');
    const ccy=String(ci.ccy>=0?c[ci.ccy]:'').trim().toUpperCase()||'USD';
    const date=_taxNormDate(ci.date>=0?c[ci.date]:today)||today;
    const fee=ci.fee>=0?Math.abs(num(c[ci.fee])):0;
    PF_TRADES.push({id:'tr'+Date.now()+'_'+Math.floor(Math.random()*1e6)+'_'+i,tab:v3Key,tk,name:tk,ccy,act,qty,price,feeNative:fee||undefined,plNative:null,date,imp:1});n++;
  }
  return n;
}
function pfImportTradesCSV(input){
  if(!pf3MyPort(v3Key)){toast(RT('Импорт только для семейных портфелей','Import only for family portfolios'),true);return;}
  const file=input&&input.files&&input.files[0];if(!file){return;}
  const rd=new FileReader();
  rd.onload=()=>{try{const n=pfParseTradesCSV(String(rd.result||''));
    if(!n)toast(RT('Сделки не найдены. Нужны колонки: date, action, ticker, qty, price, ccy (fee — опц.)','No trades found. Need columns: date, action, ticker, qty, price, ccy (fee optional)'),true);
    else{pfRecalcRealized(v3Key);scheduleSave();renderPF3();toast(`📥 ${RT('Импортировано сделок','Imported trades')}: ${n}`);}
  }catch(e){toast('CSV: '+(e&&e.message||e),true);}if(input)input.value='';};
  rd.readAsText(file);
}
function pfTaxSetMethod(m){_taxMethod=m==='fifo'?'fifo':'avg';renderPF3();}
function pfTaxHTML(){
  const d=pf3D();
  const recs=pfTaxLots(pfTaxTrades(),_taxMethod);
  const hd=`<div class="pf3-panel-hd"><span>🧾 ${RT('Налоговый отчёт','Tax report')} ${infoBtn('tax')}</span><span class="pf3-tf"><button class="pf3-tfbtn${_taxMethod==='avg'?' on':''}" onclick="pfTaxSetMethod('avg')">${RT('Средняя','Average')}</button><button class="pf3-tfbtn${_taxMethod==='fifo'?' on':''}" onclick="pfTaxSetMethod('fifo')">FIFO</button></span></div>`;
  if(!recs.length)return`<section class="pf3-panel tax">${hd}<div class="pf3-empty">${RT('В журнале этого портфеля нет продаж. Импортируйте CSV во вкладке «Сделки» или внесите продажи в карточке акции.','No sells in the journal of this portfolio. Import a CSV in «Trades» or add sells from a stock card.')}</div></section>`;
  const years={};recs.forEach(r=>{(years[r.year]=years[r.year]||[]).push(r);});
  const yrKeys=Object.keys(years).sort((a,b)=>a<b?1:-1);
  const sek=(ccy,v)=>Math.round(v*(FX[ccy]||1));let totSEK=0;
  const blocks=yrKeys.map(y=>{
    const list=years[y],byCcy={};let ySEK=0;
    list.forEach(r=>{const a=byCcy[r.ccy]||(byCcy[r.ccy]={gain:0});a.gain+=r.gain;ySEK+=sek(r.ccy,r.gain);});totSEK+=ySEK;
    const ccyLines=Object.keys(byCcy).map(c=>`<span class="${byCcy[c].gain>=0?'pf3-up':'pf3-down'}">${byCcy[c].gain>=0?'+':''}${pf3Fmt(byCcy[c].gain,0)} ${c}</span>`).join(' · ');
    const rowsH=list.slice().sort((a,b)=>a.date<b.date?1:-1).map(r=>`<div class="tax-row"><span>${r.date}</span><span class="pf3-row-name"><b>${r.tk}</b></span><span class="tr-qty">${pf3Fmt(r.qty)} ${RT('шт','sh')}</span><span>${pf3Fmt(r.proceeds,0)} ${r.ccy}</span><span class="${r.gain>=0?'pf3-up':'pf3-down'}">${r.gain>=0?'+':''}${pf3Fmt(r.gain,0)} ${r.ccy}</span></div>`).join('');
    return`<div class="tax-year"><div class="tax-year-hd"><b>${y}</b> · ${ccyLines} · <span class="${ySEK>=0?'pf3-up':'pf3-down'}">≈${ySEK>=0?'+':''}${pf3Money(d,ySEK)}</span> <span class="pf3-asof">(${list.length} ${RT('прод.','sales')})</span></div><div class="tax-rows">${rowsH}</div></div>`;
  }).join('');
  return`<section class="pf3-panel tax">${hd}
    <div class="tax-tot"><span>${RT('Итого реализованный результат','Total realized result')}: </span><b class="${totSEK>=0?'pf3-up':'pf3-down'}">${totSEK>=0?'+':''}${pf3Money(d,totSEK)}</b> <button class="pf3-btn pf3-btn-sm" onclick="pfTaxExportCSV()">📥 CSV</button></div>
    ${blocks}
    <p class="pf3-asof tax-note">${RT('«Средняя» = genomsnittsmetoden (корректно для шведской декларации K4); FIFO — для сверки. Суммы в kr — по ТЕКУЩЕМУ курсу (не на дату сделки): это оценка, не готовая K4. Комиссия покупки входит в себестоимость, комиссия продажи уменьшает выручку.','«Average» = genomsnittsmetoden (correct for the Swedish K4); FIFO is for cross-check. kr amounts use the CURRENT FX (not the trade-date rate): an estimate, not a filing-ready K4. Buy fees add to cost basis, sell fees reduce proceeds.')} ${RT(INFO_DISCLAIM[0],INFO_DISCLAIM[1])}</p>
  </section>`;
}
function pfTaxExportCSV(){
  const recs=pfTaxLots(pfTaxTrades(),_taxMethod);
  const rows=[['year','date','ticker','qty','proceeds','cost','gain','ccy','gainSEK_est']];
  recs.forEach(r=>rows.push([r.year,r.date,r.tk,r.qty,r.proceeds,r.cost,r.gain,r.ccy,Math.round(r.gain*(FX[r.ccy]||1))]));
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='tax_'+_taxMethod+'_'+TAB_LABEL(v3Key).replace(/\s/g,'_')+'.csv';a.click();
}
// ── 🎯 План действий: триггеры по уровням/датам с уведомлением ───────────────
// Пользователь (или совет AI) заводит правила вида «купить TK у уровня X»,
// «сократить TK до даты Y». При каждом обновлении цен дашборд сверяет живую цену
// с уровнем и уведомляет (тост + браузерный push), когда условие достигнуто.
function planCurPrice(tk){
  tk=String(tk||'').trim().toUpperCase(); if(!tk)return null;
  const keys=Object.keys(DATA||{});
  for(const k of keys){
    const d=DATA[k]; if(!d||!d.rows||!(d.v3==='1'||k===PF3_KEY||k===AIP_KEY))continue;
    for(const r of d.rows){ if(String(r[2]||'').trim().toUpperCase()===tk){ const p=parseFloat(r[7]); if(isFinite(p)&&p>0)return p; } }
  }
  return null;
}
function planDaysLeft(deadline){ if(!deadline)return null; const dl=new Date(deadline+'T23:59:59').getTime(); return Math.ceil((dl-Date.now())/86400000); }
function planStatus(rule){
  const price=planCurPrice(rule.tk), lvl=parseFloat(rule.level);
  const hasLvl=isFinite(lvl)&&lvl>0; let priceReady=false, gapPct=null;
  if(hasLvl&&price>0){
    if(rule.act==='sell'){ priceReady=price>=lvl; gapPct=(lvl-price)/price*100; }   // ждём роста до уровня
    else { priceReady=price<=lvl; gapPct=(price-lvl)/lvl*100; }                        // ждём падения в зону покупки
  }
  const dleft=planDaysLeft(rule.deadline);
  const overdue=dleft!=null&&dleft<0, dueSoon=dleft!=null&&dleft>=0&&dleft<=3;
  // Готово к исполнению: если задан уровень — по цене; если уровня нет, а есть
  // дедлайн — по приближению/наступлению даты.
  const ready = hasLvl ? priceReady : (dueSoon||overdue);
  return {price,lvl,hasLvl,priceReady,gapPct,dleft,overdue,dueSoon,ready};
}
function planReadyCount(tab){ return (PLAN_RULES||[]).filter(r=>(!tab||(r.tab||PF3_KEY)===tab)&&!r.done&&planStatus(r).ready).length; }
function planBadge(tab){ const n=planReadyCount(tab); return n?` 🔔${n}`:''; }
function planActIcon(act){ return act==='sell'?'🔴':act==='watch'?'👁':'🟢'; }
function planActLabel(act){ return act==='sell'?RT('Сократить','Trim'):act==='watch'?RT('Наблюдать','Watch'):RT('Купить','Buy'); }
function planNotify(title,body){
  try{
    if(typeof Notification==='undefined')return;
    if(Notification.permission==='granted'){ new Notification(title,{body,tag:'plan'}); }
    else if(Notification.permission==='default'){ Notification.requestPermission(); }
  }catch(e){}
}
function planAskNotify(silent){
  try{
    if(typeof Notification==='undefined'){ if(!silent)toast(RT('Браузер не поддерживает уведомления','Browser has no notifications'),true); return; }
    if(Notification.permission==='default'){ Notification.requestPermission().then(()=>{ if(!silent&&isV3()&&pf3Tab==='plan')renderPF3(); }); }
    else if(Notification.permission==='denied'){ if(!silent)toast(RT('Уведомления заблокированы в браузере','Notifications blocked in browser'),true); }
    else if(!silent){ toast(RT('Уведомления уже включены','Alerts already on')); }
  }catch(e){}
}
// Сверяет все правила с живыми ценами; уведомляет о НОВО достигнутых уровнях.
// Вызывается после обновления цен и при открытии вкладки «План».
function planCheck(){
  let changed=false; const fired=[];
  (PLAN_RULES||[]).forEach(rule=>{
    if(rule.done)return;
    const st=planStatus(rule);
    if(st.ready&&!rule.hitAt){ rule.hitAt=Date.now(); changed=true; fired.push({rule,st}); }
    else if(!st.ready&&rule.hitAt&&st.price>0){ rule.hitAt=0; changed=true; }   // ушли из зоны → сброс, чтобы уведомить при повторном входе
  });
  fired.forEach(({rule,st})=>{
    const lvlTxt=st.hasLvl
      ?`${rule.act==='sell'?RT('цена выросла до','price rose to'):RT('цена опустилась к','price dropped to')} ${pf3Fmt(st.lvl,2)} ${rule.ccy||''}`
      :RT('подошёл срок','deadline reached');
    const msg=`${planActIcon(rule.act)} ${rule.tk}: ${lvlTxt}${rule.amount?` · ~${pf3Fmt(rule.amount,0)} kr`:''}`;
    toast('🎯 '+msg);
    planNotify(RT('🎯 План действий — пора исполнять','🎯 Action plan — act now'), msg+(rule.note?`\n${rule.note}`:''));
  });
  if(changed)scheduleSave();
  if(fired.length&&isV3()&&pf3Tab==='plan')renderPF3();
}
let planEditId=null;   // id правила, открытого на редактирование (инлайн)
// Сколько ЦЕЛЫХ акций влезает в сумму kr по цене (валюта бумаги). Акции
// покупаются поштучно — поэтому показываем штуки, а не «на N крон».
function planShares(r, price){
  if(!(price>0)||!(r.amount>0))return null;
  const ccyAmt=r.amount/(FX[r.ccy]||1);   // kr → валюта бумаги
  return Math.floor(ccyAmt/price);
}
// Строка про количество: либо заданные штуки, либо «сколько влезает» из суммы.
function planQtyBit(r, price){
  if(r.qty>0){
    let s=`${pf3Fmt(r.qty)} ${RT('шт','sh')}`;
    if(price>0)s+=` ≈ ${pf3Fmt(r.qty*price*(FX[r.ccy]||1),0)} kr`;
    return s;
  }
  if(r.amount>0){
    if(price>0){
      const sh=planShares(r,price);
      if(sh<1)return `~${pf3Fmt(r.amount,0)} kr · ⚠ ${RT('меньше цены 1 акции','below 1-share price')} (≈${pf3Fmt(price*(FX[r.ccy]||1),0)} kr/${RT('шт','sh')})`;
      return `~${pf3Fmt(r.amount,0)} kr · ≈ ${sh} ${RT('шт','sh')}`;
    }
    return `~${pf3Fmt(r.amount,0)} kr`;
  }
  return '';
}
// Достать ценовой уровень из текста совета («зоне 358–366», «у поддержки €1099»).
// Денежные суммы (kr/крон) отбрасываем, чтобы не спутать с ценой акции.
function planParseLevel(text, act){
  if(!text)return 0;
  const t=String(text).replace(/\d[\d  .,]*\s*(kr|крон|kr\.|sek)\b/gi,' ');
  const m=t.match(/\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g);
  if(!m)return 0;
  const nums=m.map(s=>parseFloat(s.replace(/[  ]/g,'').replace(',','.'))).filter(n=>isFinite(n)&&n>0);
  if(!nums.length)return 0;
  return act==='sell'?Math.min.apply(null,nums):Math.max.apply(null,nums);   // buy→верх зоны, sell→уровень
}
// Перенести структурированный совет AI-Proto («⚖️ Предложение») в правила плана.
function planImportFromAi(){
  const H=pf3AiHist(),last=H[0],P=last&&last.proposal;
  const acts=(P&&P.actions)||[];
  const wl=(P&&P.watchlist)||[];
  if(!acts.length&&!wl.length){toast(RT('Нет структурированного совета — запустите анализ на «🤖 AI Proto»','No structured advice — run analysis on «🤖 AI Proto»'),true);return;}
  // Версии плана: если уже есть перенесённый из AI план — заменить его новой версией или добавить как следующую версию.
  const existing=(PLAN_RULES||[]).filter(r=>r.fromAi&&!r.done&&(r.tab||PF3_KEY)===v3Key);
  let ver='1.0';
  if(existing.length){
    const maxV=existing.reduce((m,r)=>Math.max(m,parseFloat(r.ver)||1),1);
    const replace=confirm(RT(`Уже перенесён план v${maxV.toFixed(1)}.\n\nОК — заменить его новой версией (старые непросмотренные пункты удалятся).\nОтмена — добавить как новую версию v${(maxV+0.1).toFixed(1)} (старые останутся).`,`A plan v${maxV.toFixed(1)} is already imported.\n\nOK — replace it with a new version (old pending items removed).\nCancel — add as a new version v${(maxV+0.1).toFixed(1)} (old kept).`));
    if(replace){ PLAN_RULES=PLAN_RULES.filter(r=>!(r.fromAi&&!r.done&&(r.tab||PF3_KEY)===v3Key)); ver='1.0'; }
    else ver=(maxV+0.1).toFixed(1);
  }
  const d=pf3D(); let added=0;
  acts.forEach((a,i)=>{
    const isSell=/прода|сократ|уменьш|fix|sell|trim|reduce/i.test(a.action||'');
    const isBuy=/куп|докуп|добав|нарасти|buy|add|increase/i.test(a.action||'');
    if(!isBuy&&!isSell)return;   // «держать» — пропускаем (наблюдение идёт из watchlist)
    const act=isSell?'sell':'buy';
    const tk=String(a.ticker||'').trim().toUpperCase(); if(!tk)return;
    if((PLAN_RULES||[]).some(r=>!r.done&&(r.tab||PF3_KEY)===v3Key&&r.tk===tk&&r.act===act))return;   // дедуп
    const level=planParseLevel(a.details||'',act);
    const row=((d&&d.rows)||[]).find(r=>String(r[2]||'').trim().toUpperCase()===tk);
    let ccy='USD';
    if(row&&row[8])ccy=String(row[8]).toUpperCase();
    else if(/€|eur/i.test(a.details||''))ccy='EUR';
    else if(/£|gbp/i.test(a.details||''))ccy='GBP';
    const amount=typeof a.amountSEK==='number'&&a.amountSEK>0?a.amountSEK:0;
    PLAN_RULES.push({id:'pl'+Date.now()+'_'+i+'_'+Math.floor(Math.random()*1e4),tab:v3Key,tk,name:String(a.name||(row&&row[1])||tk),ccy,act,level:level||0,amount,qty:0,deadline:'',note:String(a.details||'').trim(),hitAt:0,done:false,fromAi:1,ver});
    added++;
  });
  // 👁 Лист ожидания (приоритет 4) — отдельным типом «watch».
  wl.forEach((w,i)=>{
    const tk=String(w&&w.ticker||'').trim().toUpperCase(); if(!tk)return;
    if((PLAN_RULES||[]).some(r=>!r.done&&(r.tab||PF3_KEY)===v3Key&&r.tk===tk&&r.act==='watch'))return;   // дедуп
    const row=((d&&d.rows)||[]).find(r=>String(r[2]||'').trim().toUpperCase()===tk);
    const ccy=row&&row[8]?String(row[8]).toUpperCase():'USD';
    const note=[w.condition?RT('Условие','When')+': '+w.condition:'',w.rationale||''].filter(Boolean).join(' · ');
    PLAN_RULES.push({id:'plw'+Date.now()+'_'+i+'_'+Math.floor(Math.random()*1e4),tab:v3Key,tk,name:String(w.name||(row&&row[1])||tk),ccy,act:'watch',level:0,amount:0,qty:0,deadline:'',note,hitAt:0,done:false,fromAi:1,ver});
    added++;
  });
  if(added){planAskNotify(true);scheduleSave();renderPF3();toast('📥 '+RT('Перенесено из совета AI','Imported from AI advice')+` (v${ver}): ${added}. `+RT('Проверьте уровни и кол-во ✏','Check levels & qty ✏'));}
  else toast(RT('Новых правил нет (уже добавлены или нет торговых действий)','No new rules (already added or no trade actions)'));
}
function planEdit(id){ planEditId=(planEditId===id?null:id); renderPF3(); }
function planCancelEdit(){ planEditId=null; renderPF3(); }
function planSave(id){
  const r=(PLAN_RULES||[]).find(x=>x.id===id); if(!r)return;
  const g=k=>document.getElementById(k);
  r.act=(g('planE_act')&&g('planE_act').value)||r.act;
  const tk=String((g('planE_tk')&&g('planE_tk').value)||'').trim().toUpperCase(); if(tk)r.tk=tk;
  r.level=parseFloat(g('planE_lvl')&&g('planE_lvl').value)||0;
  r.ccy=String((g('planE_ccy')&&g('planE_ccy').value)||r.ccy||'USD').trim().toUpperCase();
  r.qty=parseFloat(g('planE_qty')&&g('planE_qty').value)||0;
  r.amount=parseFloat(g('planE_amt')&&g('planE_amt').value)||0;
  r.deadline=(g('planE_dl')&&g('planE_dl').value)||'';
  r.note=String((g('planE_note')&&g('planE_note').value)||'').trim();
  if(!(r.level>0)&&!r.deadline){toast(RT('Задайте уровень цены или дедлайн','Set a price level or a deadline'),true);return;}
  r.hitAt=0;   // условие изменилось → пересверить заново
  planEditId=null; scheduleSave(); renderPF3();
  toast('🎯 '+RT('Правило обновлено','Rule updated'));
}
function planRulesHTML(){
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const d=pf3D();
  const tkOpts=((d&&d.rows)||[]).map(r=>`<option value="${r[2]}">${esc(r[1]||'')}</option>`).join('');
  const mine=(PLAN_RULES||[]).filter(r=>(r.tab||PF3_KEY)===v3Key).map(r=>({r,st:planStatus(r)}));
  mine.sort((a,b)=>{
    if(!!a.r.done!==!!b.r.done)return a.r.done?1:-1;
    if(a.st.ready!==b.st.ready)return a.st.ready?-1:1;
    const ga=a.st.gapPct==null?999:Math.abs(a.st.gapPct), gb=b.st.gapPct==null?999:Math.abs(b.st.gapPct);
    return ga-gb;
  });
  const readyN=mine.filter(x=>!x.r.done&&x.st.ready).length;
  const editRow=r=>`<div class="plan-row plan-edit">
      <div class="plan-add-form plan-edit-form">
        <select id="planE_act"><option value="buy"${r.act!=='sell'?' selected':''}>🟢 ${RT('Купить','Buy')}</option><option value="sell"${r.act==='sell'?' selected':''}>🔴 ${RT('Сократить','Trim')}</option></select>
        <input id="planE_tk" value="${esc(r.tk||'')}" list="planTkList" style="text-transform:uppercase;width:92px">
        <input id="planE_lvl" type="number" step="any" min="0" value="${r.level||''}" placeholder="${RT('Уровень','Level')}">
        <input id="planE_ccy" value="${esc(r.ccy||'USD')}" style="width:58px;text-transform:uppercase">
        <input id="planE_qty" type="number" step="any" min="0" value="${r.qty||''}" placeholder="${RT('Кол-во, шт','Qty, sh')}">
        <input id="planE_amt" type="number" step="any" min="0" value="${r.amount||''}" placeholder="${RT('Сумма, kr','Amount, kr')}">
        <input id="planE_dl" type="date" value="${r.deadline||''}" title="${RT('Дедлайн','Deadline')}">
        <input id="planE_note" value="${esc(r.note||'')}" placeholder="${RT('Заметка','Note')}" style="flex:1;min-width:140px">
        <button class="pf3-btn" onclick="planSave('${r.id}')">${RT('Сохранить','Save')}</button>
        <button class="pf3-btn pf3-btn-sm" onclick="planCancelEdit()">${RT('Отмена','Cancel')}</button>
      </div>
    </div>`;
  const rows=mine.map(({r,st})=>{
    if(planEditId===r.id)return editRow(r);
    let badge;
    if(r.done)badge=`<span class="plan-badge plan-done">✓ ${RT('Исполнено','Done')}</span>`;
    else if(r.act==='watch')badge=`<span class="plan-badge plan-watch">👁 ${RT('Наблюдение','Watch')}</span>`;
    else if(st.ready)badge=`<span class="plan-badge plan-ready">🔔 ${RT('Пора','Act now')}</span>`;
    else if(st.overdue)badge=`<span class="plan-badge plan-over">⌛ ${RT('Просрочено','Overdue')}</span>`;
    else badge=`<span class="plan-badge plan-wait">⏳ ${RT('Ждём','Waiting')}</span>`;
    const bits=[];
    if(st.hasLvl){
      bits.push(`${RT('уровень','level')} ${r.act==='sell'?'≥':'≤'} ${pf3Fmt(st.lvl,2)} ${r.ccy||''}`);
      if(st.price>0)bits.push(`${RT('сейчас','now')} ${pf3Fmt(st.price,2)} ${r.ccy||''}`);
      if(!st.ready&&st.gapPct!=null)bits.push(`${st.gapPct>=0?'+':''}${pf3Fmt(st.gapPct,1)}% ${RT('до уровня','to level')}`);
    }
    if(r.deadline){
      const dl=st.dleft;
      bits.push(`📅 ${r.deadline}${dl!=null?` (${dl<0?RT('просрочен','past'):dl===0?RT('сегодня','today'):dl+RT(' дн','d')})`:''}`);
    }
    const qb=planQtyBit(r, st.price>0?st.price:st.lvl);
    if(qb)bits.push(qb);
    return`<div class="plan-row${st.ready&&!r.done?' is-ready':''}${r.done?' is-done':''}">
      <span class="plan-act ${r.act}">${planActIcon(r.act)} ${planActLabel(r.act)}</span>
      <span class="plan-main"><b>${esc(r.name||r.tk)}</b> <span class="plan-tk">${esc(r.tk)}</span> ${badge}${r.fromAi?`<span class="plan-src" title="${RT('Перенесено из совета AI','From AI advice')}${r.ver?' · v'+r.ver:''}">🤖${r.ver?' v'+r.ver:''}</span>`:''}<span class="plan-sub">${bits.join(' · ')}</span>${r.note?`<span class="plan-note">${esc(r.note)}</span>`:''}</span>
      ${can('action.edit_plan')?`<span class="plan-btns">
        <button class="pf3-del" onclick="planEdit('${r.id}')" title="${RT('Редактировать','Edit')}">✏</button>
        ${r.done?`<button class="pf3-del" onclick="planDone('${r.id}',0)" title="${RT('Вернуть в активные','Reactivate')}">↩</button>`:`<button class="plan-ok" onclick="planDone('${r.id}',1)" title="${RT('Отметить исполненным','Mark done')}">✓</button>`}
        <button class="pf3-del" onclick="planDel('${r.id}')" title="${RT('Удалить','Delete')}">🗑</button>
      </span>`:''}
    </div>`;
  }).join('');
  const canNotify=typeof Notification!=='undefined';
  const notifBtn=(canNotify&&Notification.permission!=='granted')
    ?`<button class="pf3-btn pf3-btn-sm" onclick="planAskNotify()">🔔 ${RT('Вкл. уведомления','Enable alerts')}</button>`:'';
  const hasProp=(()=>{const H=pf3AiHist();return!!(H[0]&&H[0].proposal&&(H[0].proposal.actions||[]).length);})();
  const importBtn=(can('action.edit_plan')&&hasProp)?`<button class="pf3-btn pf3-btn-sm" onclick="planImportFromAi()">📥 ${RT('Из совета AI','From AI advice')}</button>`:'';
  const addForm=`
    <datalist id="planTkList">${tkOpts}</datalist>
    <details class="plan-add"${mine.length?'':' open'}>
      <summary>➕ ${RT('Добавить правило плана','Add plan rule')}</summary>
      <div class="plan-add-form">
        <select id="planAct"><option value="buy">🟢 ${RT('Купить/докупить','Buy/add')}</option><option value="sell">🔴 ${RT('Сократить/продать','Trim/sell')}</option></select>
        <input id="planTk" list="planTkList" placeholder="${RT('Тикер','Ticker')}" autocomplete="off" style="text-transform:uppercase">
        <input id="planLvl" type="number" step="any" min="0" placeholder="${RT('Уровень цены','Price level')}">
        <input id="planCcy" placeholder="${RT('Валюта','Ccy')}" value="USD" style="width:64px;text-transform:uppercase">
        <input id="planQty" type="number" step="any" min="0" placeholder="${RT('Кол-во, шт','Qty, sh')}">
        <input id="planAmt" type="number" step="any" min="0" placeholder="${RT('или сумма, kr','or amount, kr')}">
        <input id="planDl" type="date" title="${RT('Дедлайн (необязательно)','Deadline (optional)')}">
        <input id="planNote" placeholder="${RT('Заметка / условие','Note / condition')}" style="flex:1;min-width:160px">
        <button class="pf3-btn" onclick="planAdd()">${RT('Добавить','Add')}</button>
      </div>
      <div class="pf3-reco-note">${RT('Уровень: для покупки сработает, когда цена опустится ДО уровня (≤); для продажи — когда поднимется ДО уровня (≥). Кол-во указывайте в штуках (акции покупаются поштучно). Если указать сумму в kr — покажу, сколько целых акций на неё влезает по цене. Дедлайн без уровня сработает по дате.','Level: a buy triggers when price drops TO the level (≤); a sell when it rises TO the level (≥). Enter quantity in shares (stocks are bought per share). If you enter a kr amount, I show how many whole shares it covers at price. A deadline without a level triggers by date.')}</div>
    </details>`;
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>🎯 ${RT('План действий','Action plan')} — ${TAB_LABEL(v3Key)}</span>${readyN?`<span class="pf3-asof"><b class="plan-ready-t">🔔 ${readyN} ${RT('к исполнению','ready')}</b></span>`:''}${importBtn}${notifBtn}</div>
    ${mine.length?`<div class="plan-list">${rows}</div>`:`<div class="pf3-empty">${RT('Правил пока нет. Нажмите «📥 Из совета AI», чтобы перенести предложение AI-Proto, или добавьте уровни/даты вручную — дашборд уведомит, когда придёт время действовать.','No rules yet. Click «📥 From AI advice» to import the AI-Proto proposal, or add levels/dates manually — the dashboard will alert you when it is time to act.')}</div>`}
    ${can('action.edit_plan')?addForm:''}
  </section>`;
}
function planAdd(){
  const g=id=>document.getElementById(id);
  const tk=String((g('planTk')&&g('planTk').value)||'').trim().toUpperCase();
  if(!tk){toast(RT('Укажите тикер','Enter a ticker'),true);return;}
  const act=(g('planAct')&&g('planAct').value)||'buy';
  const level=parseFloat(g('planLvl')&&g('planLvl').value)||0;
  const qty=parseFloat(g('planQty')&&g('planQty').value)||0;
  const amount=parseFloat(g('planAmt')&&g('planAmt').value)||0;
  const deadline=(g('planDl')&&g('planDl').value)||'';
  const note=String((g('planNote')&&g('planNote').value)||'').trim();
  let ccy=String((g('planCcy')&&g('planCcy').value)||'').trim().toUpperCase()||'USD';
  if(!(level>0)&&!deadline){toast(RT('Задайте уровень цены или дедлайн','Set a price level or a deadline'),true);return;}
  const d=pf3D(); let name=tk;
  const row=((d&&d.rows)||[]).find(r=>String(r[2]||'').trim().toUpperCase()===tk);
  if(row){ name=String(row[1]||tk); if(row[8])ccy=String(row[8]).toUpperCase(); }
  PLAN_RULES.push({id:'pl'+Date.now()+'_'+Math.floor(Math.random()*1e4),tab:v3Key,tk,name,ccy,act,level:level>0?level:0,qty:qty>0?qty:0,amount:amount>0?amount:0,deadline,note,hitAt:0,done:false});
  planAskNotify(true);   // тихо запросить разрешение на push при первом правиле
  scheduleSave();renderPF3();
  toast('🎯 '+RT('Правило добавлено','Rule added')+': '+tk);
}
function planDel(id){ PLAN_RULES=(PLAN_RULES||[]).filter(r=>r.id!==id); if(planEditId===id)planEditId=null; scheduleSave();renderPF3(); }
function planDone(id,v){ const r=(PLAN_RULES||[]).find(x=>x.id===id); if(!r)return; r.done=!!(+v); if(r.done)r.hitAt=0; scheduleSave();renderPF3(); }
function pf3SetYears(y){pf3State.years=y;renderPF3()}
// Цены + дневное изменение + SMA (обе серии) + поддержка/сопротивление для
// ОДНОЙ вкладки. Batched in chunks of 20 — the worker makes 2 Yahoo calls per
// symbol and Cloudflare caps subrequests; все чанки параллельно.
async function pf3FetchPrices(d,key){
  const syms=[...new Set(d.rows.map(r=>exSymbol(r[2],r[8])).filter(Boolean))];
  const chunks=[];
  // По 15: воркер на тикер делает ~3 подзапроса (chart 1y + chart 1d + weekly), лимит Cloudflare ~50.
  for(let i=0;i<syms.length;i+=15)chunks.push(syms.slice(i,i+15).join(','));
  const parts=await Promise.all(chunks.map(c=>fetch(PRICE_PROXY+'?symbols='+encodeURIComponent(c)).then(r=>r.json()).catch(()=>null)));
  const prices=Object.assign({},...parts.filter(Boolean));
  const {s50,s100,s200}=smaIdx(d);
  const supI=ensurePFCol(d,'Поддержка'),resI=ensurePFCol(d,'Сопротивление');
  let updated=0;
  d.rows.forEach((r,i)=>{
    const q=prices[exSymbol(r[2],r[8])];
    if(!(q&&typeof q.price==='number'))return;
    r[7]=q.price;
    if(typeof q.pct==='number')r[10]=Math.round(q.pct*100)/100;
    // Обе серии SMA (дневные и недельные) — в SMA_TF; в видимые колонки
    // идёт набор выбранного периода (1Г/3Г), а не всегда дневной. От этих
    // колонок считаются «Критерий» и «Сигнал» при перерисовке.
    const tk=String(r[2]||'');
    const mode=(SMA_TF[tk]&&SMA_TF[tk].mode)||'1Y';
    SMA_TF[tk]={mode,
      d:[q.sma50??null,q.sma100??null,q.sma200??null],
      w:[q.sma50w??null,q.sma100w??null,q.sma200w??null]};
    const set=mode==='3Y'?SMA_TF[tk].w:SMA_TF[tk].d;
    if(s50>=0&&set[0]!=null)r[s50]=set[0];
    if(s100>=0&&set[1]!=null)r[s100]=set[1];
    if(s200>=0&&set[2]!=null)r[s200]=set[2];
    if(q.support!=null)r[supI]=q.support;
    if(q.resistance!=null)r[resI]=q.resistance;
    recalcPF(i,key);updated++;
  });
  if(updated){
    pf3WriteReco(d);
    // База «Я vs AI» — стоимость МОЕГО портфеля по живым ценам. Ставится один
    // раз (myStartLive); базы, посчитанные по устаревшему сид-блобу до этого
    // флага, перефиксируются здесь же.
    if(key===PF3_KEY&&AI_PORT&&AI_PORT.myStartLive!=='1'){
      let eq=0;d.rows.forEach(r=>{eq+=parseFloat(r[13])||0});eq+=parseFloat(d.cashFree)||0;
      if(eq>0){AI_PORT.myStartEquity=Math.round(eq);AI_PORT.myStartLive='1';}
    }
    scheduleSave();
  }
  return updated;
}
async function pf3Refresh(silent){
  const d=pf3D();
  const btn=document.getElementById('pf3RefreshBtn');
  if(btn&&!silent){btn.disabled=true;btn.textContent='⏳ Обновляю…';}
  try{
    const updated=await pf3FetchPrices(d,v3Key);
    if(updated)pf3LastRefresh[v3Key]=Date.now();
    try{await pf3RefreshTargets(d)}catch(e){}   // аналит. таргеты — раз в сутки, тем же батч-паттерном
    try{planCheck()}catch(e){}                  // 🎯 сверить уровни плана и уведомить о достигнутых
    try{scnAlertCheck()}catch(e){}              // 📊 Блок D: сценарные алерты (триггеры/R/R/RSI)
    if(!silent)toast(`🔄 ${updated}/${d.rows.length} обновлено`,!updated);
  }catch(e){if(!silent)toast('Прокси цен недоступен',true);}
  // Don't redraw under the user's cursor while they edit qty / buy price.
  const ae=document.activeElement,area=document.getElementById('pf3Area');
  if(!(silent&&ae&&ae.tagName==='INPUT'&&area&&area.contains(ae)))renderPF3();
}

// Живая цена ОДНОЙ бумаги при открытии карточки — чтобы «потенциал роста»
// (таргет/цена) считался по актуальной цене, а не по последнему обновлению
// вкладки. Дёшево: один тикер; не чаще раза в 2 мин на символ.
let _cardPxAt={};
async function pf3RefreshCardPrice(d,r){
  const sym=exSymbol(r[2],r[8]);if(!sym)return;
  if(_cardPxAt[sym]&&Date.now()-_cardPxAt[sym]<45000)return;   // ~45с: «% за день» обновляется живо на открытой карточке
  _cardPxAt[sym]=Date.now();
  try{
    const j=await fetch(PRICE_PROXY+'?symbols='+encodeURIComponent(sym)).then(x=>x.json()).catch(()=>null);
    const q=j&&j[sym];
    if(!(q&&typeof q.price==='number')){_cardPxAt[sym]=0;return;}
    const i=d.rows.indexOf(r);if(i<0)return;
    const {s50,s100,s200}=smaIdx(d);
    const supI=ensurePFCol(d,'Поддержка'),resI=ensurePFCol(d,'Сопротивление');
    r[7]=q.price;
    if(typeof q.pct==='number')r[10]=Math.round(q.pct*100)/100;
    const tk=String(r[2]||''),mode=(SMA_TF[tk]&&SMA_TF[tk].mode)||'1Y';
    CARD_VOL[tk]={vol:typeof q.vol==='number'?q.vol:null,avgVol:typeof q.avgVol==='number'?q.avgVol:null,day:typeof q.pct==='number'?q.pct:null,at:Date.now()};   // объём торгов + дневное движение (лайв)
    SMA_TF[tk]={mode,d:[q.sma50??null,q.sma100??null,q.sma200??null],w:[q.sma50w??null,q.sma100w??null,q.sma200w??null]};
    const set=mode==='3Y'?SMA_TF[tk].w:SMA_TF[tk].d;
    if(s50>=0&&set[0]!=null)r[s50]=set[0];
    if(s100>=0&&set[1]!=null)r[s100]=set[1];
    if(s200>=0&&set[2]!=null)r[s200]=set[2];
    if(q.support!=null)r[supI]=q.support;
    if(q.resistance!=null)r[resI]=q.resistance;
    recalcPF(i,v3Key);scheduleSave();
    {const ve=document.getElementById('pf3Vol');if(ve&&isV3()&&pf3Sel===tk)ve.innerHTML=cardVolInner(tk);}   // объём — обновляем in-place (на случай, если перерисовку пропустим из-за фокуса в input)
    // Перерисовать только если карточка той же бумаги ещё открыта и пользователь не печатает.
    const ae=document.activeElement;
    if(isV3()&&pf3Sel===tk&&!(ae&&ae.tagName==='INPUT'))renderPF3();
  }catch(e){_cardPxAt[sym]=0;}
}

// ── 🌅/🌙 Pre/post-market в карточке акции (лайв) ──
// Опрос ?prepost= каждые 20с, пока карточка этой бумаги открыта; блок обновляется
// in-place. Сам останавливается, когда карточка закрыта/сменилась.
let CARD_VOL={};   // объём торгов по тикеру (лайв): {tk:{vol,avgVol,at}}
let CARD_PP={},_cardPPTimer=null,_cardPPTk=null,_cardPPSym=null,_cardPPLoading=false;
function cardPPStop(){if(_cardPPTimer){clearInterval(_cardPPTimer);_cardPPTimer=null;}_cardPPTk=null;_cardPPSym=null;}
function cardPPStart(tk,sym){
  if(!tk||!sym)return;
  if(_cardPPTk===tk&&_cardPPTimer)return;   // уже опрашиваем эту бумагу
  cardPPStop();_cardPPTk=tk;_cardPPSym=sym;
  cardPPLoad();
  _cardPPTimer=setInterval(cardPPLoad,20000);
}
async function cardPPLoad(){
  const tk=_cardPPTk,sym=_cardPPSym;
  if(!tk||!sym)return;
  if(!(isV3()&&pf3Sel===tk)){cardPPStop();return;}   // карточка закрыта/сменилась — стоп
  if(document.hidden||_cardPPLoading)return;
  _cardPPLoading=true;
  try{
    const j=await fetch(PRICE_PROXY+'?prepost='+encodeURIComponent(sym)).then(r=>r.json()).catch(()=>null);
    if(j&&typeof j==='object'){CARD_PP[sym]={...j,at:Date.now()};const el=document.getElementById('pf3PrePost');if(el&&pf3Sel===tk)el.innerHTML=cardPPInner(sym);}
    // Освежаем и обычную котировку (цена + «% за день») — иначе дневной % «замерзает».
    const d=pf3D(),r=d&&Array.isArray(d.rows)&&d.rows.find(x=>String(x[2]||'')===tk);
    if(r)pf3RefreshCardPrice(d,r);
  }catch(e){}
  _cardPPLoading=false;
}
function cardPPInner(sym){
  const d=CARD_PP[sym];if(!d)return'';
  const st=String(d.state||'').toUpperCase();
  const seg=(o,ru,en)=>{if(!o||!(o.price>0))return'';const c=o.pct==null?'':o.pct>=0?'pf3-up':'pf3-down';return`<span class="pf3-pp-l">${RT(ru,en)}</span> <span class="pf3-pp-v ${c}">${pf3Fmt(o.price,2)} <small>${d.ccy||''}</small>${o.pct!=null?` (${o.pct>=0?'+':''}${o.pct.toFixed(2)}%)`:''}</span>`};
  let body='';
  if(st.indexOf('PRE')>=0)body=seg(d.pre,'🌅 Пре-маркет','🌅 Pre-market');
  else if(st.indexOf('POST')>=0)body=seg(d.post,'🌙 Пост-маркет','🌙 After-hours');
  else if(st==='CLOSED')body=seg(d.post,'🌙 Пост-маркет','🌙 After-hours')||seg(d.pre,'🌅 Пре-маркет','🌅 Pre-market');
  return body?`<span class="pf3-pp-live">●</span> ${body}`:'';
}
// 📊 Объём торгов в карточке (лайв). Компактный формат (12.3M) + «×N к среднему»
// (avgVol = средний дневной за 3 мес): >1.5× — повышенная активность (акцент).
const fmtVol=n=>{n=+n;if(!isFinite(n)||n<=0)return'—';const a=Math.abs(n);return a>=1e9?(n/1e9).toFixed(2)+'B':a>=1e6?(n/1e6).toFixed(1)+'M':a>=1e3?Math.round(n/1e3)+'K':String(Math.round(n));};
function cardVolInner(tk){
  const v=CARD_VOL[tk];if(!v||!(v.vol>0))return'';
  let rel='',conv='';
  if(v.avgVol>0){
    const m=v.vol/v.avgVol;
    // Режим объёма vs средний дневной за 3 мес: ажиотаж / повышенный / норма / низкий.
    const reg=m>=2?['🔥',RT('ажиотаж','frenzy'),'xhi']:m>=1.5?['🔼',RT('повышенный','elevated'),'hi']:m>=0.7?['•',RT('норма','normal'),'mid']:['🔽',RT('низкий','low'),'lo'];
    rel=` · <span class="pf3-vol-rel ${reg[2]}" title="${RT('×N к среднему дневному объёму за 3 мес. Высокий объём подтверждает движение цены; низкий — движение слабое/ненадёжное.','×N of the 3-month average daily volume. High volume confirms the price move; low volume = weak/unreliable move.')}">×${m.toFixed(1)} ${reg[0]} ${reg[1]}</span>`;
    // Привязка к движению цены: есть заметное дневное движение → подтверждено объёмом или слабое.
    if(typeof v.day==='number'&&Math.abs(v.day)>=1.5){
      if(m>=1.5)conv=` <span class="pf3-vol-conv ok">${RT('движение на объёме','move on volume')} ✓</span>`;
      else if(m<0.7)conv=` <span class="pf3-vol-conv warn">${RT('слабый объём','thin volume')} ⚠</span>`;
    }
  }
  return `<span class="pf3-pp-l">📊 ${RT('Объём','Volume')}</span> <span class="pf3-vol-v">${fmtVol(v.vol)}</span>${rel}${conv}`;
}

// ── 🌅/🌙 Изменение баланса портфеля по пре/пост-рынку (лайв, в сводке) ──
// Батч ?prepost=sym1,sym2,... по позициям текущего портфеля раз в 30с; считает
// суммарную дельту стоимости акций во внебиржевую сессию. Сам останавливается,
// когда вкладка портфеля закрыта/сменилась.
let PF_PP={},_pfPPTimer=null,_pfPPKey=null,_pfPPLoading=false;
function pfSumPPStop(){if(_pfPPTimer){clearInterval(_pfPPTimer);_pfPPTimer=null;}_pfPPKey=null;}
function pfSumPPStart(key){
  if(!key)return;
  if(_pfPPKey===key&&_pfPPTimer)return;   // уже опрашиваем этот портфель
  pfSumPPStop();_pfPPKey=key;
  pfSumPPLoad();
  _pfPPTimer=setInterval(pfSumPPLoad,30000);
}
async function pfSumPPLoad(){
  const key=_pfPPKey;if(!key)return;
  if(!(isV3()&&curIdx===key&&pf3IsPort(key))){pfSumPPStop();return;}   // ушли с портфеля — стоп
  const d=DATA[key];if(!d||!Array.isArray(d.rows))return;
  if(document.hidden||_pfPPLoading)return;
  _pfPPLoading=true;
  try{
    const syms=[...new Set(d.rows.map(r=>(parseFloat(r[6])||0)>0?exSymbol(r[2],r[8]):null).filter(Boolean))];
    if(syms.length){
      const j=await fetch(PRICE_PROXY+'?prepost='+encodeURIComponent(syms.join(','))).then(r=>r.json()).catch(()=>null);
      if(j&&typeof j==='object'){
        if(syms.length===1)PF_PP[syms[0]]=j; else Object.assign(PF_PP,j);   // 1 символ → объект бумаги, не карта
        const el=document.getElementById('pfSumPP');
        if(el&&curIdx===key)el.innerHTML=pfSumPPInner(DATA[key]);
      }
    }
  }catch(e){}
  _pfPPLoading=false;
}
function pfSumPPInner(d){
  if(!d||!Array.isArray(d.rows))return'';
  let deltaSEK=0,totalSEK=0,pre=0,post=0;
  d.rows.forEach(r=>{
    const qty=parseFloat(r[6])||0;if(!(qty>0))return;
    totalSEK+=parseFloat(r[13])||0;
    const pp=PF_PP[exSymbol(r[2],r[8])];if(!pp)return;
    const reg=pp.regular;if(!(reg>0))return;
    const st=String(pp.state||'').toUpperCase();
    let o=null,usedPre=false;
    if(st.indexOf('PRE')>=0){o=pp.pre;usedPre=true;}
    else if(st.indexOf('POST')>=0){o=pp.post;}
    else if(st==='CLOSED'){o=pp.post||pp.pre;usedPre=!pp.post;}   // CLOSED мог взять пре-маркет
    if(!o||!(o.price>0))return;
    const fx=FX[r[8]||'USD']||1;
    deltaSEK+=qty*(o.price-reg)*fx;
    if(usedPre)pre++;else post++;   // метку считаем по реально использованной котировке
  });
  if(pre+post===0)return'';   // нет внебиржевых котировок — блок скрыт (:empty)
  const pct=totalSEK>0?deltaSEK/totalSEK*100:null;
  const cls=deltaSEK>=0?'pf3-up':'pf3-down';
  const lbl=pre>=post?RT('🌅 Пре-маркет','🌅 Pre-market'):RT('🌙 Пост-маркет','🌙 After-hours');
  return`<span class="pf3-pp-live">●</span> <span class="pf3-pp-l">${lbl} · ${RT('изм. баланса','balance Δ')}</span> <span class="pf3-pp-v ${cls}">${deltaSEK>=0?'+':''}${pf3Money(d,deltaSEK)}${pct!=null?` (${pct>=0?'+':''}${pct.toFixed(2)}%)`:''}</span>`;
}

// Аналит. таргеты (Yahoo/Refinitiv-консенсус) для текущей вкладки: worker-эндпоинт
// ?targets= батчем по 40, раз в сутки. Покрывает Nasdaq 100, где FMP-cron не
// работает (лимит подзапросов Cloudflare); портфель тоже освежается между cron-ами.
let _tgEndpointDown=false;   // worker без ?targets отвечает не-JSON — выключаемся до перезагрузки страницы
async function pf3RefreshTargets(d){
  if(_tgEndpointDown)return;
  if(d.targetsAt&&Date.now()-d.targetsAt<24*3600*1000)return;
  const tgC=ensurePFCol(d,'Аналит. таргет');
  const syms=[...new Set(d.rows.map(r=>exSymbol(r[2],r[8])).filter(Boolean))];
  const chunks=[];
  // По 20: воркер делает 2 подзапроса на тикер (Yahoo + FMP), лимит Cloudflare — 50/запрос.
  for(let i=0;i<syms.length;i+=20)chunks.push(syms.slice(i,i+20).join(','));
  const parts=await Promise.all(chunks.map(c=>fetch(PRICE_PROXY+'?targets='+encodeURIComponent(c)).then(r=>r.json()).catch(()=>null)));
  const good=parts.filter(p=>p&&typeof p==='object'&&!p.error);
  if(!good.length){_tgEndpointDown=true;return;}
  const tg=Object.assign({},...good);
  const tgrC=ensurePFCol(d,'Таргет 3м');
  const peC=ensurePFCol(d,'P/E'),psC=ensurePFCol(d,'P/S'),dyC=ensurePFCol(d,'Дивид. %');
  const beC=ensurePFCol(d,'Beta'),roC=ensurePFCol(d,'ROE'),deC=ensurePFCol(d,'D/E'),rgC=ensurePFCol(d,'Рост выручки'),poC=ensurePFCol(d,'Payout');
  const rvC=ensurePFCol(d,'Выручка TTM'),cpC=ensurePFCol(d,'Кап-я');
  let n=0;
  d.rows.forEach(r=>{
    const q=tg[exSymbol(r[2],r[8])];
    if(!q)return;
    if(typeof q.avg==='number'&&q.avg>0)r[tgC]=q.avg;
    if(typeof q.recent==='number'&&q.recent>0)r[tgrC]=q.recent;
    if(typeof q.avg==='number'&&q.avg>0)TG_META[String(r[2]||'').trim().toUpperCase()]={n:q.count||0,nr:q.recentCount||0,span:q.recentSpan||null,src:q.src||null,at:Date.now()};
    if(typeof q.pe==='number'&&q.pe>0)r[peC]=Math.round(q.pe*10)/10;
    if(typeof q.ps==='number'&&q.ps>0)r[psC]=Math.round(q.ps*10)/10;
    if(typeof q.divy==='number'&&q.divy>0)r[dyC]=Math.round(q.divy*1000)/10;   // доля → %
    if(typeof q.beta==='number')r[beC]=Math.round(q.beta*100)/100;
    if(typeof q.roe==='number')r[roC]=Math.round(q.roe*10)/10;
    if(typeof q.de==='number')r[deC]=Math.round(q.de*100)/100;
    if(typeof q.revg==='number')r[rgC]=Math.round(q.revg*10)/10;
    if(typeof q.payout==='number')r[poC]=Math.round(q.payout*10)/10;
    if(typeof q.rev==='number')r[rvC]=q.rev;
    if(typeof q.cap==='number')r[cpC]=q.cap;
    n++;
  });
  if(n){
    // Свежие метрики → пересчитать типы по скорингу (методологии MSCI/S&P).
    d.rows.forEach(r=>{const t=pf3DeriveType(String(r[2]||'').trim().toUpperCase(),r[4],r[5],d,r);if(t&&r[5]!==t)r[5]=t});
    pf3WriteReco(d);
    d.targetsAt=Date.now();scheduleSave();
  }
}

// Auto-refresh while the Портфель 3.0 tab is open: immediately when stale, then every 5 min.
let pf3Timer=null,pf3LastRefresh={};   // время последнего обновления ПО ВКЛАДКАМ (раньше было общим → индексные вкладки показывали устаревшие seed-цены)
const PF3_REFRESH_MS=5*60*1000;
function pf3EnsureAutoRefresh(){
  if(!pf3Timer)pf3Timer=setInterval(()=>{if(isV3())pf3Refresh(true)},PF3_REFRESH_MS);
  const last=pf3LastRefresh[v3Key]||0;
  if(Date.now()-last>PF3_REFRESH_MS)pf3Refresh(true);   // открыли вкладку, чьи цены устарели → обновить сразу
}
function pf3StopAutoRefresh(){if(pf3Timer){clearInterval(pf3Timer);pf3Timer=null}}

async function refreshLivePrices(){
  if(!isAnalysis()){ toast('Обновление цен доступно на вкладках 💼 Портфель и Nasdaq 100'); return; }
  const d = DATA[curIdx];
  const priceC = d.headers.findIndex(x=>/^цена/i.test(x));   // price column (position varies by tab schema)
  const dayC = d.headers.findIndex(x=>/1д|день/i.test(x));   // 1-day % column
  const supIdx = ensurePFCol(d, 'Поддержка');        // Support level (rolling 3-month low)
  const resIdx = ensurePFCol(d, 'Сопротивление');    // Resistance level (rolling 3-month high)
  const tfExisted = d.headers.includes(SMA_TF_COL);
  ensurePFCol(d, SMA_TF_COL);                        // per-stock 1Г/3Г SMA timeframe toggle
  if(!tfExisted) positionAfter(d, d.headers.indexOf(SMA_TF_COL), /sma.?200/i);   // place right after SMA 200
  const btn = document.getElementById('refreshPricesBtn');
  if(btn){ btn.disabled = true; btn.textContent = '⏳ …'; }
  let updated = 0, manual = 0;
  manualPriceRows.clear();

  if(PRICE_PROXY){
    // One batched request → covers US + Nordic/EU via Yahoo.
    const symbols = [...new Set(d.rows.map(r => exSymbol(r[2], rowCcy(r))).filter(Boolean))];
    let prices = {};
    try{
      const r = await fetch(PRICE_PROXY + '?symbols=' + encodeURIComponent(symbols.join(',')));
      if(!r.ok) throw new Error('proxy ' + r.status);
      prices = await r.json();
    }catch(e){
      if(btn){ btn.disabled = false; btn.textContent = '🔄 Цены'; }
      toast('Прокси цен недоступен — проверьте PRICE_PROXY', true); return;
    }
    d.rows.forEach((row, i) => {
      const p = prices[exSymbol(row[2], rowCcy(row))];
      const price = (p && typeof p === 'object') ? p.price : p;   // worker now returns {price,pct}; tolerate legacy number
      if(price != null){
        if(priceC>=0) row[priceC] = price;
        if(p && typeof p === 'object'){
          if(dayC>=0 && typeof p.pct === 'number') row[dayC] = Math.round(p.pct * 100) / 100;   // 1д %
          if(typeof p.support === 'number') row[supIdx] = p.support;                    // Поддержка
          if(typeof p.resistance === 'number') row[resIdx] = p.resistance;              // Сопротивление
          // Store both daily (1Y) and weekly (3Y) SMA sets; show the one matching this stock's toggle.
          const tk = String(row[2] || ''), mode = (SMA_TF[tk] && SMA_TF[tk].mode) || '1Y';
          SMA_TF[tk] = { mode,
            d: [p.sma50 ?? null, p.sma100 ?? null, p.sma200 ?? null],
            w: [p.sma50w ?? null, p.sma100w ?? null, p.sma200w ?? null] };
          applySmaTF(d, i);
        }
        updated++;
      } else { manual++; manualPriceRows.add(i); }
    });
  } else {
    // Fallback: Finnhub free tier (US only).
    if(!finnhubKey){
      const k = prompt('Вставьте Finnhub API ключ (бесплатно), или задайте PRICE_PROXY для полного покрытия:');
      if(!k){ if(btn){ btn.disabled = false; btn.textContent = '🔄 Цены'; } return; }
      finnhubKey = k.trim(); scheduleSave();
    }
    for(let i = 0; i < d.rows.length; i++){
      const row = d.rows[i];
      let q = null;
      try{ q = await fetchFinnhub(exSymbol(row[2], rowCcy(row))); }catch(e){ q = null; }
      if(q != null){ if(priceC>=0) row[priceC] = q.price; if(dayC>=0 && typeof q.pct === 'number') row[dayC] = Math.round(q.pct * 100) / 100; updated++; } else { manual++; manualPriceRows.add(i); }
    }
  }

  renderTable(); scheduleSave();
  if(btn){ btn.disabled = false; btn.textContent = '🔄 Цены'; }
  toast(`🔄 ${updated} обновлено · ${manual} вручную` + (manual ? ' (выделены жёлтым)' : ''));
}

/* ===== Column visibility (per-tab, synced) ===== */
function toggleColsMenu(){
  const ex = document.getElementById('colsMenu');
  if(ex){ ex.remove(); document.removeEventListener('click', closeColsOnOutside); return; }
  const m = document.createElement('div'); m.id = 'colsMenu'; m.className = 'cols-menu';
  const hdrs = DATA[curIdx].headers, hid = hiddenCols[curIdx] || [];
  let html = '<div class="cols-menu-hd"><span>Колонки</span><button onclick="showAllCols()">Все</button></div>';
  hdrs.forEach((h, ci) => {
    html += `<label><input type="checkbox" ${hid.includes(ci) ? '' : 'checked'} onchange="toggleCol(${ci})"> ${h || '—'}</label>`;
  });
  m.innerHTML = html;
  document.body.appendChild(m);
  const btn = document.getElementById('colsBtn'), r = btn.getBoundingClientRect();
  m.style.top = (r.bottom + 6) + 'px';
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
  setTimeout(() => document.addEventListener('click', closeColsOnOutside), 0);
}
function closeColsOnOutside(e){
  const m = document.getElementById('colsMenu');
  if(m && !m.contains(e.target) && e.target.id !== 'colsBtn'){
    m.remove(); document.removeEventListener('click', closeColsOnOutside);
  }
}
function toggleCol(ci){
  if(!hiddenCols[curIdx]) hiddenCols[curIdx] = [];
  const arr = hiddenCols[curIdx], i = arr.indexOf(ci);
  if(i >= 0) arr.splice(i, 1); else arr.push(ci);
  scheduleSave(); renderTable();
}
function showAllCols(){
  hiddenCols[curIdx] = []; scheduleSave(); renderTable();
  const m = document.getElementById('colsMenu'); if(m) m.remove();
}

boot();
