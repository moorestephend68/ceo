/* The backstop.

   Rounds normally close when the next player opens the page after the deadline —
   that keeps the game moving without depending on a schedule. But a game where
   everyone has lost interest for a day would otherwise sit frozen, so this sweeps
   often and closes anything overdue. It is idempotent: shouldResolve is false for
   a game that has already been settled.

   Every five minutes rather than hourly, because a game can now run a round every
   five minutes — an hourly backstop would leave a fast game frozen for most of an
   hour if everyone closed their tab mid-round.

   It reads one list of due-markers rather than every game on the site, so its cost
   scales with how many rounds are actually overdue, not with how many games have
   ever been played. See lib/schedule.mjs. */

import { getStore } from '@netlify/blobs';
import * as G from '../../lib/game.mjs';
import { dueCodes, syncMarker } from '../../lib/schedule.mjs';

const STORE = 'ceo-games';
const store = () => getStore({ name: STORE, consistency: 'strong' });

export default async () => {
  const now = new Date().toISOString();
  const s = store();
  const due = await dueCodes(s, now);
  let closed = 0, gone = 0;

  for (const { code, key } of due) {
    let game;
    try {
      game = await s.get(`game/${code}`, { type: 'json' });
    } catch { continue; }
    if (!game) {
      /* the marker outlived its game — tidy it away */
      await s.delete(key).catch(() => {});
      gone += 1;
      continue;
    }
    let changed = false;
    while (game.status === 'playing' && G.shouldResolve(game, now)) {
      G.resolveRound(game, now);
      closed += 1;
      changed = true;
    }
    if (changed) {
      await syncMarker(s, game);
      await s.setJSON(`game/${code}`, game);
    } else {
      /* not actually due after all — re-point the marker at the real deadline */
      await syncMarker(s, game);
    }
  }

  console.log(`tick: ${due.length} overdue, ${closed} rounds closed, ${gone} stale markers`);
};

export const config = { schedule: '*/5 * * * *' };
