-- CEO — schema for Supabase (Postgres).
--
-- Run this once in the Supabase SQL editor. It is idempotent: re-running it is
-- safe and will not drop anything.
--
-- The reason this exists rather than staying on Netlify Blobs is one line:
--
--     name citext not null unique
--
-- Buying a company name is a transaction. Two people paying for "Ravensworth &
-- Co" in the same second must not both succeed, and object storage with
-- last-write-wins cannot express that. Everything else here — accounts,
-- entitlements, the leaderboard — wants the same guarantees.

create extension if not exists citext;      -- case-insensitive names
create extension if not exists pgcrypto;    -- gen_random_uuid()

-- ---------------------------------------------------------------- profiles
-- Supabase Auth owns the credentials; this is the row we hang everything off.
create table if not exists profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       citext,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- companies
-- A purchased, permanent company name. Reserved the moment checkout starts, so
-- two people cannot pay for the same name and have one of them lose afterwards:
-- the loser is stopped before any money moves.
--
--   pending  — held while the buyer is in Stripe. Expires if they abandon.
--   active   — paid for, theirs.
create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references profiles on delete cascade,
  name        citext not null unique,          -- the whole reason for Postgres
  status      text not null default 'pending'
              check (status in ('pending', 'active')),
  expires_at  timestamptz,                     -- only meaningful while pending
  created_at  timestamptz not null default now()
);

create index if not exists companies_owner_idx on companies (owner);
-- lets the sweeper find abandoned holds cheaply
create index if not exists companies_pending_idx on companies (expires_at)
  where status = 'pending';

-- ---------------------------------------------------------------- entitlements
-- What an account has bought. `kind` is 'host' today; 'facilitator' later.
-- stripe_event is unique so a webhook delivered twice grants once.
create table if not exists entitlements (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null references profiles on delete cascade,
  kind          text not null check (kind in ('host', 'facilitator')),
  stripe_event  text unique,                  -- idempotency for redelivery
  stripe_ref    text,
  created_at    timestamptz not null default now()
);

create unique index if not exists entitlements_owner_kind_idx
  on entitlements (owner, kind);

-- ---------------------------------------------------------------- games
-- The game itself stays exactly as it is: one JSON document, produced by the
-- same lib/game.mjs that has always produced it. Only where it lives changes.
--
-- `deadline` and `status` are pulled out as real columns purely so the sweeper
-- can ask one indexed question instead of listing every game. This replaces the
-- due-marker scheme entirely — see lib/schedule.mjs, now only needed for the
-- blob backend.
create table if not exists games (
  code        text primary key,
  status      text not null,
  deadline    timestamptz,
  host        uuid references profiles on delete set null,
  state       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists games_due_idx on games (deadline)
  where status = 'playing';
create index if not exists games_host_idx on games (host);

-- ---------------------------------------------------------------- security
-- Everything is written by the service role from the functions, never by the
-- browser. These policies exist so that if an anon key ever does reach the
-- client, it cannot read other people's accounts or rewrite a game.
alter table profiles     enable row level security;
alter table companies    enable row level security;
alter table entitlements enable row level security;
alter table games        enable row level security;

drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles
  for select using (auth.uid() = id);

drop policy if exists "own companies" on companies;
create policy "own companies" on companies
  for select using (auth.uid() = owner);

drop policy if exists "own entitlements" on entitlements;
create policy "own entitlements" on entitlements
  for select using (auth.uid() = owner);

-- A game is readable by anyone holding its code; the API decides what of it to
-- show. Nothing in the browser may write one.
drop policy if exists "games are read-only to clients" on games;
create policy "games are read-only to clients" on games
  for select using (true);

-- ---------------------------------------------------------------- housekeeping
-- Abandoned checkouts release their name. Called by the scheduled function.
create or replace function release_expired_holds() returns integer as $$
declare
  freed integer;
begin
  delete from companies
   where status = 'pending' and expires_at is not null and expires_at < now();
  get diagnostics freed = row_count;
  return freed;
end;
$$ language plpgsql;

-- A new sign-up gets a profile row automatically.
create or replace function handle_new_user() returns trigger as $$
begin
  insert into profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
