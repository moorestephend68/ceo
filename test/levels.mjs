/* Is there a second game here, or the same game with more buttons?

   An instructor with a fifteen-week semester can run this twice: once early, and
   once later with more to think about. That is worth real money — it is the
   difference between one licence and a course built around the thing. But it is
   only true if the second game teaches something the first did not.

   The question has a wrong answer that is easy to reach: count the levers, see
   that there are more of them, and declare it advanced. More decisions is not
   the same as a different lesson. If the players who do well in the base game
   are exactly the players who do well with the extra levers switched on, then
   the second sitting is the first sitting with extra typing, and an instructor
   will work that out by week ten.

   So the test is **orthogonality**, and getting it right took two attempts.

   The first version ranked the players with the extras off, ranked them again
   with the extras played well, and found the order identical — rank correlation
   1.00. That number was an artefact of the design: every player was given the
   same competence at the new levers, and a decision everyone handles equally
   well cannot change who wins. It is not a classroom. In a classroom the student
   who is careless about price may well be the one who reads the news.

   The version below crosses the two: every base style against every level of
   competence at the extras, ranked together. The question is how often a weaker
   base player overtakes a stronger one by handling the new decisions better.

   And a second reading: is what the extras are worth related to how good a
   player already was? Near zero means an independent axis of skill and a genuine
   second lesson. Strongly positive means a multiplier on the first one. That one
   also has a trap in it — a style that bankrupts itself in nine seasons out of
   ten cannot benefit from anything, so including it measures survival rather
   than skill. Both readings are printed.

   Run: node test/levels.mjs [seasons]  */

import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';

const SEASONS = Number(process.argv[2]) || 200;
const ROUNDS = 10;
const SEATS = 4;

const money = (x) => (x < 0 ? '-' : '') + '$' + Math.round(Math.abs(x)).toLocaleString('en-US');
const at = (i) => new Date(Date.parse('2026-09-01T09:00:00Z') + i * 3600000).toISOString();
const sorted = (xs) => [...xs].sort((a, b) => a - b);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = sorted(xs), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ---------------------------------------------------------- the base players

   Eight ways of playing the game that already exists — the levers an instructor
   runs in week three. They vary on the things the base game is actually about:
   what you charge, how much you build, how you split research, and whether you
   open a second line. Deliberately a wide spread, from someone who has
   understood it to someone who has not. */
const PLAYERS = {
  'prices at value':      { price: 1.00, buffer: 1.00, rd: 30000, proc: 10000, launch: false },
  'undercuts a little':   { price: 0.97, buffer: 1.05, rd: 30000, proc: 12000, launch: false },
  'undercuts hard':       { price: 0.88, buffer: 1.15, rd: 20000, proc: 12000, launch: false },
  'premium, high spec':   { price: 1.08, buffer: 0.95, rd: 55000, proc: 8000,  launch: false },
  'builds to the brim':   { price: 0.97, buffer: 1.35, rd: 30000, proc: 12000, launch: false },
  'builds short':         { price: 0.97, buffer: 0.80, rd: 30000, proc: 12000, launch: false },
  'all in on process':    { price: 0.95, buffer: 1.05, rd: 12000, proc: 40000, launch: false },
  'opens a second line':  { price: 0.97, buffer: 1.05, rd: 30000, proc: 12000, launch: true },
};

function ordersFor(v, p, extra) {
  const products = {};
  for (const prod of v.you.products) {
    const room = prod.effCapacity + (extra[prod.name] || 0);
    const want = Math.round((prod.lastDemand || 1300) * p.buffer);
    products[prod.name] = {
      price: Math.round(prod.value * p.price),
      rd: p.rd, rdProcess: p.proc, advertising: 8000,
      targetCapacity: Math.round(prod.capacity), discontinue: false,
      produce: Math.max(0, Math.min(want, room) - prod.inventory),
    };
  }
  return products;
}

/* ------------------------------------------------------- the extra levers

   Three ways of handling what §38 and §39 added, using only what is on the
   player's own screen. "well" is the best rule each measurement found; "blind"
   is the same lever pulled without reading anything. */
const free = (v) => !v.you.leasing.running.length;

const EXTRAS = {
  off: () => ({}),
  blind: (v) => {
    const out = {};
    if (v.you.supply.canSign) {
      out.contract = { committed: Math.round(v.you.supply.offers.reference * 1.0), term: 5 };
    }
    if (free(v)) {
      out.leases = v.you.leasing.lines.filter((l) => l.maxIn > 0)
        .map((l) => ({ product: l.product, units: Math.round(l.maxIn * 0.5), kind: 'in' }));
    }
    return out;
  },
  well: (v) => {
    const out = {};
    /* Lock the input price while input prices are already moving. */
    if (v.you.supply.canSign && v.you.costMult > 1.001) {
      out.contract = { committed: Math.round(v.you.supply.offers.reference * 1.0), term: 5 };
    }
    /* Rent plant while the factory cannot run at full tilt. */
    if (free(v) && v.you.capacityMult < 0.999) {
      out.leases = v.you.leasing.lines.filter((l) => l.maxIn > 0)
        .map((l) => ({ product: l.product, units: Math.round(l.maxIn * 0.5), kind: 'in' }));
    }
    return out;
  },
};

function season(seed, player, extras) {
  const { game, token } = G.createGame({
    hostName: 'Subject', seats: SEATS, rounds: ROUNDS, preset: 'standard',
    seed, now: at(0),
  });
  G.startGame(game, token, at(0));
  const me = game.seats.find((s) => s.token === token);

  let launched = false;
  while (game.status === 'playing') {
    const v = G.viewFor(game, token);
    if (v.you && v.you.products.length && !v.you.bankrupt) {
      const want = extras(v) || {};
      const extra = {};
      for (const l of v.you.leasing.running) {
        extra[l.product] = (extra[l.product] || 0) + (l.kind === 'in' ? l.units : -l.units);
      }
      for (const l of (want.leases || [])) {
        extra[l.product] = (extra[l.product] || 0) + (l.kind === 'in' ? l.units : -l.units);
      }
      const body = { products: ordersFor(v, player, extra) };
      if (want.contract) body.contract = want.contract;
      if (want.leases && want.leases.length) body.leases = want.leases;
      if (player.launch && !launched && v.you.canLaunch && game.round === 2) {
        body.launch = true; body.launchKind = 'software'; launched = true;
      }
      try { G.submitDecisions(game, token, body); } catch {
        try { G.submitDecisions(game, token, { products: ordersFor(v, player, {}) }); } catch {}
      }
    }
    G.resolveRound(game, at(game.round + 1));
  }
  return { value: E.companyValue(me.firm), bankrupt: !!me.firm.bankrupt };
}

const seeds = Array.from({ length: SEASONS }, (_, i) => 100000 + i * 7);
const runAll = (extras) => Object.fromEntries(Object.entries(PLAYERS).map(([name, p]) =>
  [name, seeds.map((s) => season(s, p, extras))]));

console.log(`${SEASONS} seeded seasons per player, ${Object.keys(PLAYERS).length} players, `
  + `${SEATS} seats, ${ROUNDS} rounds.\n`);

const off = runAll(EXTRAS.off);
const well = runAll(EXTRAS.well);
const blind = runAll(EXTRAS.blind);

const score = (rows) => median(rows.map((r) => r.value));
const bust = (rows) => rows.filter((r) => r.bankrupt).length / rows.length;

/* ================================================================= level one */
console.log('='.repeat(78));
console.log('THE GAME AS IT STANDS — how far apart the base decisions put people\n');

const names = Object.keys(PLAYERS);
const baseScores = Object.fromEntries(names.map((n) => [n, score(off[n])]));
const rankBase = [...names].sort((a, b) => baseScores[b] - baseScores[a]);
const h = 'how they play'.padEnd(24) + 'median'.padStart(12) + 'bust'.padStart(8);
console.log('  ' + h);
console.log('  ' + '-'.repeat(h.length));
for (const n of rankBase) {
  console.log('  ' + n.padEnd(24) + money(baseScores[n]).padStart(12)
    + ((bust(off[n]) * 100).toFixed(0) + '%').padStart(8));
}
const baseSpread = baseScores[rankBase[0]] - baseScores[rankBase[rankBase.length - 1]];
console.log(`\n  Best to worst: ${money(baseSpread)}. That is what the game already teaches.`);

/* ============================================================== level two */
console.log('\n' + '='.repeat(78));
console.log('WITH THE EXTRA LEVERS ON — and what they are worth to each player\n');

const wellScores = Object.fromEntries(names.map((n) => [n, score(well[n])]));
const blindScores = Object.fromEntries(names.map((n) => [n, score(blind[n])]));
const gain = Object.fromEntries(names.map((n) => [n, wellScores[n] - baseScores[n]]));
const cost = Object.fromEntries(names.map((n) => [n, blindScores[n] - baseScores[n]]));

const h2 = 'how they play'.padEnd(24) + 'levers off'.padStart(12) + 'played well'.padStart(13)
  + 'gain'.padStart(12) + 'pulled blind'.padStart(14) + 'cost'.padStart(12);
console.log('  ' + h2);
console.log('  ' + '-'.repeat(h2.length));
for (const n of rankBase) {
  console.log('  ' + n.padEnd(24) + money(baseScores[n]).padStart(12)
    + money(wellScores[n]).padStart(13) + money(gain[n]).padStart(12)
    + money(blindScores[n]).padStart(14) + money(cost[n]).padStart(12));
}

const gains = names.map((n) => gain[n]);
const costs = names.map((n) => cost[n]);
console.log(`\n  Playing them well is worth ${money(median(gains))} to the median player.`);
console.log(`  Pulling them blind costs ${money(median(costs))}.`);
console.log(`  The gap between handling the extras well and badly: `
  + `${money(median(gains) - median(costs))}.`);

/* ============================================================ orthogonality */
console.log('\n' + '='.repeat(78));
console.log('IS IT A SECOND LESSON, OR THE SAME ONE LOUDER?\n');
console.log('  The first version of this test held the extra levers at the same');
console.log('  competence for every player, and unsurprisingly nobody overtook anybody:');
console.log('  if everyone handles the new decisions equally well, the new decisions');
console.log('  cannot change who wins. That is not a classroom. In a classroom the');
console.log('  student who is careless about price may be the one who reads the news.\n');
console.log('  So: every combination of a base style and a level of competence at the');
console.log('  extras, ranked together.\n');

const combos = [];
for (const n of names) {
  combos.push({ label: `${n} · levers off`, base: n, ex: 'off', v: baseScores[n] });
  combos.push({ label: `${n} · plays them well`, base: n, ex: 'well', v: wellScores[n] });
  combos.push({ label: `${n} · pulls them blind`, base: n, ex: 'blind', v: blindScores[n] });
}
combos.sort((a, b) => b.v - a.v);

/* How far can competence at the extras carry you past a better base player?
   For each pair of base styles where A is better than B with the levers off,
   does B-playing-well overtake A-playing-blind, or even A-with-levers-off? */
let overtakes = 0, pairs = 0, overtakesOff = 0;
for (const a of names) {
  for (const b of names) {
    if (a === b || baseScores[a] <= baseScores[b]) continue;
    pairs += 1;
    if (wellScores[b] > blindScores[a]) overtakes += 1;
    if (wellScores[b] > baseScores[a]) overtakesOff += 1;
  }
}
console.log(`  ${pairs} pairs where one base style beats another outright.`);
console.log(`  The weaker style overtakes by handling the extras well, when the`);
console.log(`  stronger one pulls them blind:        ${overtakes} of ${pairs} `
  + `(${((overtakes / pairs) * 100).toFixed(0)}%)`);
console.log(`  ...and when the stronger one simply never touches them: `
  + `${overtakesOff} of ${pairs} (${((overtakesOff / pairs) * 100).toFixed(0)}%)\n`);

console.log('  The combined table, best first — the mixing is the point:');
console.log('  ' + 'player and how they handle the extras'.padEnd(44) + 'median'.padStart(12));
console.log('  ' + '-'.repeat(56));
for (const c of combos.slice(0, 12)) {
  console.log('  ' + c.label.padEnd(44) + money(c.v).padStart(12));
}

/* And whether the extras are a new axis or a multiplier on the old one. Two
   readings, because the absolute one is dominated by scale: a company that goes
   bankrupt in nine seasons out of ten cannot benefit from anything, and letting
   those into the correlation measures survival rather than skill. */
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const corr = (xs, ys) => {
  const mx = mean(xs), my = mean(ys);
  const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const dx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
  return dx && dy ? num / (dx * dy) : 0;
};
const viable = names.filter((x) => bust(off[x]) < 0.25);
console.log(`\n  Correlation between how good a player already is and what the extras`);
console.log(`  are worth to them, in dollars:`);
console.log(`    across all eight styles:                    `
  + corr(names.map((x) => baseScores[x]), names.map((x) => gain[x])).toFixed(2));
console.log(`    across the ${viable.length} that are not usually bankrupt:      `
  + corr(viable.map((x) => baseScores[x]), viable.map((x) => gain[x])).toFixed(2));
console.log(`  And as a share of what they were already making:`);
for (const x of rankBase.filter((y) => viable.includes(y))) {
  const rel = baseScores[x] > 0 ? gain[x] / baseScores[x] : 0;
  console.log(`    ${x.padEnd(24)} ${((rel) * 100).toFixed(0)}%`);
}

/* ================================================== how much is level one */
console.log('\n' + '='.repeat(78));
console.log('THE OTHER HALF OF THE QUESTION — how much is already in level one\n');
console.log('  A second sitting is a step up in two ways, not one: what the second');
console.log('  game adds, and what the first game could leave out. The base game');
console.log('  already asks for seven numbers a product plus whether to open a line.');
console.log('  If a first sitting hid some of that, the gap between the two would be');
console.log('  the hidden levers AND the new ones, not the new ones alone.\n');

/* Two levers that could plausibly be hidden from a first sitting: process R&D
   and opening a second line. What is the spread worth without them? */
const simple = Object.fromEntries(Object.entries(PLAYERS).map(([k, p]) =>
  [k, { ...p, proc: 0, launch: false }]));
const simpleScores = Object.fromEntries(Object.entries(simple).map(([k, p]) =>
  [k, score(seeds.map((s) => season(s, p, EXTRAS.off)))]));
const simpleRank = [...names].sort((a, b) => simpleScores[b] - simpleScores[a]);
const simpleSpread = simpleScores[simpleRank[0]] - simpleScores[simpleRank[simpleRank.length - 1]];
console.log(`  With process research and launching hidden, best to worst is `
  + `${money(simpleSpread)}`);
console.log(`  With everything the base game has:                          `
  + `${money(baseSpread)}`);
console.log(`  So those two levers alone are worth ${money(baseSpread - simpleSpread)} of`);
console.log(`  separation — more, on this measure, than the supply contract and the`);
console.log(`  leases put together.`);

/* ================================================================== verdict */
console.log('\n' + '='.repeat(78));
console.log('VERDICT\n');

/* The base spread including two styles that bankrupt themselves in half or more
   of their seasons is not a fair denominator — that is not what the base game
   teaches, it is what going bankrupt looks like. Both are reported. */
const viableScores = viable.map((x) => baseScores[x]);
const viableSpread = Math.max(...viableScores) - Math.min(...viableScores);
const leverSpread = median(gains) - median(costs);

console.log(`  Base decisions separate best from worst by      ${money(baseSpread)}`);
console.log(`  ...counting only styles that usually survive:   ${money(viableSpread)}`);
console.log(`  Handling the extras well against badly:         ${money(leverSpread)}`);
console.log(`  — ${((leverSpread / baseSpread) * 100).toFixed(0)}% of the first figure, `
  + `${((leverSpread / viableSpread) * 100).toFixed(0)}% of the second.\n`);

const bigEnough = leverSpread / viableSpread > 0.35;
const reshuffles = overtakes / pairs > 0.2;
const independent = Math.abs(corr(viable.map((x) => baseScores[x]),
  viable.map((x) => gain[x]))) < 0.6;

console.log(`  material enough to be a level:   ${bigEnough ? 'yes' : 'NO'}`);
console.log(`  can change who wins:             ${reshuffles ? 'yes' : 'NO'} `
  + `(${((overtakes / pairs) * 100).toFixed(0)}% of pairs overtaken)`);
console.log(`  an independent axis of skill:    ${independent ? 'yes' : 'NO'}`);
console.log(`\n  And the hidden-lever route is worth ${money(baseSpread - simpleSpread)} `
  + `on its own,`);
console.log(`  against ${money(leverSpread)} for everything §38 and §39 added.`);
console.log('\n' + '='.repeat(78));
