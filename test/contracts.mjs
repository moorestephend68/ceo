/* Supplier contracts — the arithmetic, and the ways it could quietly be wrong.

   Two of these tests exist because of specific mistakes that were nearly made.
   The first is drift: settling a hedge by rewriting the unit cost after the
   engine has booked it into inventory produces profit out of nowhere three
   rounds later, and it is invisible in any single round. The second is timing:
   resolve() decides bankruptcy before the contract has been charged, so a
   commitment big enough to end a company would have ended it one round after the
   player was told they had survived.

   The rest are the promises the mechanic makes to a player: the rate is fixed,
   the volume is not optional, and you cannot sign your way out of a contract
   you are already in. */

import assert from 'node:assert';
import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';
import * as S from '../lib/contracts.mjs';

const money = (x) => (x < 0 ? '-' : '') + '$' + Math.round(Math.abs(x)).toLocaleString('en-US');
const at = (i) => new Date(Date.parse('2026-09-01T09:00:00Z') + i * 3600000).toISOString();

/* ---------------------------------------------------------------- the curve */
console.log('The rate curve:');
{
  const ref = 1000;
  const small = S.quote(200, 3, ref);
  const big = S.quote(1500, 3, ref);
  const long = S.quote(1500, 8, ref);
  console.log(`  commit 200 for 3 rounds: ${small.lock.toFixed(3)}× the market`);
  console.log(`  commit 1,500 for 3 rounds: ${big.lock.toFixed(3)}×`);
  console.log(`  commit 1,500 for 8 rounds: ${long.lock.toFixed(3)}×`);

  /* The two levers have to pull against each other or there is no decision.
     Volume buys a better rate and buys take-or-pay risk with it; term buys more
     rounds of cover and pays a worse rate for them. When term was a discount as
     well, the longest contract was strictly correct at every volume — see the
     note on TERM_STEP. */
  assert(big.lock < small.lock, 'volume does not buy a better rate');
  assert(long.lock > big.lock,
    'a longer lock is cheaper, which makes the longest term strictly correct');
  console.log('  volume improves the rate, term worsens it — the levers pull apart');

  /* The long-run average cost shock is about 1.039. A contract sized to your own
     production has to sit near it: much below and every player should sign one
     without thinking, much above and nobody should ever sign one at all. */
  const own = S.quote(ref, 5, ref).lock;
  assert(own > 0.98 && own < 1.04,
    `a contract covering your own production locks at ${own.toFixed(3)}, which is `
    + 'either free money or dead weight');
  console.log(`  a contract sized to your own production locks at ${own.toFixed(3)}, `
    + 'against a market that averages 1.039');

  /* Nobody signs an unbounded commitment, and nobody gets materials at half
     price. */
  assert.strictEqual(S.quote(1e9, 8, ref).committed, ref * S.C.MAX_RATIO,
    'a supplier underwrote unlimited volume');
  assert(S.quote(1e9, 8, ref).lock >= S.C.FLOOR, 'the rate went through the floor');
  console.log(`  a supplier will underwrite at most ${S.C.MAX_RATIO}× your throughput\n`);
}

/* ------------------------------------------------------- the settlement sums */
console.log('Settling a round:');
{
  const c = { committed: 1000, term: 4, lock: 0.95, from: 0, to: 3, baseUnit: 50 };
  const log = (produced, unitCost) => [{ name: 'p', produced, unitCost }];

  /* Produced exactly what was committed, market calm. You pay 0.95 of a $50
     unit instead of $50: $2,500 saved. */
  const level = S.settle(c, log(1000, 50), 1.0, 0);
  console.log(`  1,000 made, 1,000 committed, market flat: ${money(-level.adjustment)} saved`);
  assert(Math.abs(level.adjustment + 2500) < 1e-6, 'the flat case is wrong');

  /* Market spikes 35%. The unit now costs $67.50, you still pay 0.95 × $50. */
  const spike = S.settle(c, log(1000, 67.5), 1.35, 0);
  console.log(`  the same round inside a 35% cost spike: ${money(-spike.adjustment)} saved`);
  assert(Math.abs(spike.adjustment + 20000) < 1e-6, 'the spike case is wrong');
  assert(spike.adjustment < level.adjustment, 'a cost spike did not make the contract worth more');

  /* Market falls 15%. Now the lock is above the market and the contract costs. */
  const glut = S.settle(c, log(1000, 42.5), 0.85, 0);
  console.log(`  and inside a commodity glut: ${money(spike.adjustment && glut.adjustment)} — it costs you`);
  assert(glut.adjustment > 0, 'a cheap market did not make the lock a liability');

  /* Take-or-pay: half the volume made, and a deficiency charge on the rest.
     Not the full invoice — see the note on SHORTFALL. */
  const short = S.settle(c, log(500, 50), 1.0, 0);
  console.log(`  500 made against 1,000 committed: ${money(short.adjustment)} — `
    + `${money(short.onShortfall)} of it a deficiency charge on units never taken`);
  assert.strictEqual(short.shortfall, 500);
  assert(Math.abs(short.onShortfall - 500 * 47.5 * S.C.SHORTFALL) < 1e-6,
    'the take-or-pay charge is wrong');
  assert(short.adjustment > 0, 'producing half the commitment was free');
  assert(short.onShortfall < 500 * 47.5,
    'a unit never taken cost the full price, which is what made this a trap');

  /* Nothing made at all. There is no observed rate this round, so the one the
     contract was signed at stands in — and the whole commitment is owed. */
  const nothing = S.settle(c, [], 1.0, 0);
  console.log(`  nothing made at all: ${money(nothing.adjustment)} owed on the whole commitment`);
  assert(Math.abs(nothing.adjustment - 1000 * 50 * 0.95 * S.C.SHORTFALL) < 1e-6,
    'a round with no production escaped the commitment');

  /* Over the commitment, the excess is bought at the market like anyone else. */
  const over = S.settle(c, log(1500, 50), 1.0, 0);
  console.log('  1,500 made against 1,000 committed: the extra 500 at the market rate');
  assert.strictEqual(over.overspill, 500);
  assert(Math.abs(over.adjustment + 2500) < 1e-6, 'the excess was not bought at market');

  /* Outside the term it does nothing at all. */
  assert.strictEqual(S.settle(c, log(1000, 50), 1.0, 4).active, false,
    'a finished contract kept charging');
  console.log('  and after round 3 it stops\n');
}

/* ------------------------------------------------- your own learning is yours */
console.log('The lock is on the market, not on your factory:');
{
  const c = { committed: 1000, term: 4, lock: 0.95, from: 0, to: 3, baseUnit: 50 };
  /* Same market, but this company has learned: its units now cost $40 to make.
     The saving scales with the cheaper unit rather than the contract turning
     into a liability because the player got better at manufacturing. */
  const before = S.settle(c, [{ produced: 1000, unitCost: 50 }], 1.0, 0);
  const after = S.settle(c, [{ produced: 1000, unitCost: 40 }], 1.0, 0);
  console.log(`  at $50 a unit: ${money(-before.adjustment)} saved`);
  console.log(`  at $40 a unit, same contract: ${money(-after.adjustment)} saved`);
  assert(after.adjustment < 0, 'learning to build cheaply turned the contract into a penalty');
  assert(Math.abs(after.adjustment + 2000) < 1e-6, 'the lock did not follow the unit down');
  console.log('  the lock followed the cost down — it fixes the market, not the factory\n');
}

/* --------------------------------------------------------- inside a real game */
console.log('Inside a real game:');
const { game, token } = G.createGame({
  hostName: 'Ravenscarr', seats: 4, rounds: 12, preset: 'standard',
  seed: 4242, now: at(0),
});
G.startGame(game, token, at(0));
const me = game.seats.find((s) => s.token === token);

function orders(v) {
  const products = {};
  for (const p of v.you.products) {
    products[p.name] = {
      price: Math.round(p.value * 0.97), rd: 30000, rdProcess: 12000,
      advertising: 8000, targetCapacity: Math.round(p.capacity), discontinue: false,
      produce: Math.max(0, Math.min(Math.round((p.lastDemand || 1300) * 1.05),
                                    p.effCapacity) - p.inventory),
    };
  }
  return products;
}

{
  /* Round 0: there is no throughput yet, and an offer still has to exist —
     otherwise the idea is introduced on a screen where it cannot be used. */
  const v0 = G.viewFor(game, token);
  assert(v0.you.supply.canSign, 'no contract could be signed in round 0');
  assert(v0.you.supply.offers.reference > 0, 'the supplier had nothing to quote against');
  console.log(`  round 0 quote is against ${Math.round(v0.you.supply.offers.reference).toLocaleString('en-US')}`
    + ' units of buildable throughput, because nothing has shipped yet');

  const want = Math.round(v0.you.supply.offers.reference);
  G.submitDecisions(game, token, {
    products: orders(v0), contract: { committed: want, term: 5 },
  });
  const c = me.contract;
  console.log(`  signed: ${c.committed.toLocaleString('en-US')} units a round for `
    + `${c.term} rounds at ${c.lock.toFixed(3)}× the market, rounds ${c.from}–${c.to}`);
  assert.strictEqual(c.from, 0, 'the contract did not start with the round it was signed in');

  /* Signing again while one runs is the thing this must refuse. */
  const v = G.viewFor(game, token);
  assert.strictEqual(v.you.supply.canSign, false, 'a second contract was on offer');
  assert.throws(() => G.submitDecisions(game, token, {
    products: orders(v), contract: { committed: 10, term: 3 },
  }), /already have a supply contract/, 'a second contract was signed over the first');
  console.log('  and a second one cannot be signed over it');
}

{
  /* A contract must not renew itself because somebody missed a deadline. That
     would be the most expensive silent default in the game. */
  const terms = (c) => [c.committed, c.term, c.lock, c.from, c.to, c.signedRound].join('/');
  const before = terms(me.contract);
  G.resolveRound(game, at(1));
  G.resolveRound(game, at(2));       // two rounds on standing orders
  assert.strictEqual(terms(me.contract), before,
    'standing orders re-signed the contract on new terms');
  console.log('  standing orders repeat the orders and never re-sign the contract');
}

{
  while (game.status === 'playing') {
    const v = G.viewFor(game, token);
    if (v.you && v.you.products.length && !v.you.bankrupt) {
      try { G.submitDecisions(game, token, { products: orders(v) }); } catch {}
    }
    G.resolveRound(game, at(game.round + 3));
  }
  const settled = game.history
    .map((h) => h.results.find((r) => r.seatId === me.id))
    .filter((r) => r && r.supply);
  const saved = settled.reduce((a, r) => a + Math.max(0, -r.supply.adjustment), 0);
  const paid = settled.reduce((a, r) => a + Math.max(0, r.supply.adjustment), 0);
  console.log(`  over the whole season it settled in ${settled.length} rounds — `
    + `${money(saved)} saved, ${money(paid)} paid`);
  assert.strictEqual(settled.length, 5, `a 5-round contract settled in ${settled.length} rounds`);
  assert.strictEqual(game.history.filter((h) => {
    const r = h.results.find((x) => x.seatId === me.id);
    return r && r.supply;
  }).length, 5, 'the contract settled outside its term');

  /* And once it has finished the company can sign another. */
  console.log(`  after it ended, another could be signed: `
    + `${S.canSign(me, { ...game, round: 8, config: game.config })}`);
}

/* --------------------------------------------- the book value does not drift */
console.log('\nThe books do not drift:');
{
  /* The failure this guards against: settle by rewriting the unit cost and the
     value of stock on hand no longer matches what was paid for it, which shows
     up rounds later as profit from nowhere. Two identical games, one with a large
     contract, must hold identically valued inventory — because a cash hedge is
     not a change in what the factory paid. */
  const build = (withContract) => {
    const { game: g, token: t } = G.createGame({
      hostName: 'Testfield', seats: 4, rounds: 10, preset: 'standard',
      seed: 909090, now: at(0),
    });
    G.startGame(g, t, at(0));
    const seat = g.seats.find((s) => s.token === t);
    let first = true;
    while (g.status === 'playing') {
      const v = G.viewFor(g, t);
      if (v.you && v.you.products.length && !v.you.bankrupt) {
        const body = { products: orders(v) };
        if (first && withContract) {
          body.contract = { committed: Math.round(v.you.supply.offers.reference * 0.9), term: 6 };
        }
        try { G.submitDecisions(g, t, body); } catch {}
        first = false;
      }
      G.resolveRound(g, at(g.round + 1));
    }
    return seat;
  };
  const plain = build(false);
  const hedged = build(true);
  const book = (s) => E.live(s.firm).reduce((a, p) => a + p.invBook, 0);
  const stock = (s) => E.live(s.firm).reduce((a, p) => a + p.inventory, 0);
  assert(!plain.firm.bankrupt && !hedged.firm.bankrupt,
    'one arm went under, so the comparison is of two different histories');
  console.log(`  stock on hand: ${Math.round(stock(plain))} vs ${Math.round(stock(hedged))} units`);
  console.log(`  book value:    ${money(book(plain))} vs ${money(book(hedged))}`);
  assert(Math.abs(book(plain) - book(hedged)) < 1e-6,
    'the contract changed the book value of inventory — that is the drift bug');
  console.log('  identical, because the contract settles in cash and never touches the unit cost');
  console.log(`  and it was worth ${money(E.companyValue(hedged.firm) - E.companyValue(plain.firm))}`
    + ' to this company in this seeded season');
}

/* --------------------------------------- a contract can end a company outright */
console.log('\nA commitment big enough to end you ends you in the round it lands:');
{
  const { game: g, token: t } = G.createGame({
    hostName: 'Overreach', seats: 4, rounds: 12, preset: 'brutal', seed: 77, now: at(0),
  });
  G.startGame(g, t, at(0));
  const seat = g.seats.find((s) => s.token === t);
  const v = G.viewFor(g, t);
  /* The worst thing you can do with a take-or-pay commitment: sign the largest
     one on offer and then build nothing at all. Pay for everything, use none of
     it. */
  const idle = orders(v);
  for (const k of Object.keys(idle)) idle[k].produce = 0;
  G.submitDecisions(g, t, {
    products: idle,
    contract: { committed: v.you.supply.offers.maxCommitted, term: 8 },
  });
  seat.firm.debt = g.config.credit * 0.9;

  /* The control: the identical round with no contract. If this company goes
     under either way the test proves nothing. */
  const { game: c2, token: t2 } = G.createGame({
    hostName: 'Overreach', seats: 4, rounds: 12, preset: 'brutal', seed: 77, now: at(0),
  });
  G.startGame(c2, t2, at(0));
  const control = c2.seats.find((s) => s.token === t2);
  const idle2 = orders(G.viewFor(c2, t2));
  for (const k of Object.keys(idle2)) idle2[k].produce = 0;
  G.submitDecisions(c2, t2, { products: idle2 });
  control.firm.debt = c2.config.credit * 0.9;
  G.resolveRound(c2, at(1));

  G.resolveRound(g, at(1));
  const mine = g.history[0].results.find((r) => r.seatId === seat.id);
  console.log(`  charged ${money(mine.supply.adjustment)} against a credit line `
    + `${money(g.config.credit)} wide and already ${money(g.config.credit * 0.9)} drawn`);
  console.log(`  the same round with no contract: bankrupt ${control.firm.bankrupt}`);
  console.log(`  with the contract:               bankrupt ${seat.firm.bankrupt}`);
  assert.strictEqual(control.firm.bankrupt, false,
    'the control went under on its own, so the contract proved nothing');
  assert.strictEqual(mine.bankrupt, true,
    'the round result said the company survived a contract that had ended it');
  console.log('  the round that charges it is the round that decides it\n');
}

console.log('contracts OK');
