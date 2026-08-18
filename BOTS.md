# The bot league

You can write a program to play CEO. There is a league for it, with its own
board, and it is separate from the human game on purpose.

This is not a loophole we are tolerating. It is a supported way to play.

## Why it exists

The client is HTTP and the state is JSON, so automating it was always going to
happen — an afternoon's work turns a browser tab into a program. We measured
what that would do: a straightforward optimiser, one that searches price,
production and advertising each round using nothing a human player cannot also
see, wins **35%** of ranked public tables against a thoughtful human's **30%**.

That is a real edge. It is not a large enough one to be worth an arms race
over, and policing it would mean guessing from timing and typing patterns who
is a person — which is a losing game that also insults the people it gets
wrong.

So automation gets its own pool instead. Bots play bots. The board ranks
programs against other programs, which is the only comparison that means
anything, and the human board goes back to being about people.

## The rules, in full

1. **We never run your code.** Your bot runs on your machine — your laptop, a
   VPS, a Raspberry Pi, whatever you like — and talks to the ordinary public
   API over HTTPS. Nothing is uploaded here.
2. **A bot key plays league games only.** It cannot join a ranked public table,
   a private game or a class. Using a bot in the human tier is the one thing
   that is actually against the rules, and the key is what makes staying on the
   right side of that line easy rather than a matter of trust.
3. **A key may start 20 games an hour.** Joining a table somebody else opened
   does not count against it. This is generous for tuning and small enough that
   nobody can run up our bill.
4. **League results never move a human rating** and never appear on the human
   leaderboard. The two boards do not see each other's games.
5. **Your bot gets no information a human does not get.** It reads the same
   view the page renders: rivals' last prices, qualities and awareness, its own
   full accounts. Rivals still commit blind, the same as always.

## Getting a key

Sign in, open your account page, and press **Create a bot key**. The key is
shown **once**. It is stored hashed, so nobody — including us — can read it
back afterwards. If you lose it or it leaks, make another; that revokes the
old one, which is the only revocation anybody actually needs.

A key looks like `ceobot_` followed by 32 characters. Treat it like a password:
environment variable, not source control.

If you have bought a company name, your league results are recorded under that
name and appear on the board. Without one your bot can still play — it just
plays anonymously, and there is nothing to rank.

## The protocol

Three endpoints. Base URL is the site, e.g. `https://ceo-the-game.netlify.app`.

### 1. Join a table

```
POST /api/bot/join
Content-Type: application/json

{ "key": "ceobot_..." }
```

Returns:

```json
{
  "code": "ABCDE",
  "token": "…",
  "ranked": true,
  "view": { "status": "lobby", … }
}
```

`token` is your seat. Keep it; every later call needs it, and it is the only
thing that identifies you at that table.

You are put with other bots that are waiting. If nobody is waiting you open a
table, and if nobody else arrives within 20 seconds the built-in archetypes
take the empty seats — so a lone author can still tune against something rather
than sitting in an empty room. `ranked: false` means no company name is
attached, so the game will not count towards the board.

### 2. Read the state

```
GET /api/state?code=ABCDE&token=…
```

Returns `{ "view": … }`. The view is exactly what the browser gets. What
matters most:

| Field | Meaning |
| --- | --- |
| `view.status` | `lobby`, `playing`, `over` |
| `view.round` | 0-based; `view.totalRounds` is the length |
| `view.deadline` | ISO timestamp this round closes |
| `view.you.filed` | whether your orders for this round are in |
| `view.you.cash`, `.debt`, `.value` | your accounts |
| `view.you.products[]` | one entry per line you run — see below |
| `view.you.firmState` | your company exactly as the engine holds it |
| `view.market[]` | every seat: `lastPrice`, `lastShare`, `pub[]` per line |
| `view.history[]` | every past round; your own rows carry full detail |

Each `view.you.products[i]` carries `name`, `quality`, `value` (what the market
thinks one unit is worth — the natural price anchor), `unitCost`, `inventory`,
`capacity`, `effCapacity`, `efficiency`, `awareness` and `lastDemand`.

Reading the state does not extend the deadline and does not cost you anything.
Do not poll faster than once a second; there is nothing new to see.

### 3. File your orders

```
POST /api/submit
Content-Type: application/json

{
  "code": "ABCDE",
  "token": "…",
  "decisions": {
    "products": {
      "<product name>": {
        "price": 1240,
        "produce": 1300,
        "rd": 30000,
        "rdProcess": 12000,
        "advertising": 6000,
        "targetCapacity": 1400,
        "discontinue": false
      }
    },
    "launch": false,
    "launchKind": "software"
  }
}
```

Every field is clamped to something legal, so an out-of-range number is
corrected rather than rejected. Filing again before the round closes replaces
your previous orders.

Returns the updated view. **A round closes the moment the last seat has
filed** — bots do not need five minutes to think, so a league game finishes in
under a minute. There is still a 45-second deadline per round, because one
crashed program must not freeze the table for everyone else; miss it and your
previous orders repeat.

### The board

```
GET /api/bot/board
```

Ranked by **average money made over your last 20 games**, with a minimum of 5
games to appear. Not a total — that would rank whoever left their bot running
longest. Not a best — that would rank whoever got the luckiest market. An
average over recent games ranks the program.

## Format

| | |
| --- | --- |
| Seats | 5 |
| Rounds | 10 |
| Round deadline | 45 seconds (rounds usually close in under one) |
| Lobby wait | 20 seconds |
| Preset | standard — every company starts with $250,000 |

"Money made" is final company value minus that starting cash.

## A reference bot

`bots/reference-bot.mjs` in this repository is a complete, runnable player in
about 150 lines with no dependencies. It joins, plays a whole game and reports
what it made:

```sh
export CEO_BOT_KEY=ceobot_…
node bots/reference-bot.mjs --site https://ceo-the-game.netlify.app --games 5
```

Its strategy is deliberately plain: price a little under what the market thinks
the product is worth, build what it expects to sell, spend steadily on R&D and
advertising, and add capacity when it keeps selling out. It is a starting
point, not a target — it will lose to anything thoughtful, which is the idea.

## Things worth knowing before you tune

- **Demand is shared and price-sensitive.** Your share depends on your price
  and quality against everyone else's, which you only learn *after* the round.
  Everyone commits blind.
- **R&D arrives late.** Money spent on product R&D shows up as quality two
  rounds later. Process R&D lowers unit cost on the same delay. A bot that
  optimises only the current round's profit systematically underspends on both,
  and is beaten in the second half by one that does not.
- **Capacity is not free.** It costs upkeep every round whether you use it or
  not, and selling it back returns less than it cost.
- **Stockouts are invisible in the accounts.** Demand you could not meet does
  not appear as a loss; it appears as a rival's market share. `lastDemand`
  against what you produced is where to look.
- **Debt gets dearer as you use it.** The interest rate is a function of how
  much of the credit line is drawn and how you have been trading. `view.you.credit`
  tells you what your next loan costs before you take it.
- **Ten rounds is short.** A launch needs three rounds to pay back, and the
  game refuses one with fewer than three left.

The full economy is documented in `CEO-economy-design.md`, and the engine is
`lib/engine.mjs` — the same file the browser, the server and this bot's
opponents all run. You are welcome to import it and simulate against yourself.

## Fair play

Two things, both of which we can see and neither of which we want to litigate:

- One key per person. Filling a table with five copies of your own bot to farm
  a good average is obvious in the results, and the board is not worth cheating
  for.
- Do not use a bot key's games to grind the human boards. They are separate by
  construction, so this is not really possible — it is written down so it is
  clear it was considered rather than overlooked.

If your bot crashes mid-game, nothing bad happens: its previous orders repeat
each round, the table finishes, and the result counts. That is the same
treatment a person who closes their laptop gets.
