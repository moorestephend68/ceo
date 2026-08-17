/* CEO live sessions — the whole API surface.

   Thin on purpose: every rule lives in lib/, which is tested without a network.
   This file does routing, auth and error shapes and nothing else. */

import * as G from '../../lib/game.mjs';
import * as A from '../../lib/accounts.mjs';
import * as B from '../../lib/billing.mjs';
import { requireUser, userFrom } from '../../lib/auth.mjs';
import { getDb, getVerifier, publicAuthConfig } from '../../lib/runtime.mjs';

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
  while (game.status === 'playing' && G.shouldResolve(game, now)) {
    G.resolveRound(game, now);
    changed = true;
  }
  if (changed) await db.putGame(game);
  return game;
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  const now = new Date().toISOString();
  const db = getDb();
  const verify = getVerifier();

  let body = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { body = {}; }
  }
  const code = (body.code || url.searchParams.get('code') || '').toUpperCase();
  const token = body.token || url.searchParams.get('token') || '';

  try {
    /* ------------------------------------------------------------ public */
    if (route === 'config') {
      return json({
        presets: G.PRESETS, limits: G.LIMITS, cadences: G.CADENCES,
        auth: publicAuthConfig(),
        products: Object.fromEntries(Object.entries(B.PRODUCTS).map(([k, p]) => [k, {
          label: p.label, blurb: p.blurb, forSale: !!process.env[p.envPrice],
        }])),
        nameRules: { min: A.NAME.min, max: A.NAME.max },
      });
    }

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
    const status = /sign in|please sign/i.test(msg) ? 401
      : /charter|licence/i.test(msg) ? 402
      : 400;
    return fail(msg, status);
  }
};

export const config = { path: '/api/*' };
