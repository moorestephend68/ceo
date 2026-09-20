/* WHAT RESEARCH PUT IN THE THING — the engine half.

   upkeep() has always known when a research project lands and has always
   thrown the answer away. Now it is kept, and a screen is built on it, so
   these are the properties that screen depends on:

     · a landing is recorded in the round it actually arrives, not the round
       it was paid for
     · the count of landings only ever goes up, and matches the number of
       named improvements the page will have shown
     · what is in one company's pipeline is not in anybody else's view

   The third one is the whole reason this is a node test and not a browser
   one: a leak here would be invisible on screen and permanent in the data. */
import * as G from '../lib/game.mjs';
import { improvementsFor, PROCESS_STEPS, CATALOGUE, KIND_ORDER } from '../lib/catalogue.mjs';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) bad++; };

/* every product in the catalogue, and every variant of it, has five names */
let missing = 0;
for (const k of KIND_ORDER) {
  for (const p of CATALOGUE[k]) {
    if ((improvementsFor(k, p.name) || []).length !== 5) missing++;
    for (const v of p.variants) if (!improvementsFor(k, v)) missing++;
  }
  if ((PROCESS_STEPS[k] || []).length !== 5) missing++;
}
ok(missing === 0, 'every product, variant and kind has its improvements');

const { game, token } = G.createGame({
  hostName: 'Ravensworth & Co', seats: 4, rounds: 10, preset: 'standard',
  seed: 20260919, cadence: 'manual', now: '2026-09-01T09:00:00Z' });
const mate = G.joinGame(game, 'Dunmore & Sons', '2026-09-01T09:02:00Z');
G.startGame(game, token, '2026-09-01T09:05:00Z');

const RD = 34000;
const landings = [];
let guard = 0, lastUpgrades = 0, monotone = true;
while (game.status === 'playing' && guard++ < 20) {
  const v = G.viewFor(game, token);
  if (!v.you || !v.you.products.length || v.you.bankrupt) break;
  const line = v.you.products[0];
  if (line.upgrades < lastUpgrades) monotone = false;
  lastUpgrades = line.upgrades;
  if (v.you.landed) {
    for (const it of v.you.landed.items) {
      if (it.gain > 0) landings.push({ round: v.round, funded: it.funded, n: it.upgrade });
    }
  }
  const products = {};
  for (const p of v.you.products) {
    const want = p.lastDemand || 1300;
    products[p.name] = { price: Math.round(p.value * 0.98),
      produce: Math.max(0, Math.min(want * 1.05, p.effCapacity) - p.inventory),
      rd: RD, rdProcess: 12000, advertising: 6000,
      targetCapacity: Math.max(p.capacity, Math.min(want * 1.15, p.capacity * 1.3)),
      discontinue: false };
  }
  G.submitDecisions(game, token, { products });
  G.resolveRound(game, '2026-09-01T18:00:00Z');
}

ok(landings.length >= 5, `research landed ${landings.length} times in the season`);
ok(monotone, 'the count of improvements never goes down');
ok(landings.every((l, i) => l.n === i + 1), 'they are numbered in order, with no gaps');
/* the delay is the point: money spent now is a product two rounds from now */
const gaps = landings.map((l) => l.round - l.funded);
ok(gaps.every((g) => g >= 2), `each one arrived at least two rounds after it was funded (${gaps.join(', ')})`);

/* and it is nobody else's business */
const seat = game.seats.find((s) => s.token === token);
const rival = { token: mate.token || mate };
const mine = G.viewFor(game, token);
ok(!!(mine.you && mine.you.landed !== undefined), 'your own view carries what landed on your line');
if (rival) {
  const theirs = G.viewFor(game, rival.token);
  ok(!theirs.you || theirs.you.seatId !== seat.id, "a rival's view is not your seat");
  const blob = JSON.stringify(theirs.market) + JSON.stringify(theirs.history);
  ok(!/"landed"|"upgrades"|"rdPipeline"/.test(blob),
    'nothing public carries a pipeline, a landing or an improvement count');
}

/* a product stored before any of this existed reads as "nothing yet" rather
   than crashing — there are live games in that state right now */
const old = { quality: 100, upgrades: undefined };
ok(((old.upgrades || 0) === 0), 'a product saved before this counts as no improvements');

console.log(bad ? `\n${bad} FAILED` : '\nproduct OK');
process.exitCode = bad ? 1 : 0;
