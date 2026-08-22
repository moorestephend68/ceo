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
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- `set search_path` and the explicit `public.` are not decoration.
--
-- This function runs inside Supabase's auth schema when a user is created, and a
-- security-definer function with no fixed search path resolves `profiles`
-- against whatever path the caller happens to have. When that path does not
-- include `public`, the insert fails with "relation profiles does not exist",
-- the trigger aborts the user creation, and the only thing the person signing in
-- ever sees is **"Database error saving new user"** — a message that names
-- neither the table nor the trigger. Pinning both removes the class of failure
-- rather than the instance.

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================ stage 2
-- Public ranked games, and what they produce.

-- Public games are the only rated ones, because they are the only ones with a
-- format nobody can tune. A private game's host picks the seats, the length and
-- the difficulty, so ranking those would rank whoever configured the softest
-- table rather than whoever played best.
alter table games add column if not exists is_public boolean not null default false;

create index if not exists games_open_public_idx on games (created_at)
  where is_public and status = 'lobby';

-- One row per company, carrying its standing.
create table if not exists ratings (
  company_id  uuid primary key references companies on delete cascade,
  rating      integer not null default 1500,
  games       integer not null default 0,
  wins        integer not null default 0,
  best_value  numeric,
  updated_at  timestamptz not null default now()
);

create index if not exists ratings_board_idx on ratings (rating desc, games desc);

-- One row per company per finished public game. Kept so a rating can be
-- explained rather than merely asserted, and so a game can never be scored
-- twice — that is what the unique constraint is for.
create table if not exists results (
  id           uuid primary key default gen_random_uuid(),
  game_code    text not null,
  company_id   uuid references companies on delete set null,
  name         text not null,
  place        integer not null,
  seats        integer not null,
  value        numeric not null,
  rating_delta integer not null default 0,
  was_bot      boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (game_code, name)
);

create index if not exists results_company_idx on results (company_id, created_at desc);

alter table ratings enable row level security;
alter table results enable row level security;

-- The leaderboard is public by design; it is the point of it.
drop policy if exists "ratings are public" on ratings;
create policy "ratings are public" on ratings for select using (true);
drop policy if exists "results are public" on results;
create policy "results are public" on results for select using (true);

-- ============================================================ stage 3
-- Cohorts: one facilitator running many groups at once.

-- Every group in a cohort shares the cohort's seed, so all of them face an
-- identical market. That is what makes grading defensible — nobody can claim
-- they drew a harder economy — and it is the thing an instructor asks about
-- first.
create table if not exists cohorts (
  id           uuid primary key default gen_random_uuid(),
  facilitator  uuid not null references profiles on delete cascade,
  name         text not null,
  join_code    text not null unique,
  seed         bigint not null,
  group_size   integer not null default 5,
  config       jsonb not null default '{}'::jsonb,
  status       text not null default 'open'
               check (status in ('open', 'running', 'paused', 'closed')),
  created_at   timestamptz not null default now()
);

create index if not exists cohorts_owner_idx on cohorts (facilitator, created_at desc);

alter table games add column if not exists cohort_id uuid references cohorts on delete cascade;
create index if not exists games_cohort_idx on games (cohort_id);

alter table cohorts enable row level security;
drop policy if exists "own cohorts" on cohorts;
create policy "own cohorts" on cohorts
  for select using (auth.uid() = facilitator);

-- ============================================================ stage 4
-- The demo class: a real cohort that belongs to nobody.
--
-- An instructor evaluating this should not have to create an account first —
-- that is the single biggest reason an evaluation never happens. So a demo
-- cohort has no facilitator at all, and is controlled instead by a random token
-- handed to whoever opened it. The token grants control of that one throwaway
-- class and nothing else: no account, no entitlement, no other data.
alter table cohorts alter column facilitator drop not null;
alter table cohorts add column if not exists is_demo boolean not null default false;
alter table cohorts add column if not exists demo_token text;
alter table cohorts add column if not exists expires_at timestamptz;

-- Demos are disposable; the scheduled sweep deletes them, and games.cohort_id
-- cascades so nothing is orphaned.
create index if not exists cohorts_demo_idx on cohorts (expires_at) where is_demo;

-- The "own cohorts" policy above compares auth.uid() to facilitator, and a null
-- facilitator matches nobody — so a demo cohort is invisible to the anon key.
-- Only the service role inside the functions can see it, which is what the demo
-- token is checked against.

-- ============================================================ stage 5
-- The decaying leaderboard.
--
-- The public board is no longer the rating. It is the best company anybody has
-- built lately — money made over the starting cash, worth 10% less every hour,
-- so half a result is gone in under seven hours and the top of the board is
-- winnable this afternoon rather than owned by whoever got there first.
--
-- Nothing new is stored for it: a result already records what the company was
-- worth and when. All it needs is to be able to ask for the last two days
-- cheaply, which is this index. Anything older has decayed to under a
-- hundredth of itself and cannot reach a board of twenty-five.
create index if not exists results_recent_idx on results (created_at desc)
  where company_id is not null;

-- ============================================================ stage 6
-- Concurrency. This is a correctness fix, not a feature.
--
-- A game is one JSON document, so every change is read-modify-write. Two of
-- those overlapping meant one of them vanished: five players filing in the same
-- second produced five reads of the same state and five writes, of which four
-- were lost — and all five were answered 200 OK. Near a deadline, which is when
-- everyone files, that was the normal case rather than an edge case.
--
-- `version` makes the write conditional. The application updates
--   ... where code = $1 and version = $2
-- so a write built on stale state matches no row, changes nothing, and is
-- reported instead of silently applied. lib/mutate.mjs then re-reads and
-- re-applies against whatever the other writer left behind.
alter table games add column if not exists version integer not null default 1;

-- Seating a class, without forty students racing each other.
--
-- Joining used to read the list of groups, look for one with room, and open a
-- new group if there was none. Correct when students arrive one at a time;
-- catastrophic when they arrive together, because they all read the list before
-- any of them had written to it. Forty students pressing Join in the same ten
-- seconds produced forty groups of one.
--
-- Now each student takes a number in a single atomic statement and their group
-- is arithmetic.
alter table cohorts add column if not exists seats_taken integer not null default 0;

create or replace function take_cohort_seat(c_id uuid) returns integer as $$
declare
  n integer;
begin
  update cohorts set seats_taken = seats_taken + 1
   where id = c_id
  returning seats_taken into n;
  return n;
end;
$$ language plpgsql;

-- And the game for a group is created exactly once, however many of its five
-- students arrive at the same instant: the unique index decides, and the losers
-- read the winner's row.
alter table games add column if not exists group_no integer;
create unique index if not exists games_cohort_group_idx
  on games (cohort_id, group_no) where cohort_id is not null;

-- ============================================================ stage 7
-- The bot league.
--
-- Somebody was always going to automate this. The client is HTTP, the state is
-- JSON, and an evening's work turns a browser tab into a program. Measured, a
-- straightforward optimiser wins 35% of ranked tables against a thoughtful
-- human's 30% — enough of an edge to quietly sour the human board, not enough
-- to be worth an arms race over.
--
-- So it gets somewhere to go instead. Bots play bots, on their own board, with
-- their own key. Nothing here runs anybody's code: a bot lives on its author's
-- machine and talks to the ordinary API.

-- One key per account, stored hashed. A key can act on its owner's behalf, so
-- it is treated the way such a thing should be: shown once at creation, never
-- readable back, and replaced rather than recovered. Asking for a new key
-- revokes the old one, which is the only revocation anybody actually needs.
create table if not exists bot_keys (
  owner      uuid primary key references profiles on delete cascade,
  key_hash   text not null unique,
  created_at timestamptz not null default now()
);

alter table bot_keys enable row level security;
-- No policy at all: this table is reachable only by the service role, from the
-- server. A hashed key is not a secret worth publishing even so.

-- Which pool a game belongs to. Null is the ordinary world — private games,
-- classes, ranked public tables. 'bot' is the league, and it is the flag that
-- keeps league results off the human board and out of the human rating.
alter table games   add column if not exists league text;
alter table results add column if not exists league text;

-- Finding the open league table, and counting what one key has started lately.
-- Both are asked on every join, so both are indexed.
create index if not exists games_league_lobby_idx on games (league, created_at)
  where league is not null and status = 'lobby';
create index if not exists games_league_owner_idx on games (league, host, created_at desc)
  where league is not null;

-- The league board reads its own results and nothing else. The partial index
-- means the human board's rows are not even walked.
create index if not exists results_league_idx on results (league, created_at desc)
  where league is not null;

-- ============================================================ stage 8
-- Being findable by somebody who is hiring.
--
-- A company pays to browse a pool of players, sees a company name and a record,
-- and can send one thing: an invitation to apply. It never learns who the person
-- is. The player decides whether to answer, and answering is what reveals them.
--
-- The schema is small because most of the product is refusals, and the refusals
-- live in lib/talent.mjs. What has to be stored is: who asked to be listed, that
-- they said they are an adult, when they said it, and — separately — enough of
-- how each game was played that a profile can describe more than a number.

-- Explicitly opted in. Not a column on profiles with a default, because a
-- default is a decision nobody made: a row here exists only because somebody
-- pressed a button, and `revoked_at` is set rather than the row deleted so that
-- "did they ever consent, and when" stays answerable.
create table if not exists talent_optin (
  owner      uuid primary key references profiles on delete cascade,
  adult      boolean not null default false,
  open_to    text,
  region     text,
  opted_at   timestamptz not null default now(),
  revoked_at timestamptz
);

alter table talent_optin enable row level security;
-- No policy: reachable only by the service role. A list of people open to being
-- approached is exactly the kind of table that should not be publicly readable,
-- and the anon key is public by design.

-- One index, for the only question the pool ever asks.
create index if not exists talent_live_idx on talent_optin (opted_at desc)
  where revoked_at is null and adult;

-- How a game was played, not merely what it made.
--
-- A finished game is a large document and it is thrown away; a result row is
-- kept. So the description has to be computed while the game still exists. Each
-- figure is measured against the rest of that particular table — "4% under the
-- room" means the same thing across markets and shocks, where "charged $1,240"
-- does not.
--
-- Stored for every rated seat. Only two of the figures are ever shown to
-- anybody: price and quality settle within 10% of their long-run value after a
-- single game, while advertising, borrowing and margin are still wrong more
-- often than not after twenty. The rest are kept because they cost nothing to
-- keep and are worth having in aggregate.
alter table results add column if not exists traits jsonb;

-- ============================================================ stage 9
-- Two changes: what is for sale, and who may approach a player.

-- ---------------------------------------------------------------- unbundling
-- The charter used to be one purchase covering two quite different things: a
-- company name kept for good, and the ability to host private games. They are
-- now sold separately, so `kind` needs a third value.
--
-- Dropping and re-adding the constraint is the only way to widen a check. It is
-- safe: every existing row holds 'host' or 'facilitator', both of which the new
-- constraint still allows.
alter table entitlements drop constraint if exists entitlements_kind_check;
alter table entitlements add constraint entitlements_kind_check
  check (kind in ('name', 'host', 'facilitator', 'recruiter'));

-- Nobody who already paid loses anything.
--
-- Anyone holding 'host' bought it when it meant "name and hosting", so they are
-- given the 'name' entitlement the split has now separated out. Without this,
-- unbundling would quietly take something away from the people who paid first,
-- which is the worst possible group to take something away from.
insert into entitlements (owner, kind, stripe_event, stripe_ref)
select owner, 'name', 'grandfathered:' || owner, 'held a charter before the split'
  from entitlements where kind = 'host'
on conflict do nothing;

-- ---------------------------------------------------------------- invitations
-- A company that has paid for access can send one thing to a player: an
-- invitation to apply for a named job. It never learns who they are. Replying
-- happens on the employer's own site, so we are not in the middle of it — this
-- table records that an approach was made, not a conversation.
--
-- The unique index is the anti-pestering rule: one approach per recruiter per
-- player, for ever. A company that wants to ask twice has to have something new
-- to say, and this is not the place to say it.
create table if not exists invitations (
  id           uuid primary key default gen_random_uuid(),
  recruiter    uuid not null references profiles on delete cascade,
  company_id   uuid not null references companies on delete cascade,
  -- Who it is from. The player is anonymous; the employer is not, because an
  -- invitation from nobody in particular is worthless to receive.
  from_name    text not null,
  role         text not null,
  url          text,
  blurb        text,
  reason       text,
  created_at   timestamptz not null default now(),
  seen_at      timestamptz,
  dismissed_at timestamptz,
  unique (recruiter, company_id)
);

-- Belt and braces. `create table if not exists` does nothing to a table that
-- already exists, so a database where an earlier draft of this stage was run
-- would silently keep the old shape and fail on the first invitation. Naming
-- the column explicitly costs a line and removes the whole class of problem.
alter table invitations add column if not exists from_name text;
update invitations set from_name = 'Unnamed employer' where from_name is null;
alter table invitations alter column from_name set not null;

alter table invitations enable row level security;
-- No policy: the service role reaches this from the server and nothing else
-- does. A table listing who has been approached is not one to leave readable.

-- The player's own list, newest first, and the recruiter's daily count.
create index if not exists invitations_company_idx
  on invitations (company_id, created_at desc);
create index if not exists invitations_recruiter_idx
  on invitations (recruiter, created_at desc);

-- ============================================================ stage 10
-- Tournaments: a league with a final, not a bracket.
--
-- §43 measured both. A knockout crowns the strongest entrant about one time in
-- four, and playing more games inside one does not help — elimination throws
-- the information away. Ranking on aggregate over the same number of tables is
-- better on every count, and it keeps every paying attendee playing rather than
-- sending five of every six home after the first hour.
--
-- A tournament is a cohort with stages, so almost nothing new is needed.

-- Which stage a game belongs to. Classes have one stage and keep the default,
-- so every game that already exists is stage 0 and nothing changes for them.
alter table games add column if not exists stage integer not null default 0;

-- A class has one game per group. A tournament has one per group per stage, so
-- the uniqueness that stops two students opening the same group has to widen to
-- match — otherwise stage two cannot create a group 1 because stage one already
-- did.
drop index if exists games_cohort_group_idx;
create unique index if not exists games_cohort_stage_group_idx
  on games (cohort_id, stage, group_no) where cohort_id is not null;

-- Somebody entered in an event, as opposed to somebody sitting at one table.
--
-- A class needs no such thing: a student joins one group and stays in it, so
-- the seat in the game is the whole of their identity. A tournament re-draws
-- the groups every stage, so an entrant needs a name and a token that outlive
-- any particular table — their seat token changes underneath them and they
-- should never notice.
create table if not exists entrants (
  id         uuid primary key default gen_random_uuid(),
  cohort_id  uuid not null references cohorts on delete cascade,
  name       text not null,
  -- What the entrant holds. Never shown to anybody else, and it is the only
  -- thing that identifies them across the re-draws.
  token      text not null unique,
  created_at timestamptz not null default now()
);

-- Two companies called Ravenscarr in one event is a scoreboard nobody can read,
-- so the name is claimed rather than shared. Case-insensitively: "ravenscarr"
-- and "Ravenscarr" are the same name to everyone reading the board.
create unique index if not exists entrants_name_idx
  on entrants (cohort_id, lower(name));
create index if not exists entrants_cohort_idx on entrants (cohort_id, created_at);

alter table entrants enable row level security;
-- No policy: the server reaches this with the service role and nothing else
-- does. The tokens in this table are what let somebody play, so a table anybody
-- can read is a table anybody can play from.
