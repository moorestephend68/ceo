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
| `public/live.html` | The multiplayer client |
| `lib/game.mjs` | Every rule of a live session. Pure functions, no network, injected clock |
| `lib/engine.mjs` | The economy. **Generated** — see below |
| `netlify/functions/api.mjs` | create · join · start · submit · state |
| `netlify/functions/tick.mjs` | Hourly sweep that closes rounds nobody opened |
| `test/` | See below |

### The engine is generated, not written

`lib/engine.mjs` is produced from `engine.js` in the parent project by
`mkserver.py`, and `public/index.html` is produced from `template.html` by
`build.py`. Both inline the same source, so **the browser and the server run
byte-identical economy code**. Editing `lib/engine.mjs` by hand will be overwritten.

That engine is in turn verified against a Python reference implementation
(`ceo_engine.py`) to a divergence of 1e-06 across the solo path, the shared market,
bankruptcy redistribution and all four product kinds.

## Tests

```bash
node test/season.mjs        # a whole season: absences, standing orders, a bankruptcy
node test/api.mjs           # every HTTP route, including what a stranger can read
node test/browser.mjs       # two real browsers, one game, driven through the interface
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

Netlify Blobs, store `ceo-games`, one JSON object per game at `game/<CODE>`. A
finished twelve-round, five-company game is about 54 KB. There is no schema and
nothing to provision.

Known limitation: Blobs has no compare-and-swap, so two players filing in the same
second could overwrite one another. With five friends and a daily round the
exposure is small, but it is real. Moving storage to Postgres is the fix.

## Design

The economy is documented in `CEO-economy-design.md` — twenty sections covering
what was measured, what was tried and rejected, and which instincts turned out to
be wrong. Roughly half of them did.
