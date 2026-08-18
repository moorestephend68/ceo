# Setting up accounts and payments

The code is done and tested. What is left is configuration in three accounts that
are yours — I can't create projects, run migrations against your database, or see
your Stripe keys. This is the whole list, in order.

Nothing here touches the game. If you stop halfway, the site keeps working exactly
as it does today; hosting simply stays unavailable until the last step.

---

## 1. Supabase — the database

**Create a project.** Any region near your players. Keep the database password
somewhere safe; you won't need it again for this.

**Run the schema.** Open *SQL Editor → New query*, paste the whole of
`db/schema.sql`, and run it. It is idempotent — running it twice is safe and drops
nothing. You should see four tables under *Table Editor*: `profiles`, `companies`,
`entitlements`, `games`.

**Turn on email sign-in.** *Authentication → Sign In / Providers → Email* — the
menu is called "Sign In / Providers", not "Providers"; it was renamed, and the
direct link is `https://supabase.com/dashboard/project/_/auth/providers`. Enable
the email provider and turn **on** "Confirm email", then Save. There are no
passwords in this design — people get a
link. Under *Authentication → URL Configuration*, set the Site URL to
`https://ceo-the-game.netlify.app` and add `https://ceo-the-game.netlify.app/g/`
to the redirect allow-list, or the sign-in link will bounce.

**Collect three values** from *Project Settings → API*:

| Value | Where it goes |
|---|---|
| Project URL | `SUPABASE_URL` |
| `anon` public key | `SUPABASE_ANON_KEY` |
| `service_role` secret key | `SUPABASE_SERVICE_ROLE_KEY` |

The `service_role` key bypasses every security rule. It goes in Netlify's
environment variables and nowhere else — never in the repository, never in a page.
The `anon` key is meant to be public; the browser uses it to sign in.

---

## 2. Stripe — taking the money

**Start in test mode.** The toggle is top-right. Everything below works the same
in test mode with card `4242 4242 4242 4242`, any future expiry, any CVC.

**Create the product.** *Product catalogue → Add product*:

- Name: **Company charter** (or whatever you want on the receipt)
- Price: **one-off**, your number. Comparable one-buy-many-play games sit around
  $25–35; a first price is a guess and easy to change later.

Save it, then copy the **price ID** — it looks like `price_1ABC...`, and it is the
price you need, not the product ID.

**Create the webhook.** *Developers → Webhooks → Add endpoint*:

- URL: `https://ceo-the-game.netlify.app/hooks/stripe`
- Event: **`checkout.session.completed`** — that one only

Copy the **signing secret** (`whsec_...`).

This webhook is what actually grants the purchase. Payment succeeding is not the
same as the purchase being recorded; the webhook is the part that records it.

---

## 3. Netlify — the environment variables

*Site configuration → Environment variables*. Add all six:

```
SUPABASE_URL                 https://xxxxx.supabase.co
SUPABASE_ANON_KEY            eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY    eyJhbGci...        ← secret
STRIPE_SECRET_KEY            sk_test_...        ← secret
STRIPE_WEBHOOK_SECRET        whsec_...          ← secret
STRIPE_PRICE_HOST            price_1ABC...
```

Then **redeploy** — environment variables are read at build time, so an existing
deploy won't pick them up.

---

## 4. Check it end to end

1. Open `/g/`. You should see **"Your company"** with an email box.
2. Sign in. Check your inbox, click the link, land back on `/g/`.
3. Type a company name. It should say available or taken **as you type**.
4. Click through to payment and pay with `4242 4242 4242 4242`.
5. You come back to `/g/` and your company name is now shown at the top.
6. *Start a game* is no longer greyed out.

**If step 5 shows nothing**, the payment worked but the webhook didn't. Check
*Stripe → Developers → Webhooks → your endpoint* for the delivery attempt and its
response. A 400 means the signing secret doesn't match; a 500 means the database
rejected something and Stripe will retry on its own.

---

## 5. Re-run the schema

`db/schema.sql` is idempotent and gains a section per stage, so paste the whole
file into the SQL editor again after any update — it will not drop anything. The
Stage 4 section makes `cohorts.facilitator` nullable and adds `is_demo`,
`demo_token` and `expires_at`, which the demo class needs. Without it, the
**Open the facilitator demo** button will error.

The demo is the one part of the site with no sign-in at all: anyone can open a
class that is already running, push it forward, sit in a student's chair and
download the gradebook. It is worth linking to directly —
`https://your-site/g/?demo=1` — because that link is the whole sales pitch and it
works from an email.

Demo classes delete themselves. Each is six games, they carry a four-hour expiry,
and the scheduled `tick` function sweeps them; `games.cohort_id` cascades, so
nothing is left behind.

---

## Going live

Flip Stripe out of test mode, create the product again in live mode (test and live
are separate worlds), and replace `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
`STRIPE_PRICE_HOST` with the live values. Redeploy.

Two things worth doing before you charge real money: fill in your Stripe business
details so receipts look legitimate, and decide your refund position. Somebody
will ask, and "no refunds" written down beforehand is easier than deciding under
pressure.

---

## What runs without any of this

`test/serve.mjs` uses an in-memory database and no Stripe at all. It seeds an
account — token `tok:demo`, company **Ravensworth & Co** — so you can develop and
play the whole paid flow locally without touching either service. The browser
tests sign in as that account.

## The one thing I could not test

Every path here is covered by tests against a fake Stripe and an in-memory
database — including a forged webhook, the same webhook arriving three times, and
two people buying the same name in the same instant. What I could not do is put a
real card through a real Stripe account. Step 4 above is that test, and it is
worth doing in test mode before you go live.
