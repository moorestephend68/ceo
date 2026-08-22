/* Does the supply contract make the game better, or just longer?

   A new lever is easy to build and hard to justify. Four things have to be true
   before one earns a place on the screen, and none of them is "an investor asked
   for it":

     1. The choice has to move the season it is made in. Not "beat the market on
        average" — a hedge is not supposed to do that — but change where this
        company ends up by an amount worth thinking about.
     2. It has to do the job it claims. This one claims to trade upside for
        certainty, so it has to lift the worst seasons without gutting the
        median. Cutting the range by destroying the company does not count.
     3. There must be no dominant setting. If one contract is better than every
        other on both money and survival it is not a decision, it is a tax on not
        having read the manual.
     4. The right answer has to depend on something the player can see.

   The design is matched pairs. Every arm plays the identical seeded season with
   the identical trading policy against the identical opponents; the contract is
   the only thing that differs. So a difference within one season is caused by
   the contract and nothing else, and the paired differences can be read directly
   rather than inferred from two noisy distributions.

   The two levers are measured apart before they are measured together, because
   the first run of this confounded them: two named policies differed in both
   volume and timing and it was impossible to say which one was doing the damage.

   Run: node test/contractsim.mjs [seasons]  */

import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';
import * as S from '../lib/contracts.mjs';

const SEASONS = Number(process.argv[2]) || 400;
const ROUNDS = 10;
const SEATS = 4;

const money = (x) => (x < 0 ? '-' : '') + '$' + Math.round(Math.abs(x)).toLocaleString('en-US');
const pct = (x) => (x * 100).toFixed(0) + '%';
const at = (i) => new Date(Date.parse('2026-09-01T09:00:00Z') + i * 3600000).toISOString();

const sorted = (xs) => [...xs].sort((a, b) => a - b);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = sorted(xs), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, q) => {
  if (!xs.length) return 0;
  const s = sorted(xs);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};
const iqr = (xs) => quantile(xs, 0.75) - quantile(xs, 0.25);

/* -------------------------------------------------------------- the player

   One fixed trading policy, used by every arm. Deliberately competent and
   deliberately not clever: price just under value, build to last round's demand.
   It matters that it follows demand, because that is what makes a take-or-pay
   commitment bite — a recession cuts what this player builds, and the contract
   goes on charging for what it committed to. */
function tradingOrders(v) {
  const products = {};
  for (const p of v.you.products) {
    const want = Math.round((p.lastDemand || 1300) * 1.05);
    products[p.name] = {
      price: Math.round(p.value * 0.97), rd: 30000, rdProcess: 12000,
      advertising: 8000, targetCapacity: Math.round(p.capacity), discontinue: false,
      produce: Math.max(0, Math.min(want, p.effCapacity) - p.inventory),
    };
  }
  return products;
}

/* One season. `decide(view)` may only use what a player can see. */
function season(seed, decide) {
  const { game, token } = G.createGame({
    hostName: 'Subject', seats: SEATS, rounds: ROUNDS, preset: 'standard',
    seed, now: at(0),
  });
  G.startGame(game, token, at(0));
  const me = game.seats.find((s) => s.token === token);

  let signed = 0, costRounds = 0, slumpRounds = 0;
  while (game.status === 'playing') {
    const v = G.viewFor(game, token);
    if (v.you && v.you.products.length && !v.you.bankrupt) {
      if (v.you.costMult > 1.001) costRounds += 1;
      if (v.you.marketMult < 0.999) slumpRounds += 1;
      const body = { products: tradingOrders(v) };
      if (v.you.supply.canSign) {
        const want = decide(v, signed);
        if (want && want.committed > 0) { body.contract = want; signed += 1; }
      }
      try { G.submitDecisions(game, token, body); } catch { /* nothing filed */ }
    }
    G.resolveRound(game, at(game.round + 1));
  }

  const settled = game.history
    .map((h) => h.results.find((r) => r.seatId === me.id))
    .filter((r) => r && r.supply);

  return {
    value: E.companyValue(me.firm),
    bankrupt: !!me.firm.bankrupt,
    signed,
    covered: settled.length,
    saved: settled.reduce((a, r) => a + Math.max(0, -r.supply.adjustment), 0),
    paid: settled.reduce((a, r) => a + Math.max(0, r.supply.adjustment), 0),
    shortfalls: settled.filter((r) => r.supply.shortfall > 0.5).length,
    costRounds, slumpRounds,
  };
}

const seeds = Array.from({ length: SEASONS }, (_, i) => 100000 + i * 7);
const run = (decide) => seeds.map((s) => season(s, decide));
const arm = (rows, base) => {
  const deltas = base ? rows.map((r, i) => r.value - base[i].value) : [];
  return {
    rows, deltas,
    value: median(rows.map((r) => r.value)),
    spread: iqr(rows.map((r) => r.value)),
    p10: quantile(rows.map((r) => r.value), 0.10),
    med: base ? median(deltas) : 0,
    swing: base ? iqr(deltas) : 0,
    wins: base ? deltas.filter((d) => d > 0).length / deltas.length : 0,
    bust: rows.filter((r) => r.bankrupt).length / rows.length,
  };
};

console.log(`${SEASONS} seeded seasons, ${SEATS} seats, ${ROUNDS} rounds, `
  + 'identical market and identical trading in every arm.\n');

const base = run(() => null);
const none = arm(base, base);
console.log(`With no contract at all: median ${money(none.value)}, `
  + `middle half spanning ${money(none.spread)}, ${pct(none.bust)} bankrupt.`);
console.log(`That spread is the noise every number below has to be read against.\n`);

/* ================================================================ THE GRID

   One contract, signed in round 0, never renewed. Volume as a multiple of the
   throughput the supplier quotes against; term in rounds. Nothing else varies,
   so the two axes are the two levers and nothing is confounded with them. */
console.log('='.repeat(74));
console.log('THE TWO LEVERS, SEPARATELY — one contract signed in round 0, never renewed\n');

const RATIOS = [0.4, 0.6, 0.8, 1.0, 1.2, 1.5, 2.0, 3.0];
const TERMS = [3, 5, 8];
const grid = {};
for (const t of TERMS) {
  for (const r of RATIOS) {
    grid[`${r}/${t}`] = arm(run((v, signed) => (signed ? null
      : { committed: Math.round(v.you.supply.offers.reference * r), term: t })), base);
  }
}

const gridTable = (label, cell, fmt) => {
  console.log(`  ${label}`);
  console.log('    volume ' + RATIOS.map((r) => `${r}x`.padStart(10)).join(''));
  for (const t of TERMS) {
    console.log(`    ${t} rds `.padEnd(11)
      + RATIOS.map((r) => fmt(cell(grid[`${r}/${t}`])).padStart(10)).join(''));
  }
  console.log('');
};
gridTable('Median gain against never signing:', (a) => a.med, money);
gridTable('Bankruptcy rate (no contract: ' + pct(none.bust) + '):', (a) => a.bust, pct);
gridTable('How much it swings the season (IQR of the paired difference):',
  (a) => a.swing, money);
gridTable('The bad tail — 10th-percentile season (no contract: '
  + money(none.p10) + '):', (a) => a.p10, money);

/* ===================================================== IS IT ACTUALLY A HEDGE */
console.log('='.repeat(74));
console.log('DOES IT DO WHAT IT CLAIMS? — a hedge trades upside for certainty\n');
console.log('  If this works, a modest contract cuts the worst seasons without');
console.log('  gutting the median. If it only ever deepens the bad tail, it is a bet');
console.log('  wearing an insurance label.\n');
console.log('    ' + 'contract'.padEnd(12) + 'worst tenth'.padStart(14)
  + 'vs no contract'.padStart(20) + 'median'.padStart(13));
console.log('    ' + '-'.repeat(59));
console.log('    ' + 'none'.padEnd(12) + money(none.p10).padStart(14)
  + '—'.padStart(20) + money(none.value).padStart(13));
for (const key of ['0.6/3', '0.8/5', '1/5', '1/8', '1.5/5', '3/5']) {
  const a = grid[key];
  const change = a.p10 - none.p10;
  console.log('    ' + key.padEnd(12) + money(a.p10).padStart(14)
    + ((change > 0 ? 'better by ' : 'worse by ') + money(Math.abs(change))).padStart(20)
    + money(a.value).padStart(13));
}

/* ========================================================== TIMING, ISOLATED */
console.log('\n' + '='.repeat(74));
console.log('TIMING — volume and term held fixed at 1.0x for 5 rounds\n');
console.log('  The only difference between these is WHEN the same contract is signed,');
console.log('  and every rule uses only what is on the player\'s own screen.\n');

const V = 1.0, T = 5;
const want = (v) => ({ committed: Math.round(v.you.supply.offers.reference * V), term: T });
const TIMING = {
  'round 0':          (v, s) => (s ? null : want(v)),
  'while costs high': (v, s) => (s || v.you.costMult <= 1.001 ? null : want(v)),
  'while costs calm': (v, s) => (s || v.you.costMult > 1.001 ? null : want(v)),
  'while demand ok':  (v, s) => (s || v.you.marketMult < 0.999 ? null : want(v)),
  'always renewing':  (v) => want(v),
};
const timing = {};
console.log('    ' + 'rule'.padEnd(20) + 'median gain'.padStart(13) + 'wins'.padStart(7)
  + 'bust'.padStart(7) + 'signed'.padStart(9) + 'covered'.padStart(9));
console.log('    ' + '-'.repeat(65));
for (const [name, fn] of Object.entries(TIMING)) {
  const a = arm(run(fn), base);
  timing[name] = a;
  const avg = (f) => a.rows.reduce((x, r) => x + f(r), 0) / a.rows.length;
  console.log('    ' + name.padEnd(20) + money(a.med).padStart(13) + pct(a.wins).padStart(7)
    + pct(a.bust).padStart(7) + avg((r) => r.signed).toFixed(1).padStart(9)
    + avg((r) => r.covered).toFixed(1).padStart(9));
}

/* ================================================ WHAT THE PLAYER CAN SEE */
console.log('\n' + '='.repeat(74));
console.log('DOES THE RIGHT ANSWER DEPEND ON ANYTHING VISIBLE?\n');
console.log('  Seasons split by what actually happened to them. A player cannot see');
console.log('  this in advance — the point is whether the same contract is worth');
console.log('  different amounts in different worlds, which is what makes reading the');
console.log('  headlines worth doing at all.\n');

const hadCost = base.map((r) => r.costRounds > 0);
const hadSlump = base.map((r) => r.slumpRounds > 0);
const split = (a, flags) => ({
  yes: median(a.deltas.filter((_, i) => flags[i])),
  no: median(a.deltas.filter((_, i) => !flags[i])),
});
console.log('    ' + 'contract'.padEnd(12) + 'cost spike'.padStart(13) + 'no spike'.padStart(13)
  + 'demand slump'.padStart(14) + 'no slump'.padStart(13));
console.log('    ' + '-'.repeat(65));
for (const key of ['0.6/5', '1/5', '1.5/5', '3/5']) {
  const c = split(grid[key], hadCost), d = split(grid[key], hadSlump);
  console.log('    ' + key.padEnd(12) + money(c.yes).padStart(13) + money(c.no).padStart(13)
    + money(d.yes).padStart(14) + money(d.no).padStart(13));
}
console.log(`\n    (${hadCost.filter(Boolean).length} of ${SEASONS} seasons had a cost shock; `
  + `${hadSlump.filter(Boolean).length} had a demand slump)`);

/* ================================================================ VERDICT */
const cells = Object.entries(grid);
const bestMoney = cells.reduce((a, b) => (b[1].med > a[1].med ? b : a));
const bestSurvival = cells.reduce((a, b) => (b[1].bust < a[1].bust ? b : a));
const dominant = bestMoney[0] === bestSurvival[0];

/* Does any contract genuinely cut the downside without gutting the company?

   The first version of this test asked only whether the range of outcomes got
   narrower, and the most ruinous settings passed it — commit three times your
   production and every season converges on the same catastrophe, which is a very
   narrow range indeed. So the test is now the pair: a better worst tenth AND a
   median that has not collapsed. Cutting the tail by destroying the company is
   not what the word hedge means. */
const narrows = cells.filter(([, a]) =>
  a.p10 > none.p10 && a.value > none.value * 0.95).map(([k]) => k);

/* Does the same contract pay differently in a spiky world than a calm one, by
   more than half of what it pays on average? */
const conditional = cells.filter(([, a]) => {
  const s = split(a, hadCost);
  return Math.abs(s.yes - s.no) > Math.max(8000, Math.abs(a.med));
}).map(([k]) => k);

/* Does the choice move the season it is made in, against the noise of the
   market? Measured as the paired swing, not as an average gain — a hedge is not
   supposed to beat the market on average. */
const moves = cells.filter(([, a]) => a.swing > none.spread * 0.10).map(([k]) => k);

console.log('\n' + '='.repeat(74));
console.log('VERDICT\n');
console.log(`  1. Moves the season it is made in`);
console.log(`     ${moves.length} of ${cells.length} settings swing the paired outcome by more than`);
console.log(`     10% of the market's own spread. Widest: ${money(Math.max(...cells.map(([, a]) => a.swing)))}.`);
console.log(`     ${moves.length ? 'PASS' : 'FAIL'}\n`);

console.log(`  2. Behaves like a hedge, not a bet`);
console.log(`     ${narrows.length
  ? `${narrows.length} setting(s) lift the worst tenth without gutting the median:`
    + `\n     ${narrows.join(', ')}`
  : 'No setting improves the bad tail — every one of them deepens it'}`);
console.log(`     ${narrows.length ? 'PASS' : 'FAIL'}\n`);

console.log(`  3. No dominant setting`);
console.log(`     Best on money ${bestMoney[0]} (${money(bestMoney[1].med)}); `
  + `safest ${bestSurvival[0]} (${pct(bestSurvival[1].bust)} bust).`);
console.log(`     ${dominant ? 'FAIL — the same setting wins both' : 'PASS'}\n`);

console.log(`  4. The right answer depends on what you can see`);
console.log(`     ${conditional.length} of ${cells.length} settings are worth materially different`);
console.log(`     amounts in a spiky world than a calm one.`);
const bestTiming = Object.entries(timing).reduce((a, b) => (b[1].med > a[1].med ? b : a));
console.log(`     Best timing rule: "${bestTiming[0]}" at ${money(bestTiming[1].med)} `
  + `against ${money(timing['round 0'].med)} for signing blind in round 0.`);
console.log(`     ${conditional.length ? 'PASS' : 'FAIL'}`);
console.log('\n' + '='.repeat(74));
