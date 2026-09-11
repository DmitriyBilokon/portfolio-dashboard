# План: синк — «залипший» pushTimer и очередь push/realtime

Статус: **Implementation завершён** (2026-09-11, Fable · high): §3 реализован в `app.js` как в плане, §4 — группа `sync queue` в `tests/cases-app.js` (27 кейсов, 1313/1313 зелёных), §6 — CLAUDE.md, s7b-map §10, audit-followup E. Осталась ручная проверка §5 после деплоя сайта. Деплой воркера не нужен, SQL не меняется.

Источник: замечание ревьюера S7b-3 (`plans/s7b-map.md` §10, «вне диффа»), находки аудита `data-model-sync#2` (тихий rev-конфликт — уже закрыт `syncCommitted`) и `#3` (дедуп по часам, входящий снапшот отбрасывается). Слияние по полям (блок E `plans/audit-followup.md`) — **не входит**: политика остаётся «весь блоб, облако новее → перечитать, повторить правку».

## 1. Что сломано (проверено по `app.js` @ 36794ca)

1. **`pushTimer` не сбрасывается.** `schedulePush` пишет id таймера в `pushTimer` (app.js:33), а `pushState` его не обнуляет. В браузере id ≥ 1, поэтому после первого сохранения в сессии обработчик realtime (app.js:239) всегда выходит на `if(pushTimer) return`. Следствие: записи воркера (aiPort, таргеты, кулдауны) и другого устройства **не применяются** до перезагрузки; следующий push клиента идёт со старым `stateRev` → триггер отклоняет → тост «конфликт», `pullState`, последняя правка теряется. Так с коммита 1d68b2b (июнь 2026).
2. **Входящий снапшот при несохранённых правках отбрасывается, а не откладывается** (`#3`). Даже с починенным флагом: правка на этом устройстве (таймер 800 мс) + запись с другого → событие потеряно → гарантированный конфликт при следующем push.
3. **Дедуп по часам клиента** (`lastPushTs`, app.js:66/238): `updated_at` пишет клиент своими часами; устройство с отстающими часами игнорируется целиком. Нужный признак «новее ли» уже есть — `data.rev`.
4. **Параллельные push.** `pushState` — два круга сети (чтение aiPort/pfTrades + upsert многомегабайтного блоба). Правка во время отправки ставит новый таймер; если первый push ещё не вернулся через 800 мс (медленная сеть), второй уходит с тем же `stateRev` → отклонён → тост + `pullState` → правка теряется. Скорее всего именно это пользователь видит как «конфликт» на одном устройстве.
5. Побочное: `handleLogout` не гасит таймер и не чистит состояние синка (push после выхода отсекает `!currentUser`, но состояние «мусорит» следующий вход).

Механика триггера, которую нужно помнить (`supabase-ledger-guard.sql`): при `new_rev <= old_rev` он делает `return OLD` — UPDATE **проходит со старыми значениями** (в т.ч. старый `updated_at`), поэтому отклонённая запись **тоже порождает realtime-событие** с текущим (неизменившимся) `rev`. Дедуп по `rev` отсекает его сам; дедуп по времени — нет.

## 2. Решения

- **D1.** Единственный признак «облако новее» — `rev`: событие с `typeof rev==='number' && rev<=stateRev` пропускается. Событие без числового `rev` считается новым (совместимость; таких писателей нет). `lastPushTs` удаляется; `updated_at` клиент продолжает писать (его читают админ-экраны/воркер как метку времени).
- **D2.** Пока синк «занят» (`pushTimer` стоит или push в полёте), входящий снапшот **откладывается** в `remotePending` (хранится последний), а не отбрасывается. Применяется после завершения push, если по `rev` всё ещё новее облачного состояния клиента.
- **D3.** Push сериализуется: одновременно в полёте не больше одного. Правка во время отправки ставит флаг `pushAgain`; после завершения — `schedulePush()` (обычный дебаунс). Никаких повторов при сетевой ошибке upsert — как сейчас (следующая правка отправит).
- **D4.** Политика конфликта не меняется: облако побеждает, локальные несохранённые правки теряются с тем же тостом, что и сейчас. Тост при применении отложенного снапшота показывается только если несохранённые правки действительно были (push не закоммичен или стоял `pushAgain`); при обычном применении «чужой» записи тоста нет.
- **D5.** `applyRemoteState` сбрасывает `pushAgain` — состояние заменено целиком, правок «в полёте» больше нет (иначе после `pullState` ушёл бы пустой push rev+1 с тем же содержимым).
- **D6.** Обработчик realtime и «после push» выносятся в именованные синхронные функции — тесты JXA не умеют ждать промисы (в `tests/cases-app.js` нет ни одного `await`/`.then`), поэтому проверяемая логика должна быть наблюдаема синхронно.

## 3. Реализация (`app.js`, блок синка, строки 15–33, 35–84, 179–242, 286–292)

Состояние (замена app.js:15):
```js
let currentUser=null, realtimeChannel=null, applyingRemote=false;
let pushTimer=null;        // id дебаунса — null, когда таймер не стоит (сбрасывается в pushFire)
let pushBusy=false;        // push в полёте (между началом pushState и syncSettle)
let pushAgain=false;       // во время полёта были правки — после завершения schedulePush()
let remotePending=null;    // отложенный входящий снапшот (последний), пока синк занят
```
Функции:
```js
function schedulePush(){ clearTimeout(pushTimer); pushTimer=setTimeout(pushFire, 800); }
function pushFire(){ pushTimer=null; pushState(); }           // ← корень бага: таймер отработал — флага нет
function syncBusy(){ return pushTimer!=null || pushBusy; }
function pushState(){                                          // обёртка-очередь; тело — pushStateRun
  if(!currentUser) return Promise.resolve(false);
  if(pushBusy){ pushAgain=true; return Promise.resolve(false); }
  pushBusy=true;
  return pushStateRun().catch(e=>{ console.warn('Sync push failed', e); return false; })
    .then(ok=>{ pushBusy=false; syncSettle(ok); return ok; });
}
async function pushStateRun(){ /* нынешнее тело pushState; возвращает true ⇔ коммит (stateRev=snap.rev),
  false — отклонено/ошибка/отложено (ветка !aiPortReadOk по-прежнему зовёт schedulePush()) */ }
function syncRemoteDecision(rev, stateRev, busy){              // чистая
  if(typeof rev==='number' && rev<=stateRev) return 'skip';
  return busy ? 'defer' : 'apply';
}
function syncOnRemote(s){                                      // из обработчика realtime; возвращает решение
  const d=syncRemoteDecision(s&&s.rev, stateRev, syncBusy());
  if(d==='defer') remotePending=s;
  else if(d==='apply') applyRemoteState(s);
  return d;
}
function syncSettle(ok){                                       // после каждого push
  const dirty=!ok||pushAgain;                                  // были несохранённые правки
  if(syncFlushRemote(dirty)) return;                           // применили облако → правки «в полёте» уже потеряны (D5)
  if(pushAgain){ pushAgain=false; schedulePush(); }
}
function syncFlushRemote(dirty){                               // true ⇔ применили отложенный снапшот
  const s=remotePending; if(!s) return false;
  if(syncBusy()) return false;                                 // ветка повтора поставила таймер — ждём дальше
  remotePending=null;
  if(typeof s.rev==='number' && s.rev<=stateRev) return false; // устарел (pullState/коммит уже обогнали)
  if(dirty) syncConflictToast();
  applyRemoteState(s); return true;
}
function syncConflictToast(){ toast(RT('⚠ Конфликт синхронизации: …'), true); }   // текст — нынешний из pushState
function syncReset(){ clearTimeout(pushTimer); pushTimer=null; pushBusy=false; pushAgain=false; remotePending=null; }
```
Точки правок:
- `pushStateRun` (бывшее тело): ветка rev-конфликта зовёт `syncConflictToast()` и `await pullState()`, возвращает `false`; успех — `stateRev=snap.rev; pfBackupSave(); return true`; убрать `ts`/`lastPushTs` из upsert-части (сам `updated_at:new Date().toISOString()` остаётся).
- `applyRemoteState`: первой строкой `pushAgain=false` (D5). Остальное без изменений.
- `subscribeRealtime`: тело обработчика → `p=>{ if(p.new&&p.new.data) syncOnRemote(p.new.data); }`.
- `handleLogout`: `syncReset()` рядом с `syncReady=false`.
- `pullState` (первый вход, `else pushState()`) и `app-3.js:90/126` (`await pullState()`) — без изменений; `pullState` по-прежнему не трогает очередь.
- Комментарии у app.js:26–33 переписать под новую модель (таймер → очередь → отложенный снапшот).

Что **не** делать: не менять политику на «локальное побеждает» (D4), не добавлять повтор при сетевой ошибке upsert, не трогать SQL/воркер, не переносить `updated_at` на default БД.

## 4. Тесты (`tests/cases-app.js`, группа `sync queue`)

Раннер: `setTimeout` в заглушке возвращает `0` (→ `pushTimer` ложный), поэтому в кейсах «таймер стоит» на время теста подменять `globalThis.setTimeout=function(fn){ return 7; }` и возвращать обратно в `finally`; `pushTimer`/`pushBusy`/`pushAgain`/`remotePending`/`stateRev`/`currentUser` — `let` в общей области, кейсы выставляют их напрямую и восстанавливают. `applyRemoteState`/`toast` подменять как в существующих кейсах (`_init=init` в строке 283), `sb.from` — обёрткой со счётчиком (`sb` — тот же объект `sbStub`).

1. `syncRemoteDecision`: `(5,5,false)→skip`, `(4,5,false)→skip`, `(6,5,false)→apply`, `(6,5,true)→defer`, `(undefined,5,false)→apply` (без rev — новое), `(undefined,5,true)→defer`.
2. `pushFire` сбрасывает `pushTimer` в `null` до вызова `pushState` (регрессия корня бага): `pushTimer=7; currentUser=null; pushFire(); pushTimer===null`.
3. `syncOnRemote` при стоящем таймере: `applyRemoteState` не вызван, `remotePending===s`, результат `defer`; при свободном синке — вызван один раз, `apply`; при `rev<=stateRev` — `skip` и `remotePending` не тронут.
4. `pushState` при `pushBusy=true`: синхронно `pushAgain===true`, `sb.from` не вызывался, возвращает промис.
5. `syncSettle(true)` при `pushAgain`: ставит таймер (счётчик подменённого `setTimeout` = 1), `pushAgain===false`, `remotePending` пуст → тоста нет.
6. `syncFlushRemote`: (а) `remotePending.rev=7, stateRev=5, dirty=false` → `applyRemoteState` вызван, тоста нет, `remotePending===null`, вернул `true`; (б) то же с `dirty=true` → тост один раз; (в) `rev=5, stateRev=5` → не применён, `remotePending===null`, `false`; (г) `syncBusy()` (таймер стоит) → не применён, `remotePending` сохранён, `false`.
7. `syncSettle(false)` с отложенным снапшотом новее и `pushAgain=true`: применён с тостом, таймер **не** поставлен (D5: `applyRemoteState` сбросил `pushAgain`). Здесь `applyRemoteState` — настоящая (на снимке `snapshotState()` с `rev:7`), чтобы проверить сброс `pushAgain`; `init`/`migrateState` подменить как в строке 283.
8. `syncReset`: после вызова все четыре поля в исходном состоянии.
9. Существующие `snapshotState keys`/`sync round-trip`/`syncCommitted` — без изменений (новых ключей снапшота нет).

Порог `MIN_CASES_app` не трогать (кейсы только добавляются). Синтаксис — per-file JSC (`new Function`), как обычно.

## 5. Ручная проверка (после деплоя сайта)

1. Два окна (или два устройства) под одним аккаунтом. В A сделать правку (например, стоп в «Позиции») → дождаться сохранения → в B **без перезагрузки** правка видна. Затем правка в B → видна в A. Раньше второе не работало после первого сохранения в окне.
2. Воркер: в открытом клиенте после своей правки дождаться cron-записи (aiPort/таргеты, :00/:20/:40) — обновление видно без перезагрузки, в консоли нет `Sync push rejected`.
3. DevTools → Network → «Slow 3G»: быстро сделать 3–4 правки подряд → ни одного тоста «конфликт», в Network не больше одного `ledger_state` upsert в полёте одновременно, итоговый `stateRev` в облаке = число успешных push.
4. Конфликт по-настоящему: правка в A и в течение секунды правка в B → в одном окне тост «в облаке новее — повторите последнюю правку», состояние обоих окон одинаковое, журнал сделок/позиции не пусты.
5. Выход и повторный вход — синк работает, лишних push при входе нет.

## 6. Документация

- CLAUDE.md, «Архитектура → Supabase»: дополнить одной фразой — realtime дедуплицируется по `rev`, при занятом синке входящий снапшот откладывается (`remotePending`), push сериализован (`pushBusy`/`pushAgain`); слияние по полям — блок E.
- `plans/s7b-map.md` §10 — пометить «вне диффа» как закрытое ссылкой сюда; `plans/audit-followup.md` — `data-model-sync#3` закрыт в части дедупа по часам (клиентский `updated_at` остаётся).
- Память: указатель в заметке редизайна.
