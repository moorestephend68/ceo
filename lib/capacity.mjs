/* Leasing plant, in both directions.

   Capacity in this game has only ever been permanent. You buy it at $18 a unit
   and it arrives a round later, or you sell it and recover $7.20 — a 60% haircut
   the moment you change your mind. There is no way to answer a two-round demand
   spike, and no way to sit out a two-round trough without paying for a factory
   nobody is using.

   Work out what temporary capacity costs today and the gap is obvious. Buying a
   unit and dumping it two rounds later costs $18, recovers $7.20, and pays $5 a
   round of upkeep in between: $20.80, or $10.40 per unit per round. Over five
   rounds the same unit costs $7.16 a round, and over ten, $6.08. Owning is
   cheap if you keep it and brutal if you do not, which means the game already
   punishes temporary capacity — it just offers no alternative to being punished.

   ------------------------------------------------------------- what is added

   Two leases, both running exactly two rounds and then ending on their own.

   **Lease in.** Rent plant you do not own. It is available in the round you sign
   for it, which is the whole point — bought capacity takes a round to arrive and
   a spike does not wait. It costs more per round than owning, and it stops.

   **Lease out.** Rent your idle plant to somebody else. You keep the asset and
   you stop paying to run it, but you cannot have it back for two rounds.

   ----------------------------------------------------------------- the traps

   Each direction has one, and they are the reason this is a decision.

   Lease in for a spike that does not arrive and you have paid for plant you did
   not use. That is annoying and survivable.

   Lease out and watch demand recover is the serious one. You are capacity-bound
   for up to two rounds, you stock out, and a stockout carries into next round's
   demand pool as well. Renting out the factory the round before the market turns
   is the most expensive thing in this file.

   ------------------------------------------------------------------- pricing

   The rates are set against the buy-and-dump cost above rather than invented.
   Leasing in is dearer per round than owning for the long run and cheaper than
   owning for two rounds, so the boundary between the two levers falls exactly
   where the lease term ends. Leasing out pays less than leasing in, because
   every rental market has a spread — and more than selling into the game's 60%
   resale haircut, which is the point and is discussed on LEASE_OUT below.

   ------------------------------------------------------- how it is applied

   Leased units are held here, never inside `p.capacity`, and folded in for the
   duration of one resolve() call and immediately folded back out. That keeps the
   engine untouched — it is generated from a source file outside this repository
   and shared byte-identical with the single-player game — and it keeps
   `targetCapacity` meaning what it has always meant: the size of the plant you
   own. A player cannot accidentally sell a factory they are renting, because the
   build and sell orders are computed before any of this is applied. */

export const C = {
  /* Per unit per round, on top of the ordinary running cost. Leased plant is
     still plant: you pay the $5 a round to operate it whoever owns it, and this
     is the rent on top. All in, that is $9.50 a unit a round against $10.40 for
     buying and dumping over the same two rounds — cheaper than the alternative
     that exists today, dearer than owning anything you intend to keep.

     Swept from $3 to $9. The rate barely moves what a careful player earns and
     moves sharply what a careless one loses: at $3, renting blindly every round
     costs $45,233 and bankrupts 13%; at $9 it costs $125,242 and bankrupts 30%.
     $4.50 is where reading the headlines is worth about $34,000 and ignoring
     them costs about $63,000, which is the spread this lever exists to create. */
  LEASE_IN: 4.5,

  /* Per unit per round, received, and no running cost while it is out — whoever
     is renting it is the one operating it, so the $5 a round is theirs too.

     Set by sweeping it against two rules at once: a player who rents out idle
     plant during an announced slump, and a player who rents out everything spare
     every chance they get. At $3 the careful rule was worth $5,218 and barely
     distinguishable from noise; at $4 it is worth $7,902 and the careless one
     still bankrupts more than half the companies that try it. Raising the rate
     does not rescue the careless version, because what makes it careless is
     giving away production, not the price it gets for it.

     **It must stay below LEASE_IN, and that is not a matter of taste.** Rented-in
     plant pays the running cost and rented-out plant does not, so the upkeep
     cancels exactly and the difference between the two rates is pure profit per
     unit cycled. Set at $5 against $4.50 in — which is what the sweep first
     suggested — a company with two lines could rent capacity out of one and into
     the other, hold exactly the same total plant, and collect fifty cents a unit
     a round for it. A rental market without a spread is a money pump.

     One consequence worth stating rather than hiding: this makes renting out
     better than selling for any plant that is genuinely idle, at any rate above
     about $0.90 a round. Both stop the running cost; selling pays $7.20 once and
     renting pays $5 every round it is out. Measured over 300 seasons, answering
     an idle line by selling it down is worth -$271,938 and by renting it out
     -$27,484.

     That was not the intention and it is not being corrected, because it is
     right. A 60% haircut on resale is a fire-sale price, and a fire-sale should
     lose to renting. What it means is that selling plant is now the answer to a
     narrower question than before — when the cash is needed now, or the line is
     being abandoned — rather than the only way to shrink. */
  LEASE_OUT: 4.0,

  /* Both leases run this many rounds and then stop on their own. Long enough to
     cover the shorter shocks — a supply crunch is two rounds, a logistics strike
     is two — and short enough that it is never a substitute for owning. */
  TERM: 2,

  /* You cannot rent a factory larger than the one you have. Plant does not
     appear from nowhere at short notice, and without a cap this becomes a way to
     buy a whole second company for a round. */
  MAX_IN_RATIO: 1.0,

  /* The engine will not let a product fall below this much owned capacity, and
     neither will leasing it out. */
  FLOOR: 400,
};

export class NotAllowed extends Error {}

const isRunning = (l, round) => round >= l.from && round <= l.to;

/* Everything currently running, by product. */
export function activeAt(leases, round) {
  return (leases || []).filter((l) => isRunning(l, round));
}

/* The net change to a product's usable capacity this round: rented in counts
   up, rented out counts down. */
export function deltaFor(leases, round, productName) {
  let d = 0;
  for (const l of activeAt(leases, round)) {
    if (l.product !== productName) continue;
    d += l.kind === 'in' ? l.units : -l.units;
  }
  return d;
}

/* What the leases cost or earn this round. Positive means it costs money, the
   same sign convention as the supply contract. */
export function settle(leases, round) {
  const live = activeAt(leases, round);
  if (!live.length) return { active: false, adjustment: 0, rentPaid: 0, rentEarned: 0 };

  let rentPaid = 0, rentEarned = 0, unitsIn = 0, unitsOut = 0;
  for (const l of live) {
    if (l.kind === 'in') { rentPaid += l.units * C.LEASE_IN; unitsIn += l.units; }
    else { rentEarned += l.units * C.LEASE_OUT; unitsOut += l.units; }
  }
  return {
    active: true,
    adjustment: rentPaid - rentEarned,
    rentPaid, rentEarned, unitsIn, unitsOut,
    /* Which of them end after this round, so the player can be told before it
       happens rather than discovering it in the results. */
    ending: live.filter((l) => l.to === round)
      .map((l) => ({ product: l.product, units: l.units, kind: l.kind })),
  };
}

/* How much of a product could be leased out right now: everything owned above
   the floor, less whatever is already out. */
export function spareFor(product, leases, round) {
  const alreadyOut = activeAt(leases, round)
    .filter((l) => l.product === product.name && l.kind === 'out')
    .reduce((a, l) => a + l.units, 0);
  return Math.max(0, product.capacity - C.FLOOR - alreadyOut);
}

/* And how much could be leased in: up to the size of the plant already there,
   less whatever is already in. */
export function headroomFor(product, leases, round) {
  const alreadyIn = activeAt(leases, round)
    .filter((l) => l.product === product.name && l.kind === 'in')
    .reduce((a, l) => a + l.units, 0);
  return Math.max(0, product.capacity * C.MAX_IN_RATIO - alreadyIn);
}

/* What the player is shown for one product. */
export function offerFor(product, leases, round, roundsLeft) {
  const enough = roundsLeft >= 1;
  return {
    product: product.name,
    term: C.TERM,
    inRate: C.LEASE_IN, outRate: C.LEASE_OUT,
    maxIn: Math.round(headroomFor(product, leases, round)),
    maxOut: Math.round(spareFor(product, leases, round)),
    /* Both rates as a whole bill, because a rate per unit per round is not a
       number anyone can weigh against a $18 purchase price without arithmetic. */
    costPerRoundAt: (units) => units * C.LEASE_IN,
    canLease: enough,
  };
}

/* Sign one. Validated against the plant as it stands, and refused rather than
   silently clamped — a player who asks for 2,000 units and gets 600 has been
   told something untrue about their own factory. */
export function lease(seat, game, { product, units, kind }) {
  if (kind !== 'in' && kind !== 'out') throw new NotAllowed('A lease is either in or out.');
  const p = (seat.firm.products || []).find((x) => x.alive && x.name === product);
  if (!p) throw new NotAllowed('That is not one of your product lines.');

  const want = Math.round(Number(units));
  if (!Number.isFinite(want) || want <= 0) throw new NotAllowed('Say how many units.');

  const leases = seat.leases || [];
  const round = game.round;

  /* Both directions at once on the same line is not a position, it is a
     misunderstanding, and it would net out to paying the spread for nothing. */
  const opposite = activeAt(leases, round)
    .some((l) => l.product === product && l.kind !== kind);
  if (opposite) {
    throw new NotAllowed(kind === 'in'
      ? 'You are already renting out capacity on that line. End that first.'
      : 'You are already renting capacity in on that line.');
  }

  if (kind === 'in') {
    const room = headroomFor(p, leases, round);
    if (want > room) {
      throw new NotAllowed(`You can rent in at most ${Math.round(room).toLocaleString('en-US')} `
        + 'units on that line — nobody has a spare factory bigger than yours to hand.');
    }
  } else {
    const spare = spareFor(p, leases, round);
    if (want > spare) {
      throw new NotAllowed(`You have ${Math.round(spare).toLocaleString('en-US')} units `
        + 'spare on that line to rent out, and a plant cannot go below its floor.');
    }
  }

  return {
    product, units: want, kind,
    rate: kind === 'in' ? C.LEASE_IN : C.LEASE_OUT,
    from: round, to: round + C.TERM - 1,
    signedRound: round,
  };
}

/* Plain language for the round summary. */
export function describe(s) {
  if (!s || !s.active) return null;
  const money = (x) => '$' + Math.round(Math.abs(x)).toLocaleString('en-US');
  const bits = [];
  if (s.unitsIn) {
    bits.push(`renting in ${Math.round(s.unitsIn).toLocaleString('en-US')} units `
      + `of capacity for ${money(s.rentPaid)}`);
  }
  if (s.unitsOut) {
    bits.push(`renting out ${Math.round(s.unitsOut).toLocaleString('en-US')} units `
      + `for ${money(s.rentEarned)}`);
  }
  let out = 'Leases: ' + bits.join(', ') + '.';
  if (s.ending && s.ending.length) {
    out += ` ${s.ending.length === 1 ? 'That lease ends' : 'Those leases end'} after this round.`;
  }
  return out;
}
