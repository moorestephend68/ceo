/* WHICH GAME IS THIS?

   The lobby, the join codes, the public matchmaking, the bot fill, the tick
   sweep and the read-apply-retry writer are all game-agnostic — they move a
   row through lobby → playing → over and know nothing about companies or
   cargo. Everything that IS specific lives behind this table.

   A row with no `kind` is CEO. That is not laziness: every game already stored
   was written before this file existed, and a migration that rewrites live
   rows to add a field they do not need is a migration that can go wrong at
   three in the morning for no benefit. Absent means CEO, forever.

   The contract a kind has to satisfy is small, and deliberately so:

     resolveWhileDue(game, now)  bring a running game up to date in place,
                                 returning true if anything changed
     viewFor(game, token)        what one seat is allowed to see
     seatByToken(game, token)    find a seat
     label                       what to call it to a person

   Anything a kind does NOT implement stays with its own module. This file
   exists to keep `if (game.kind === ...)` out of the route handlers, not to
   pretend two different games are the same game. */

import * as G from './game.mjs';
import * as K from './cargo.mjs';
import * as P from './public.mjs';

/* A lobby carrying a deadline starts itself: a public table when its wait runs
   out, and a private one opened by a latecomer. The rule is the same for both
   games — full, or out of time — so it lives here once. */
const shouldStart = (game, now) => {
  if (!game || game.status !== 'lobby') return false;
  if (game.paused) return false;
  if (!game.lobbyDeadline) return false;      // a private lobby waits for its host
  if (game.seats.length >= game.config.seats) return true;
  return Date.parse(now || Date.now()) >= Date.parse(game.lobbyDeadline);
};

export const CEO = {
  kind: 'ceo',
  label: 'CEO',
  seatByToken: G.seatByToken,
  viewFor: G.viewFor,
  shouldStart,
  startPublic: (game, now) => P.startPublic(game, now),
  resolveWhileDue(game, now) {
    let changed = false;
    while (game.status === 'playing' && G.shouldResolve(game, now)) {
      G.resolveRound(game, now);
      changed = true;
    }
    return changed;
  },
};

export const CARGO = {
  kind: 'cargo',
  label: 'Cargo Run',
  seatByToken: K.seatByToken,
  viewFor: K.viewFor,
  shouldStart,
  /* the table's own host token was never handed to anybody, so passing it is
     the point rather than a workaround */
  startPublic: (game, now) => { K.startGame(game, game.hostToken, now);
    game.lobbyDeadline = null; return game; },
  /* A cargo round is two stages, so "resolve while due" may run twice in one
     request: the declare window closing publishes the manifests, and the route
     window closing settles the run and then the yard. The loop is the same
     shape either way, which is the point of putting it here. */
  resolveWhileDue(game, now) {
    /* A table the old sweep started with CEO's code is put right before
       anything else touches it — see cargo.mjs repair(). */
    let changed = K.repair(game, now);
    let guard = 0;
    while (game.status === 'playing' && K.shouldResolve(game, now) && guard++ < 64) {
      K.resolveStage(game, now);
      changed = true;
      /* A stage that closes because everybody had already filed would otherwise
         cascade through the whole season in one request: the next stage has
         nobody outstanding either until somebody files. Stop as soon as the new
         stage is waiting on a human. */
      if (K.humansOutstanding(game).length > 0 && !K.shouldResolve(game, now)) break;
    }
    return changed;
  },
};

const TABLE = { ceo: CEO, cargo: CARGO };

/* The only place that decides. Absent kind means CEO — see the note above. */
export const kindOf = (game) => TABLE[(game && game.kind) || 'ceo'] || CEO;
