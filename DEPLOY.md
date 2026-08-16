# Deploying

You have GitHub, Netlify and Supabase. Two of the three are all this needs.

## The short version

**GitHub → Netlify is the path, and it also gets round the problem that blocked
the last two attempts.** The `403 Forbidden` came from deploying over the API with
a token that could not write to the site. A repository-connected deploy never uses
that token: Netlify pulls the code itself and builds it.

Supabase is not needed yet. What it would buy is at the bottom.

## 1. Push to GitHub

This folder is already a git repository with a first commit. Create an empty
repository on GitHub — no README, no `.gitignore`, nothing, or the first push will
conflict — then:

```bash
cd ceo-live
git remote add origin https://github.com/<you>/ceo.git
git push -u origin main
```

## 2. Connect it to Netlify

In the Netlify dashboard, on the existing **ceo-the-game** site:

**Site configuration → Build & deploy → Continuous deployment → Link repository**

Pick the GitHub repository. Netlify reads `netlify.toml` and needs no manual
settings — publish directory, functions directory and Node version are all in
there. Deploy.

Every `git push` from then on redeploys.

### If it asks for build settings anyway

| Field | Value |
|---|---|
| Build command | `echo 'static site — nothing to build'` |
| Publish directory | `public` |
| Functions directory | `netlify/functions` |

The functions directory is the one that matters. Without it the pages ship and
every game request returns 404.

## 3. Check it

- `https://ceo-the-game.netlify.app/` — the single-player levels
- `https://ceo-the-game.netlify.app/g/` — start a live session
- `https://ceo-the-game.netlify.app/api/config` — should return JSON with the
  presets and limits. If this 404s, the functions did not deploy.

Netlify Blobs provisions itself on the first write, so there is nothing to set up
for storage. The hourly round-closing function only runs on published production
deploys, not on deploy previews — that is expected.

## If you would rather not use GitHub

```bash
npm install -g netlify-cli
netlify login
cd ceo-live
netlify deploy --prod --dir=public --functions=netlify/functions --site=ceo-the-game
```

This is the path that returned 403 from an automated environment. It normally
works fine from a machine where you have just logged in interactively, because
`netlify login` issues a token with your own permissions.

---

## What Supabase would add, when you want it

Nothing in the game needs a database today. Storage is Netlify Blobs: one JSON
object per game, no schema, no provisioning. It is genuinely enough for five
friends playing a round a day.

Three things would make Supabase worth adding, and none of them are urgent:

**1. Two people filing in the same second.** Blobs has no compare-and-swap, so the
second write silently overwrites the first. With a daily round and five players the
odds are small, but it is a real defect and Postgres removes it outright.

**2. Losing your browser means losing your seat.** Identity is a token in
`localStorage`. Clear your browser data mid-game and there is no way to prove which
company was yours. Supabase Auth — even just a magic link — fixes that and lets
people play from a phone and a laptop.

**3. Company identity across games.** §16 of the design document wants a company
name you keep, carrying games played, best result and win rate. That has to live
server-side to survive switching machines, and it is exactly a two-table Supabase
schema.

The order that makes sense: ship on GitHub and Netlify, play some real games with
people, and add Supabase when the first person says "I lost my game" or asks what
their record is. Adding it before then is building for a problem you have not had.
