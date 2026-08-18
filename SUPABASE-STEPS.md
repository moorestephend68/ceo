# The Supabase step, on its own

Your site is deployed and the code is fine. What is missing is a database: the
functions have nowhere to keep games, accounts or company names, so every request
fails. This is that one step, start to finish. About ten minutes, all of it
clicking.

You need two files from the repository: **`db/schema.sql`** (you will paste it
into Supabase) and nothing else.

---

## 1. Make the project

Go to **supabase.com**, sign in, **New project**.

- **Name** — anything. `ceo` is fine.
- **Database password** — it generates one. Copy it somewhere safe. You will not
  need it for this, but you cannot see it again afterwards.
- **Region** — whichever is nearest to most of your players.

Then wait. It takes a minute or two to finish provisioning, and the next step will
not work until it does.

---

## 2. Run the schema

Left sidebar → **SQL Editor** → **New query**.

Open `db/schema.sql` from the repository, select all of it, paste it into the
editor, and press **Run**.

It should say *Success. No rows returned*. That is what success looks like — the
file creates tables rather than returning any.

**Check it worked:** left sidebar → **Table Editor**. You should see seven tables:

```
profiles   companies   entitlements   games   ratings   results   cohorts
```

If you see fewer, the paste was probably truncated. Select the whole file again
and re-run — the script is written so that running it twice is safe and drops
nothing.

---

## 3. Turn on email sign-in

Left sidebar → **Authentication**. Then, in the *second* sidebar that appears
inside Authentication, click **Sign In / Providers**.

The name matters, because it has changed: older guides (including my own message)
say "Providers", and there is no longer a menu item called that. It is now
**Sign In / Providers**, and it sits under the *Configuration* heading in that
inner sidebar.

If you cannot find it, this link goes straight there — `_` means "my project", so
it works without you pasting an id:

```
https://supabase.com/dashboard/project/_/auth/providers
```

On that page, under **Auth Providers**, click **Email** to expand it. Inside:

- **Enable email provider** — on.
- **Confirm email** — on.

Press **Save** at the bottom of the expanded Email panel. It is easy to toggle
something and navigate away without saving.

There are no passwords anywhere in this design. People type an email address and
get a link.

Then, in the same inner sidebar, **URL Configuration** — or directly:

```
https://supabase.com/dashboard/project/_/auth/url-configuration
```

- **Site URL**: `https://ceo-the-game.netlify.app`
- **Redirect URLs** → *Add URL*: `https://ceo-the-game.netlify.app/g/`

Miss that second one and the sign-in link people click will bounce them somewhere
useless.

---

## 4. Copy three values

Left sidebar → **Project Settings** (the gear) → **API**.

| On that page | Copy it into |
|---|---|
| **Project URL** — `https://xxxxx.supabase.co` | `SUPABASE_URL` |
| **anon** / **public** key — a long `eyJ...` string | `SUPABASE_ANON_KEY` |
| **service_role** / **secret** key — another long `eyJ...` string | `SUPABASE_SERVICE_ROLE_KEY` |

The two keys look almost identical and are very easy to swap. The `service_role`
one is usually hidden behind a **Reveal** button — that is the giveaway.

> **The service_role key bypasses every security rule in the database.** It goes
> into Netlify's environment variables and absolutely nowhere else — never in the
> repository, never in a page, never in a message. The `anon` key is designed to
> be public; the browser uses it to sign in.

---

## 5. Paste them into Netlify

**app.netlify.com** → your **ceo-the-game** site → **Site configuration** →
**Environment variables** → **Add a variable**.

> **Watch the word "key" here — it means two different things.**
>
> Netlify labels the first box **Key**. That is the *name* of the variable, and it
> wants `SUPABASE_ANON_KEY`. The long `eyJhbGci...` string from Supabase — which
> Supabase also calls a key — goes in the **Values** box underneath.
>
> Putting the long string in the top box gives you:
> *"variable names can only consist of alphanumeric characters and underscores"*.
> That error is Netlify telling you the two got swapped: a JWT is full of dots and
> dashes, which are legal in a value and illegal in a name.
>
> | Netlify box | What goes in it |
> |---|---|
> | **Key** | `SUPABASE_ANON_KEY` |
> | **Values** | `eyJhbGciOiJIUzI1NiIsInR5cCI6...` (the long string) |

**If it asks about deploy contexts, choose "Same value for all deploy contexts."**
The alternative exists so you can point preview builds at a *different* database
from the live one. You have one Supabase project and one database, so there is
nothing to vary — and setting a value for production only would mean every branch
or preview deploy came up with no database at all, which is the exact failure you
are here to fix. Marking a variable secret does not restrict this choice.

Add these three, exactly as spelled:

```
SUPABASE_URL                 https://xxxxx.supabase.co
SUPABASE_ANON_KEY            eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY    eyJhbGci...
```

The name has to match character for character — a lower-case letter or a stray
space is the commonest reason this step appears to do nothing.

**When Netlify offers to mark `SUPABASE_SERVICE_ROLE_KEY` as a secret, say yes.**
It is exactly right about that one: the service key bypasses every rule in the
database, and marking it secret keeps it out of the UI, the API, the build logs
and the CLI. Your functions still receive the real value — code running on
Netlify's own systems always does; it is everything outside that gets a mask.

Two things to know before you click it:

- **The flag is one-way.** You cannot un-secret it, and you cannot read the value
  back afterwards. That is fine — if you ever need it again, rotate the key in
  Supabase and paste the new one.
- **Leave the scope alone if you can.** Secret variables must have explicit
  scopes, and the one that must *not* be ticked is **Post processing** — that is
  the scope that can inject values into pages. Netlify will not let you pick it
  for a secret anyway, which is the point of the restriction.

Do **not** mark `SUPABASE_URL` or `SUPABASE_ANON_KEY` as secrets. The anon key is
designed to be published — the browser needs it in order to sign anyone in, and
row-level security is what protects the data, not the secrecy of that string.

The same "yes, make it secret" applies later to `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET`. `STRIPE_PRICE_HOST` is just a product id and is not
sensitive.

Stripe's three variables can wait. Without them everything works except buying a
company name.

---

## 6. Redeploy

Environment variables are read when the site builds, so the deploy that is already
up will not see them.

**Deploys** → **Trigger deploy** → **Deploy site**. Wait for it to go green.

---

## 7. Check

Open **https://ceo-the-game.netlify.app/g/**.

- The red *"This site is still being set up"* banner should be gone. If it is
  still there, the variables have not reached the functions — check the spelling
  and redeploy again.
- Click **Open the facilitator demo**. Within a second or two you should get a
  class of six groups and thirty students, five rounds in.

If the demo says *"The database is missing the latest tables"*, step 2 did not
finish — go back and re-run `db/schema.sql` in full.

Everything else follows from there: **Play now** works, and signing in with your
email works. Only buying a name needs Stripe, which is step 2 of `SETUP.md`
whenever you want it.

---

## What each piece is doing

Worth thirty seconds, because it makes the failures readable.

**Supabase is Postgres.** The game itself is still one JSON document per game, as
it always was. What Postgres adds is the promise that two people paying for the
same company name in the same second cannot both succeed — that is one line in the
schema, `name citext not null unique`, and it is the reason this is not still on
file storage.

**Netlify's functions are the only thing that talks to it**, using the
`service_role` key. The browser never touches the database directly. That is why
the anon key being public is safe and the service key being public would not be.

**Nothing is stored until you do this step.** There is no data to lose and no
migration to worry about — the site has never successfully written anything.
