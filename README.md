# Сканер накладных поставщиков

Mobile-first веб-приложение для фотографирования, обработки, распознавания
и хранения накладных от поставщиков. Стек: **React + Vite + TypeScript +
Tailwind v4**, БД/Auth/Storage — **Supabase**, деплой — **Netlify**.

➡️ **Если продолжаете проект (новый чат / другой аккаунт Claude) — сначала
прочитайте [`PROGRESS.md`](./PROGRESS.md).** Там написано, что уже готово
и что делать дальше, по частям.

## Быстрый старт (локально)

```bash
npm install
cp .env.example .env   # вписать свои VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

## Настройка Supabase (один раз)

1. Создать проект на [supabase.com](https://supabase.com).
2. **SQL Editor → New query** → вставить содержимое [`supabase/schema.sql`](./supabase/schema.sql)
   → Run. Это создаст все таблицы, RLS-политики и storage buckets
   (`originals`, `processed`, `pdfs`) для **всех** частей проекта разом —
   повторно этот шаг делать не нужно при переходе к следующей части.
3. **SQL Editor → New query** → вставить содержимое
   [`supabase/migrations/002_part4.sql`](./supabase/migrations/002_part4.sql)
   → Run. Добавляет то, что понадобилось в Части 4: таблицу настроек
   (`app_settings`, автостатус — раздел 18 ТЗ), право `admin` менять роли
   других пользователей, индексы под поиск. Без этого шага работает всё,
   кроме: настройки автостатуса в `/admin` и смены роли других пользователей
   там же (остальной функционал Части 4 — архив/поиск/офлайн-очередь/
   «Улучшить документ» — не зависит от этой миграции).
4. **Project Settings → API** → скопировать `Project URL` и `anon public key`
   в `.env` (см. `.env.example`).
5. **Authentication → Providers** → Email включён по умолчанию, этого
   достаточно для MVP.
6. Назначить себе роль `admin`, чтобы попасть в `/admin`: **Table Editor →
   profiles** → найти свою строку по email/`id` → изменить `role` на
   `admin` вручную (первого администратора иначе назначить неоткуда —
   дальше можно управлять ролями других пользователей уже из `/admin`).

## Деплой на Netlify

Через веб-интерфейс (проще всего):

1. Запушить этот проект в GitHub-репозиторий.
2. На [app.netlify.com](https://app.netlify.com) → **Add new site → Import
   an existing project** → выбрать репозиторий.
3. Netlify сам подхватит настройки из `netlify.toml` (`npm run build`,
   папка `dist`).
4. **Site configuration → Environment variables** → добавить
   `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` (те же значения, что
   в `.env`).
5. Deploy.

Через Netlify CLI (альтернатива):

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify env:set VITE_SUPABASE_URL "https://xxxx.supabase.co"
netlify env:set VITE_SUPABASE_ANON_KEY "xxxx"
netlify deploy --build --prod
```

> Примечание: у меня (Claude) в этой песочнице нет доступа к netlify.com
> и supabase.com, поэтому сам деплой и создание проекта Supabase нужно
> выполнить вам — все конфиги под это уже готовы.

## Структура проекта

```
src/
  routes/         # экраны: Home, Login, Scan, Archive, Search, Settings, Admin
  components/     # переиспользуемые UI-компоненты
  context/        # AuthContext (сессия + профиль)
  lib/supabase.ts # клиент Supabase
  types/          # TS-типы, соответствуют таблицам БД
supabase/
  schema.sql              # полная схема БД на весь проект (все части)
  migrations/002_part4.sql # доп. таблицы/политики Части 4 (см. п.3 выше)
PROGRESS.md        # статус разработки по частям — читать при продолжении
netlify.toml        # конфиг деплоя
```

## Роли пользователей

- `employee` — сканирует и видит свои документы;
- `accountant` — видит все документы, работает с архивом;
- `admin` — доступ к панели администратора.

Роль хранится в `profiles.role` (по умолчанию `employee` при регистрации).
Поменять роль вручную можно в Supabase Table Editor, пока нет UI для этого
(появится в Части 4).
