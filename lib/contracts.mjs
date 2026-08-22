/* Supplier contracts.

   An investor asked whether a player ever negotiates with anybody — for raw
   materials, for space, for a raise. The honest answer for two of those three is
   that the game already has the lever under a different name: leasing space is
   `targetCapacity`, and paying people better is process R&D. Adding a second
   control that does the same arithmetic would make the screen longer without
   making the decision harder.

   Raw materials were the one real gap. Input costs move — there is a cost shock
   track in the engine, roughly 27% of rounds are inside one, and a player has no
   answer to it beyond producing less. This is the answer: commit to buying a
   volume every round for a run of rounds, and the supplier fixes your rate
   against the market.

   ---------------------------------------------------------------- what it is

   Three numbers make a contract: how many units a round you commit to, how many
   rounds it runs, and the rate the supplier locks you at. The player picks the
   first two; the third comes off a curve, and the curve is the negotiation.

   Commit more and the rate falls: the supplier is paying you for certainty of
   volume. Commit for longer and the rate rises: they are now carrying your price
   risk for more of the season, and they charge for it.

   So the two levers pull against each other, which is the whole reason there is
   a decision here. Volume buys a better rate and buys take-or-pay risk with it.
   Term buys more rounds of cover and pays a worse rate for them. Nothing on the
   curve is free and nothing on it is strictly best.

   ------------------------------------------------------------ take-or-pay

   The commitment is take-or-pay: you pay for the committed volume whether you
   use it or not. That is not a punishment bolted on to make the lever spicy — it
   is the entire reason the supplier discounts. A contract you could walk away
   from in a bad round would be a free option, the rate would have to price it as
   one, and there would be no decision left.

   So the shape of the thing is: it pays when you keep producing and costs when
   you do not, and demand shocks are what stop you producing. A recession is a
   70% demand multiplier for three rounds. Signing a big number the round before
   one of those arrives is how this hurts.

   -------------------------------------------------------- how it settles

   As cash, once a round, after the engine has resolved — not by rewriting what
   the factory paid.

   The alternative was to change the unit cost inside resolve(), and it is wrong
   twice over. The engine is generated from a source file that lives outside this
   repo and is shared byte-identical with the single-player game, so multiplayer
   cannot quietly diverge from it. And the cost of a unit is booked into
   inventory: change it after the fact and the book value of stock drifts away
   from what was paid for it, which shows up rounds later as profit that came
   from nowhere.

   Settling in cash is also what a real hedge does. You buy at the market rate
   and the contract pays the difference. The arithmetic:

     covered   = min(produced, committed)   paid at the locked rate
     overspill = produced - committed       paid at the market rate, if positive
     shortfall = committed - produced       paid at the locked rate, for nothing

     adjustment = covered × (locked - market) + shortfall × locked

   Positive means the contract cost you money this round. It is charged the same
   way a loss is: out of cash, onto the credit line if the cash is not there.

   ------------------------------------------------------ the locked rate

   The lock is a multiplier on the market cost shock, not a dollar figure. Your
   own learning and your own process R&D still bring the cost of a unit down
   underneath it; what is fixed is the part of the price the world sets.

   That distinction matters. Locking a dollar price would mean a contract turns
   into a bad deal purely because the player got better at manufacturing, which
   would teach exactly the wrong lesson. */

/* The shape of the curve. Every one of these was moved and re-measured; see
   test/contracts.mjs and §38 of the design doc for what each is worth. */
export const C = {
  /* The rate for committing almost nothing, before volume and term move it.

     Swept from 0.99 to 1.09 over 300 matched seasons a step. Below about 1.02
     every modest contract simply pays — free money for reading the manual. Above
     about 1.06 nothing on the curve is worth signing and the lever is dead
     weight on the screen. 1.04 is where a contract sized to your own production
     costs a little on the median and takes about $9,000 off the worst tenth of
     seasons, which is what a hedge is supposed to do. */
  BASE: 1.04,
  /* How far the rate can fall on volume alone, and how quickly it gets there.

     These two were the whole calibration. The first pass had the discount
     arriving fast — a contract covering your own throughput locked at 0.95
     against a market averaging 1.039, which is a 9% saving on materials for no
     risk anybody would notice. Measured over 400 seasons it beat never signing
     by $23,549 AND went bankrupt less often AND had a better worst tenth. That
     is not a hedge, it is a coupon, and a coupon everybody should clip is a tax
     on players who have not read the manual.

     So the curve was flattened until a contract sized to your own throughput
     locks at roughly what the market averages. What is bought then is certainty,
     which is what the lever is supposed to sell — and the discount that is left
     is only reachable by committing to volumes you may not be able to use. */
  MAX_VOLUME_DISCOUNT: 0.145,
  VOLUME_SCALE: 3.1,
  /* Per round of term beyond the minimum, and NEGATIVE — a longer lock costs
     more, it does not cost less.

     It was a discount to begin with, and that made the longest term strictly
     correct: more rounds of cover at a better rate, with no offsetting cost.
     Measured at 400 seasons, an eight-round contract beat a three-round one at
     every volume. A fixed price over a longer horizon is more risk for the
     supplier, not less, so charging for it is both the right economics and the
     thing that turns term into a real choice: more cover, worse rate. */
  TERM_STEP: -0.004,
  /* Nobody gets materials at a tenth off. */
  FLOOR: 0.95,

  /* What a unit you committed to and did not take costs you, as a fraction of
     the locked rate.

     The first build charged the full price for goods never received, and that
     one number was the difference between a hedge and a trap. Measured: with a
     commitment sized to a season's production, a player falls short in 13% of
     rounds — a capacity shock, a slump, one round of over-stock — and at full
     price those rounds cost more than every cost spike the contract protects
     against. The worst tenth of seasons got worse, not better, at every price
     the supplier could offer. A lever that only ever widens the range of
     outcomes has no business being sold as certainty.

     A fraction is also what a take-or-pay clause actually says. The deficiency
     charge is the supplier's lost margin on volume they planned for and did not
     ship, not the invoice for goods that were never made. */
  SHORTFALL: 0.4,

  MIN_TERM: 3,
  MAX_TERM: 8,
  /* A supplier will not underwrite unlimited volume for a company this size. */
  MAX_RATIO: 3,
  /* Below this there is no throughput to quote against — a company in its first
     round has produced nothing yet. */
  MIN_REFERENCE: 1,
};

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/* The curve. Deterministic on purpose: a supplier who haggles differently
   depending on a die roll turns a decision into a slot machine, and the whole
   point of a seeded market is that two players who decide the same thing get the
   same result. */
export function quote(committed, term, reference) {
  const ref = Math.max(C.MIN_REFERENCE, reference || 0);
  const t = clamp(Math.round(term), C.MIN_TERM, C.MAX_TERM);
  const units = clamp(committed, 0, ref * C.MAX_RATIO);
  const ratio = units / ref;

  const volume = C.MAX_VOLUME_DISCOUNT * (1 - Math.exp(-ratio / C.VOLUME_SCALE));
  const length = C.TERM_STEP * (t - C.MIN_TERM);
  const lock = Math.max(C.FLOOR, C.BASE - volume - length);

  return { committed: units, term: t, lock, ratio };
}

/* What the player is shown. Not a list of take-it-or-leave-it deals — the whole
   curve, sampled, so the trade-off between the three numbers is visible rather
   than hidden behind three buttons someone has to reverse-engineer. The rate
   improves rightwards along a row and worsens down a column, and being able to
   see both at once is the point. */
export function offers(reference, { roundsLeft = C.MAX_TERM } = {}) {
  const ref = Math.max(C.MIN_REFERENCE, reference || 0);
  const maxTerm = clamp(roundsLeft, C.MIN_TERM, C.MAX_TERM);
  const terms = [];
  for (let t = C.MIN_TERM; t <= maxTerm; t++) terms.push(t);

  const volumes = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((r) => Math.round(ref * r));
  return {
    reference: ref,
    maxCommitted: Math.round(ref * C.MAX_RATIO),
    terms,
    volumes,
    /* One grid, so the page never has to know the curve. */
    grid: terms.map((t) => ({
      term: t,
      rates: volumes.map((v) => ({ committed: v, lock: quote(v, t, ref).lock })),
    })),
  };
}

/* Can this company sign right now? A contract is only offered when there is no
   contract running and enough of the season left for the shortest term to
   finish — signing something that outlives the game is not a decision, it is a
   trick. */
export function canSign(seat, game) {
  if (!seat || seat.out || (seat.firm && seat.firm.bankrupt)) return false;
  if (seat.contract && seat.contract.to >= game.round) return false;
  return game.config.rounds - game.round >= C.MIN_TERM;
}

/* Turn a request into a signed contract, or throw with a reason a person can
   read. Signed at the same moment orders are filed, and effective from the round
   about to be resolved — you commit to it blind, like everything else. */
export function sign(seat, game, { committed, term }, reference, baseUnit) {
  if (!canSign(seat, game)) {
    if (seat.contract && seat.contract.to >= game.round) {
      throw new Error('You already have a supply contract running. '
        + `It ends after round ${seat.contract.to}.`);
    }
    throw new Error(`There is not enough of the season left — a contract runs for at least ${C.MIN_TERM} rounds.`);
  }
  const units = Number(committed);
  if (!Number.isFinite(units) || units <= 0) {
    throw new Error('Say how many units a round you are committing to.');
  }
  const roundsLeft = game.config.rounds - game.round;
  const q = quote(units, Math.min(Number(term) || C.MIN_TERM, roundsLeft), reference);
  if (q.committed <= 0) throw new Error('That is not a volume a supplier would quote against.');

  return {
    committed: q.committed, term: q.term, lock: q.lock,
    from: game.round, to: game.round + q.term - 1,
    reference: Math.max(C.MIN_REFERENCE, reference || 0),
    signedRound: game.round,
    /* The market rate for a unit with the shock divided out, as it stood when
       this was signed. Only ever used in the one round where a company produces
       nothing at all and there is therefore no rate to observe — it still owes
       for the volume. Refreshed each round it does produce. */
    baseUnit: Number(baseUnit) || 0,
    paid: 0, saved: 0,
  };
}

const isRunning = (contract, round) =>
  !!contract && round >= contract.from && round <= contract.to;

/* What the contract does to this round's cash.

   `log` is the engine's own per-product record, which already carries what was
   produced and what each unit actually cost — so the market rate here is the
   rate the engine charged, not a second calculation of it that could drift. */
export function settle(contract, log, costShock, round) {
  const none = { active: false, adjustment: 0 };
  if (!isRunning(contract, round)) return none;

  let units = 0, spend = 0;
  for (const e of log || []) {
    if (!e || e.event === 'discontinued') continue;
    const made = Number(e.produced) || 0;
    const uc = Number(e.unitCost) || 0;
    units += made;
    spend += made * uc;
  }

  /* The market rate the engine used, with the shock divided back out, is what
     the lock is a multiplier on. With nothing produced there is no observed rate
     this round, so the one the contract was signed at stands in — a company that
     produced nothing still owes for the volume it committed to. */
  const shock = costShock || 1;
  const blended = units > 0 ? spend / units : (contract.baseUnit || 0);
  const base = blended / shock;
  const locked = base * contract.lock;

  const covered = Math.min(units, contract.committed);
  const shortfall = Math.max(0, contract.committed - units);
  const overspill = Math.max(0, units - contract.committed);

  const adjustment = covered * (locked - blended) + shortfall * locked * C.SHORTFALL;

  return {
    active: true,
    adjustment,
    committed: contract.committed, lock: contract.lock,
    units, covered, shortfall, overspill,
    marketUnit: blended, lockedUnit: locked,
    /* Split out because they are different facts about the same round and a
       player conflating them is the mistake this mechanic exists to teach: the
       rate was good AND the commitment was too big is the common case. */
    onCovered: covered * (locked - blended),
    onShortfall: shortfall * locked * C.SHORTFALL,
    base,
    lastRound: round >= contract.to,
  };
}

/* Plain language for the round summary. */
export function describe(s) {
  if (!s || !s.active) return null;
  const money = (x) => '$' + Math.round(Math.abs(x)).toLocaleString('en-US');
  if (s.shortfall > 0.5) {
    const short = Math.round(s.shortfall).toLocaleString('en-US');
    return `Supply contract: you produced ${Math.round(s.units).toLocaleString('en-US')} `
      + `of the ${Math.round(s.committed).toLocaleString('en-US')} `
      + `you committed to. ${money(s.onShortfall)} of that was paid for and not used.`;
  }
  if (s.adjustment < 0) return `Supply contract: ${money(s.adjustment)} cheaper than the market this round.`;
  if (s.adjustment > 0) return `Supply contract: ${money(s.adjustment)} dearer than the market this round.`;
  return 'Supply contract: level with the market this round.';
}
