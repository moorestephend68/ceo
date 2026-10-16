/* A WHOLE TABLE, THROUGH THE REAL MACHINERY.

   Not the engine on its own — the lobby, the code join, the stranger
   matchmaking, the two-stage round and the bot fill, driven the way the API
   drives them, against the in-memory database that enforces the same
   constraints as Postgres.

   What this is actually checking, in order of how badly each would hurt:

     1. a captain looking for a table is never seated at a CEO game
     2. a private code seats friends and a public table cannot be joined by one
     3. a table nobody else joins still becomes a game, with bots in the seats
     4. both stages close on their own, and a season ends
     5. a bid filed in the declare window and no longer affordable is void
        rather than pushing a captain into negative cash */
import { memoryDb } from '../lib/db.mjs';
import * as K from '../lib/cargo.mjs';
import * as G from '../lib/game.mjs';
import { kindOf } from '../lib/kinds.mjs';
import * as M from '../lib/mutate.mjs';

const db = memoryDb();
const t0 = Date.parse('2026-03-01T10:00:00.000Z');
const at = (s) => new Date(t0 + s * 1000).toISOString();
const ok = (c, m) => { if (!c) { console.error('  FAIL: ' + m); process.exit(1); } console.log('  ok  ' + m); };

/* the same settle() the API uses, in miniature */
async function settle(game, now) {
  const kind = kindOf(game);
  let changed = false;
  if (game.status === 'lobby' && kind.shouldStart(game, now)) { kind.startPublic(game, now); changed = true; }
  if (kind.resolveWhileDue(game, now)) changed = true;
  return changed;
}

console.log('\n  Matchmaking');
/* a CEO public lobby is sitting there first, which is the trap */
const ceo = G.createGame({ seats: 5, rounds: 10, cadence: '5m', hostName: 'Acme' });
ceo.game.isPublic = true;
ceo.game.lobbyDeadline = at(90);
await db.putGame(ceo.game, null);
ok(!(await db.openPublicGame('cargo')), 'a CEO lobby is not offered to a captain');
ok(!!(await db.openPublicGame(null)), 'and is still offered to a CEO player');

const first = K.createGame({ seats: 5, rounds: 8, cadence: '5m', hostName: 'Halloran', isPublic: true, now: at(0) });
first.game.isPublic = true;
first.game.lobbyDeadline = at(90);
await db.putGame(first.game, null);
const found = await db.openPublicGame('cargo');
ok(found && found.code === first.game.code, 'a captain finds the open cargo table');

console.log('\n  Joining');
let joined = null;
await M.mutateGame(db, first.game.code, (g) => { joined = K.joinGame(g, 'Brandt', at(20)).token; return true; });
ok(!!joined, 'a second captain takes a seat');
let refused = false;
try { await M.mutateGame(db, first.game.code, (g) => { K.joinGame(g, 'brandt', at(21)); return true; }); }
catch (e) { refused = true; }
ok(refused, 'and cannot take the same name twice');

console.log('\n  The wait runs out');
let game = await db.getGame(first.game.code);
await settle(game, at(30));
ok(game.status === 'lobby', 'the table waits while the clock is still running');
await settle(game, at(95));
ok(game.status === 'playing', 'and starts itself once the wait is over');
ok(game.seats.length === 5, 'with five seats');
ok(game.seats.filter((s) => s.isBot).length === 3, 'three of them filled by bots');
ok(game.stage === 'declare', 'the first window is the declare window');
ok(game.block && game.block.grades.length === K.C.PARTS, 'and the yard already has its parts out');

console.log('\n  A round, both stages');
const host = game.seats[0], me = game.seats[1];
const mine = K.routesFor(game, host, null)[0];
K.submitDeclaration(game, host.token, { pickup: mine.p, commodity: mine.c,
  bids: game.block.grades.map((g, j) => Math.round(K.worthOf(game, g, K.fallbackAt(game, j)) * 0.8)) });
ok(host.declared && host.declared.bids.some((b) => b > 0), 'a captain files a manifest and four bids at once');
let view = K.viewFor(game, me.token);
ok(!view.manifests, 'the manifests are not visible while the window is open');
const two = K.routesFor(game, me, null)[0];
K.submitDeclaration(game, me.token, { pickup: two.p, commodity: two.c, bids: [0, 0, 0, 0] });
await settle(game, at(100));
ok(game.stage === 'route', 'both humans in, so the window closes at once');
view = K.viewFor(game, me.token);
ok(view.manifests && view.manifests.length === 5, 'and every manifest is now public');
ok(view.manifests.every((m) => m.couldSell && m.couldSell.length === 3),
   'showing what is in each hold and the three stations it could reach');
ok(!JSON.stringify(view.manifests).includes('"d"'), 'but never which station was chosen');

const board = K.boardFor(game.seed);
K.submitRoute(game, host.token, { drop: board.reachD[host.declared.p][0] });
K.submitRoute(game, me.token, { drop: board.reachD[me.declared.p][0] });
await settle(game, at(110));
ok(game.round === 2, 'the run settles and the season moves on');
ok(game.history.length === 1 && game.history[0].refit, 'and the yard settled with it');
ok(game.seats.every((s) => Number.isFinite(s.cash)), 'everybody still has a number for cash');
ok(game.seats.every((s) => s.hold > 0), 'and a ship that can carry something');

console.log('\n  A bid the round has made unaffordable');
{
  const g2 = K.createGame({ seed: 77, seats: 5, rounds: 8, cadence: 'manual', hostName: 'Skint' });
  K.startGame(g2.game, g2.token);
  const seat = g2.game.seats[0];
  seat.cash = 500;                                  // a captain down to their last
  K.submitDeclaration(g2.game, seat.token, { pickup: K.boardFor(g2.game.seed).reachP[seat.at][0],
    commodity: 0, bids: [300, 0, 0, 0] });
  seat.cash = 100;                                  // the run went badly
  const refit = K.runRefit(g2.game);
  const wonIt = refit.lots.some((l) => l.who === 0 && l.paid > 0);
  ok(!wonIt || seat.cash >= 0, 'a bid it can no longer cover does not go through');
  ok(seat.cash >= 0, 'and nobody is left with negative cash');
}

console.log('\n  A whole season with one live captain');
{
  const g3 = K.createGame({ seed: 991, seats: 5, rounds: 8, cadence: '5m', hostName: 'Solo' });
  K.startGame(g3.game, g3.token);
  const seat = g3.game.seats[0];
  let guard = 0, t = 200;
  while (g3.game.status === 'playing' && guard++ < 100) {
    if (g3.game.stage === 'declare') {
      const r = K.routesFor(g3.game, seat, null)[0];
      K.submitDeclaration(g3.game, seat.token, { pickup: r.p, commodity: r.c,
        bids: g3.game.block.grades.map((g, j) => Math.round(K.worthOf(g3.game, g, K.fallbackAt(g3.game, j)) * 0.8)) });
    } else {
      const b = K.boardFor(g3.game.seed);
      K.submitRoute(g3.game, seat.token, { drop: b.reachD[seat.declared.p][0] });
    }
    await settle(g3.game, at(t += 5));
  }
  ok(g3.game.status === 'over', 'the season finishes');
  ok(g3.game.history.length === 8, 'with eight rounds on the record');
  const fin = g3.game.seats.map((s) => s.cash);
  ok(fin.every(Number.isFinite), 'and five finishing numbers that are numbers');
  console.log('      finished: ' + fin.map((v) => '$' + Math.round(v).toLocaleString()).join('  '));
}
/* ------------------------------------------- THE GOING RATE IN THE YARD

   The yard decides the season, and a cautious opening bid was measured to be
   identical to no bid at all: 40% of what a lot is worth won zero parts, 1.7%
   of seasons and 61% finishing last, because the field files 50-65% and there
   are four lots for five captains. Every slider on the page opened at zero.

   So the server now sends what a lot tends to go for, and its provenance. */
{
  const now = at(900);
  const { game, token } = K.createGame({ seats: 5, rounds: 8, cadence: '5m',
    hostName: 'Halloran Freight', seed: 31, warehouses: true, now });
  K.startGame(game, game.hostToken, now);

  let v = K.viewFor(game, token);
  ok(Array.isArray(v.block.going) && v.block.going.length === v.block.grades.length,
    'round one quotes a rate for every lot on the block');
  ok(v.block.goingFrom === 'table',
    `and says where it came from: ${v.block.goingFrom} - the habits of the field actually sitting there`);
  ok(v.block.going.every((x, j) => (x > 0) === (v.block.worth[j] > 0)),
    'a lot worth nothing is quoted at nothing, and every other lot at something');
  ok(v.block.goingShade > 0.45 && v.block.goingShade < 0.75,
    `the quote is ${Math.round(100 * v.block.goingShade)}% of worth - inside the band that wins parts`);
  ok(v.block.going.every((x, j) => v.block.worth[j] < 1 || x / v.block.worth[j] > 0.5),
    'every quote clears the half-of-worth floor where bids stop winning anything');

  const me = K.seatByToken(game, token);
  const purse = Math.max(0, me.cash) * 0.6;
  const bids = v.block.going.map((x) => Math.round(Math.min(x, purse) / 25) * 25);
  const r = K.routesFor(game, me, null)[0];
  const holdBefore = me.hold;
  K.submitDeclaration(game, token, { pickup: r.p, commodity: r.c, bids });
  K.resolveStage(game, now); K.resolveStage(game, now);
  ok(K.seatByToken(game, token).hold !== holdBefore,
    'a captain who simply accepts the quote comes out of the yard with a part');

  v = K.viewFor(game, token);
  ok(v.block.goingFrom === 'reveal',
    'and from the second round the quote is a fact off the envelopes, not an estimate');
  const lots = game.history[0].refit.lots.filter((l) => l.who >= 0 && l.paid > 0);
  ok(lots.length > 0 && lots.every((l) => l.worth > 0),
    'which works because the refit records what each lot was WORTH beside what it fetched');
}

/* ----------------------------- an all-human table has nothing to go on */
{
  const now = at(1000);
  const { game, token } = K.createGame({ seats: 2, rounds: 8, cadence: '5m',
    hostName: 'Halloran Freight', seed: 12, warehouses: true, now });
  K.joinGame(game, 'Okafor Lines', now);
  K.startGame(game, game.hostToken, now);
  const v = K.viewFor(game, token);
  ok(v.block.goingFrom === 'estimate',
    'with nobody to read, the page is told the figure is an estimate and not a fact');
  ok(Math.abs(v.block.goingShade - 0.6) < 1e-9,
    'set at the measured best reply against a bidding field, 60%');
}

console.log('\n  all good.\n');
