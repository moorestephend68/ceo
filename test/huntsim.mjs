/* DOES THE SHIPPED ENGINE STILL REWARD JUDGEMENT?
   Four instincts sharing one hunt, assigned round-robin, so every style faces
   the others. If this does not reproduce market.mjs the engine is not the
   thing that was measured. */
import * as H from '../lib/hunt.mjs';
const POL = [
  { trade: 'judge',     travel: 'avoider'  },
  { trade: 'collector', travel: 'follower' },
  { trade: 'naive',     travel: 'drifter'  },
  { trade: 'hoarder',   travel: 'avoider'  },
];
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const S = Number(process.argv[2] || process.env.GAMES || 60);
const FIELD = Number(process.env.FIELD || 24);

const wins = {}, seats = {}, got = {};
for (const p of POL) { wins[p.trade] = 0; seats[p.trade] = 0; got[p.trade] = 0; }
let won = 0; const days = [];

for (let s = 1; s <= S; s++) {
  const now = '2026-10-16T10:00:00Z';
  const { game } = H.createGame({ seats: FIELD, hostName: 'Seat 0', seed: s, now });
  for (let i = 1; i < FIELD; i++) H.joinGame(game, 'Seat ' + i, now);
  H.startGame(game, game.hostToken, now);
  game.seats.forEach((x, i) => { const k = POL[i % POL.length];
    x.isBot = true; x.trade = k.trade; x.travel = k.travel; });
  let t = Date.parse(now), guard = 0;
  while (game.status === 'playing' && guard++ < 2000) {
    t += 61 * 60000; H.resolveWhileDue(game, new Date(t).toISOString());
  }
  for (const x of game.seats) { seats[x.trade]++; got[x.trade] += x.got; }
  if (game.winner !== null && game.winner !== undefined) {
    won++; days.push(game.day);
    wins[game.seats[game.winner].trade]++;
  }
}
console.log(`\n  ${S} hunts, field of ${FIELD}, four instincts each. Chance is 25%.\n`);
console.log('  ' + 'instinct'.padEnd(12) + 'hunts won'.padStart(11) + 'win rate'.padStart(10)
  + 'items received'.padStart(16));
for (const p of POL)
  console.log('  ' + p.trade.padEnd(12) + String(wins[p.trade]).padStart(11)
    + ((100 * wins[p.trade] / Math.max(won, 1)).toFixed(1) + '%').padStart(10)
    + (got[p.trade] / seats[p.trade]).toFixed(1).padStart(16));
console.log(`\n  ${won}/${S} hunts produced a winner, median day ${days.length ? med(days) : '—'}`);
console.log('  market.mjs said: collector 57% / reader 42% / naive 1% / hoarder 0%, day 21');
