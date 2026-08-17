/* CEO live sessions — the whole API surface.

   Thin on purpose: every rule lives in lib/, which is tested without a network.
   This file does routing, auth and error shapes and nothing else. */

import * as G from '../../lib/game.mjs';
import * as A from '../../lib/accounts.mjs';
import * as B from '../../lib/billing.mjs';
import * as P from '../../lib/public.mjs';
import * as R from '../../lib/rating.mjs';
import * as CO from '../../lib/cohorts.mjs';
import * as D from '../../lib/demo.mjs';
import { requireUser, userFrom } from '../../lib/auth.mjs';
import { getDb, getVerifier, publicAuthConfig, serverReady } from '../../lib/runtime.mjs';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const fail = (message, status = 400) => json({ error: message }, status);

/* Rounds close on their own. Rather than relying only on the scheduled sweep,
   every request that touches a game first asks whether its clock has run out —
   so the first player to open the page after the deadline triggers the round.
   The schedule is the backstop, not the mechanism. */
async function settle(db, game, now) {
  let changed = false;
  /* A public table waiting for players starts when it fills or when its wait
     runs out, whichever comes first — nobody sits looking at an empty lobby. */
  if (game.status === 'lobby' && game.isPublic && P.shouldStart(game, now)) {
    P.startPublic(game, now);
    changed = true;
  }
  while (game.status === 'playing' && G.shouldResolve(game, now)) {
    G.resolveRound(game, now);
    changed = true;
  }
  /* Ratings move when the game ends, and only for public games. scoreGame is
     idempotent at the database, so two requests finishing it together is fine. */
  if (game.status === 'over' && game.isPublic && !game.scored) {
    await P.scoreGame(db, game);
    changed = true;
  }
  if (changed) await db.putGame(game);
  return game;
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  const now = new Date().toISOString();

  let body = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { body = {}; }
  }
  const code = (body.code || url.searchParams.get('code') || '').toUpperCase();
  const token = body.token || url.searchParams.get('token') || '';
  const demoKey = body.demo || url.searchParams.get('demo') || '';

  /* Opening the database is deferred until a route actually needs one.

     It used to happen on the way in, which meant that a server missing its
     Supabase environment variables threw before the try block and every single
     request — including the one the page uses to work out what this server even
     is — came back as an opaque 502 with nothing in it. A half-configured server
     should be able to say so. */
  let _db = null;
  const database = () => (_db || (_db = getDb()));
  const verify = getVerifier();

  /* A class board, plus — for the demo only — the two or three sentences that
     say what to look at. A dashboard of six groups explains nothing on its own. */
  const boardOf = async (co) => {
    const b = await CO.board(database(), co);
    if (co.is_demo) b.guide = D.guide(b);
    return b;
  };

  try {
    /* ------------------------------------------------------------ public */
    /* Answered without touching storage, so the page can always find out what it
       is talking to — including that it is not ready yet. */
    if (route === 'config') {
      return json({
        presets: G.PRESETS, limits: G.LIMITS, cadences: G.CADENCES,
        auth: publicAuthConfig(), ready: serverReady(),
        products: Object.fromEntries(Object.entries(B.PRODUCTS).map(([k, p]) => [k, {
          label: p.label, blurb: p.blurb, forSale: !!process.env[p.envPrice],
        }])),
        nameRules: { min: A.NAME.min, max: A.NAME.max },
        publicFormat: { describe: P.describe(), waitSeconds: P.LOBBY_WAIT_SECONDS },
        cohortLimits: CO.LIMITS,
        demo: { groups: D.DEMO.groups, students: D.DEMO.groups * D.DEMO.groupSize,
                opening: D.DEMO.opening, rounds: D.DEMO.rounds,
                maxAdvance: D.DEMO.maxAdvance },
      });
    }

    /* The public format is fixed and needs no storage either. */
    if (route === 'public/format') {
      return json({ format: P.FORMAT, describe: P.describe(),
                    waitSeconds: P.LOBBY_WAIT_SECONDS });
    }

    /* Everything below this line touches storage. If the server has not been
       configured, this is where it says so — with a message rather than a 502. */
    const db = database();

    /* Is this company name free? Answers the format question too, so the page
       can say why rather than just refusing. */
    if (route === 'name') {
      const wanted = url.searchParams.get('q') || '';
      const checked = A.checkName(wanted);
      if (!checked.ok) return json({ ok: false, available: false, error: checked.error });
      const available = await A.isAvailable(db, checked.name);
      return json({ ok: true, available, name: checked.name });
    }

    /* ----------------------------------------------------------- account */
    if (route === 'account') {
      const user = await userFrom(req, verify);
      if (!user) return json({ signedIn: false });
      await db.ensureProfile(user.id, user.email);
      const state = await A.accountState(db, user.id);
      return json({ signedIn: true, email: user.email, ...state });
    }

    if (route === 'checkout' && req.method === 'POST') {
      const user = await requireUser(req, db, verify);
      const out = await B.startCheckout({
        stripe: B.stripeClient(), db, user,
        kind: body.kind === 'facilitator' ? 'facilitator' : 'host',
        companyName: body.companyName, origin: url.origin, now,
      });
      return json({ url: out.url });
    }

    /* -------------------------------------------------- public, ranked play */
    if (route === 'public/join' && req.method === 'POST') {
      /* Free, and no account needed. Signing in with a purchased company is what
         makes the result count towards a rating — that is the whole difference. */
      const user = await userFrom(req, verify);
      let name = String(body.name || '').trim();
      let companyId = null;
      if (user) {
        const acct = await A.accountState(db, user.id);
        if (acct.companies[0]) { name = acct.companies[0].name; companyId = acct.companies[0].id; }
      }
      if (!name) return fail('Give your company a name first.');
      const checked = A.checkName(name);
      if (!checked.ok) return fail(checked.error);

      const joined = await P.joinPublic(db, { name: checked.name, companyId, now });
      await settle(db, joined.game, now);
      await db.putGame(joined.game, user ? user.id : null);
      return json({ code: joined.game.code, token: joined.token, rated: !!companyId,
                    view: G.viewFor(joined.game, joined.token) });
    }

    if (route === 'leaderboard') {
      const board = await db.leaderboard(50);
      return json({
        board: board.map((r, i) => ({
          rank: i + 1, name: r.name, rating: r.rating, band: R.band(r.rating),
          games: r.games, wins: r.wins, bestValue: r.best_value,
        })),
      });
    }

    if (route === 'record') {
      const user = await userFrom(req, verify);
      if (!user) return json({ signedIn: false });
      const acct = await A.accountState(db, user.id);
      const mine = acct.companies[0];
      if (!mine) return json({ signedIn: true, rated: false });
      const [rated, recent] = await Promise.all([
        db.ratingsFor([mine.id]), db.recordFor(mine.id, 10),
      ]);
      const r = rated[mine.id];
      return json({
        signedIn: true, rated: true, name: mine.name,
        rating: r ? r.rating : R.START, band: R.band(r ? r.rating : R.START),
        games: r ? r.games : 0, wins: r ? r.wins : 0, bestValue: r ? r.best_value : null,
        recent: recent.map((x) => ({ place: x.place, seats: x.seats,
          value: x.value, delta: x.rating_delta })),
      });
    }

    /* ------------------------------------------------------------ cohorts */
    /* Running a class is the facilitator licence; joining one is free, the same
       way joining a private game is. */
    if (route === 'cohorts' && req.method === 'POST') {
      const user = await requireUser(req, db, verify);
      const acct = await A.accountState(db, user.id);
      if (!acct.canFacilitate) throw new Error('Running a class needs a facilitator licence.');
      const cohort = await CO.createCohort(db, user.id, body);
      return json({ cohort: await boardOf(cohort) });
    }

    /* A class that is already running, with no account and no form to fill in.
       Whoever opens it gets a token that controls that one throwaway class —
       and a seat in group one, so they can see what a student sees. */
    if (route === 'demo' && req.method === 'POST') {
      const made = await D.createDemo(db, now);
      return json({
        cohortId: made.cohort.id, demoToken: made.demoToken,
        student: made.student, cohort: await boardOf(made.cohort),
      });
    }

    if (route === 'cohorts') {
      const user = await userFrom(req, verify);
      if (!user) return json({ signedIn: false, cohorts: [] });
      const acct = await A.accountState(db, user.id);
      const mine = await db.cohortsOf(user.id);
      return json({ signedIn: true, canFacilitate: acct.canFacilitate,
        cohorts: mine.map((c) => ({ id: c.id, name: c.name, code: c.join_code,
                                    status: c.status, created: c.created_at })) });
    }

    /* Everything below acts on one class and belongs to its owner alone. */
    if (route.startsWith('cohort/')) {
      const [, cohortId, action] = route.split('/');
      const cohort = await db.cohort(cohortId);
      if (!cohort) return fail('No class with that id.', 404);
      /* Two ways in, and only two: you own this class, or you are holding the
         token of a demo that belongs to nobody. */
      if (!D.opensDemo(cohort, demoKey)) {
        const user = await requireUser(req, db, verify);
        if (cohort.facilitator !== user.id) return fail('That is not your class.', 403);
      }

      if (!action) return json({ cohort: await boardOf(cohort) });

      if (action === 'export') {
        const csv = await CO.exportCsv(db, cohort);
        const safe = cohort.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'class';
        return new Response(csv, { status: 200, headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${safe}-results.csv"`,
          'cache-control': 'no-store',
        } });
      }

      if (req.method !== 'POST') return fail('Unknown request.', 404);
      let out;
      if (action === 'start') out = await CO.startAll(db, cohort, now);
      else if (action === 'pause') out = await CO.setPaused(db, cohort, true);
      else if (action === 'resume') out = await CO.setPaused(db, cohort, false);
      else if (action === 'extend') out = await CO.extendAll(db, cohort, body.minutes, now);
      else if (action === 'resolve') out = await CO.resolveAll(db, cohort, now);
      /* Time compression. Nobody sits through fifteen-minute rounds in an
         evaluation, so the demo can be played forward several rounds at once —
         with the scripted students filing and the visitor's own seat left to its
         standing orders. It exists only for demos: a real class's rounds belong
         to the people playing them. */
      else if (action === 'advance') {
        if (!cohort.is_demo) return fail('Only the demo class can be fast-forwarded.', 400);
        out = await D.advanceDemo(db, cohort, body.rounds, now);
      }
      else if (action === 'close') { await db.updateCohort(cohort.id, { status: 'closed' }); out = { closed: true }; }
      else return fail('Unknown request.', 404);

      const fresh = await db.cohort(cohortId);
      return json({ ...out, cohort: await boardOf(fresh) });
    }

    /* A student joins with the class code and is seated automatically. */
    if (route === 'class/join' && req.method === 'POST') {
      const cohort = await db.cohortByJoinCode(String(body.code || '').trim());
      if (!cohort) return fail('No class with that code.', 404);
      const checked = A.checkName(body.name);
      if (!checked.ok) return fail(checked.error);
      const joined = await CO.joinCohort(db, cohort, checked.name, now);
      await db.putGame(joined.game);
      return json({ code: joined.game.code, token: joined.token, group: joined.group,
                    className: cohort.name, view: G.viewFor(joined.game, joined.token) });
    }

    /* -------------------------------------------------------------- games */
    if (route === 'create' && req.method === 'POST') {
      /* Hosting a private game is the thing that was bought, so it is checked
         here on the server and never inferred from what the page sends. */
      const user = await requireUser(req, db, verify);
      const state = await A.requireHost(db, user.id);
      const owned = state.companies[0];
      if (!owned) return fail('Your company name is still being set up. Try again in a moment.');

      let made = null;
      for (let i = 0; i < 5; i++) {
        made = G.createGame({ ...body, hostName: owned.name, now });
        if (!(await db.getGame(made.game.code))) break;
        made = null;
      }
      if (!made) return fail('Could not allocate a game code. Try again.', 503);
      await db.putGame(made.game, user.id);
      return json({ code: made.game.code, token: made.token,
                    view: G.viewFor(made.game, made.token) });
    }

    if (route === 'join' && req.method === 'POST') {
      const game = await db.getGame(code);
      if (!game) return fail('No game with that code.', 404);
      /* Joining is free and needs no account. If you happen to be signed in with
         a company of your own, it is used. */
      const user = await userFrom(req, verify);
      let name = body.name;
      if (user) {
        const state = await A.accountState(db, user.id);
        if (state.companies[0]) name = state.companies[0].name;
      }
      if (!String(name || '').trim()) return fail('Your company needs a name.');
      const checked = A.checkName(name);
      if (!checked.ok) return fail(checked.error);
      const { token: t } = G.joinGame(game, checked.name, now);
      await db.putGame(game);
      return json({ code: game.code, token: t, view: G.viewFor(game, t) });
    }

    if (route === 'start' && req.method === 'POST') {
      const game = await db.getGame(code);
      if (!game) return fail('No game with that code.', 404);
      G.startGame(game, token, now);
      await db.putGame(game);
      return json({ view: G.viewFor(game, token) });
    }

    if (route === 'submit' && req.method === 'POST') {
      const game = await db.getGame(code);
      if (!game) return fail('No game with that code.', 404);
      await settle(db, game, now);
      if (game.status !== 'playing') return fail('That round has already closed.', 409);
      G.submitDecisions(game, token, body.decisions || {});
      /* Filing may be the last one outstanding, in which case the round closes
         now rather than waiting for a clock nobody is watching. */
      await settle(db, game, now);
      await db.putGame(game);
      return json({ view: G.viewFor(game, token) });
    }

    if (route === 'state') {
      const game = await db.getGame(code);
      if (!game) return fail('No game with that code.', 404);
      await settle(db, game, now);
      return json({ view: G.viewFor(game, token) });
    }

    return fail('Unknown request.', 404);
  } catch (err) {
    /* Rule violations from lib/ are messages meant for a player. */
    const msg = err && err.message ? err.message : 'Something went wrong.';

    /* Two failures are the operator's rather than the player's, and both used to
       arrive as an unexplained crash. They are worth naming exactly, because the
       fix for each is one step in SETUP.md and nothing in the interface would
       ever have told anyone which. */
    if (/is not configured on the server/i.test(msg)) {
      return fail('This site has not finished being set up: its database is not '
        + 'connected yet. See SETUP.md, step 3 — the Netlify environment variables.', 503);
    }
    if (/is_demo|demo_token|schema cache|column .* does not exist/i.test(msg)) {
      return fail('The database is missing the latest tables. Re-run db/schema.sql '
        + 'in the Supabase SQL editor — it is idempotent and will not drop anything.', 503);
    }

    const status = /sign in|please sign/i.test(msg) ? 401
      : /charter|licence/i.test(msg) ? 402
      : 400;
    return fail(msg, status);
  }
};

export const config = { path: '/api/*' };
