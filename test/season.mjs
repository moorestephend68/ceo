/* A whole asynchronous season, played out in milliseconds.

   The thing that makes an async game hard to be confident about is that it takes
   twelve days to play once. So the clock is injected everywhere and the entire
   season runs here: joins, a player who files every round, a player who files
   sometimes, a player who joins and then vanishes, bot-filled seats, deadlines
   passing with orders outstanding, a company going under, and the reveal. */

import assert from 'node:assert';
import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';

const money = (x) => '$' + Math.round(x).toLocaleString('en-US');
const pct = (x) => (x * 100).toFixed(0) + '%';

let day = new Date('2026-09-01T09:00:00Z').getTime();
const HOUR = 3600 * 1000;
const now = () => new Date(day).toISOString();
const advance = (h) => { day += h * HOUR; };

/* ---------------------------------------------------------------- set up */
const { game, token: hostTok } = G.createGame({
  hostName: 'Ravensworth', seats: 5, rounds: 12, preset: 'standard',
  closeHour: 18, seed: 20260901, now: now(),
});
console.log(`game ${game.code} — ${game.config.seats} seats, ${game.config.rounds} rounds, ` +
            `${G.PRESETS[game.config.preset].label}`);

const { token: annaTok } = G.joinGame(game, 'Sableworth Ltd', now());
const { token: benTok } = G.joinGame(game, 'Ketteridge', now());
assert.throws(() => G.joinGame(game, 'ketteridge'), /already called that/);
console.log('joined:', game.seats.map((s) => s.name).join(', '));

G.startGame(game, hostTok, now());
console.log(`started with ${game.seats.length} seats, ` +
            `${game.seats.filter((s) => s.isBot).length} of them filled by bots`);
console.log('seat order:', game.seats.map((s) => s.name).join(' | '));
assert.equal(game.seats.length, 5);
assert.equal(game.status, 'playing');

/* nobody can see who is a bot while the game is running */
const midView = G.viewFor(game, annaTok);
assert(midView.market.every((m) => m.isBot === null), 'bot identity leaked mid-game');
assert(midView.market.every((m) => m.strategy === null), 'strategy leaked mid-game');
console.log('mid-game identity hidden:', midView.market.every((m) => m.isBot === null));

/* the first deadline is never minutes away just because of when you pressed go */
const lead = (new Date(game.deadline) - new Date(now())) / HOUR;
console.log(`first round closes in ${lead.toFixed(0)}h (host chose ${game.config.closeHour}:00 UTC)`);
assert(lead >= 6, 'first deadline too soon');

/* ------------------------------------------------------------- the season */
function file(tok, tweak, launch) {
  const v = G.viewFor(game, tok);
  if (!v.you || !v.you.products.length || v.you.bankrupt) return false;
  const products = {};
  for (const p of v.you.products) {
    /* Each seller brings its own customers, so a line's demand is roughly its own
       pool rather than a slice of one fixed pot. Produce to that. */
    const want = p.lastDemand || 1300;
    const base = {
      price: Math.round(p.value * 0.98),
      produce: Math.max(0, Math.min(want * 1.05, p.effCapacity) - p.inventory),
      rd: 34000, rdProcess: 12000, advertising: 6000,
      targetCapacity: Math.max(p.capacity, Math.min(want * 1.15, p.capacity * 1.3)),
      discontinue: false,
    };
    products[p.name] = { ...base, ...(tweak ? tweak(p, v) : {}) };
  }
  G.submitDecisions(game, tok, { products, launch: !!launch && v.you.canLaunch });
  return true;
}

const log = [];
let round = 0;
while (game.status === 'playing') {
  round += 1;
  /* Ravensworth is diligent — files every round, on the day. */
  file(hostTok, (p) => ({ price: Math.round(p.value * 1.02), rd: 46000, advertising: 4000 }),
       round === 6);   /* the host opens a second line halfway through */
  /* Sableworth files most rounds but forgets rounds 4 and 9. */
  if (round !== 4 && round !== 9) {
    file(annaTok, (p) => ({ price: Math.round(p.value * 0.93), rd: 26000,
                            rdProcess: 22000, advertising: 9000 }));
  }
  /* Ketteridge files twice, then stops answering entirely. */
  if (round <= 2) file(benTok, (p) => ({ price: Math.round(p.value * 0.90), advertising: 20000 }));

  const outstanding = G.humansOutstanding(game).map((s) => s.name);
  const closedEarly = outstanding.length === 0;
  if (!closedEarly) {
    /* the clock has to run out — jump to just past the deadline */
    day = new Date(game.deadline).getTime() + 60 * 1000;
  }
  assert(G.shouldResolve(game, now()), `round ${round} should have been ready to resolve`);
  G.resolveRound(game, now());

  const h = game.history[game.history.length - 1];
  const mine = h.results.find((r) => r.name === 'Ravensworth');
  log.push({
    round, closedEarly, outstanding: outstanding.join(','),
    autos: h.results.filter((r) => r.auto).map((r) => r.name).join(','),
    busts: h.results.filter((r) => r.bankrupt).map((r) => r.name).join(','),
    myShare: mine ? mine.share : 0, myProfit: mine ? mine.profit : 0,
  });
  if (game.status === 'playing') advance(20);
}

console.log('\nround  closed        waiting on               auto-filed        share   profit');
for (const l of log) {
  console.log(
    String(l.round).padStart(4) + '   ' +
    (l.closedEarly ? 'everyone in ' : 'on the clock') + '  ' +
    (l.outstanding || '—').padEnd(24) +
    (l.autos || '—').padEnd(18) +
    pct(l.myShare).padStart(5) + '  ' + money(l.myProfit).padStart(9) +
    (l.busts ? '   OUT: ' + l.busts : ''));
}

/* ------------------------------------------------------------- assertions */
assert.equal(game.status, 'over');
assert.equal(game.round, 12, 'season did not run its full length');

const early = log.filter((l) => l.closedEarly).length;
console.log(`\nrounds that closed early because everyone had filed: ${early}/12`);
assert(early >= 1, 'no round ever closed early — the everyone-in path is dead');
assert(log.some((l) => l.autos), 'standing orders never fired');

/* standing orders must actually repeat the last filed orders, not reset */
const anna = game.seats.find((s) => s.name === 'Sableworth Ltd');
assert(anna.standing && anna.standing.products, 'no standing order retained');
assert(anna.autoRounds >= 1, `expected Sableworth to be auto-filed at least once, got ${anna.autoRounds}`);
const ben = game.seats.find((s) => s.name === 'Ketteridge');
console.log(`Sableworth auto-filed ${anna.autoRounds}x, Ketteridge ${ben.autoRounds}x ` +
            `(filed rounds 1-2, then vanished${ben.firm.bankrupt ? ' and went under' : ''})`);
assert(ben.autoRounds >= 1, 'the absent player was never carried by standing orders');
/* An absent player is carried, not frozen — and being carried is not a shield:
   standing orders repeat, the market moves on, and the company can still fail. */
assert(ben.standing && ben.standing.products, 'the vanished player kept no standing order');
if (ben.firm.bankrupt) assert(ben.out, 'a bankrupt seat was not marked out');

/* launching */
const launches = game.history.flatMap((h) => (h.launched || []).map((l) => l.name));
console.log('product lines opened during the game:', launches.length ? launches.join(', ') : 'none');
const rav = game.seats.find((s) => s.name === 'Ravensworth');
console.log('Ravensworth finished running', rav.firm.products.filter((p) => p.alive).length, 'lines');
/* Not asserted: a second line costs $180,000 in cash, and a company having a hard
   season simply cannot afford one. That is the mechanic working, not failing.
   test/length.mjs is where launching is measured. */

/* the reveal */
const final = G.viewFor(game, hostTok);
const table = final.market.slice().sort((a, b) => b.finalValue - a.finalValue);
console.log('\nfinal standings');
table.forEach((m, i) => {
  console.log(`  ${i + 1}. ${m.name.padEnd(22)} ${money(m.finalValue).padStart(10)}  ` +
              `${m.isBot ? m.strategy : 'a person'}${m.out ? '  (went under)' : ''}`);
});
assert(table.every((m) => m.isBot !== null), 'identities not revealed at the end');
assert(table.some((m) => m.isBot), 'no bots in the game');
assert(table.some((m) => !m.isBot), 'no humans in the game');

/* nobody ever saw anyone else's orders or private numbers */
const spy = G.viewFor(game, annaTok);
for (const h of spy.history) {
  for (const r of h.results) {
    if (r.name === 'Sableworth Ltd') continue;
    assert(r.cash === undefined, `leaked ${r.name}'s cash`);
    assert(r.profit === undefined, `leaked ${r.name}'s profit`);
    assert(r.detail === undefined, `leaked ${r.name}'s P&L`);
  }
}
console.log('\nno rival cash, profit or P&L in any player view: confirmed');
console.log('serialised game size:', (JSON.stringify(game).length / 1024).toFixed(1) + ' KB');

/* the state has to survive a round-trip through storage */
const revived = JSON.parse(JSON.stringify(game));
assert.deepEqual(G.viewFor(revived, hostTok), final, 'state does not survive JSON');
console.log('survives a JSON round-trip: yes');
console.log('\nseason OK');
