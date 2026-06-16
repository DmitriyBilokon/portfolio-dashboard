-- 🛡 Серверная защита ledger_state от обнуления критичных данных.
--
-- Проблема: устаревшая вкладка/клиент со старым кешем при старте может записать
-- дефолтный снапшот ПОВЕРХ облака и стереть журнал сделок (pfTrades) и состояние
-- AI-портфеля. Клиентские защиты помогают только обновлённым клиентам — этот
-- триггер закрывает дыру на уровне БД для ЛЮБОГО клиента.
--
-- Логика BEFORE UPDATE: если входящий снапшот теряет данные, которые уже есть в
-- строке, — подставляем старые значения обратно в NEW. Легитимный рост/изменение
-- журнала проходит как обычно.
--
-- Выполнить ОДИН раз: Supabase → SQL Editor → New query → вставить → Run.

create or replace function public.ledger_state_guard()
returns trigger
language plpgsql
as $$
declare
  old_rev numeric := coalesce((OLD.data ->> 'rev')::numeric, 0);
  new_rev numeric := coalesce((NEW.data ->> 'rev')::numeric, 0);
  old_trades jsonb := OLD.data -> 'pfTrades';
  new_trades jsonb := NEW.data -> 'pfTrades';
  old_aiport jsonb := OLD.data -> 'aiPort';
  new_aiport jsonb := NEW.data -> 'aiPort';
begin
  -- 0) ГЛАВНОЕ: optimistic concurrency. Если входящая ревизия НЕ выросла —
  -- значит писатель опирался на устаревшее состояние (старая вкладка/гонка).
  -- Полностью отклоняем запись (оставляем строку как есть). Это защищает ВСЁ
  -- состояние (позиции, кэш, журнал), а не только отдельные ключи.
  if new_rev <= old_rev then
    return OLD;
  end if;

  -- 1) Журнал сделок: был непустым массивом, новый пуст/отсутствует → вернуть старый.
  if jsonb_typeof(old_trades) = 'array'
     and jsonb_array_length(old_trades) > 0
     and (new_trades is null
          or jsonb_typeof(new_trades) <> 'array'
          or jsonb_array_length(new_trades) = 0) then
    NEW.data := jsonb_set(coalesce(NEW.data, '{}'::jsonb), '{pfTrades}', old_trades, true);
  end if;

  -- 2) AI-портфель: был инициализирован (есть startedAt), новый его потерял → вернуть.
  if old_aiport ? 'startedAt'
     and (new_aiport is null or not (new_aiport ? 'startedAt')) then
    NEW.data := jsonb_set(coalesce(NEW.data, '{}'::jsonb), '{aiPort}', old_aiport, true);
  end if;

  return NEW;
end;
$$;

drop trigger if exists ledger_state_guard_trg on public.ledger_state;
create trigger ledger_state_guard_trg
  before update on public.ledger_state
  for each row
  execute function public.ledger_state_guard();

-- ── Примечания ───────────────────────────────────────────────────────────────
-- • ГЛАВНАЯ защита — проверка rev (шаг 0): устаревший/старый клиент с меньшим
--   или равным rev НЕ сможет перезаписать состояние (позиции/кэш/журнал).
--   Клиент с этой версией сайта шлёт растущий rev автоматически.
-- • Шаги 1–2 (pfTrades/aiPort) — подстраховка на переходный период.
-- • Срабатывает только на UPDATE (на первый INSERT-сид не влияет).
-- • Триггер сохраняет НЕПУСТОЙ журнал поверх пустого. Это значит, что
--   «удалить ВСЕ сделки разом» через обычную синхронизацию заблокировано —
--   так и задумано (защита от случайного обнуления). Если когда-нибудь
--   понадобится очистить журнал намеренно — сделать это вручную:
--     update public.ledger_state
--       set data = jsonb_set(data, '{pfTrades}', '[]'::jsonb)
--       where user_id = '<ваш user_id>';
--   (выполняется напрямую, минуя триггер логики «непусто→пусто», т.к. вы
--    сознательно подтверждаете очистку этим запросом — он тоже пройдёт через
--    триггер, поэтому при РЕАЛЬНОЙ необходимости временно отключите триггер:
--      alter table public.ledger_state disable trigger ledger_state_guard_trg;
--      -- ваш update --
--      alter table public.ledger_state enable trigger ledger_state_guard_trg; )
-- • Позиции/кэш семейных портфелей лежат в data->'data'->'<вкладка>' и защищены
--   на стороне клиента (локальный бэкап + авто-восстановление). При желании их
--   можно добавить и сюда — скажите, допишу.
