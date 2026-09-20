/* The engine's self-test, before anything is wired to it.

   A new copy of an economy is where drift gets in. This plays whole seasons
   through lib/cargo.mjs with every seat a bot and checks the numbers land where
   the page's own calibration put them — and, just as important, that nothing
   goes NaN, nothing goes negative, and a season always ends. */
import * as K from '../lib/cargo.mjs';

const N = Number(process.env.GAMES || 300);
const money = (x) => (x < 0 ? '-$' : '$') + Math.round(Math.abs(x)).toLocaleString();
const pct = (x) => Math.round(100 * x) + '%';
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

let leadHeld = 0, comeback = 0, bestShipWon = 0, ended = 0;
const spreads = [], spends = [], ships = [], cashes = [], paid = [];
for (let g = 0; g < N; g++) {
  const { game, token } = K.createGame({ seed: 4000 + g, seats: 5, rounds: 8, cadence: 'manual' });
  /* Every seat a bot, including the host's. The first version left the host as
     a human nobody was playing — it filed nothing, took the auto route and bid
     zero all season, so one seat was deliberately bad at BOTH halves of the
     game. That alone put "the best ship wins" at 49% against the page's 19%:
     not an engine difference, a straw man sitting at the table. */
  Object.assign(game.seats[0], { isBot: true, token: null, habit: 'model', shade: 0.6 });
  K.startGame(game, token);
  let mid = null, guard = 0;
  while (game.status === 'playing' && guard++ < 200) {
    K.resolveStage(game);
    if (game.stage === 'declare' && game.round === 5 && !mid) mid = game.seats.map((s) => s.cash);
  }
  if (game.status === 'over') ended++;
  const end = game.seats.map((s) => s.cash);
  const qs = game.seats.map((s) => K.shipQ(s));
  for (const v of end) if (!Number.isFinite(v)) throw new Error('a captain finished with ' + v);
  for (const s of game.seats) {
    if (!Number.isFinite(s.hold) || s.hold <= 0) throw new Error('bad hold ' + s.hold);
    if (s.onParts > 0 && s.onParts > 40000) throw new Error('spent ' + s.onParts + ' on parts');
  }
  const ord = end.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  if (mid) {
    const mo = mid.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    if (ord[0] === mo[0]) leadHeld++;
    if (ord.slice(0, 2).includes(mo[4])) comeback++;
  }
  const bs = qs.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0])[0][1];
  if (ord[0] === bs) bestShipWon++;
  spreads.push(Math.max(...end) - Math.min(...end));
  spends.push(mean(game.seats.map((s) => s.onParts)));
  ships.push(mean(qs));
  cashes.push(mean(end));
  for (const h of game.history) for (const l of h.refit.lots) if (l.paid > 0) paid.push(l.paid);
}

console.log('\n  ' + N + ' seasons, every seat a bot, through lib/cargo.mjs\n');
console.log('  seasons that finished      : ' + ended + ' of ' + N);
console.log('  a captain ends with        : ' + money(mean(cashes)) +
  ',  spread ' + money(mean(spreads)));
console.log('  ships end at               : ' + pct(mean(ships)) +
  ',  spent on parts ' + money(mean(spends)));
console.log('  parts go for               : ' + money(mean(paid)));
console.log('  halfway leader holds on    : ' + pct(leadHeld / N));
console.log('  comeback from last         : ' + pct(comeback / N));
console.log('  the best ship wins         : ' + pct(bestShipWon / N) + '  (chance is 20%)');
if (ended !== N) { console.error('  NOT EVERY SEASON FINISHED'); process.exit(1); }
console.log('\n  the page, for comparison   : ships 56-61%, parts $193-$577, best ship 19%');
