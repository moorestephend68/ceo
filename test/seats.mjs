/* Does a live game stay worth playing as seats are added?

   §16 says 3-6 players, but that was measured before advertising existed and
   before the current constants. Every seat brings its own customers AND its own
   $65k of fixed cost, so the answer is not obvious. All seats play competently
   (bot policies) so this measures the economy, not the players. */

import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';

const money = (x) => (x < 0 ? '-$' : '$') + Math.abs(Math.round(x / 1000)) + 'k';

function season(seats, rounds, seed, adOn) {
  const { game, token } = G.createGame({
    hostName: 'H', seats, rounds, preset: 'standard', seed,
    now: '2026-09-01T09:00:00Z',
  });
  /* all seats bot-filled so nobody is handicapped */
  game.config.seats = seats;
  G.startGame(game, token, '2026-09-01T09:00:00Z');
  if (!adOn) for (const s of game.seats) if (s.isBot) s.botState.noAd = true;
  let t = new Date('2026-09-01T09:00:00Z').getTime();
  while (game.status === 'playing') {
    /* the one human seat plays the balanced policy through the normal path */
    const me = G.seatByToken(game, token);
    if (!me.firm.bankrupt && E.live(me.firm).length) {
      const p = E.live(me.firm)[0];
      const BOT = E.BOTS.find((b) => b.id === 'balanced');
      const st = { drift: 0, lastShare: me.lastShare, lastStockout: false,
                   mistakeCd: 0, anchor: BOT.priceRatio,
                   rand: E.mulberry32((seed ^ 555 ^ game.round * 7919) >>> 0) };
      const eff = E.humaniseBot(BOT, st);
      if (!adOn) eff.ad = 0;
      const price = E.humanPrice(E.value(p), eff.priceRatio, st.rand);
      const others = game.seats.filter((s) => s !== me && !s.firm.bankrupt && E.live(s.firm).length);
      const guess = E.estimateShare(p, price, others.map((s) => E.live(s.firm)[0]),
                                    others.map((s) => s.lastPrice), 1);
      const plan = E.botDecide(me.firm, eff, guess, {});
      G.submitDecisions(game, token, {
        price, produce: plan.produce, rd: plan.rd, rdProcess: plan.rdProcess,
        advertising: plan.advertising,
        targetCapacity: p.capacity + plan.capex / E.C.CAPEX_PER_UNIT - plan.sellCapacity,
        discontinue: false,
      });
    }
    t = new Date(game.deadline).getTime() + 60000;
    G.resolveRound(game, new Date(t).toISOString());
  }
  const vals = game.seats.map((s) => E.companyValue(s.firm));
  const busts = game.seats.filter((s) => s.firm.bankrupt).length;
  return { vals, busts, top: Math.max(...vals), med: vals.slice().sort((a, b) => a - b)[Math.floor(vals.length / 2)] };
}

/* advertising is a prisoner's dilemma; the bot personalities all buy some, so
   "everyone advertises" is the realistic case. Measure it against the ceasefire. */
for (const rounds of [8, 12]) {
  console.log(`\n=== ${rounds} rounds, start $250k ===`);
  console.log('seats  winner    median   busts/game   |  same with nobody advertising');
  for (const seats of [3, 4, 5, 6]) {
    const runs = [];
    const quiet = [];
    for (let s = 0; s < 24; s++) {
      runs.push(season(seats, rounds, 1000 + s * 137, true));
      quiet.push(season(seats, rounds, 1000 + s * 137, false));
    }
    const avg = (a, f) => a.reduce((x, r) => x + f(r), 0) / a.length;
    console.log(
      String(seats).padStart(4) + '  ' +
      money(avg(runs, (r) => r.top)).padStart(8) +
      money(avg(runs, (r) => r.med)).padStart(9) +
      avg(runs, (r) => r.busts).toFixed(2).padStart(11) + '     |  ' +
      money(avg(quiet, (r) => r.top)).padStart(8) +
      money(avg(quiet, (r) => r.med)).padStart(9) +
      avg(quiet, (r) => r.busts).toFixed(2).padStart(8));
  }
}
