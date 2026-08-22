/* Does leasing plant earn its place, or does it just kill capex?

   Four tests, the same four the supply contract had to pass:

     1. The choice has to move the season it is made in.
     2. It has to do the job it claims.
     3. There must be no dominant setting — and the specific danger here is
        capital expenditure. Renting is available the round you ask for it and
        buying takes one, so if the rent is priced even slightly low, renting
        becomes the answer to everything and a lever the game already has stops
        mattering.
     4. The right answer has to depend on something the player can see.

   Matched pairs: identical seeded season, identical trading, identical
   opponents, and the lease is the only difference.

   ------------------------------------------------ two things this got wrong

   **Stockouts are not the metric, and neither is share.** The first version of
   this file reported rounds ending in a stockout and units of demand turned
   away, and both read zero in every arm: in a shared market the spill has
   already capped each company's allocation by what it can supply before
   resolve() ever sees it, so `lostSales` is structurally near zero in
   multiplayer. The second version used market share, which read flat to the
   nearest percent in every arm for a different reason — share is the slice of
   demand a company's price and quality win, and renting the factory out changes
   neither. What changes is how much of that demand can be supplied, and the
   spill hands the rest to whoever has stock. **Units sold** is the metric.

   **Renting has to be compared to buying on the right question.** Asking whether
   renting beats buying for a two-round squeeze answers itself: that is what
   renting is for, and winning there is not evidence of anything. The question
   that matters is whether buying still wins when the need is permanent. Both are
   below, and the boundary between them is the whole design.

   Run: node test/leasesim.mjs [seasons]  */

import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';
import * as L from '../lib/capacity.mjs';

const SEASONS = Number(process.argv[2]) || 300;
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

/* Orders. `extra` is units of rented plant on each line, which the player is
   assumed to actually use — renting plant and not raising production is a real
   mistake but a useless thing to average over. `capex` optionally overrides the
   plant size, which is how the buying arms express themselves. */
function tradingOrders(v, extra, capex) {
  const products = {};
  for (const p of v.you.products) {
    const room = p.effCapacity + (extra[p.name] || 0);
    const want = Math.round((p.lastDemand || 1300) * 1.05);
    products[p.name] = {
      price: Math.round(p.value * 0.97), rd: 30000, rdProcess: 12000,
      advertising: 8000, discontinue: false,
      targetCapacity: Math.round(capex ? capex(p) : p.capacity),
      produce: Math.max(0, Math.min(want, room) - p.inventory),
    };
  }
  return products;
}

/* The visible signal that the plant is too small: last round's demand — the raw
   figure, before the market was split — exceeded what the line can build. */
const shortOfPlant = (v) => v.you.products.some((p) =>
  p.lastDemand !== null && p.lastDemand > p.effCapacity * 0.95);

/* And that it is too big. */
const plantIdle = (v) => v.you.products.some((p) =>
  p.lastDemand !== null && p.lastDemand < p.effCapacity * 0.7);

/* One season. `decide` returns lease requests; `capex` optionally sets plant
   size. Both may only use what a player can see on their own screen. */
function season(seed, decide, capex) {
  const { game, token } = G.createGame({
    hostName: 'Subject', seats: SEATS, rounds: ROUNDS, preset: 'standard',
    seed, now: at(0),
  });
  G.startGame(game, token, at(0));
  const me = game.seats.find((s) => s.token === token);

  let signings = 0;
  while (game.status === 'playing') {
    const v = G.viewFor(game, token);
    if (v.you && v.you.products.length && !v.you.bankrupt) {
      const wanted = (decide && decide(v)) || [];
      const extra = {};
      for (const l of v.you.leasing.running) {
        extra[l.product] = (extra[l.product] || 0) + (l.kind === 'in' ? l.units : -l.units);
      }
      for (const l of wanted) {
        extra[l.product] = (extra[l.product] || 0) + (l.kind === 'in' ? l.units : -l.units);
      }
      const body = { products: tradingOrders(v, extra, capex) };
      if (wanted.length) body.leases = wanted;
      try {
        G.submitDecisions(game, token, body);
        signings += wanted.length;
      } catch {
        try { G.submitDecisions(game, token, { products: tradingOrders(v, {}, capex) }); } catch {}
      }
    }
    G.resolveRound(game, at(game.round + 1));
  }

  const rows = game.history
    .map((h) => h.results.find((r) => r.seatId === me.id)).filter(Boolean);

  return {
    value: E.companyValue(me.firm),
    bankrupt: !!me.firm.bankrupt,
    signings,
    /* Units sold across the season. This is what being short of plant actually
       costs — the demand is still won, and then handed to somebody who can
       supply it. */
    sold: rows.reduce((a, r) => a + (r.sales || 0), 0),
    rent: rows.reduce((a, r) => a + (r.leases ? r.leases.adjustment : 0), 0),
  };
}

const seeds = Array.from({ length: SEASONS }, (_, i) => 100000 + i * 7);
const run = (decide, capex) => seeds.map((s) => season(s, decide, capex));

const arm = (rows, base) => {
  const deltas = rows.map((r, i) => r.value - base[i].value);
  /* Seasons in which the rule actually did something. A rule that fires in a
     third of seasons has a median paired difference of zero no matter how good
     it is, so the conditional number is the one that means anything. */
  const fired = deltas.filter((_, i) => rows[i].signings > 0);
  return {
    rows, deltas,
    value: median(rows.map((r) => r.value)),
    p10: quantile(rows.map((r) => r.value), 0.10),
    med: median(deltas),
    firedIn: rows.filter((r) => r.signings > 0).length / rows.length,
    whenFired: median(fired),
    swing: iqr(deltas),
    wins: deltas.filter((d) => d > 0).length / deltas.length,
    bust: rows.filter((r) => r.bankrupt).length / rows.length,
    sold: median(rows.map((r) => r.sold)),
  };
};

console.log(`${SEASONS} seeded seasons, ${SEATS} seats, ${ROUNDS} rounds, `
  + 'identical market and identical trading in every arm.\n');

const base = run(null);
const none = arm(base, base);
console.log(`Never leasing, never buying: median ${money(none.value)}, `
  + `worst tenth ${money(none.p10)}, ${pct(none.bust)} bankrupt,`);
console.log(`selling ${Math.round(none.sold).toLocaleString('en-US')} units over the season.\n`);

const table = (title, arms, baseline) => {
  console.log(`  ${title}`);
  const h = 'rule'.padEnd(26) + 'fires in'.padStart(10) + 'when it does'.padStart(14)
    + 'wins'.padStart(7) + 'worst 10th'.padStart(13) + 'bust'.padStart(7) + 'sold'.padStart(10);
  console.log('  ' + h);
  console.log('  ' + '-'.repeat(h.length));
  console.log('  ' + 'never'.padEnd(26) + '—'.padStart(10) + '—'.padStart(14)
    + '—'.padStart(7) + money(baseline.p10).padStart(13) + pct(baseline.bust).padStart(7)
    + Math.round(baseline.sold).toLocaleString('en-US').padStart(10));
  for (const [name, a] of Object.entries(arms)) {
    console.log('  ' + name.padEnd(26) + pct(a.firedIn).padStart(10)
      + money(a.whenFired).padStart(14) + pct(a.wins).padStart(7)
      + money(a.p10).padStart(13) + pct(a.bust).padStart(7)
      + Math.round(a.sold).toLocaleString('en-US').padStart(10));
  }
  console.log('');
};

/* ============================================================ RENTING PLANT IN */
console.log('='.repeat(80));
console.log('RENTING PLANT IN\n');

const inFor = (v, frac, when) => (when
  ? v.you.leasing.lines.filter((l) => l.maxIn > 0)
      .map((l) => ({ product: l.product, units: Math.round(l.maxIn * frac), kind: 'in' }))
      .filter((l) => l.units > 0)
  : []);
const free = (v) => !v.you.leasing.running.length;

const IN = {
  'always, blind': (v) => inFor(v, 0.5, free(v)),
  'when short of plant': (v) => inFor(v, 0.5, free(v) && shortOfPlant(v)),
  'during a boom': (v) => inFor(v, 0.5, free(v) && v.you.marketMult > 1.001),
  'during a supply crunch': (v) => inFor(v, 0.5, free(v) && v.you.capacityMult < 0.999),
  'short of plant, half as much': (v) => inFor(v, 0.25, free(v) && shortOfPlant(v)),
};
const inArms = {};
for (const [name, fn] of Object.entries(IN)) inArms[name] = arm(run(fn), base);
table('Renting in, by when the player decides to do it:', inArms, none);

/* ================================================= RENTING AGAINST BUYING */
console.log('='.repeat(80));
console.log('RENTING AGAINST BUYING — where the boundary between them falls\n');
console.log('  Two different needs. A short squeeze is a round or two of demand the');
console.log('  plant cannot meet. A permanent need is a company that is simply too');
console.log('  small for its market and will be for the rest of the season.\n');
console.log('  Renting should win the first and lose the second. If it wins both,');
console.log('  capital expenditure is dead and this feature should not ship.\n');

const rentShort = inArms['when short of plant'];
const buyShort = arm(run(null, (p) => (p.lastDemand !== null
  && p.lastDemand > p.effCapacity * 0.95 ? p.capacity * 1.5 : p.capacity)), base);

/* The permanent need: keep the plant half as big again for the whole season,
   answered either by owning it or by renewing a lease over and over. */
const buyBig = arm(run(null, (p) => Math.max(p.capacity, 3300)), base);
const rentBig = arm(run((v) => inFor(v, 0.5, free(v))), base);

const h3 = 'the need'.padEnd(22) + 'answered by'.padEnd(18) + 'median'.padStart(12)
  + 'vs never'.padStart(12) + 'worst 10th'.padStart(13);
console.log('  ' + h3);
console.log('  ' + '-'.repeat(h3.length));
console.log('  ' + 'a short squeeze'.padEnd(22) + 'renting'.padEnd(18)
  + money(rentShort.value).padStart(12) + money(rentShort.med).padStart(12)
  + money(rentShort.p10).padStart(13));
console.log('  ' + ''.padEnd(22) + 'buying'.padEnd(18)
  + money(buyShort.value).padStart(12) + money(buyShort.med).padStart(12)
  + money(buyShort.p10).padStart(13));
console.log('  ' + 'a permanently'.padEnd(22) + 'renting, renewed'.padEnd(18)
  + money(rentBig.value).padStart(12) + money(rentBig.med).padStart(12)
  + money(rentBig.p10).padStart(13));
console.log('  ' + 'bigger company'.padEnd(22) + 'buying, once'.padEnd(18)
  + money(buyBig.value).padStart(12) + money(buyBig.med).padStart(12)
  + money(buyBig.p10).padStart(13));

/* ========================================================== RENTING PLANT OUT */
console.log('\n' + '='.repeat(80));
console.log('RENTING PLANT OUT\n');

const outFor = (v, frac, when) => (when
  ? v.you.leasing.lines.filter((l) => l.maxOut > 0)
      .map((l) => ({ product: l.product, units: Math.round(l.maxOut * frac), kind: 'out' }))
      .filter((l) => l.units > 0)
  : []);

const OUT = {
  'always, blind': (v) => outFor(v, 0.5, free(v)),
  'when plant sits idle': (v) => outFor(v, 0.5, free(v) && plantIdle(v)),
  'during a slump': (v) => outFor(v, 0.5, free(v) && v.you.marketMult < 0.999),
  'idle AND slumping': (v) => outFor(v, 0.5,
    free(v) && plantIdle(v) && v.you.marketMult < 0.999),
  'idle, and only a quarter': (v) => outFor(v, 0.25, free(v) && plantIdle(v)),
};
const outArms = {};
for (const [name, fn] of Object.entries(OUT)) outArms[name] = arm(run(fn), base);
table('Renting out, by when the player decides to do it:', outArms, none);

console.log('  "sold" is the column to read. Plant rented out is plant that cannot');
console.log('  answer a recovery, and in a shared market the demand does not wait —');
console.log('  it goes to whoever can supply it, and it does not come back.\n');

/* ---- and against simply selling the plant, which the game already allows --- */
const sellIdle = arm(run(null, (p) => (p.lastDemand !== null
  && p.lastDemand < p.effCapacity * 0.7
  ? Math.max(L.C.FLOOR, p.capacity * 0.7) : p.capacity)), base);
console.log(`  Selling idle plant instead, which the game already allowed: `
  + `${money(sellIdle.med)}`);
console.log(`  The best renting-out rule above: `
  + `${money(Math.max(...Object.values(outArms).map((a) => a.med)))}`);

/* ================================================================== VERDICT */
const inNames = Object.keys(IN), outNames = Object.keys(OUT);
const bestIn = inNames.reduce((a, b) => (inArms[b].whenFired > inArms[a].whenFired ? b : a));
const bestOut = outNames.reduce((a, b) => (outArms[b].whenFired > outArms[a].whenFired ? b : a));

const moves = [...inNames.map((n) => inArms[n]), ...outNames.map((n) => outArms[n])]
  .filter((a) => a.swing > 20000).length;
const rentWinsShort = rentShort.med >= buyShort.med;
const buyWinsLong = buyBig.med > rentBig.med;
const inReadable = inArms[bestIn].whenFired > inArms['always, blind'].whenFired;
const outWorks = outArms[bestOut].whenFired > 0;

console.log('\n' + '='.repeat(80));
console.log('VERDICT\n');
console.log(`  1. Moves the season it is made in`);
console.log(`     ${moves} of ${inNames.length + outNames.length} rules swing the paired outcome by more than $20,000.`);
console.log(`     ${moves ? 'PASS' : 'FAIL'}\n`);

console.log(`  2. Renting in does the job it claims`);
console.log(`     Best rule "${bestIn}" is worth ${money(inArms[bestIn].whenFired)} in the`);
console.log(`     seasons it fires, against ${money(inArms['always, blind'].whenFired)} for renting blind.`);
console.log(`     ${inArms[bestIn].whenFired > 0 ? 'PASS' : 'FAIL'}\n`);

console.log(`  3. Does not kill buying plant`);
console.log(`     Short squeeze:    renting ${money(rentShort.med)} vs buying ${money(buyShort.med)}`);
console.log(`     Permanent need:   renting ${money(rentBig.med)} vs buying ${money(buyBig.med)}`);
console.log(`     ${rentWinsShort && buyWinsLong
  ? 'PASS — renting wins the short need, buying wins the permanent one'
  : buyWinsLong ? 'PARTIAL — buying still wins the permanent need'
  : 'FAIL — renting wins both, so capex is dead'}\n`);

console.log(`  4. Renting out earns its place`);
console.log(`     Best rule "${bestOut}" is worth ${money(outArms[bestOut].whenFired)} `
  + `in the seasons it fires.`);
console.log(`     Selling the same idle plant instead: ${money(sellIdle.med)}.`);
console.log(`     ${outWorks ? 'PASS' : 'FAIL — no rule for renting plant out makes money'}`);
console.log('\n' + '='.repeat(80));
