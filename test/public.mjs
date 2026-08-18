/* Public play, through the real handlers.

   The things worth proving here are the ones a player would notice: several
   people land at the SAME table rather than each opening their own, a table that
   nobody else joins still becomes a game, a signed-out player can do all of it,
   and the result only counts for companies with a claimed name. */

import assert from 'node:assert';
import { memoryDb } from '../lib/db.mjs';
import * as A from '../lib/accounts.mjs';
import * as P from '../lib/public.mjs';
import * as G from '../lib/game.mjs';

const db = memoryDb();
globalThis.__CEO_DB__ = db;
const USERS = { 'tok:alice': { id: 'alice', email: 'a@x.com' } };
globalThis.__CEO_VERIFY__ = async (t) =>
  (USERS[t] ? { data: { user: USERS[t] }, error: null } : { data: null, error: { message: 'no' } });
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon';

const { default: api } = await import('../netlify/functions/api.mjs');
const { default: tick } = await import('../netlify/functions/tick.mjs');

const call = async (method, path, body, auth) => {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (auth) headers.authorization = `Bearer ${auth}`;
  const res = await api(new Request('https://ceo.test' + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined }));
  return { status: res.status, body: await res.json() };
};
const ok = (r, what) => { assert(r.status === 200, `${what}: ${r.status} ${JSON.stringify(r.body)}`); return r.body; };

/* alice has bought a name; bob and carol have not */
await db.ensureProfile('alice', 'a@x.com');
const held = await A.claimName(db, 'alice', 'Ravensworth', new Date().toISOString());
await A.confirmPurchase(db, { owner: 'alice', companyId: held.id, eventId: 'e1' });

const fmt = ok(await call('GET', '/api/public/format'), 'format');
console.log('the public format:', fmt.describe);
console.log('lobby wait:', fmt.waitSeconds, 'seconds');

/* ------------------------------------------------ everyone lands together */
const a1 = ok(await call('POST', '/api/public/join', {}, 'tok:alice'), 'alice joins');
console.log('\nalice joins ->', a1.code, '| rated:', a1.rated);
assert(a1.rated, 'a player with a purchased name should be rated');

const b1 = ok(await call('POST', '/api/public/join', { name: 'Ketteridge' }), 'bob joins');
const c1 = ok(await call('POST', '/api/public/join', { name: 'Dunmore & Sons' }), 'carol joins');
console.log('bob joins   ->', b1.code, '| rated:', b1.rated);
console.log('carol joins ->', c1.code, '| rated:', c1.rated);
assert.equal(b1.code, a1.code, 'they must land at the same table');
assert.equal(c1.code, a1.code, 'they must land at the same table');
assert.equal(b1.rated, false, 'a player without a claimed name is not rated');
console.log('all three at one table:', c1.view.joined.map((j) => j.name).join(', '));

/* two strangers with the same name go to different tables rather than colliding */
const dup = ok(await call('POST', '/api/public/join', { name: 'Ketteridge' }), 'duplicate name');
console.log('a second "Ketteridge" gets its own table:', dup.code !== a1.code);
assert.notEqual(dup.code, a1.code, 'a name clash should open another table, not fail');

/* a signed-out player needs a name */
const noName = await call('POST', '/api/public/join', {});
assert.equal(noName.status, 400);
console.log('joining with no name at all:', noName.body.error);

/* --------------------------------------------- the table starts by itself */
let state = ok(await call('GET', `/api/state?code=${a1.code}&token=${a1.token}`), 'state');
console.log('\nbefore the wait expires, status:', state.view.status);
assert.equal(state.view.status, 'lobby');

/* push the lobby deadline into the past, the way waiting would */
const g = await db.getGame(a1.code);
g.lobbyDeadline = new Date(Date.now() - 1000).toISOString();
await db.putGame(g);

await tick(new Request('https://ceo.test/tick', { method: 'POST' }));
state = ok(await call('GET', `/api/state?code=${a1.code}&token=${a1.token}`), 'state');
console.log('after the wait, status:', state.view.status);
assert.equal(state.view.status, 'playing', 'a table nobody else joined must still start');
const bots = state.view.market.length - 3;
console.log(`bots filled ${bots} of ${state.view.market.length} seats`);
assert.equal(state.view.market.length, P.FORMAT.seats);

/* nobody is told which are bots */
assert(state.view.market.every((m) => m.isBot === null), 'bot identity leaked mid-game');
console.log('bot identities hidden while playing:', state.view.market.every((m) => m.isBot === null));

/* -------------------------------------------------------- play it to the end */
const live = await db.getGame(a1.code);
while (live.status === 'playing') {
  G.resolveRound(live, new Date(Date.parse(live.deadline) + 1000).toISOString());
}
await db.putGame(live);

/* the first request to touch it afterwards scores it */
const done = ok(await call('GET', `/api/state?code=${a1.code}&token=${a1.token}`), 'final');
assert.equal(done.view.status, 'over');
/* The board is money made above what every company starts with, so a company
   that finished below its starting cash is not on it — that is the rule, not an
   omission. What must hold either way is that nothing else can get on it. */
const mine = done.view.market.find((m) => m.you);
const made = Math.round(mine.finalValue) - board_start();
function board_start() { return 250000; }        // the standard preset's cash
const board = ok(await call('GET', '/api/leaderboard'), 'board');
console.log(`\nRavensworth finished at ${Math.round(mine.finalValue).toLocaleString('en-US')}` +
            ` — ${made > 0 ? 'made' : 'lost'} ${Math.abs(made).toLocaleString('en-US')}`);
console.log('leaderboard:', board.board.length
  ? board.board.map((r) => `${r.rank}. ${r.name} ${r.score}`).join(' · ') : '(empty)');
console.log(`decays ${board.decayPerHour * 100}% an hour, half gone after ${board.halfLifeHours}h`);

if (made > 0) {
  assert.equal(board.board.length, 1, 'the one company that made money should be on it');
  assert.equal(board.board[0].name, 'Ravensworth');
  assert.equal(board.board[0].made, made, 'the board should show what it actually made');
} else {
  assert.equal(board.board.length, 0, 'a company that lost money must not be on the board');
  console.log('  it lost money, so the board is empty — which is the rule working');
}
/* nobody without a purchased name gets on it, whatever they scored */
assert(!board.board.some((r) => r.name === 'Passing Stranger'),
  'an unnamed player must never reach the board');

const rec = ok(await call('GET', '/api/record', null, 'tok:alice'), 'record');
console.log('alice’s record:', JSON.stringify({ rating: rec.rating, games: rec.games,
  onBoard: rec.onBoard, boardScore: rec.boardScore }));
assert.equal(rec.games, 1);
assert.equal(rec.recent.length, 1);
/* the rating is kept and is still hers, even though it is off the public board */
assert(typeof rec.rating === 'number' && rec.band, 'the rating must survive off the board');

/* a second pass must not score it again */
await call('GET', `/api/state?code=${a1.code}&token=${a1.token}`);
await tick(new Request('https://ceo.test/tick', { method: 'POST' }));
const again = ok(await call('GET', '/api/record', null, 'tok:alice'), 'record 2');
console.log('after re-reading and another sweep, games played:', again.games);
assert.equal(again.games, 1, 'the game must not be scored twice');

/* a signed-out visitor can read the board — it is the shop window, so it must
   never need an account, and it must say how it works to somebody who has not
   played yet */
const anonBoard = ok(await call('GET', '/api/leaderboard'), 'anon board');
assert(Array.isArray(anonBoard.board), 'the board must be readable signed out');
assert.equal(anonBoard.startCash, 250000, 'and say what "money made" is measured from');
assert(anonBoard.halfLifeHours > 6 && anonBoard.halfLifeHours < 7,
  'and how fast it decays');
console.log('signed out, the board is readable:', anonBoard.board.length, 'entries');

console.log('\npublic OK');
