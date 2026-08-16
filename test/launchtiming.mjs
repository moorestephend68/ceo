/* When is a second product line worth $180,000?

   The first attempt launched late — once the original line was maturing and a
   large cash pile had built up — and it destroyed value. But the solo game's own
   advice is the opposite: launch while the first product is still strong enough
   to carry the new one. So the timing is swept rather than guessed. */

import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';

const money = (x) => (x < 0 ? '-$' : '$') + Math.abs(Math.round(x / 1000)) + 'k';

function season(rounds, seed, launchAt, kind) {
  const { game, token } = G.createGame({
    hostName: 'Subject', seats: 4, rounds, preset: 'standard', seed,
    now: '2026-09-01T09:00:00Z',
  });
  G.startGame(game, token, '2026-09-01T09:00:00Z');
  const me = G.seatByToken(game, token);
  const BOT = E.BOTS.find((b) => b.id === 'balanced');
  let did = false;
  while (game.status === 'playing') {
    const lines = E.live(me.firm);
    if (lines.length && !me.firm.bankrupt) {
      const products = {};
      const rivals = game.seats.filter((s) => s !== me && !s.firm.bankrupt).flatMap((s) => E.live(s.firm));
      const rivalPrices = game.seats.filter((s) => s !== me && !s.firm.bankrupt)
        .flatMap((s) => E.live(s.firm).map((p) => (s.lastPriceBy || {})[p.name] || s.lastPrice));
      for (const p of lines) {
        const st = { drift: 0, lastShare: me.lastShare, lastStockout: false, mistakeCd: 0,
                     anchor: BOT.priceRatio, rand: E.mulberry32((seed ^ 17 ^ game.round * 7919) >>> 0) };
        const eff = E.humaniseBot(BOT, st);
        const price = E.humanPrice(E.value(p), eff.priceRatio, st.rand);
        const guess = E.estimateShare(p, price, rivals, rivalPrices, 1);
        const plan = E.botDecideFor(me.firm, eff, p, guess, { budgetShare: 1 / lines.length });
        products[p.name] = { price, produce: plan.produce, rd: plan.rd, rdProcess: plan.rdProcess,
          advertising: plan.advertising,
          targetCapacity: p.capacity + plan.capex / E.C.CAPEX_PER_UNIT - plan.sellCapacity,
          discontinue: false };
      }
      const v = G.viewFor(game, token);
      const k = v.you.kinds.find((x) => x.id === kind);
      const want = launchAt !== null && !did && game.round === launchAt && !!(k && k.affordable);
      G.submitDecisions(game, token, { products, launch: want, launchKind: kind });
      if (want) did = true;
    }
    G.resolveRound(game, new Date(new Date(game.deadline).getTime() + 60000).toISOString());
  }
  return { value: E.companyValue(me.firm), bust: me.firm.bankrupt, did };
}

const KINDS = ['hardware', 'software', 'commodity', 'deeptech'];
const base = {};
for (const rounds of [12, 16, 20]) {
  const runs = [];
  for (let s = 0; s < 24; s++) runs.push(season(rounds, 6000 + s * 197, null, 'hardware'));
  const vals = runs.map((r) => r.value).sort((a, b) => a - b);
  base[rounds] = { med: vals[Math.floor(vals.length / 2)],
                   bust: runs.filter((r) => r.bust).length / runs.length };
}
for (const rounds of [12, 16, 20]) {
  console.log(`\n=== ${rounds} rounds ===   never launching: ` +
    `${money(base[rounds].med)} (${(base[rounds].bust * 100).toFixed(0)}% bust)`);
  console.log('kind          launch r3         launch r6         launch r9');
  console.log('            (value change, bust rate, how many of 24 could afford it)');
  for (const kind of KINDS) {
    const cells = [];
    for (const at of [2, 5, 8]) {
      if (at >= rounds - 3) { cells.push('        —'); continue; }
      const runs = [];
      for (let s = 0; s < 24; s++) runs.push(season(rounds, 6000 + s * 197, at, kind));
      /* Only the seasons where the launch actually happened. Averaging in the ones
         where it was unaffordable buries the effect under the seasons that did
         nothing — which is what made hardware and software look identical. */
      const did = runs.filter((r) => r.did);
      if (did.length < 4) { cells.push(`  ${did.length}/24 could`); continue; }
      const vals = did.map((r) => r.value).sort((a, b) => a - b);
      const med = vals[Math.floor(vals.length / 2)];
      const bust = did.filter((r) => r.bust).length / did.length * 100;
      const delta = med - base[rounds].med;
      cells.push(((delta >= 0 ? '+' : '') + money(delta) + ' ' +
                  bust.toFixed(0) + '% ' + did.length + '/24').padStart(18));
    }
    console.log('  ' + kind.padEnd(10) + cells.join(''));
  }
}
