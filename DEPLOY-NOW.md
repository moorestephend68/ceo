# Deploying this build

Your live site is on `2026-08-19 · did anybody play`. This build is
`2026-08-22 · tournaments`, and **five batches of work have piled up behind it**,
not one:

| | what it needs |
|---|---|
| Unbundling — company name sold separately from hosting, plus the hiring side | **SQL, two Stripe products, two env vars** |
| Two levels — a first game and the full game | nothing |
| Supply contracts and leasing plant, and their interface | nothing |
| The game screen fitting a phone | nothing |
| Tournaments | **SQL** (the same paste) |

I told you earlier this was "deploy only, no schema change". That was true of the
last piece and wrong about what you actually have to do, because the unbundling
deploy never went out. The SQL and the Stripe work below are that older batch
catching up.

Do the four steps in order. Everything before step 4 is free; step 4 is the one
that spends build credits, so it goes last and there is only one of it.

---

## Step 1 — Run the SQL (2 minutes)

**Supabase → your project → SQL Editor → New query.**

Open `db/schema.sql` and copy **from the line `-- ==== stage 9`, to the end of the
file** — that is stages 9 and 10 together. Paste it, press **Run**.

It should say `Success. No rows returned`.

Safe to run twice. Every statement in it is `if not exists`, `if exists`, or an
`on conflict do nothing` — so if you are not sure whether you already ran it, run
it again rather than trying to find out.

What it does:

- Widens what an entitlement can be, from `host`/`facilitator` to
  `name`/`host`/`facilitator`/`recruiter`.
- **Grandfathers everyone who already paid.** Anyone holding `host` bought it
  when it meant "name *and* hosting", so they are given the `name` entitlement
  too. Nobody loses anything they paid for.
- Creates the `invitations` table for the hiring side, with the unique index that
  enforces one approach per player per company, for ever.
- Adds `games.stage` and an `entrants` table for tournaments, and widens the
  per-group uniqueness to include the stage. Existing classes are all stage 0 and
  are untouched.

---

## Step 2 — Two new Stripe products (10 minutes)

You already have the charter product and the facilitator licence. You need two
more. **Sandbox is fine** — the demo does not need live mode.

**Stripe → Product catalogue → Add product**, twice:

| Name | Price | Type |
|---|---|---|
| Company name | **$19.99** | One-off |
| Hiring access | your call | One-off |

### The tax code — this is the bit that bit you last time

Managed Payments is on by default and it refuses any price without a product tax
code. The error is `Invalid line_items[0]: the product tax code is missing`, and
it does not appear until somebody tries to check out.

On **each** new product: **Edit product → Tax code →** search for and pick
**`General - Electronically Supplied Services`** (`txcd_10000000`). Same code
both times.

If a product shows a **"Needs info"** badge, that is what it means. Do not move
past it — I did last time and it cost us an afternoon.

### Then copy the two price IDs

On each product, the price row has an ID starting `price_`. Copy both. You want
the **price** ID, not the product ID (`prod_`).

---

## Step 3 — Environment variables in Netlify (3 minutes)

**Netlify → ceo-the-game → Site configuration → Environment variables.**

Add two:

| Key | Value |
|---|---|
| `STRIPE_PRICE_NAME` | the `price_…` for **Company name** |
| `STRIPE_PRICE_RECRUITER` | the `price_…` for **Hiring access** |

Leave `STRIPE_PRICE_FACILITATOR` alone.

### One thing to decide about `STRIPE_PRICE_HOST`

It currently points at the old $49 charter, which used to buy a name *and*
hosting. After this deploy that same product buys **hosting alone**, and the name
is the separate $19.99.

Nothing breaks either way — it is a decision, not a bug. Your options:

- **Leave it.** Hosting costs $49, a name costs $19.99. Fine for the demo.
- **Make a new "Private games" product** at whatever hosting is worth on its own,
  tax code and all, and repoint `STRIPE_PRICE_HOST` at it.

If you skip a price variable entirely, that product simply is not for sale: the
button gives *"Hiring access is not configured for sale yet."* Nothing crashes,
and nothing else is affected.

**Do not touch** `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` or
`STRIPE_WEBHOOK_SECRET`. They are already set and they are the three that must
never leave that page.

---

## Step 4 — Upload the code (5 minutes)

**Unzip the file on your machine first.** GitHub's web uploader does not unzip
anything — dragging the `.zip` in puts a `.zip` in your repository and changes
nothing else. That is what happened last time.

Then, on your repository page:

1. **Add file → Upload files**
2. Drag in the **contents** of the unzipped `ceo-live` folder — the files and
   folders *inside* it, not the folder itself.
3. Scroll to the bottom and **press "Commit changes"**. The upload finishing is
   not the same as committing, and the green button is below the fold.

Netlify builds automatically. Two to three minutes.

### If you would rather push from a terminal

```bash
cd ceo-live
git add -A
git commit -m "Levels, supply contracts, leasing, phone layout, tournaments"
git push
```

---

## Step 5 — Check it actually landed (1 minute)

Open **`/g/`** and scroll to the footer. Both halves must read:

```
page 2026-08-22 · tournaments
server 2026-08-22 · tournaments
```

**If only one half has moved, half the site is old.** The page comes from
`public/live.html` and the server from `lib/version.mjs`; if they disagree, one
of the two files did not upload. Re-upload and commit again.

Then three quick things:

- **`/api/config`** — should now list `levels` and `defaultLevel`. That is the
  new work being live.
- **Start a game** and pick **"First game"** under *How much of the game*. You
  should see **five sliders a line**, no process R&D, no new-line card, no supply
  contract, no leasing.
- **Start another** at **"The full game"**. Six sliders, a supply contract grid
  you can click a cell of, and rent-in / rent-out boxes under the factory-size
  slider.
- **Open `/g/` on your phone.** The market table should read as a stack of
  companies rather than running off the right edge, and the expected profit
  should sit in a bar pinned to the bottom of the screen.
- **Tournaments** should be a card on the front page. Creating one needs the
  facilitator licence; entering one needs nothing.

---

## What existing games and classes do

Nothing. Any game or class created before this deploy has no level stored, and
anything without one is treated as the full game — exactly what it was when it
started. Nobody's game changes shape underneath them.

New private games default to the full game. **New classes default to the first
game**, because a class is where a first sitting actually happens.

---

## If something goes wrong

**"…is not configured for sale yet."** — a price environment variable is missing
or misspelled. Step 3.

**"the product tax code is missing"** — step 2, the tax code. It only ever shows
up at checkout.

**Anything 503s about the database** — the SQL did not run. Step 1.

**A game says it no longer exists** — that is the fix from a fortnight ago
working. Reload; it will not loop.

**Everything slow on the first click** — cold start on the functions, about two
seconds, once. Click any API endpoint before the demo to warm it.

**Rolling back** — Netlify keeps every deploy. **Deploys → the previous one →
Publish deploy.** The SQL does not need undoing; the old code ignores the new
column and the new table.

---

## Before Friday

The runbook is `DEMO.md` and the pre-flight list at the top of it is the thing to
read an hour before. Two items on it are new:

- If you plan to show contracts or leasing, **create the demo game at "The full
  game"**. They are deliberately not there at level 1, and discovering that in
  front of investors would look like a bug.
- The **two-levels answer** is now in the questions section, with the numbers.
  It is a strong one: the new mechanics are worth 45% of what all the base
  decisions are worth, and hiding two levers the game already had is worth three
  times what they add.
