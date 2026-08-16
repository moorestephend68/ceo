/* CEO live sessions — the whole API surface.

   Thin on purpose: every rule lives in lib/game.mjs, which is tested without a
   network. This file does storage, routing and error shapes and nothing else. */

import { getStore } from '@netlify/blobs';
import * as G from '../../lib/game.mjs';

const STORE = 'ceo-games';
const key = (code) => `game/${String(code).toUpperCase()}`;

/* Strong consistency: a player reloading immediately after filing must see that
   they filed. Eventual consistency would show them a stale "not filed yet" for up
   to a minute and they would file twice. */
const store = () => getStore({ name: STORE, consistency: 'strong' });

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json',
                       'cache-control': 'no-store' },
  });

const fail = (message, status = 400) => json({ error: message }, status);

async function load(code) {
  if (!code) return null;
  return (await store().get(key(code), { type: 'json' })) || null;
}

const save = (game) => store().setJSON(key(game.code), game);

/* Rounds close on their own. Rather than relying only on the scheduled function,
   every request that touches a game first asks whether its clock has run out —
   so the first player to open the page after the deadline triggers the round.
   The schedule is the backstop, not the mechanism. */
async function settle(game, now) {
  let changed = false;
  while (game.status === 'playing' && G.shouldResolve(game, now)) {
    G.resolveRound(game, now);
    changed = true;
  }
  if (changed) await save(game);
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

  try {
    if (route === 'config') {
      return json({ presets: G.PRESETS, limits: G.LIMITS, cadences: G.CADENCES });
    }

    if (route === 'create' && req.method === 'POST') {
      if (!String(body.hostName || '').trim()) return fail('Your company needs a name.');
      /* Codes are short enough to read aloud, so check for a collision. */
      let made = null;
      for (let i = 0; i < 5; i++) {
        made = G.createGame({ ...body, now });
        if (!(await load(made.game.code))) break;
        made = null;
      }
      if (!made) return fail('Could not allocate a game code. Try again.', 503);
      await save(made.game);
      return json({ code: made.game.code, token: made.token,
                    view: G.viewFor(made.game, made.token) });
    }

    if (route === 'join' && req.method === 'POST') {
      const game = await load(code);
      if (!game) return fail('No game with that code.', 404);
      if (!String(body.name || '').trim()) return fail('Your company needs a name.');
      const { token: t } = G.joinGame(game, body.name, now);
      await save(game);
      return json({ code: game.code, token: t, view: G.viewFor(game, t) });
    }

    if (route === 'start' && req.method === 'POST') {
      const game = await load(code);
      if (!game) return fail('No game with that code.', 404);
      G.startGame(game, token, now);
      await save(game);
      return json({ view: G.viewFor(game, token) });
    }

    if (route === 'submit' && req.method === 'POST') {
      const game = await load(code);
      if (!game) return fail('No game with that code.', 404);
      await settle(game, now);
      if (game.status !== 'playing') return fail('That round has already closed.', 409);
      G.submitDecisions(game, token, body.decisions || {});
      /* Filing may be the last one outstanding, in which case the round closes
         now rather than waiting for a clock nobody is watching. */
      await settle(game, now);
      await save(game);
      return json({ view: G.viewFor(game, token) });
    }

    if (route === 'state') {
      const game = await load(code);
      if (!game) return fail('No game with that code.', 404);
      await settle(game, now);
      return json({ view: G.viewFor(game, token) });
    }

    return fail('Unknown request.', 404);
  } catch (err) {
    /* Rule violations from lib/game.mjs are messages meant for a player. */
    return fail(err && err.message ? err.message : 'Something went wrong.', 400);
  }
};

export const config = { path: '/api/*' };
