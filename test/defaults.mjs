/* What the game hands a player who has not worked anything out yet.

   This is not a test of a feature. It is a test of the opening position, which
   nobody chooses and everybody starts from — including anyone carried by standing
   orders after missing a deadline.

   It exists because the shipped default for advertising was zero, and zero is
   close to the worst number on the dial. A beginner filing the defaults won 5% of
   games against a 20% baseline and lost money in 82% of them. The entire gap
   between a beginner and a competent player was one lever the game itself had set
   to nothing, which reads as "this game is too hard" and is not. */

import assert from 'node:assert';
import * as G from '../lib/game.mjs';
import * as P from '../lib/public.mjs';

const START = P.START_CASH;
const at = (ms) => new Date(ms).toISOString();
const M = (x) => (x < 0 ? '-$' : '$') + Math.abs(Math.round(x)).toLocaleString('en-US');
const N = 60;

/* Play the public format, filing a fixed set of orders every round. */
function playAs(ads) {
  const values = [];
  let wins = 0;
  for (let s = 0; s < N; s++) {
    const t0 = Date.parse('2026-09-01T09:00:00Z');
    const { game } = G.createGame({ ...P.FORMAT, hostName: 'Me', seed: 5000 + s, now: at(t0) });
    G.startGame(game, game.hostToken, at(t0));
    const seat = game.seats.find((x) => !x.isBot);
    let r = 0;
    while (game.status === 'playing') {
      const v = G.viewFor(game, seat.token);
      if (v.you && v.you.products.length && !v.you.bankrupt) {
        const products = {};
        for (const p of v.you.products) {
          products[p.name] = {
            price: Math.round(p.value),
            produce: Math.max(0, Math.min(p.lastDemand || 1300, p.effCapacity) - p.inventory),
            rd: 30000, rdProcess: 10000,
            advertising: ads === null ? G.DEFAULT_ADVERTISING : ads,
            targetCapacity: Math.round(p.capacity), discontinue: false,
          };
        }
        try { G.submitDecisions(game, seat.token, { products, launch: false }); } catch {}
      }
      G.resolveRound(game, at(t0 + (++r) * 5 * 60000));
    }
    const ranked = game.seats.slice().sort((a, b) => G.finalValue(b) - G.finalValue(a));
    if (ranked.indexOf(seat) === 0) wins += 1;
    values.push(G.finalValue(seat));
  }
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    wins: wins / N,
    inProfit: values.filter((v) => v > START).length / N,
    median: sorted[Math.floor(sorted.length / 2)],
  };
}

const chance = 1 / P.FORMAT.seats;
console.log(`${P.FORMAT.seats} seats, so finishing first by chance alone is ` +
            `${(chance * 100).toFixed(0)}%.\n`);
console.log('advertising        won   in profit   median made');
const zero = playAs(0);
const shipped = playAs(null);
for (const [label, r] of [['nothing (the old default)', zero],
                          [`${M(G.DEFAULT_ADVERTISING)} (what ships now)`, shipped]]) {
  console.log(`${label.padEnd(26)} ${(r.wins * 100).toFixed(0).padStart(3)}%   ` +
              `${(r.inProfit * 100).toFixed(0).padStart(7)}%   ${M(r.median - START).padStart(11)}`);
}

/* The opening position must not be a losing one. */
assert(G.DEFAULT_ADVERTISING > 0, 'the game must not open with the lever at zero');
assert(shipped.wins > zero.wins * 2,
  `the shipped default should not be near-unplayable: ${(zero.wins * 100).toFixed(0)}% ` +
  `→ ${(shipped.wins * 100).toFixed(0)}%`);
assert(shipped.wins > chance * 0.9,
  `somebody filing the defaults should finish about as often as chance, got ` +
  `${(shipped.wins * 100).toFixed(0)}% against ${(chance * 100).toFixed(0)}%`);
assert(shipped.inProfit > 0.4,
  `and should usually build a company worth more than it started with, got ` +
  `${(shipped.inProfit * 100).toFixed(0)}%`);
console.log(`\nfiling the defaults now finishes first ${(shipped.wins * 100).toFixed(0)}% of the ` +
            `time against a ${(chance * 100).toFixed(0)}% baseline, and is in profit ` +
            `${(shipped.inProfit * 100).toFixed(0)}% of the time`);

/* But it must not be the best play either, or there is nothing left to decide. */
const tuned = playAs(6000);
const heavy = playAs(20000);
console.log(`tuned to ${M(6000)}: ${(tuned.wins * 100).toFixed(0)}% · ` +
            `overspending at ${M(20000)}: ${(heavy.wins * 100).toFixed(0)}%`);
assert(heavy.wins < shipped.wins,
  'spending far too much must still be punished, or the lever is not a decision');

/* And the standing orders a missed deadline files must be the same sane thing. */
const { game } = G.createGame({ ...P.FORMAT, hostName: 'Absent', seed: 77,
                                now: at(Date.parse('2026-09-01T09:00:00Z')) });
G.startGame(game, game.hostToken, at(Date.parse('2026-09-01T09:00:00Z')));
G.resolveRound(game, at(Date.parse('2026-09-01T09:06:00Z')));
const carried = game.history[0].results.find((r) => r.name === 'Absent');
console.log(`\na player who filed nothing at all was carried with ` +
            `${M(carried.advertising)} of advertising`);
assert.equal(carried.advertising, G.DEFAULT_ADVERTISING,
  'standing orders must carry the same sane default, not the old zero');

console.log('\ndefaults OK');
