/* The backstop.

   Rounds normally close when the next player opens the page — that keeps the
   game moving without depending on a schedule. This sweeps for games everyone
   has walked away from, and releases company-name holds abandoned in checkout.

   On Postgres the whole due-marker scheme from the blob backend is unnecessary:
   "which games are overdue" is one indexed query. */

import * as G from '../../lib/game.mjs';
import * as P from '../../lib/public.mjs';
import { getDb } from '../../lib/runtime.mjs';

export default async () => {
  const now = new Date().toISOString();
  const db = getDb();

  /* Public tables whose wait has run out start with bots filling the rest,
     so a lobby nobody else joined still becomes a game. */
  const lobbies = await db.dueLobbies(now);
  for (const game of lobbies) {
    if (!P.shouldStart(game, now)) continue;
    P.startPublic(game, now);
    await db.putGame(game);
  }

  const due = await db.dueGames(now);
  let closed = 0, rated = 0;
  for (const game of due) {
    let changed = false;
    while (game.status === 'playing' && G.shouldResolve(game, now)) {
      G.resolveRound(game, now);
      closed += 1;
      changed = true;
    }
    if (game.status === 'over' && game.isPublic && !game.scored) {
      const out = await P.scoreGame(db, game);
      if (out.scored) rated += 1;
      changed = true;
    }
    if (changed) await db.putGame(game);
  }

  /* Names held by someone who never finished paying go back on the market. */
  const freed = await db.releaseExpiredHolds(now);

  console.log(`tick: ${lobbies.length} lobbies started, ${due.length} overdue, ` +
              `${closed} rounds closed, ${rated} games rated, ${freed} name holds released`);
};

export const config = { schedule: '*/5 * * * *' };
