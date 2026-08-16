/* Does launching new products fix long games?

   The round range was capped at 8-14 because a single product goes into decline
   at round 8 and a live company had no answer to it. Launching is that answer, so
   the cap should be re-derived rather than assumed — including whether it is
   worth doing at all, and whether it merely moves the problem.

   All seats play competent bot policies; the subject is a human seat filing
   through the ordinary path, with launching either allowed or forbidden. */

import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';

const money = (x) => (x < 0 ? '-$' : '$') + Math.abs(Math.round(x / 1000)) + 'k';

function season(seats, rounds, seed, allowLaunch) {
  const { game, token } = G.createGame({
    hostName: 'Subject', seats, rounds, preset: 'standard', seed,
    now: '2026-09-01T09:00:00Z',
  });
  G.startGame(game, token, '2026-09-01T09:00:00Z');
  const me = G.seatByToken(game, token);
  const BOT = E.BOTS.find((b) => b.id === 'balanced');
  let launched = 0;
  while (game.status === 'playing') {
    const lines = E.live(me.firm);
    if (lines.length && !me.firm.bankrupt) {
      const products = {};
      const rivals = game.seats.filter((s) => s !== me && !s.firm.bankrupt)
        .flatMap((s) => E.live(s.firm));
      const rivalPrices = game.seats.filter((s) => s !== me && !s.firm.bankrupt)
        .flatMap((s) => E.live(s.firm).map((p) => (s.lastPriceBy || {})[p.name] || s.lastPrice));
      for (const p of lines) {
        const st = { drift: 0, lastShare: me.lastShare, lastStockout: false, mistakeCd: 0,
                     anchor: BOT.priceRatio,
                     rand: E.mulberry32((seed ^ 17 ^ game.round * 7919) >>> 0) };
        const eff = E.humaniseBot(BOT, st);
        const price = E.humanPrice(E.value(p), eff.priceRatio, st.rand);
        const guess = E.estimateShare(p, price, rivals, rivalPrices, 1);
        const plan = E.botDecideFor(me.firm, eff, p, guess,
                                    { budgetShare: 1 / lines.length });
        products[p.name] = {
          price, produce: plan.produce, rd: plan.rd, rdProcess: plan.rdProcess,
          advertising: plan.advertising,
          targetCapacity: p.capacity + plan.capex / E.C.CAPEX_PER_UNIT - plan.sellCapacity,
          discontinue: false,
        };
      }
      /* Launch when the existing line is maturing and the cash is genuinely
         spare — the same rule the bots use, so the comparison is fair. */
      const view = G.viewFor(game, token);
      const oldest = lines.reduce((a, p) => Math.max(a, p.age), 0);
      const want = allowLaunch && view.you.canLaunch
        && oldest >= E.C.MATURITY_ROUND - 3
        && me.firm.cash > E.C.LAUNCH_COST * 1.5 && me.firm.debt === 0;
      G.submitDecisions(game, token, { products, launch: want });
      if (want) launched += 1;
    }
    G.resolveRound(game, new Date(new Date(game.deadline).getTime() + 60000).toISOString());
  }
  return { value: E.companyValue(me.firm), bust: me.firm.bankrupt, launched,
           lines: me.firm.products.filter((p) => p.alive).length,
           botLaunches: game.history.reduce((a, h) => a + (h.launched || []).length, 0) };
}

console.log('4 companies, 24 seasons per cell. Median company value from $250k start.\n');
console.log('rounds   no launching        launching allowed      launches/season');
for (const rounds of [8, 12, 16, 20]) {
  const off = [], on = [];
  for (let s = 0; s < 24; s++) {
    off.push(season(4, rounds, 5000 + s * 313, false));
    on.push(season(4, rounds, 5000 + s * 313, true));
  }
  const med = (a) => { const v = a.map((r) => r.value).sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
  const bust = (a) => a.filter((r) => r.bust).length / a.length;
  const avgL = (a) => a.reduce((x, r) => x + r.botLaunches, 0) / a.length;
  console.log(
    String(rounds).padStart(5) + '   ' +
    money(med(off)).padStart(8) + ' (' + (bust(off) * 100).toFixed(0).padStart(2) + '% bust)   ' +
    money(med(on)).padStart(8) + ' (' + (bust(on) * 100).toFixed(0).padStart(2) + '% bust)   ' +
    avgL(on).toFixed(1).padStart(10));
}
