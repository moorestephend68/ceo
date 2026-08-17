/* The clock, at both ends of its range.

   A five-minute round and a daily round are the same game with a different
   deadline, so the thing worth testing is that nothing about resolution depends
   on which one it is: rounds still close early when everyone files, standing
   orders still fire when the clock beats them, and a fast game does not quietly
   give itself a daily deadline. */

import assert from 'node:assert';
import * as G from '../lib/game.mjs';

const MIN = 60000;
const at = (ms) => new Date(ms).toISOString();

console.log('cadence   first round   later rounds   a 20-round game lasts');
for (const [id, c] of Object.entries(G.CADENCES)) {
  const t0 = Date.parse('2026-09-01T09:00:00Z');
  const { game, token } = G.createGame({
    hostName: 'H', seats: 3, rounds: 20, cadence: id, closeHour: 18,
    seed: 99, now: at(t0),
  });
  assert.equal(game.config.rounds, 20, '20 rounds was refused');
  G.startGame(game, token, at(t0));
  const first = (Date.parse(game.deadline) - t0) / MIN;

  /* let the first round time out, then look at the next deadline */
  const t1 = Date.parse(game.deadline) + MIN;
  G.resolveRound(game, at(t1));
  const later = (Date.parse(game.deadline) - t1) / MIN;

  const total = c.minutes * 20;
  const human = total >= 1440 ? `${(total / 1440).toFixed(0)} days`
    : total >= 60 ? `${(total / 60).toFixed(0)} hours` : `${total} minutes`;
  console.log('  ' + id.padEnd(6) + String(Math.round(first)).padStart(8) + 'm' +
              String(Math.round(later)).padStart(14) + 'm' + human.padStart(20));

  /* a fast game must never inherit the daily anchor */
  if (c.minutes < 1440) {
    assert(later <= c.minutes + 0.001, `${id} drifted to ${later}m, expected ${c.minutes}m`);
    assert(first >= c.minutes, `${id} gave the first round less than a full round`);
  } else {
    assert(later >= 6 * 60, 'a daily game gave less than six hours');
  }
}

/* --- the two ways a round can close, at five minutes ---------------------- */
const t0 = Date.parse('2026-09-01T09:00:00Z');
const { game, token } = G.createGame({
  hostName: 'Ravensworth', seats: 3, rounds: 20, cadence: '5m', seed: 7, now: at(t0),
});
const { token: friend } = G.joinGame(game, 'Sableworth Ltd', at(t0));
G.startGame(game, token, at(t0));

const file = (tok) => {
  const v = G.viewFor(game, tok);
  if (!v.you || !v.you.products.length || v.you.bankrupt) return false;
  const products = {};
  for (const p of v.you.products) {
    products[p.name] = { price: Math.round(p.value * 0.98),
      produce: Math.max(0, Math.min(p.lastDemand || 1300, p.effCapacity) - p.inventory),
      rd: 30000, rdProcess: 10000, advertising: 5000,
      targetCapacity: p.capacity, discontinue: false };
  }
  G.submitDecisions(game, tok, { products, launch: false });
  return true;
};

let t = t0, early = 0, timedOut = 0, autos = 0;
while (game.status === 'playing') {
  file(token);
  /* the friend files on odd rounds only, so both paths get exercised */
  const both = game.round % 2 === 0;
  if (both) file(friend);
  if (G.humansOutstanding(game).length === 0) { early += 1; t += 30000; }
  else { timedOut += 1; t = Date.parse(game.deadline) + 1000; }
  assert(G.shouldResolve(game, at(t)), `round ${game.round + 1} was not ready`);
  G.resolveRound(game, at(t));
  autos += game.history[game.history.length - 1].results.filter((r) => r.auto).length;
}

console.log(`\nA 20-round game at 5 minutes:`);
console.log(`  rounds played: ${game.round}`);
console.log(`  closed early because everyone filed: ${early}`);
console.log(`  closed on the clock: ${timedOut}`);
console.log(`  orders filed automatically by standing order: ${autos}`);
console.log(`  wall-clock elapsed: ${Math.round((t - t0) / MIN)} minutes`);
assert.equal(game.round, 20, 'the 20-round game did not run its length');
assert(early > 0 && timedOut > 0, 'only one of the two closing paths was exercised');
assert(autos > 0, 'standing orders never fired at speed');
assert((t - t0) / MIN < 20 * 6, 'a five-minute game took longer than five minutes a round');

console.log('\ncadence OK');
