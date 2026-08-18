/* Does a round actually close on its own?

   There are two mechanisms and they are easy to confuse. A round is normally
   closed by whoever next opens the page — every request that touches a game asks
   first whether its clock has run out. The scheduled sweep is the backstop, for
   games everyone has walked away from.

   Both are tested here through the real handlers, because "it should resolve" is
   the kind of thing that is obviously true right up until nobody has checked it.
   The clock is moved by rewriting the stored deadline rather than by waiting,
   which is the only way to test a five-minute round in under five minutes. */

import assert from 'node:assert';
import { memoryDb } from '../lib/db.mjs';
import * as G from '../lib/game.mjs';

const db = memoryDb();
globalThis.__CEO_DB__ = db;
globalThis.__CEO_VERIFY__ = async () => ({ data: null, error: { message: 'no' } });
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon_test';

const { default: api } = await import('../netlify/functions/api.mjs');
const { default: tick } = await import('../netlify/functions/tick.mjs');

const call = async (method, path, body) => {
  const res = await api(new Request('https://ceo.test' + path, {
    method, headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }));
  return { status: res.status, body: await res.json() };
};
const ok = (r, what) => {
  assert(r.status === 200, `${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

/* Wind a game's clock back so its current deadline is in the past. */
async function expire(code) {
  const g = await db.getGame(code);
  const key = g.status === 'lobby' ? 'lobbyDeadline' : 'deadline';
  g[key] = new Date(Date.now() - 1000).toISOString();
  await db.putGame(g);
  return g;
}

const minutesLeft = (view) => (Date.parse(view.deadline) - Date.now()) / 60000;

/* ------------------------------------------------------- a public table */
const joined = ok(await call('POST', '/api/public/join', { name: 'Ketteridge' }), 'join');
const { code, token } = joined;
const seat = `code=${code}&token=${encodeURIComponent(token)}`;
console.log('seated at a public table; lobby is waiting for other people');
assert.equal(joined.view.status, 'lobby');

/* the lobby starts itself once its wait runs out */
await expire(code);
let v = ok(await call('GET', `/api/state?${seat}`), 'state').view;
console.log('after the lobby wait:', v.status, `— ${v.market.length} companies`);
assert.equal(v.status, 'playing', 'a public lobby must start itself');

/* --------------------------------------------- the first round is longer */
console.log(`\nround ${v.round + 1} closes in ${minutesLeft(v).toFixed(1)} minutes`);
const firstLen = minutesLeft(v);
assert(firstLen > 5, 'the first round of a fast game is deliberately longer');
/* and the page has to say so, or it reads as a broken promise against the
   "a round every 5 minutes" on the front page */
assert(v.firstRoundGrace === true,
  'the longer first round must be flagged to the interface, not left as a surprise');
console.log('and the view flags it as the longer first round:', v.firstRoundGrace);

/* ------------------------------------------ it closes when the clock runs out */
/* Nobody files. Standing orders should carry the seat and the round should turn
   over the moment anyone looks at it. */
await expire(code);
v = ok(await call('GET', `/api/state?${seat}`), 'state').view;
console.log(`\nnobody filed; after the deadline the round is ${v.round + 1}`);
assert.equal(v.round, 1, 'an overdue round must close when a player opens the page');
console.log(`round ${v.round + 1} closes in ${minutesLeft(v).toFixed(1)} minutes`);
assert(minutesLeft(v) <= 5.01 && minutesLeft(v) > 4.5,
  `later rounds must be a full five minutes, got ${minutesLeft(v).toFixed(2)}`);
assert.equal(v.firstRoundGrace, false, 'only the first round is longer');
assert.equal(v.you.autoRounds, 1, 'the missed round should be recorded');

/* it keeps going, round after round, without anyone filing */
for (let i = 0; i < 3; i++) {
  await expire(code);
  v = ok(await call('GET', `/api/state?${seat}`), 'state').view;
}
console.log(`three more deadlines later: round ${v.round + 1}, ` +
            `${v.you.autoRounds} rounds filed automatically`);
assert.equal(v.round, 4, 'the clock must keep turning rounds over');

/* ------------------------------------------------- and when nobody is looking */
/* This is the one that matters for "it did not advance on its own": if the last
   player closes the tab, only the scheduled sweep is left. */
const before = (await db.getGame(code)).round;
await expire(code);
const stale = (await db.getGame(code)).round;
assert.equal(stale, before, 'winding the clock back must not resolve anything by itself');
await tick();
const after = (await db.getGame(code)).round;
console.log(`\nwith nobody watching, the scheduled sweep moved round ${before + 1} → ${after + 1}`);
assert.equal(after, before + 1, 'the sweep must close rounds nobody is watching');

/* the sweep must not touch a game whose deadline has not passed */
const untouched = (await db.getGame(code)).round;
await tick();
assert.equal((await db.getGame(code)).round, untouched,
  'the sweep must leave a game that is not overdue alone');
console.log('and left the next round alone, because it is not overdue yet');

/* ------------------------------------------------------------ paused classes */
/* A facilitator holding the room still must survive the sweep, or "pause" means
   nothing the moment a cron fires. */
const g = await db.getGame(code);
g.paused = true;
g.deadline = new Date(Date.now() - 1000).toISOString();
await db.putGame(g);
const pausedAt = g.round;
await tick();
assert.equal((await db.getGame(code)).round, pausedAt,
  'a paused game must not be advanced by the sweep');
console.log('a paused game survives the sweep:', (await db.getGame(code)).round === pausedAt);

/* ------------------------------------------------- several games at once */
/* One purchased name is not one game at a time: a daily game with friends, a
   class, and a ranked table on a five-minute clock can all be running in the same
   week. What the front page has to answer is which of them is waiting for you. */
const table = await db.getGame(code);
const { game: slow, token: slowToken } = G.createGame({
  hostName: 'Ketteridge', seats: 3, rounds: 10, cadence: '1d', seed: 4,
  now: new Date().toISOString(),
});
G.startGame(slow, slow.hostToken, new Date().toISOString());
await db.putGame(slow);

const mine = ok(await call('POST', '/api/mine', {
  games: [{ code: table.code, token }, { code: slow.code, token: slowToken },
          { code: 'ZZZZZZ', token: 'nope' },
          { code: table.code, token: 'not-my-seat' }],
}), 'mine').games;

console.log('\nWhat this company has on:');
for (const g of mine) {
  console.log(`  ${g.name.padEnd(12)} ${(g.isPublic ? 'ranked' : 'private').padEnd(8)}` +
    ` round ${g.round + 1}/${g.totalRounds}  ${g.filed ? 'filed' : 'your move'}` +
    `  every ${g.cadenceLabel.toLowerCase()}`);
}
assert.equal(mine.length, 2, 'a bad code and a wrong token must both be left out');
assert(mine.some((g) => g.isPublic) && mine.some((g) => !g.isPublic),
  'a ranked table and a private game must be able to run at the same time');
/* whatever is waiting for you comes first */
assert.equal(mine[0].filed, false, 'the game waiting on you should be listed first');
console.log('the one waiting on you is listed first:', mine[0].name,
            `(${mine[0].isPublic ? 'ranked' : 'private'})`);

console.log('\nclock OK');

/* ------------------------------------------- a class the instructor drives */
/* An MBA course meets once a week and plays one round between classes; a
   workshop plays three rounds in an afternoon. Neither can be expressed as a
   number of minutes that also suits the other, so a class can simply have no
   clock: rounds close when a group has all filed, or when the facilitator says.

   Until this existed the cadences stopped at "a day", and the default class was
   ten rounds of fifteen minutes — two and a half hours, longer than any lesson. */
import * as CO2 from '../lib/cohorts.mjs';

const defaults = { name: 'MGT 481' };
const cfg = (await CO2.createCohort(db, 'teacher-x', defaults)).config;
console.log(`\nthe default class: ${cfg.rounds} rounds, cadence "${cfg.cadence}"`);
assert.equal(cfg.cadence, 'manual', 'a class should default to a clock the instructor holds');

console.log('\nevery cadence a host can pick:');
for (const [id, c] of Object.entries(G.CADENCES)) {
  console.log(`  ${id.padEnd(7)} ${String(c.label).padEnd(12)} ${c.minutes === null
    ? 'no deadline' : c.minutes + ' minutes'}`);
}
assert(G.CADENCES['1w'], 'a weekly round is how courses actually run');
assert.equal(G.CADENCES['1w'].minutes, 7 * 24 * 60);

/* a weekly game must not close the same evening it was created */
const t0 = Date.parse('2026-09-01T09:00:00Z');
const wk = G.createGame({ hostName: 'H', seats: 3, rounds: 8, cadence: '1w',
                          closeHour: 18, seed: 3, now: new Date(t0).toISOString() });
G.startGame(wk.game, wk.token, new Date(t0).toISOString());
const days = (Date.parse(wk.game.deadline) - t0) / 86400000;
console.log(`\na weekly game's first round closes in ${days.toFixed(1)} days`);
assert(days > 5 && days <= 8, `a weekly round must be about a week, got ${days.toFixed(1)} days`);

/* an instructor-paced game has no deadline and never expires by itself */
const man = G.createGame({ hostName: 'H', seats: 3, rounds: 8, cadence: 'manual',
                           seed: 3, now: new Date(t0).toISOString() });
G.joinGame(man.game, 'A Student', new Date(t0).toISOString());
G.startGame(man.game, man.token, new Date(t0).toISOString());
console.log(`instructor-paced: deadline is ${man.game.deadline === null ? 'null' : man.game.deadline}`);
assert.equal(man.game.deadline, null, 'no clock means no deadline');
assert.equal(G.shouldResolve(man.game, new Date(t0 + 365 * 86400000).toISOString()), false,
  'a year later it must still be waiting — the instructor is the clock');
console.log('a year later it has still not resolved itself:',
            G.shouldResolve(man.game, new Date(t0 + 365 * 86400000).toISOString()) === false);

/* but it still closes the moment everyone has filed */
for (const seat of man.game.seats.filter((s) => !s.isBot)) {
  const v = G.viewFor(man.game, seat.token);
  const products = {};
  for (const p of v.you.products) {
    products[p.name] = { price: Math.round(p.value), produce: 800, rd: 30000,
      rdProcess: 10000, advertising: 5000, targetCapacity: Math.round(p.capacity),
      discontinue: false };
  }
  G.submitDecisions(man.game, seat.token, { products, launch: false });
}
console.log('once every player has filed, it resolves:',
            G.shouldResolve(man.game, new Date(t0).toISOString()));
assert.equal(G.shouldResolve(man.game, new Date(t0).toISOString()), true,
  'a group that has all filed should not wait for anybody');

/* A game still in its lobby has seats with no company behind them yet. Asking
   what they are worth used to throw, which took the whole list down to a fallback
   that does not say which game is waiting on you — the one thing it is for. */
const { game: waiting, token: waitingToken } = G.createGame({
  hostName: 'Not Started Yet', seats: 3, rounds: 8, cadence: '1d', seed: 9,
  now: new Date().toISOString(),
});
await db.putGame(waiting);
const withLobby = ok(await call('POST', '/api/mine', {
  games: [{ code: waiting.code, token: waitingToken }, { code: table.code, token }],
}), 'mine with a lobby').games;
console.log(`\na list containing a game that has not started: ${withLobby.length} entries`);
for (const g of withLobby) {
  console.log(`  ${g.name.padEnd(16)} ${g.status.padEnd(8)} worth ${g.value === null ? '—' : g.value}`);
}
assert.equal(withLobby.length, 2, 'a lobby must not take the whole list down');
assert.equal(withLobby.find((g) => g.status === 'lobby').value, null,
  'a company that does not exist yet is worth nothing, not an error');
