/* The backstop.

   Rounds normally close when the next player opens the page — that keeps the
   game moving without depending on a schedule. This sweeps for games everyone
   has walked away from, and releases company-name holds abandoned in checkout.

   On Postgres the whole due-marker scheme from the blob backend is unnecessary:
   "which games are overdue" is one indexed query. */

import * as G from '../../lib/game.mjs';
import * as P from '../../lib/public.mjs';
import { getDb } from '../../lib/runtime.mjs';
import { mutateGame } from '../../lib/mutate.mjs';

export default async () => {
  const now = new Date().toISOString();
  const db = getDb();

  /* Public tables whose wait has run out start with bots filling the rest,
     so a lobby nobody else joined still becomes a game. */
  const lobbies = await db.dueLobbies(now);
  for (const stale of lobbies) {
    /* Somebody may be joining this very table as the sweep runs, so the same
       read-apply-retry as everywhere else rather than a blind overwrite. */
    await mutateGame(db, stale.code, (game) => {
      if (!P.shouldStart(game, now)) return false;
      P.startPublic(game, now);
    }).catch(() => {});
  }

  const due = await db.dueGames(now);
  let closed = 0, rated = 0;
  for (const stale of due) {
    await mutateGame(db, stale.code, async (game) => {
      let changed = false;
      while (game.status === 'playing' && G.shouldResolve(game, now)) {
        G.resolveRound(game, now);
        closed += 1;
        changed = true;
      }
      if (game.status === 'over' && (game.isPublic || game.league === 'bot') && !game.scored) {
        const out = await P.scoreGame(db, game);
        if (out.scored) rated += 1;
        changed = true;
      }
      return changed || false;
    }).catch(() => {});
  }

  /* Names held by someone who never finished paying go back on the market. */
  const freed = await db.releaseExpiredHolds(now);

  /* Demo classes are opened by strangers evaluating the thing and abandoned a
     few minutes later. Each one is six games, so they are swept rather than
     kept. */
  const demos = db.purgeExpiredDemos ? await db.purgeExpiredDemos(now) : 0;

  console.log(`tick: ${lobbies.length} lobbies started, ${due.length} overdue, ` +
              `${closed} rounds closed, ${rated} games rated, ${freed} name holds released, ` +
              `${demos} demo classes swept`);
};

export const config = { schedule: '*/5 * * * *' };
