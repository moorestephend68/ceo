# CEO

A business simulation. You run a company: set the price, decide how many to make,
choose what to spend on research and advertising, size the factory, and decide when
to launch something new. Everyone commits blind, then the round resolves.

Three single-player levels and an asynchronous multiplayer mode where you play a
round a day against friends and hidden AI companies.

## Running it

```bash
npm install
node test/serve.mjs
```

Then `http://localhost:8899` for the solo levels and `http://localhost:8899/g/` to
start a live session. Storage is in memory locally, so restarting the server clears
any games in progress.

## Deploying

Connect this repository to a Netlify site. Nothing else is needed — `netlify.toml`
sets the publish directory, the functions directory and the Node version, and
Netlify Blobs provisions itself on first write.

The one setting that matters: the functions directory must be picked up. It is set
in `netlify.toml`, so a repository-connected deploy handles it. A manual `netlify
deploy` from the command line needs `--functions=netlify/functions` passed
explicitly or the pages ship and every game request returns 404.

## Layout

| Path | What it is |
|---|---|
| `public/index.html` | The single-player game — all three levels, one self-contained file |
| `src/live-template.html` | The multiplayer client (built to `public/live.html`) |
| `lib/game.mjs` | Every rule of a live session. Pure functions, no network, injected clock |
| `lib/engine.mjs` | The economy. **Generated** — see below |
| `lib/cohorts.mjs` | Classes: seating, the board, the clock, the export |
| `lib/demo.mjs` | The demo class — a real cohort that belongs to nobody |
| `lib/league.mjs` | The bot league — keys, seating, and the average-based board |
| `lib/talent.mjs` | Being findable by an employer — consent, the floor, and what may be published |
| `lib/progress.mjs` | Whether anybody gets better — matched cohorts and a permutation null |
| `lib/recruit.mjs` | The hiring side — the pool, the identity wall, and one approach each |
| `lib/pulse.mjs` | Did anybody play — counts games rather than pageviews |
| `lib/traits.mjs` | How a game was played — including what happens after a bad round |
| `bots/reference-bot.mjs` | A complete runnable bot, no dependencies. See `BOTS.md` |
| `netlify/functions/api.mjs` | create · join · start · submit · state · demo · cohorts |
| `netlify/functions/tick.mjs` | Sweep that closes rounds nobody opened, and clears expired demos |
| `db/schema.sql` | The Postgres schema. Idempotent; run it in the Supabase SQL editor |
| `BOTS.md` | The bot protocol — three endpoints, and the rules of the league |
| `test/` | See below |

### Three things here are generated, not written

| Generated | From | By |
|---|---|---|
| `lib/engine.mjs` | `engine.js` | `mkserver.py` |
| `public/index.html` | `template.html` | `build.py` |
| `public/live.html` | `src/live-template.html` | `mklive.py` |

All three inline the same engine source, so **the solo game, the multiplayer page
and the server run byte-identical economy code**. Editing a generated file by hand
will be overwritten — edit the template and rebuild.

> **`public/index.html` currently carries three hand-made edits** — the routes from
> the solo game to the live one, marked `LIVE-LINK 1 of 3` and so on. They were
> added directly to the generated file because `template.html` and `build.py` live
> in the other repository. **They will be lost the next time the solo game is
> rebuilt**, so port them into `template.html` before that happens. Search the
> file for `LIVE-LINK` to find all three.

The multiplayer page carries the engine for one specific reason: its projection
panel is computed by running the real `resolve()` arithmetic against the orders
being typed. An end-to-end browser test files a round and compares the projected
profit with what the server actually returns — most recently, a gap of **zero**.

That engine is in turn verified against a Python reference implementation
(`ceo_engine.py`) to a divergence of 1e-06 across the solo path, the shared market,
bankruptcy redistribution and all four product kinds.

## Tests

```bash
node test/accounts.mjs      # two people buying the same name at the same instant
node test/billing.mjs       # webhooks: replayed, forged, unpaid, expired holds
node test/paywall.mjs       # signed out / signed in / paid, through the interface
node test/rating.mjs        # can the leaderboard be farmed? (it cannot)
node test/public.mjs        # matchmaking, lobbies that start themselves, scoring once
node test/publicui.mjs      # public play and the leaderboard in a browser
node test/cohort.mjs        # forty students, eight groups, a pause and the export
node test/cohortui.mjs      # the facilitator dashboard in a browser
node test/demo.mjs          # the demo class: same story every time, and it is the right story
node test/demoapi.mjs       # what a demo token opens — and everything it does not
node test/demoui.mjs        # opening the demo with no account, in a browser
node test/unconfigured.mjs  # a deployed server with no environment: does it say so?
node test/nodeversion.mjs   # does it still start on a Node with no global WebSocket?
node test/season.mjs        # a whole season: absences, standing orders, a bankruptcy
node test/api.mjs           # every HTTP route, including what a stranger can read
node test/browser.mjs       # two real browsers, one game, driven through the interface
node test/launch.mjs        # tick launch, file it, check the second line really appears
```

`test/browser.mjs` needs `test/serve.mjs` running, and Playwright installed.

Measurement scripts, which answer design questions rather than asserting
correctness:

```bash
node test/seats.mjs         # how many companies a game supports
node test/length.mjs        # how long a game stays worth playing
node test/spiral.mjs        # whether health-priced debt is escapable
node test/launchtiming.mjs  # when a new product line is worth its price
```

## Storage

Supabase Postgres — see `db/schema.sql` and `SETUP.md`. A game is still one JSON
document; only where it lives changed. What forced the move off Netlify Blobs was
a single line:

```sql
name citext not null unique
```

Buying a company name is a transaction. Two people paying for the same name in the
same second must not both succeed, and last-write-wins object storage cannot
express that. Pulling `status` and `deadline` out as real columns also replaced the
whole due-marker scheme the blob backend needed: "which games are overdue" is now
one indexed query.

Locally, `test/serve.mjs` runs an in-memory implementation of the same interface
that enforces the same unique constraints, so restarting it clears everything.

## Design

The economy is documented in `CEO-economy-design.md` — twenty sections covering
what was measured, what was tried and rejected, and which instincts turned out to
be wrong. Roughly half of them did.
