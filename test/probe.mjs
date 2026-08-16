/* Is the server wiring right, or were my test players just bad?

   One human seat plays exactly the policy a bot would play, through the ordinary
   submitDecisions path. If its trajectory tracks the bot seats, the server's
   round is wired correctly and any losses are strategy, not plumbing. */

import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';

const money = (x) => (x < 0 ? '-$' : '$') + Math.abs(Math.round(x)).toLocaleString('en-US');

const { game, token } = G.createGame({
  hostName: 'Probe Co', seats: 5, rounds: 12, preset: 'standard',
  closeHour: 18, seed: 4242, now: '2026-09-01T09:00:00Z',
});
G.startGame(game, token, '2026-09-01T09:00:00Z');

const me = G.seatByToken(game, token);
const BOT = E.BOTS.find((b) => b.id === 'balanced');
const st = { drift: 0, lastShare: null, lastStockout: false, mistakeCd: 0, anchor: BOT.priceRatio };

let t = new Date('2026-09-01T09:00:00Z').getTime();
console.log('rnd   my price  my share   my profit    my cash | bot profits');
while (game.status === 'playing') {
  /* the same decision a bot in this seat would make, filed as a human */
  const p = E.live(me.firm)[0];
  st.rand = E.mulberry32((game.seed ^ 999 ^ game.round * 104729) >>> 0);
  const eff = E.humaniseBot(BOT, st);
  const price = E.humanPrice(E.value(p), eff.priceRatio, st.rand);
  const others = game.seats.filter((s) => s !== me && !s.firm.bankrupt && E.live(s.firm).length);
  const guess = E.estimateShare(p, price, others.map((s) => E.live(s.firm)[0]),
                                others.map((s) => s.lastPrice), 1);
  const plan = E.botDecide(me.firm, eff, guess, {});
  delete st.rand;
  G.submitDecisions(game, token, {
    price, produce: plan.produce, rd: plan.rd, rdProcess: plan.rdProcess,
    advertising: plan.advertising,
    targetCapacity: p.capacity + plan.capex / E.C.CAPEX_PER_UNIT - plan.sellCapacity,
    discontinue: false,
  });

  t = new Date(game.deadline).getTime() + 60000;
  G.resolveRound(game, new Date(t).toISOString());
  const h = game.history[game.history.length - 1];
  const mine = h.results.find((r) => r.seatId === me.id);
  const bots = h.results.filter((r) => r.seatId !== me.id);
  console.log(
    String(h.round).padStart(3) + '  ' +
    ('$' + mine.price.toFixed(2)).padStart(9) +
    (mine.share * 100).toFixed(0).padStart(7) + '%' +
    money(mine.profit).padStart(12) +
    money(mine.cash).padStart(11) + ' | ' +
    bots.map((b) => money(b.profit).padStart(10)).join(''));
  if (mine.bankrupt) { console.log('  probe went bankrupt'); break; }
}

const view = G.viewFor(game, token);
const table = view.market.slice().sort((a, b) => b.finalValue - a.finalValue);
console.log('\nfinal');
table.forEach((m, i) => console.log(`  ${i + 1}. ${m.name.padEnd(22)} ` +
  `${money(m.finalValue).padStart(11)}  ${m.isBot ? m.strategy : 'THE PROBE (human seat)'}`));
