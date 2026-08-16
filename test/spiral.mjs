/* Does health-based pricing take the game away from the player?

   A rising rate is only a good mechanic if a company that digs a hole can still
   climb out by playing well. If it cannot, the rate has replaced a decision with
   a sentence. Measured in the competitive game, not against a solo firm, because
   the pressure that actually kills companies is rivals.

   Flat is simulated by flattening the constants, so both arms run identical code. */

import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';

const REAL = { base: E.C.RATE_BASE, lev: E.C.RATE_LEVERAGE, loss: E.C.RATE_LOSSES };
const setFlat = () => { E.C.RATE_BASE = 0.05; E.C.RATE_LEVERAGE = 0; E.C.RATE_LOSSES = 0; };
const setReal = () => { E.C.RATE_BASE = REAL.base; E.C.RATE_LEVERAGE = REAL.lev; E.C.RATE_LOSSES = REAL.loss; };

/* the human seat plays a competent policy, but is forced into a disaster at a
   chosen round: it over-orders badly and prices itself out of the market */
function season(seed, rounds, disasterRound, mode) {
  mode === 'flat' ? setFlat() : setReal();
  const { game, token } = G.createGame({
    hostName: 'Subject', seats: 4, rounds, preset: 'standard', seed,
    now: '2026-09-01T09:00:00Z',
  });
  G.startGame(game, token, '2026-09-01T09:00:00Z');
  const me = G.seatByToken(game, token);
  const BOT = E.BOTS.find((b) => b.id === 'balanced');
  const trace = [];
  while (game.status === 'playing') {
    const p = E.live(me.firm)[0];
    if (p && !me.firm.bankrupt) {
      const st = { drift: 0, lastShare: me.lastShare, lastStockout: false, mistakeCd: 0,
                   anchor: BOT.priceRatio, rand: E.mulberry32((seed ^ 31 ^ game.round * 7919) >>> 0) };
      const eff = E.humaniseBot(BOT, st);
      let price = E.humanPrice(E.value(p), eff.priceRatio, st.rand);
      const others = game.seats.filter((s) => s !== me && !s.firm.bankrupt && E.live(s.firm).length);
      const guess = E.estimateShare(p, price, others.map((s) => E.live(s.firm)[0]),
                                    others.map((s) => s.lastPrice), 1);
      const plan = E.botDecide(me.firm, eff, guess, {});
      const produce = plan.produce;
      const cap = p.capacity + plan.capex / E.C.CAPEX_PER_UNIT - plan.sellCapacity;
      G.submitDecisions(game, token, {
        price, produce, rd: plan.rd, rdProcess: plan.rdProcess,
        advertising: plan.advertising, targetCapacity: cap, discontinue: false,
      });
      /* The hole is injected rather than played into. Trying to lose money by
         playing badly kept producing GOOD rounds — pricing 50% over value while
         rivals were supply-constrained is profitable, not ruinous. Injecting it
         asks the question directly: given a company already 60% of the way down
         its credit line, does competent play still get it out? */
      if (game.round === disasterRound) {
        me.firm.cash = 0;
        me.firm.debt = game.config.credit * 0.6;
        me.firm.profitHistory = [-70000, -60000];
      }
    }
    G.resolveRound(game, new Date(new Date(game.deadline).getTime() + 60000).toISOString());
    const h = game.history[game.history.length - 1];
    const r = h.results.find((x) => x.seatId === me.id);
    if (r) trace.push({ round: h.round, profit: r.profit, debt: r.debt,
                        rate: E.creditRate(me.firm, game.config.credit), bust: r.bankrupt });
  }
  return { bust: me.firm.bankrupt, value: E.companyValue(me.firm), trace };
}

const money = (x) => (x < 0 ? '-$' : '$') + Math.abs(Math.round(x / 1000)) + 'k';

console.log('One company hits a disaster at round 4, then plays well for the rest.');
console.log('24 seasons per cell, 4 companies, 12 rounds.\n');
console.log('                    flat 5%              health-based');
console.log('                 bust%   median      bust%   median   peak rate');
for (const dis of [3, 5, 7]) {
  const out = {};
  for (const mode of ['flat', 'health']) {
    const runs = [];
    for (let s = 0; s < 24; s++) runs.push(season(3000 + s * 271, 12, dis, mode));
    const vals = runs.map((r) => r.value).sort((a, b) => a - b);
    out[mode] = {
      bust: runs.filter((r) => r.bust).length / runs.length,
      med: vals[Math.floor(vals.length / 2)],
      peak: Math.max(...runs.flatMap((r) => r.trace.map((t) => t.rate))),
    };
  }
  console.log(`  disaster r${dis + 1}   ` +
    (out.flat.bust * 100).toFixed(0).padStart(4) + '%' + money(out.flat.med).padStart(9) +
    (out.health.bust * 100).toFixed(0).padStart(11) + '%' + money(out.health.med).padStart(9) +
    (out.health.peak * 100).toFixed(1).padStart(9) + '%');
}

console.log('\nA single season in detail (disaster at round 4, health-based):');
const one = season(3271, 12, 3, 'health');
console.log('  rnd     profit       debt    rate');
for (const t of one.trace) {
  console.log(`  ${String(t.round).padStart(3)} ${money(t.profit).padStart(10)} ` +
              `${money(t.debt).padStart(10)}  ${(t.rate * 100).toFixed(1).padStart(5)}%` +
              (t.bust ? '   BANKRUPT' : ''));
}
console.log(`  climbed out: ${!one.bust}, finished ${money(one.value)}`);
setReal();
