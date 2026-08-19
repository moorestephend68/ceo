/* CEO live sessions — the whole API surface.

   Thin on purpose: every rule lives in lib/, which is tested without a network.
   This file does routing, auth and error shapes and nothing else. */

import * as G from '../../lib/game.mjs';
import * as A from '../../lib/accounts.mjs';
import * as B from '../../lib/billing.mjs';
import * as P from '../../lib/public.mjs';
import * as R from '../../lib/rating.mjs';
import * as BOARD from '../../lib/board.mjs';
import * as CO from '../../lib/cohorts.mjs';
import * as D from '../../lib/demo.mjs';
import * as M from '../../lib/mutate.mjs';
import * as AN from '../../lib/analysis.mjs';
import { classReport } from '../../lib/report.mjs';
import * as L from '../../lib/league.mjs';
import * as T from '../../lib/talent.mjs';
import * as PR from '../../lib/progress.mjs';
import { pulse } from '../../lib/pulse.mjs';
import { requireUser, userFrom } from '../../lib/auth.mjs';
import { getDb, getVerifier, publicAuthConfig, serverReady } from '../../lib/runtime.mjs';
import { BUILD } from '../../lib/version.mjs';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const fail = (message, status = 400) => json({ error: message }, status);

/* Rounds close on their own. Rather than relying only on the scheduled sweep,
   every request that touches a game first asks whether its clock has run out —
   so the first player to open the page after the deadline triggers the round.
   The schedule is the backstop, not the mechanism. */
/* Bring a game up to date in place. Called inside mutateGame, so it never writes
   for itself — the caller owns the write, and the retry, and therefore this is
   safe to run again on whatever state somebody else just left behind. */
async function settle(db, game, now) {
  let changed = false;
  /* A public table waiting for players starts when it fills or when its wait
     runs out, whichever comes first — nobody sits looking at an empty lobby. */
  /* Any lobby carrying a deadline starts itself: a public table when its wait
     runs out, and a class group opened by a latecomer after the class began. */
  if (game.status === 'lobby' && P.shouldStart(game, now)) {
    P.startPublic(game, now);
    changed = true;
  }
  while (game.status === 'playing' && G.shouldResolve(game, now)) {
    G.resolveRound(game, now);
    changed = true;
  }
  /* Ratings move when the game ends, and only for public games. scoreGame is
     idempotent at the database, so two requests finishing it together is fine. */
  if (game.status === 'over' && (game.isPublic || game.league === 'bot') && !game.scored) {
    await P.scoreGame(db, game);
    changed = true;
  }
  return changed;
}

/* Read a game, bring it up to date, write only if anything changed. */
const settled = (db, code, now) =>
  M.mutateGame(db, code, async (game) => (await settle(db, game, now)) || false);

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
  /* Every eligible player's average, for the percentile on a profile. Read when
     needed and not cached: the pool is small, and a stale percentile is a number
     that is wrong about a person. */
  const population = async () => {
    const opted = await database().liveTalentOptIns();
    const out = [];
    for (const o of opted) {
      const acct = await A.accountState(database(), o.owner);
      const c = acct.companies[0];
      if (!c) continue;
      const rows = await database().resultsForCompany(c.id);
      if (rows.length < T.MIN_GAMES) continue;
      out.push(rows.reduce((a, r) => a + (Number(r.value) - P.START_CASH), 0) / rows.length);
    }
    return out;
  };

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
        auth: publicAuthConfig(), ready: serverReady(), build: BUILD,
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
      /* Same for a stranger naming a company for one free game — it is not a
         purchase, so there is nothing to be exact about. */
      const checked = A.checkName(name, { tidy: !companyId });
      if (!checked.ok) return fail(checked.error);

      /* Matchmaking picks a table, which may be one somebody else is joining at
         the same moment — so the seat is added under the same retry as everywhere
         else, and a table that filled underneath us sends the next person to a
         new one. */
      const joined = await P.joinPublic(db, { name: checked.name, companyId, now });
      let out = joined;
      if (joined.created) {
        await settle(db, joined.game, now);
        await db.putGame(joined.game, user ? user.id : null);
      } else {
        const { game, result } = await M.mutateGame(db, joined.game.code, async (g) => {
          if (g.status !== 'lobby' || g.seats.length >= g.config.seats) return null;
          const { token: t } = G.joinGame(g, checked.name, now);
          const seat = g.seats[g.seats.length - 1];
          seat.companyId = companyId || null;
          await settle(db, g, now);
          return t;
        }, { host: user ? user.id : null });
        if (!result) {
          /* it filled while we were looking at it — open a fresh table */
          const again = await P.joinPublic(db, { name: checked.name, companyId, now,
                                                forceNew: true });
          await db.putGame(again.game, user ? user.id : null);
          out = again;
        } else {
          out = { game, token: result };
        }
      }
      return json({ code: out.game.code, token: out.token, rated: !!companyId,
                    view: G.viewFor(out.game, out.token) });
    }

    /* The board is the best company anyone has built lately, decayed so that it
       is winnable this afternoon. The rating still exists and is still what
       measures skill; it is on your own record rather than on the wall. */
    if (route === 'leaderboard') {
      /* Two days is generous: at 10% an hour a result is worth 0.6% of itself
         after 48 hours, so nothing older can reach a board of twenty-five. */
      const since = new Date(Date.parse(now) - 48 * 3600000).toISOString();
      const rows = await db.recentResults(since);
      return json({
        board: BOARD.build(rows, { now, start: P.START_CASH }),
        decayPerHour: BOARD.DECAY_PER_HOUR,
        halfLifeHours: Math.round(BOARD.HALF_LIFE_HOURS * 10) / 10,
        startCash: P.START_CASH,
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
      /* Where this company stands on the board right now, which is a different
         question from how good it is and is the one somebody looks for first. */
      const since = new Date(Date.parse(now) - 48 * 3600000).toISOString();
      const board = BOARD.build(await db.recentResults(since),
                                { now, start: P.START_CASH, top: 500 });
      const standing = board.find((b) => b.name === mine.name) || null;
      return json({
        signedIn: true, rated: true, name: mine.name,
        /* The rating is kept and is still what measures skill — it simply lives
           here now rather than on the public board, which is a race. */
        rating: r ? r.rating : R.START, band: R.band(r ? r.rating : R.START),
        games: r ? r.games : 0, wins: r ? r.wins : 0, bestValue: r ? r.best_value : null,
        onBoard: standing && standing.rank <= BOARD.TOP ? standing.rank : null,
        boardScore: standing ? standing.score : 0,
        boardMade: standing ? standing.made : 0,
        boardAgeHours: standing ? standing.hoursAgo : null,
        recent: recent.map((x) => ({ place: x.place, seats: x.seats,
          value: x.value, delta: x.rating_delta })),
      });
    }

    /* -------------------------------------------------------- the bot league */
    /* Somebody was always going to automate this. Rather than policing it, there
       is a pool where it is the point — bots against bots, on their own board.
       We never run anybody's code: a bot lives on its author's machine and talks
       to this API with a key. */
    if (route === 'bot/key' && req.method === 'POST') {
      const user = await requireUser(req, db, verify);
      const key = await L.issueKey(db, user.id);
      /* Shown once. Stored hashed, so nobody — including us — can read it back;
         asking for another simply revokes this one. */
      return json({ key, shownOnce: true });
    }

    if (route === 'bot/join' && req.method === 'POST') {
      const owner = await L.whoseKey(db, body.key || req.headers.get('x-bot-key'));
      if (!owner) return fail('That is not a bot key. Create one from your account page.', 401);

      const since = new Date(Date.parse(now) - 3600000).toISOString();
      const started = await db.leagueGamesSince(owner, since);
      if (started >= L.GAMES_PER_HOUR) {
        return fail(`A key may start ${L.GAMES_PER_HOUR} games an hour, and this one has `
          + `started ${started}. Wait a little.`, 429);
      }

      const acct = await A.accountState(db, owner);
      const mine = acct.companies[0];
      const name = mine ? mine.name : `Bot ${owner.slice(0, 6)}`;

      const seated = await L.joinLeague(db, {
        owner, name, companyId: mine ? mine.id : null, now,
      });
      if (seated.created) {
        seated.game.leagueOwner = owner;
        await db.putGame(seated.game, owner);
        return json({ code: seated.game.code, token: seated.token,
                      ranked: !!mine, view: G.viewFor(seated.game, seated.token) });
      }
      /* Joining a table somebody else opened, under the same retry as anywhere. */
      let token = null;
      const { game } = await M.mutateGame(db, seated.game.code, (g) => {
        if (g.status !== 'lobby' || g.seats.length >= g.config.seats) return false;
        token = G.joinGame(g, name, now).token;
        const seat = g.seats[g.seats.length - 1];
        seat.botOwner = owner;
        seat.companyId = mine ? mine.id : null;
        return true;
      });
      if (!token) return fail('That table filled up. Try again.', 409);
      return json({ code: game.code, token, ranked: !!mine,
                    view: G.viewFor(game, token) });
    }

    if (route === 'bot/board') {
      return json({
        board: L.board(await db.leagueResults()),
        format: { seats: L.FORMAT.seats, rounds: L.FORMAT.rounds,
                  roundSeconds: L.FORMAT.roundSeconds },
        window: L.WINDOW, minGames: L.MIN_GAMES,
        gamesPerHour: L.GAMES_PER_HOUR, startCash: L.START_CASH,
      });
    }

    /* ------------------------------------------------- being findable */
    /* A company pays to browse a pool of players, sees a company name and a
       record, and can send one thing: an invitation to apply. It never learns
       who anybody is. Nobody is in the pool who did not ask to be, nobody under
       eighteen is in it at all, and nobody appears on a record too thin to mean
       anything. The rules live in lib/talent.mjs and are enforced there rather
       than here, so a second route cannot forget one. */

    /* What a company would see about you — built by the same call that would
       build it for them, because a profile you cannot see is one you cannot
       correct. Answers whether or not you are opted in: knowing what would be
       shown is exactly what you need in order to decide. */
    if (route === 'talent/me') {
      const user = await requireUser(req, db, verify);
      const acct = await A.accountState(db, user.id);
      const mine = acct.companies[0] || null;
      const status = await T.statusOf(db, user.id);
      if (!mine) {
        return json({ status, company: null, minGames: T.MIN_GAMES,
          profile: { visible: false, games: 0, needs: T.MIN_GAMES,
                     why: 'A profile needs a company name.' } });
      }
      const rows = await db.resultsForCompany(mine.id);
      const p = T.profile(rows, { population: await population(),
                                  optIn: await db.talentOptIn(user.id) });
      /* A sibling of the profile, not part of it.

         The rule is that a company never sees anything the player is not also
         shown — one-directional, so the player may be shown more. A curve is
         somebody's own history with the game and is nobody else's business, so
         it lives outside `profile` and cannot travel with it by accident. */
      const progress = PR.curveFor(rows, { start: P.START_CASH });
      return json({ status, company: { id: mine.id, name: mine.name }, profile: p, progress,
                    minGames: T.MIN_GAMES, traitGames: T.TRAIT_GAMES,
                    /* Shown alongside, so nobody has to guess what an invitation
                       would look like before agreeing to receive one. */
                    example: p.visible ? T.invitation({
                      companyName: 'An employer', role: 'the role they are hiring for',
                      url: 'their application page', profile: p,
                    }) : null });
    }

    /* Does anybody get better at this?

       Public and anonymous — it is an aggregate over everybody and names
       nobody, and a claim about whether the game teaches anything should be
       checkable by the people being asked to believe it. It answers "not enough
       data yet" until there is, which for a while is the honest answer. */
    if (route === 'learning') {
      const rowsAll = await db.resultsForLearning();
      return json({ learning: PR.learning(rowsAll, { n: 5, start: P.START_CASH }) });
    }

    /* Is anything happening?

       Web analytics answers "did anybody arrive". This answers "did anybody
       play", which is a different question and the one that matters after you
       have shown the thing to somebody. Joining a game changes the URL without
       asking the server for a page, so no analytics product can see it; the
       games table can. */
    if (route === 'pulse') {
      const hours = Math.max(1, Math.min(168, Number(url.searchParams.get('hours')) || 24));
      const since = new Date(Date.parse(now) - hours * 3600000).toISOString();
      const [rowsIn, resultsIn] = await Promise.all([
        db.gamesSince(since), db.resultsSince(since),
      ]);
      return json({ pulse: pulse(rowsIn, resultsIn, { hours, now }) });
    }

    if (route === 'talent/optin' && req.method === 'POST') {
      const user = await requireUser(req, db, verify);
      await T.optIn(db, user.id, { adult: !!body.adult, openTo: body.openTo,
                                   region: body.region, now });
      return json({ status: await T.statusOf(db, user.id) });
    }

    if (route === 'talent/optout' && req.method === 'POST') {
      const user = await requireUser(req, db, verify);
      await T.optOut(db, user.id, now);
      return json({ status: await T.statusOf(db, user.id) });
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

      /* What happened, and what is worth talking about. The dashboard reads it
         live; the report and the deep export are the same computation. */
      if (action === 'analysis') {
        return json({ analysis: AN.analyse(cohort, await db.gamesOfCohort(cohort.id)) });
      }

      if (action === 'report') {
        const a = AN.analyse(cohort, await db.gamesOfCohort(cohort.id));
        const safe = cohort.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'class';
        return new Response(classReport(a), { status: 200, headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-disposition': `attachment; filename="${safe}-debrief.html"`,
          'cache-control': 'no-store',
        } });
      }

      if (action === 'rounds') {
        const csv = AN.roundsCsv(cohort, await db.gamesOfCohort(cohort.id));
        const safe = cohort.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'class';
        return new Response(csv, { status: 200, headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${safe}-rounds.csv"`,
          'cache-control': 'no-store',
        } });
      }

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
      /* A student is one of forty people with an instructor waiting. Tidy what
         they typed rather than refusing it — "Group 3 :)" becomes "Group 3" — so
         nobody is stuck at a validation message in front of the room. */
      const checked = A.checkName(body.name, { tidy: true });
      if (!checked.ok) return fail(checked.error);
      const joined = await CO.joinCohort(db, cohort, checked.name, now);
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
      const peek = await db.getGame(code);
      if (!peek) return fail('No game with that code.', 404);
      /* A public table cannot be joined by code, only by matchmaking.
         This is the rule the whole rated tier rests on: a rating is only worth
         something because nobody chooses who they sit with, and a code that can
         be passed to three friends is a code that can arrange the finishing
         order. It is also the difference somebody paid for — choosing who plays
         is what a private game is. Enforced here rather than by not showing the
         code, because a code that has been seen once has been seen. */
      if (peek.isPublic) {
        return fail('That is a public table — they are dealt by matchmaking and cannot '
          + 'be joined with a code. Use "Play now" to be seated at one, or host a '
          + 'private game to choose who plays.', 403);
      }
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
      /* Two friends taking the last seat at the same moment used to mean one of
         them silently did not get it. Now the second attempt re-reads and either
         seats them or tells them the game is full. */
      const { game: g2, result: t } = await M.mutateGame(db, code,
        (g) => G.joinGame(g, checked.name, now).token);
      return json({ code: g2.code, token: t, view: G.viewFor(g2, t) });
    }

    if (route === 'start' && req.method === 'POST') {
      const { game } = await M.mutateGame(db, code, (g) => { G.startGame(g, token, now); });
      return json({ view: G.viewFor(game, token) });
    }

    if (route === 'submit' && req.method === 'POST') {
      /* The one that was losing orders. Everything inside runs again from scratch
         if somebody else filed first, against their state rather than ours — which
         is why re-applying is correct rather than merely convenient. */
      let closed = false;
      const { game } = await M.mutateGame(db, code, async (g) => {
        closed = false;
        await settle(db, g, now);
        if (g.status !== 'playing') { closed = true; return false; }
        G.submitDecisions(g, token, body.decisions || {});
        /* Filing may be the last one outstanding, in which case the round closes
           now rather than waiting for a clock nobody is watching. */
        await settle(db, g, now);
        return true;
      });
      if (closed) return fail('That round has already closed.', 409);
      return json({ view: G.viewFor(game, token) });
    }

    /* Everything this person has on the go at once.
       One purchased name plays a daily game with friends, a class, and a ranked
       table on a five-minute clock, all in the same week — so the question that
       matters is not "which game am I in" but "which of them is waiting for me".
       The browser holds the seat tokens; this turns them into a state of play.
       A token that does not match a seat is simply left out. */
    if (route === 'mine' && req.method === 'POST') {
      const want = Array.isArray(body.games) ? body.games.slice(0, 12) : [];
      const out = [];
      for (const w of want) {
        const game = await db.getGame(String(w.code || '').toUpperCase());
        if (!game) continue;
        const seat = G.seatByToken(game, w.token);
        if (!seat) continue;
        const over = game.status === 'over';
        /* Only once there are companies to value. A game still in its lobby has
           seats with no firm behind them, and asking what they are worth threw —
           which took the whole list down to its fallback and quietly lost the
           "your move" column, in exactly the situation the list exists for. */
        const ranked = over
          ? game.seats.slice().sort((a, b) => G.finalValue(b) - G.finalValue(a))
          : [];
        out.push({
          code: game.code, name: seat.name,
          isPublic: !!game.isPublic, cohort: game.cohortName || null,
          status: game.status, round: game.round, totalRounds: game.config.rounds,
          deadline: game.status === 'lobby' ? game.lobbyDeadline : game.deadline,
          cadenceMinutes: game.config.cadenceMinutes,
          cadenceLabel: G.cadenceOf(game).label,
          seats: game.seats.length,
          filed: game.status === 'playing' ? seat.submittedRound === game.round : null,
          autoRounds: seat.autoRounds || 0,
          out: !!(seat.firm && seat.firm.bankrupt),
          value: game.status === 'lobby' || !seat.firm ? null : Math.round(G.finalValue(seat)),
          place: over ? ranked.findIndex((s) => s.id === seat.id) + 1 : null,
        });
      }
      /* Whatever is waiting for you first, then whatever ends soonest. */
      const rank = (g) => (g.status === 'playing' && !g.filed ? 0
        : g.status === 'playing' ? 1 : g.status === 'lobby' ? 2 : 3);
      out.sort((a, b) => rank(a) - rank(b)
        || Date.parse(a.deadline || 0) - Date.parse(b.deadline || 0));
      return json({ games: out });
    }

    if (route === 'state') {
      const peek = await db.getGame(code);
      if (!peek) return fail('No game with that code.', 404);
      /* A private game can be watched by anyone holding its code — a game with
         friends has spectators, and the view already hides everything private.
         A public table cannot. It is the rated tier, and a code that lets you
         watch is a code that lets you coach; the only people it shows anything to
         are the ones sitting at it. */
      if (peek.isPublic && !G.seatByToken(peek, token)) {
        return fail('A ranked table is only visible to the people playing it.', 403);
      }
      const { game } = await settled(db, code, now);
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
    if (/is_demo|demo_token|bot_keys|talent_optin|schema cache|column .* does not exist|relation .* does not exist/i.test(msg)) {
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
