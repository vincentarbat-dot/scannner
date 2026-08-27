-- ============================================================================
-- МИГРАЦИЯ 002 — Часть 4 (Архив, поиск, статусы, админка, аналитика, офлайн)
-- Выполнить в Supabase SQL Editor ПОСЛЕ основной schema.sql.
-- Безопасно перезапускать: IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- НАСТРОЙКИ СИСТЕМЫ (раздел 18: автоматическая смена статуса "в зависимости
-- от настроек системы"). Простой key/value справочник, редактируется в
-- админ-панели (раздел 25).
-- ----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value)
values (
  'auto_status',
  jsonb_build_object(
    'enabled', false,
    -- при загрузке: если итоговое качество документа >= порога — статус
    -- сразу "reviewed" ("Проверен"), иначе остаётся "new" ("Новый")
    'quality_threshold', 70
  )
)
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "settings_select_staff" on public.app_settings;
create policy "settings_select_staff" on public.app_settings
  for select using (public.current_role_name() in ('accountant', 'admin') or auth.uid() is not null);

drop policy if exists "settings_write_admin" on public.app_settings;
create policy "settings_write_admin" on public.app_settings
  for all using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

-- ----------------------------------------------------------------------------
-- ПРАВА АДМИНА НА ПРОФИЛИ (раздел 25: "управлять доступом" — назначение
-- ролей employee/accountant/admin другим пользователям).
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_update_by_admin" on public.profiles;
create policy "profiles_update_by_admin" on public.profiles
  for update using (public.current_role_name() = 'admin');

-- ----------------------------------------------------------------------------
-- document_events: сотрудник тоже должен видеть события СВОИХ документов
-- (нужно, чтобы после сохранения / статус-чейнджа UI мог показывать историю
-- и чтобы количество "пересъёмок" можно было логировать без доступа
-- бухгалтера/админа). Основная политика events_select (Часть 3) уже
-- разрешает accountant/admin видеть всё; добавляем select для владельца
-- документа, плюс отдельное разрешение читать СВОИ события с document_id = null
-- (лог пересъёмки до создания документа, раздел 26).
-- ----------------------------------------------------------------------------
drop policy if exists "events_select_own" on public.document_events;
create policy "events_select_own" on public.document_events
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.documents d where d.id = document_id and d.created_by = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- ИНДЕКСЫ ДЛЯ ПОИСКА (раздел 17: по поставщику/БИН/номеру/дате/сумме/статусу)
-- ----------------------------------------------------------------------------
create index if not exists documents_invoice_date_idx on public.documents(invoice_date);
create index if not exists documents_invoice_number_idx on public.documents(invoice_number);
create index if not exists documents_supplier_bin_idx on public.documents(supplier_bin);
create index if not exists documents_total_amount_idx on public.documents(total_amount);
create index if not exists documents_quality_score_idx on public.documents(quality_score);

-- ----------------------------------------------------------------------------
-- updated_at триггер для app_settings
-- ----------------------------------------------------------------------------
drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute procedure public.set_updated_at();
