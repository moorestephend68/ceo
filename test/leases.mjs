/* Leasing plant, in both directions.

   The dangerous part of this feature is not the arithmetic, it is that leased
   capacity is folded into a product for the length of one resolve() call and
   folded back out again. Get the order wrong and a player can sell a factory
   they are renting; get the restore wrong and rented plant is quietly kept for
   ever. Both would be invisible for several rounds and then inexplicable.

   So most of what is below is about the boundaries of that fold: what the plant
   is before, during and after, and what happens when a lease and an ordinary
   capacity order arrive in the same breath. */

import assert from 'node:assert';
import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';
import * as L from '../lib/capacity.mjs';

const money = (x) => (x < 0 ? '-' : '') + '$' + Math.round(Math.abs(x)).toLocaleString('en-US');
const units = (x) => Math.round(x).toLocaleString('en-US');
const at = (i) => new Date(Date.parse('2026-09-01T09:00:00Z') + i * 3600000).toISOString();

/* --------------------------------------------------------------- the prices */
console.log('What temporary capacity costs:');
{
  const C = E.C;
  const buyAndDump = C.CAPEX_PER_UNIT * (1 - C.CAPACITY_RESALE)
    + C.CAPACITY_UPKEEP * L.C.TERM;
  const leaseIn = (L.C.LEASE_IN + C.CAPACITY_UPKEEP) * L.C.TERM;
  console.log(`  buying a unit and selling it ${L.C.TERM} rounds later: `
    + `$${buyAndDump.toFixed(2)} — $18 out, $7.20 back, upkeep in between`);
  console.log(`  renting the same unit for ${L.C.TERM} rounds:            `
    + `$${leaseIn.toFixed(2)} — rent plus the same running cost`);
  assert(leaseIn < buyAndDump,
    'renting for the lease term costs more than buying and dumping, so nobody would rent');

  /* And over a long run owning has to win, or capex is dead. */
  const ownTen = C.CAPEX_PER_UNIT - C.CAPEX_PER_UNIT * C.CAPACITY_RESALE + C.CAPACITY_UPKEEP * 10;
  const rentTen = (L.C.LEASE_IN + C.CAPACITY_UPKEEP) * 10;
  console.log(`  over ten rounds: owning $${ownTen.toFixed(2)} against renting $${rentTen.toFixed(2)}`);
  assert(ownTen < rentTen, 'renting beats owning over a long run, which kills the capex lever');
  console.log('  so renting wins short and owning wins long — the boundary is the lease term\n');

  const sell = E.C.CAPEX_PER_UNIT * E.C.CAPACITY_RESALE;
  const rentOut = L.C.LEASE_OUT * L.C.TERM;
  console.log(`  selling a spare unit outright: $${sell.toFixed(2)}, once`);
  console.log(`  renting it out for ${L.C.TERM} rounds:      $${rentOut.toFixed(2)}, `
    + 'and again every two rounds, and you still own it');

  /* This one is deliberately the "wrong" way round and the note on LEASE_OUT
     explains why: both stop the running cost, so selling is $7.20 once against
     $5 a round for ever. A 60% haircut on resale is a fire-sale price and a
     fire-sale ought to lose to renting. What is asserted is the spread — a
     rental market has one, and without it a player could rent plant in and
     straight back out for free. */
  assert(L.C.LEASE_OUT < L.C.LEASE_IN,
    'renting out pays at least what renting in costs, so the two can be cycled for free');
  console.log(`  and renting out ($${L.C.LEASE_OUT.toFixed(2)}) always pays less than renting in `
    + `($${L.C.LEASE_IN.toFixed(2)}) — a market with no spread is a money pump\n`);
}

/* ------------------------------------------------------------ the settlement */
console.log('Settling the rent:');
{
  const leases = [
    { product: 'a', units: 1000, kind: 'in', rate: L.C.LEASE_IN, from: 2, to: 3 },
    { product: 'b', units: 500, kind: 'out', rate: L.C.LEASE_OUT, from: 2, to: 3 },
  ];
  const before = L.settle(leases, 1);
  assert.strictEqual(before.active, false, 'a lease charged before it started');

  const s = L.settle(leases, 2);
  console.log(`  1,000 units in and 500 out: ${money(s.rentPaid)} paid, `
    + `${money(s.rentEarned)} earned, net ${money(s.adjustment)}`);
  assert(Math.abs(s.rentPaid - 1000 * L.C.LEASE_IN) < 1e-9);
  assert(Math.abs(s.rentEarned - 500 * L.C.LEASE_OUT) < 1e-9);

  const last = L.settle(leases, 3);
  assert.strictEqual(last.ending.length, 2, 'the player is not warned the leases are ending');
  console.log(`  in round 3 both are flagged as ending — "${L.describe(last)}"`);

  assert.strictEqual(L.settle(leases, 4).active, false, 'a finished lease kept charging');
  console.log(`  and in round 4 they charge nothing\n`);
}

/* ------------------------------------------------------------ inside a game */
console.log('Inside a real game:');
const { game, token } = G.createGame({
  hostName: 'Ravenscarr', seats: 4, rounds: 12, preset: 'standard', seed: 31337, now: at(0),
});
G.startGame(game, token, at(0));
const me = game.seats.find((s) => s.token === token);
const line = () => E.live(me.firm)[0];

function orders(v, tweak) {
  const products = {};
  for (const p of v.you.products) {
    products[p.name] = {
      price: Math.round(p.value * 0.97), rd: 30000, rdProcess: 12000,
      advertising: 8000, targetCapacity: Math.round(p.capacity), discontinue: false,
      produce: Math.max(0, Math.min(Math.round((p.lastDemand || 1300) * 1.05),
                                    p.effCapacity) - p.inventory),
      ...(tweak ? tweak(p) : {}),
    };
  }
  return products;
}

{
  const v = G.viewFor(game, token);
  const own = line().capacity;
  console.log(`  the line owns ${units(own)} units of plant`);
  console.log(`  it may rent in up to ${units(v.you.leasing.lines[0].maxIn)} `
    + `and rent out up to ${units(v.you.leasing.lines[0].maxOut)}`);
  assert.strictEqual(v.you.leasing.lines[0].maxIn, Math.round(own * L.C.MAX_IN_RATIO),
    'the cap on renting in is wrong');

  /* Renting more plant than exists is refused rather than quietly clamped. */
  assert.throws(() => G.submitDecisions(game, token, {
    products: orders(v), leases: [{ product: line().name, units: own * 3, kind: 'in' }],
  }), /at most/, 'a player rented a factory three times the size of their own');
  console.log('  renting in more than that is refused, not silently trimmed');

  /* Renting out below the floor likewise. */
  assert.throws(() => G.submitDecisions(game, token, {
    products: orders(v), leases: [{ product: line().name, units: own, kind: 'out' }],
  }), /spare/, 'a player rented out their whole factory including the floor');
  console.log(`  and renting out cannot take the plant below its ${units(L.C.FLOOR)}-unit floor`);
}

{
  /* Rent 800 units in, and check the plant is exactly what it was afterwards. */
  const v = G.viewFor(game, token);
  const before = line().capacity;
  G.submitDecisions(game, token, {
    products: orders(v, (p) => ({ produce: Math.round(E.effCapacity(p) * 1.4) })),
    leases: [{ product: line().name, units: 800, kind: 'in' }],
  });
  assert.strictEqual(line().capacity, before,
    'signing a lease changed the owned plant before the round was even resolved');

  G.resolveRound(game, at(1));
  const r = game.history[0].results.find((x) => x.seatId === me.id);
  console.log(`\n  rented in 800 units: "${r.leaseNote}"`);
  assert(Math.abs(r.leases.rentPaid - 800 * L.C.LEASE_IN) < 1e-9, 'the rent is wrong');
  assert.strictEqual(line().capacity, before,
    'rented plant was left inside the owned capacity after the round');
  console.log(`  and the owned plant is back to ${units(line().capacity)} — exactly what it was`);

  /* It had to be usable, or there was no point renting it. */
  const made = r.detail.reduce((a, d) => a + (d.produced || 0), 0);
  console.log(`  built ${units(made)} units against an owned effective capacity of `
    + `${units(E.effCapacity(line()))}`);
  assert(made > E.effCapacity(line()),
    'the rented plant was charged for and could not be used, which is the worst of both');
}

{
  /* The fold-out must survive an ordinary capacity order arriving in the same
     round — the case where selling a factory you are renting would happen. */
  const v = G.viewFor(game, token);
  const own = line().capacity;
  const sellTo = Math.round(own - 300);
  G.submitDecisions(game, token, {
    products: orders(v, () => ({ targetCapacity: sellTo })),
  });
  G.resolveRound(game, at(2));
  console.log(`\n  selling 300 units while still renting 800 in:`);
  console.log(`    owned plant went ${units(own)} → ${units(line().capacity)}`);
  assert(Math.abs(line().capacity - sellTo) < 1,
    `the sale did not land cleanly on top of the lease (${line().capacity} vs ${sellTo})`);
  console.log('    the sale landed on owned plant only, and the lease was untouched');
}

{
  /* And it ends on its own. */
  const v = G.viewFor(game, token);
  assert.strictEqual(v.you.leasing.running.length, 0,
    'a two-round lease was still running in round 3');
  console.log(`\n  by round ${game.round} the two-round lease has ended on its own`);
  assert.strictEqual((me.leases || []).length, 0, 'finished leases are being kept for ever');
  console.log('  and it is no longer stored on the seat');
}

/* --------------------------------------------------- renting out, and the trap */
console.log('\nRenting out, and getting caught by it:');
{
  const v = G.viewFor(game, token);
  const spare = v.you.leasing.lines[0].maxOut;
  G.submitDecisions(game, token, {
    products: orders(v), leases: [{ product: line().name, units: Math.min(spare, 900), kind: 'out' }],
  });
  const owned = line().capacity;
  G.resolveRound(game, at(3));
  const r = game.history[game.history.length - 1].results.find((x) => x.seatId === me.id);
  console.log(`  "${r.leaseNote}"`);
  assert(r.leases.rentEarned > 0, 'renting out earned nothing');
  assert(r.leases.adjustment < 0, 'renting out cost money instead of earning it');
  assert.strictEqual(line().capacity, owned, 'the plant did not come back onto the books');

  /* Both directions at once on the same line is a misunderstanding, not a
     position, and it is refused. */
  const v2 = G.viewFor(game, token);
  assert.throws(() => G.submitDecisions(game, token, {
    products: orders(v2), leases: [{ product: line().name, units: 100, kind: 'in' }],
  }), /already renting out/, 'a player rented capacity in and out of the same line at once');
  console.log('  and renting in on the same line while renting out is refused');
}

/* ------------------------------------------------ it has to be able to hurt */
console.log('\nRenting out the factory the round before the market turns:');
{
  /* Two identical seeded seasons. One rents out most of its plant for two
     rounds; the other does not. Nothing else differs. */
  const build = (rentOut) => {
    const { game: g, token: t } = G.createGame({
      hostName: 'Testfield', seats: 4, rounds: 10, preset: 'standard',
      seed: 5150, now: at(0),
    });
    G.startGame(g, t, at(0));
    const seat = g.seats.find((s) => s.token === t);
    let done = false;
    while (g.status === 'playing') {
      const v = G.viewFor(g, t);
      if (v.you && v.you.products.length && !v.you.bankrupt) {
        const body = { products: orders(v) };
        if (rentOut && !done && g.round === 2) {
          body.leases = v.you.leasing.lines
            .filter((l) => l.maxOut > 0)
            .map((l) => ({ product: l.product, units: l.maxOut, kind: 'out' }));
          if (body.leases.length) done = true;
        }
        try { G.submitDecisions(g, t, body); } catch {}
      }
      G.resolveRound(g, at(g.round + 1));
    }
    const rows = g.history.map((h) => h.results.find((x) => x.seatId === seat.id))
      .filter(Boolean);
    return {
      value: E.companyValue(seat.firm),
      /* Units sold, not stockouts and not share. Share here is the slice of
         demand a company's price and quality win, and renting the factory out
         does not change either — so share is unmoved. What changes is how much
         of that demand can actually be supplied: the spill hands the rest to
         whoever has stock. Sales is where the cost shows up. */
      sold: rows.reduce((a, r) => a + (r.sales || 0), 0),
    };
  };
  const kept = build(false);
  const rented = build(true);
  const u = (x) => Math.round(x).toLocaleString('en-US');
  console.log(`  kept the plant:  ${money(kept.value)}, sold ${u(kept.sold)} units over the season`);
  console.log(`  rented it out:   ${money(rented.value)}, sold ${u(rented.sold)}`);
  assert(rented.value < kept.value,
    'renting out the whole factory into this season cost nothing, so the trap is not real');
  assert(rented.sold < kept.sold,
    'plant was rented out and the company sold just as much, so nothing was given up');
  console.log('  the plant came back; the sales went to whoever could supply them');
}

/* ------------------------------------------------------------- the money pump */
console.log('\nCycling capacity between two lines earns nothing:');
{
  /* Rented-in plant pays the running cost and rented-out plant does not, so the
     upkeep cancels exactly and the gap between the two rates is pure profit per
     unit moved. If renting out ever paid as much as renting in costs, a company
     with two lines could shuffle plant from one to the other, hold exactly the
     same total, and be paid for it every round. */
  const spread = L.C.LEASE_IN - L.C.LEASE_OUT;
  console.log(`  renting in costs $${L.C.LEASE_IN.toFixed(2)}, renting out pays `
    + `$${L.C.LEASE_OUT.toFixed(2)} — a spread of $${spread.toFixed(2)} a unit a round`);
  assert(spread > 0, 'the rates leave no spread, which is a money pump');

  /* And the same thing measured rather than argued: 1,000 units out of one line
     and 1,000 into another, same total plant, must cost money. */
  const net = L.settle([
    { product: 'a', units: 1000, kind: 'out', rate: L.C.LEASE_OUT, from: 0, to: 1 },
    { product: 'b', units: 1000, kind: 'in', rate: L.C.LEASE_IN, from: 0, to: 1 },
  ], 0);
  console.log(`  1,000 units out of one line and into another: ${money(net.adjustment)} a round`);
  assert(net.adjustment > 0, 'moving plant between two lines paid the player for doing nothing');
  console.log('  it costs money, as moving something from one place to another should\n');
}

console.log('\nleases OK');
