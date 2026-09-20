/* The backstop.

   WHICH GAME IS THIS. Everything below goes through kindOf() rather than
   calling CEO's functions directly. It did call them directly, because it was
   written when there was one game, and the result was that a Cargo Run table
   whose lobby wait ran out had its empty seats filled with COMPANIES — seats
   with a balance sheet and no ship. The table then threw on every request
   afterwards. One unguarded door is all it takes; this is that door.

   Rounds normally close when the next player opens the page — that keeps the
   game moving without depending on a schedule. This sweeps for games everyone
   has walked away from, and releases company-name holds abandoned in checkout.

   On Postgres the whole due-marker scheme from the blob backend is unnecessary:
   "which games are overdue" is one indexed query. */

import * as P from '../../lib/public.mjs';
import { kindOf } from '../../lib/kinds.mjs';
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
      const kind = kindOf(game);
      if (!kind.shouldStart(game, now)) return false;
      kind.startPublic(game, now);
    }).catch(() => {});
  }

  const due = await db.dueGames(now);
  let closed = 0, rated = 0;
  for (const stale of due) {
    await mutateGame(db, stale.code, async (game) => {
      const kind = kindOf(game);
      let changed = kind.resolveWhileDue(game, now);
      if (changed) closed += 1;
      /* Rating is CEO's, and a row with no kind is CEO — the same guard the
         API uses, rather than a second opinion about who gets rated. */
      if (game.status === 'over' && !game.kind
          && (game.isPublic || game.league === 'bot') && !game.scored) {
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
              `${closed} games advanced, ${rated} games rated, ${freed} name holds released, ` +
              `${demos} demo classes swept`);
};

export const config = { schedule: '*/5 * * * *' };
