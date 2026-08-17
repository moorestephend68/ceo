/* The backstop.

   Rounds normally close when the next player opens the page — that keeps the
   game moving without depending on a schedule. This sweeps for games everyone
   has walked away from, and releases company-name holds abandoned in checkout.

   On Postgres the whole due-marker scheme from the blob backend is unnecessary:
   "which games are overdue" is one indexed query. */

import * as G from '../../lib/game.mjs';
import { getDb } from '../../lib/runtime.mjs';

export default async () => {
  const now = new Date().toISOString();
  const db = getDb();

  const due = await db.dueGames(now);
  let closed = 0;
  for (const game of due) {
    let changed = false;
    while (game.status === 'playing' && G.shouldResolve(game, now)) {
      G.resolveRound(game, now);
      closed += 1;
      changed = true;
    }
    if (changed) await db.putGame(game);
  }

  /* Names held by someone who never finished paying go back on the market. */
  const freed = await db.releaseExpiredHolds(now);

  console.log(`tick: ${due.length} overdue, ${closed} rounds closed, ${freed} name holds released`);
};

export const config = { schedule: '*/5 * * * *' };
