/* The backstop.

   Rounds normally close when the next player opens the page after the deadline —
   that keeps the game moving without depending on a schedule. But a game where
   everyone has lost interest for a day would otherwise sit frozen, so this sweeps
   hourly and closes anything overdue. It is idempotent: shouldResolve is false
   for a game that has already been settled. */

import { getStore } from '@netlify/blobs';
import * as G from '../../lib/game.mjs';

const STORE = 'ceo-games';
const store = () => getStore({ name: STORE, consistency: 'strong' });

export default async () => {
  const now = new Date().toISOString();
  const { blobs } = await store().list({ prefix: 'game/' });
  let closed = 0, scanned = 0, finished = 0;

  for (const b of blobs) {
    let game;
    try {
      game = await store().get(b.key, { type: 'json' });
    } catch { continue; }
    if (!game || game.status !== 'playing') continue;
    scanned += 1;
    let changed = false;
    while (game.status === 'playing' && G.shouldResolve(game, now)) {
      G.resolveRound(game, now);
      closed += 1;
      changed = true;
    }
    if (game.status === 'over') finished += 1;
    if (changed) await store().setJSON(b.key, game);
  }
  console.log(`tick: ${scanned} live games, ${closed} rounds closed, ${finished} finished`);
};

export const config = { schedule: '@hourly' };
