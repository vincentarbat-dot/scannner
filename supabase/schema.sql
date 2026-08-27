-- ============================================================================
-- СХЕМА БД: Сканер накладных поставщиков
-- Выполнить целиком в Supabase SQL Editor (Project -> SQL Editor -> New query)
-- Безопасно перезапускать: используются IF NOT EXISTS / CREATE OR REPLACE
-- ============================================================================

-- расширения
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- ПРОФИЛИ ПОЛЬЗОВАТЕЛЕЙ (роль поверх auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'employee' check (role in ('employee', 'accountant', 'admin')),
  created_at timestamptz not null default now()
);

-- Автосоздание профиля при регистрации пользователя
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data ->> 'full_name', 'employee');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ----------------------------------------------------------------------------
-- ПОСТАВЩИКИ (справочник, заполняется по мере распознавания)
-- ----------------------------------------------------------------------------
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bin text,
  bank_details jsonb,
  created_at timestamptz not null default now(),
  unique (name, bin)
);

-- ----------------------------------------------------------------------------
-- НАКЛАДНЫЕ (основная сущность / "карточка документа", раздел 15 ТЗ)
-- ----------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,

  -- распознанные / введённые вручную поля (раздел 13)
  supplier_name text,
  supplier_bin text,
  invoice_number text,
  invoice_date date,
  total_amount numeric(14,2),
  vat_amount numeric(14,2),
  bank_details jsonb,
  recognized_items jsonb, -- список товаров: наименование, кол-во, ед.изм, цена, сумма

  -- статус и метаданные (раздел 18)
  status text not null default 'new'
    check (status in ('new', 'reviewed', 'sent_to_accounting', 'processed', 'archived')),
  page_count int not null default 0,
  quality_score int, -- 0-100, раздел 11
  has_qr boolean not null default false,
  has_barcode boolean not null default false,

  pdf_path text, -- путь в storage к итоговому PDF (раздел 19)

  upload_status text not null default 'uploaded'
    check (upload_status in ('pending_upload', 'uploading', 'uploaded', 'upload_error')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_created_by_idx on public.documents(created_by);
create index if not exists documents_status_idx on public.documents(status);
create index if not exists documents_supplier_idx on public.documents(supplier_id);
create index if not exists documents_created_at_idx on public.documents(created_at desc);

-- ----------------------------------------------------------------------------
-- СТРАНИЦЫ ДОКУМЕНТА (раздел 12: несколько страниц, раздел 6: оригинал+обработка)
-- ----------------------------------------------------------------------------
create table if not exists public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  page_number int not null,

  original_path text not null,   -- storage: originals/{document_id}/{page}.jpg
  processed_path text,           -- storage: processed/{document_id}/{page}.jpg

  quality_score int,
  is_blurry boolean default false,
  has_glare boolean default false,
  qr_readable boolean,
  barcode_readable boolean,

  created_at timestamptz not null default now(),
  unique (document_id, page_number)
);

create index if not exists document_pages_doc_idx on public.document_pages(document_id);

-- ----------------------------------------------------------------------------
-- РАСПОЗНАННЫЕ КОДЫ (QR / штрихкод / Data Matrix, разделы 8-9-14)
-- ----------------------------------------------------------------------------
create table if not exists public.document_codes (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  page_id uuid references public.document_pages(id) on delete cascade,
  code_type text not null check (code_type in ('qr', 'barcode', 'datamatrix')),
  raw_value text,
  is_readable boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists document_codes_doc_idx on public.document_codes(document_id);

-- ----------------------------------------------------------------------------
-- ЖУРНАЛ СОБЫТИЙ (для аналитики, раздел 26: пересъёмки, ошибки и т.д.)
-- ----------------------------------------------------------------------------
create table if not exists public.document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null, -- 'retake', 'processing_error', 'status_change', 'reprocessed', ...
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists document_events_type_idx on public.document_events(event_type);
create index if not exists document_events_created_idx on public.document_events(created_at desc);

-- ----------------------------------------------------------------------------
-- updated_at триггер
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY (раздел 24: разграничение доступа)
-- ----------------------------------------------------------------------------
-- Правила на MVP: employee видит и создаёт свои документы; accountant/admin
-- видят всё. Можно ужесточить позже (например, по отделам/командам).
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.suppliers enable row level security;
alter table public.documents enable row level security;
alter table public.document_pages enable row level security;
alter table public.document_codes enable row level security;
alter table public.document_events enable row level security;

-- helper: текущая роль пользователя
create or replace function public.current_role_name()
returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql stable security definer;

-- profiles
drop policy if exists "profiles_select_own_or_staff" on public.profiles;
create policy "profiles_select_own_or_staff" on public.profiles
  for select using (
    id = auth.uid() or public.current_role_name() in ('accountant', 'admin')
  );

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- suppliers: читают все авторизованные, пишут все авторизованные (справочник)
drop policy if exists "suppliers_select_all" on public.suppliers;
create policy "suppliers_select_all" on public.suppliers
  for select using (auth.uid() is not null);

drop policy if exists "suppliers_write_all" on public.suppliers;
create policy "suppliers_write_all" on public.suppliers
  for insert with check (auth.uid() is not null);

drop policy if exists "suppliers_update_all" on public.suppliers;
create policy "suppliers_update_all" on public.suppliers
  for update using (auth.uid() is not null);

-- documents
drop policy if exists "documents_select" on public.documents;
create policy "documents_select" on public.documents
  for select using (
    created_by = auth.uid() or public.current_role_name() in ('accountant', 'admin')
  );

drop policy if exists "documents_insert" on public.documents;
create policy "documents_insert" on public.documents
  for insert with check (created_by = auth.uid());

drop policy if exists "documents_update" on public.documents;
create policy "documents_update" on public.documents
  for update using (
    created_by = auth.uid() or public.current_role_name() in ('accountant', 'admin')
  );

drop policy if exists "documents_delete" on public.documents;
create policy "documents_delete" on public.documents
  for delete using (public.current_role_name() = 'admin');

-- document_pages / document_codes / document_events: доступ через родительский документ
drop policy if exists "pages_select" on public.document_pages;
create policy "pages_select" on public.document_pages
  for select using (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and (d.created_by = auth.uid() or public.current_role_name() in ('accountant','admin'))
    )
  );

drop policy if exists "pages_write" on public.document_pages;
create policy "pages_write" on public.document_pages
  for insert with check (
    exists (select 1 from public.documents d where d.id = document_id and d.created_by = auth.uid())
  );

drop policy if exists "pages_update" on public.document_pages;
create policy "pages_update" on public.document_pages
  for update using (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and (d.created_by = auth.uid() or public.current_role_name() in ('accountant','admin'))
    )
  );

drop policy if exists "codes_select" on public.document_codes;
create policy "codes_select" on public.document_codes
  for select using (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and (d.created_by = auth.uid() or public.current_role_name() in ('accountant','admin'))
    )
  );

drop policy if exists "codes_write" on public.document_codes;
create policy "codes_write" on public.document_codes
  for insert with check (
    exists (select 1 from public.documents d where d.id = document_id and d.created_by = auth.uid())
  );

drop policy if exists "events_select" on public.document_events;
create policy "events_select" on public.document_events
  for select using (public.current_role_name() in ('accountant', 'admin'));

drop policy if exists "events_insert" on public.document_events;
create policy "events_insert" on public.document_events
  for insert with check (auth.uid() is not null);

-- ============================================================================
-- STORAGE BUCKETS (создать также вручную в Dashboard -> Storage, если SQL
-- не создаст их из-за прав; названия должны совпадать с кодом lib/supabase.ts)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('originals', 'originals', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('processed', 'processed', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('pdfs', 'pdfs', false)
on conflict (id) do nothing;

-- Политики storage: пользователь может писать/читать только в папку {user_id}/...
drop policy if exists "originals_rw_own_folder" on storage.objects;
create policy "originals_rw_own_folder" on storage.objects
  for all using (
    bucket_id in ('originals', 'processed', 'pdfs')
    and (auth.uid())::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id in ('originals', 'processed', 'pdfs')
    and (auth.uid())::text = (storage.foldername(name))[1]
  );

-- бухгалтер/админ читают всё
drop policy if exists "staff_read_all_files" on storage.objects;
create policy "staff_read_all_files" on storage.objects
  for select using (
    bucket_id in ('originals', 'processed', 'pdfs')
    and public.current_role_name() in ('accountant', 'admin')
  );
