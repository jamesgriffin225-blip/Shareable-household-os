-- Household coordination — native data only.
--
-- Calendar events deliberately have no table here: they live in Google
-- Calendar and are read/written live. Anything we cached would be a second
-- source of truth for the one thing both of us already edit from our phones.

create table if not exists profiles (
  id          text primary key,
  name        text not null,
  color       text not null,
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);

-- One OAuth connection per person per provider. Google carries both Calendar
-- and Gmail scopes; Microsoft carries Outlook mail.
create table if not exists connections (
  id               bigserial primary key,
  profile_id       text not null references profiles(id) on delete cascade,
  provider         text not null check (provider in ('google', 'microsoft', 'spotify')),
  account_email    text,
  access_token     text,
  refresh_token    text,
  expires_at       timestamptz,
  scope            text,
  calendar_id      text not null default 'primary',
  last_scanned_at  timestamptz,
  scan_cursor      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (profile_id, provider)
);

create table if not exists recipes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  servings      text,
  instructions  text,
  source        text,
  added_by      text references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists recipe_ingredients (
  id         uuid primary key default gen_random_uuid(),
  recipe_id  uuid not null references recipes(id) on delete cascade,
  name       text not null,
  quantity   text,
  unit       text,
  category   text not null default 'Other',
  position   int  not null default 0
);
create index if not exists recipe_ingredients_recipe_idx on recipe_ingredients (recipe_id, position);

create table if not exists shopping_items (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  quantity     text,
  unit         text,
  category     text not null default 'Other',
  note         text,
  recipe_id    uuid references recipes(id) on delete set null,
  recipe_name  text,
  added_by     text references profiles(id),
  source       text not null default 'manual',
  checked_at   timestamptz,
  removed_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists shopping_items_live_idx on shopping_items (removed_at, category, created_at);

create table if not exists reminders (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  notes       text,
  due_at      timestamptz,
  done_at     timestamptz,
  removed_at  timestamptz,
  added_by    text references profiles(id),
  source      text not null default 'manual',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  body        text not null,
  added_by    text references profiles(id),
  source      text not null default 'manual',
  removed_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- Not a ledger. Pocketsmith owns the money; these are the "we spent $340 at
-- the tile place" notes you want next to the renovation figure.
create table if not exists expense_notes (
  id           uuid primary key default gen_random_uuid(),
  description  text not null,
  amount       numeric(12, 2),
  currency     text not null default 'AUD',
  category     text,
  occurred_on  date,
  added_by     text references profiles(id),
  source       text not null default 'manual',
  removed_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- "Needs your OK": anything the model was not confident enough to just do.
create table if not exists approvals (
  id           uuid primary key default gen_random_uuid(),
  action       text not null,
  payload      jsonb not null,
  summary      text not null,
  reason       text,
  confidence   text,
  source       text not null,
  source_ref   jsonb,
  profile_id   text references profiles(id),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'discarded')),
  resolved_at  timestamptz,
  resolved_by  text references profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists approvals_pending_idx on approvals (status, created_at desc);

create table if not exists activity (
  id           bigserial primary key,
  action       text not null,
  summary      text not null,
  detail       jsonb,
  profile_id   text references profiles(id),
  source       text not null,
  entity_type  text,
  entity_id    text,
  undo         jsonb,
  undone_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists activity_recent_idx on activity (created_at desc);

-- Dedupe for the mailbox scanner: one row per message we've already judged.
create table if not exists email_seen (
  connection_id  bigint not null references connections(id) on delete cascade,
  message_id     text not null,
  processed_at   timestamptz not null default now(),
  primary key (connection_id, message_id)
);

-- Small key/value scratch: Pocketsmith response cache, scan locks.
create table if not exists app_state (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Photos for the frame.
--
-- Bytes live in Postgres rather than object storage: it is one fewer service
-- to hold accounts for, and a family's worth of downscaled photos is tens of
-- megabytes, not gigabytes. The full image is capped at 1600px on its long
-- edge and a 320px thumbnail is stored alongside it so the picker grid never
-- pulls the originals. Never `select *` from this table.
create table if not exists photos (
  id           uuid primary key default gen_random_uuid(),
  caption      text,
  media_type   text not null,
  bytes        bytea not null,
  thumb_bytes  bytea,
  width        int,
  height       int,
  size_bytes   int not null,
  added_by     text references profiles(id),
  removed_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists photos_live_idx on photos (removed_at, created_at desc);

create table if not exists music_stations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- "playlist/37i9dQ..." — the kind and the id, ready for the embed.
  path        text not null unique,
  image_url   text,
  position    integer not null default 0,
  added_by    text references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists music_stations_position on music_stations (position, created_at);

-- Spotify joined the providers after this table existed on the wall, and a
-- `create table if not exists` will never widen a check constraint on a table
-- that is already there. Dropping first is what makes the pair idempotent.
alter table connections drop constraint if exists connections_provider_check;
alter table connections add constraint connections_provider_check
  check (provider in ('google', 'microsoft', 'spotify'));

-- A refresh token that Google or Microsoft has revoked never recovers, and the
-- wall re-reads the calendar every few seconds. Without somewhere to record
-- "this one is dead", every poll re-asks a token endpoint that will keep saying
-- no, and the panel shows a raw OAuth string instead of "reconnect it".
alter table connections add column if not exists needs_reauth boolean not null default false;
