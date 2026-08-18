/* Everybody doing the same thing at the same moment.

   This is the test that should have existed from the beginning. A game is one
   JSON document, so every change is read-modify-write, and until it was measured
   nobody knew that five players filing in the same second produced five reads of
   the same state and five writes of which four vanished — each answered 200 OK.

   Near a deadline everyone files at once. That was the normal case.

   The README had even named the problem, of Netlify Blobs: "no compare-and-swap,
   so two players filing in the same second could overwrite one another; moving to
   Postgres is the fix". Postgres happened; the fix did not, for months.

   Two things are checked here, both by doing them genuinely concurrently rather
   than in a loop: filing, and a whole class joining. */

import assert from 'node:assert';

import { memoryDb } from '../lib/db.mjs';
import * as A from '../lib/accounts.mjs';

const db = memoryDb();
globalThis.__CEO_DB__ = db;
const USERS = { 'tok:host': { id: 'host', email: 'h@x.com' } };
globalThis.__CEO_VERIFY__ = async (t) =>
  (USERS[t] ? { data: { user: USERS[t] }, error: null } : { data: null, error: { message: 'no' } });
process.env.SUPABASE_URL = 'x'; process.env.SUPABASE_ANON_KEY = 'y';

const { default: api } = await import('../netlify/functions/api.mjs');
const call = async (method, path, body, auth) => {
  const headers = {}; if (body) headers['content-type'] = 'application/json';
  if (auth) headers.authorization = `Bearer ${auth}`;
  const res = await api(new Request('https://ceo.test' + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined }));
  return { status: res.status, body: await res.json() };
};

await db.ensureProfile('host', 'h@x.com');
const held = await A.claimName(db, 'host', 'Ravensworth', new Date().toISOString());
await A.confirmPurchase(db, { owner: 'host', companyId: held.id, eventId: 'e1' });

const made = (await call('POST', '/api/create',
  { seats: 5, rounds: 10, cadence: '1h' }, 'tok:host')).body;
const tokens = [made.token];
for (const n of ['Sableworth Ltd', 'Ketteridge', 'Dunmore & Sons', 'Larkfield']) {
  tokens.push((await call('POST', '/api/join', { code: made.code, name: n })).body.token);
}
await call('POST', '/api/start', { code: made.code, token: made.token });

const orders = async (token) => {
  const v = (await call('GET', `/api/state?code=${made.code}&token=${encodeURIComponent(token)}`)).body.view;
  const products = {};
  for (const p of v.you.products) {
    products[p.name] = { price: Math.round(p.value), produce: 900, rd: 30000,
      rdProcess: 10000, advertising: 5000, targetCapacity: Math.round(p.capacity),
      discontinue: false };
  }
  return { products, launch: false };
};

const decisions = {};
for (const t of tokens) decisions[t] = await orders(t);

console.log('FIVE PLAYERS FILING AT THE SAME MOMENT, AS THEY DO NEAR A DEADLINE');
await Promise.all(tokens.map((t) =>
  call('POST', '/api/submit', { code: made.code, token: t, decisions: decisions[t] })));

const game = await db.getGame(made.code);
/* Five filings in a five-seat game close the round, so the proof is not "who is
   still marked as filed" but what the resolved round recorded: a seat carried by
   standing orders is flagged `auto`, and that is what a lost write looks like
   after the fact. */
if (game.round === 0) {
  const filed = game.seats.filter((s) => !s.isBot && s.submittedRound === game.round);
  console.log(`  five sent, ${filed.length} recorded, round did not close`);
  const lost = game.seats.filter((s) => !s.isBot && s.submittedRound !== game.round);
  console.log(`  ** LOST: ${lost.map((s) => s.name).join(', ')} **`);
} else {
  const res = game.history[0].results.filter((r) => !game.seats.find(
    (s) => s.id === r.seatId).isBot);
  const auto = res.filter((r) => r.auto);
  console.log(`  the round closed because all five filed`);
  console.log(`  orders actually used: ${res.length - auto.length} of ${res.length} filed by hand`);
  if (auto.length) {
    console.log(`  ** LOST: ${auto.map((r) => r.name).join(', ')} — each told 200 OK, `
      + `then carried by standing orders **`);
  } else {
    console.log('  none were lost');
  }
  const v = game.seats.filter((s) => !s.isBot).map((s) => s.autoRounds);
  console.log(`  rounds recorded as not-filed against each player: ${v.join(', ')}`);
}

assert.equal(game.round, 1, 'five filings should have closed the round');
const humanResults = game.history[0].results.filter(
  (r) => !game.seats.find((s) => s.id === r.seatId).isBot);
assert.equal(humanResults.filter((r) => r.auto).length, 0,
  'every player who filed must have had their own orders used');
assert(game.seats.filter((s) => !s.isBot).every((s) => !s.autoRounds),
  'nobody who filed should be recorded as having missed the round');

/* ------------------------------------------------- and a whole class at once */
import * as CO from '../lib/cohorts.mjs';
await A.confirmPurchase(db, { owner: 'host', companyId: null,
                              kind: 'facilitator', eventId: 'e2' });
const cohort = (await call('POST', '/api/cohorts',
  { name: 'MGT 481', groupSize: 5, rounds: 8, cadence: '5m' }, 'tok:host')).body.cohort;

const students = Array.from({ length: 40 }, (_, i) => `Company ${String(i + 1).padStart(2, '0')}`);
const joins = await Promise.all(students.map((n) =>
  call('POST', '/api/class/join', { code: cohort.code, name: n })));

console.log('\nFORTY STUDENTS PRESSING JOIN AT THE SAME MOMENT');
console.log(`  accepted: ${joins.filter((r) => r.status === 200).length} of 40`);
const board = (await call('GET', `/api/cohort/${cohort.id}`, null, 'tok:host')).body.cohort;
console.log(`  seated into ${board.totals.groups} groups of ` +
            `${[...new Set(board.groups.map((g) => g.seats))].join('/')}`);
assert.equal(joins.filter((r) => r.status === 200).length, 40, 'every student must get in');
assert.equal(board.totals.players, 40, 'and every student must have a seat');
assert.equal(board.totals.groups, 8, 'forty students at five a group is eight groups');
assert(board.groups.every((g) => g.seats === 5), 'and the groups must be full');

/* every student got a distinct seat, and can see it */
const seen = new Set();
for (const r of joins) {
  const v = (await call('GET',
    `/api/state?code=${r.body.code}&token=${encodeURIComponent(r.body.token)}`)).body.view;
  assert(v.you, 'a student who joined must have a seat when they open the page');
  seen.add(r.body.code + ':' + v.you.name);
}
assert.equal(seen.size, 40, 'forty students, forty distinct seats');
console.log('  forty distinct seats, every one of them openable');


/* --------------------------------------------------- the student who is late */
/* Somebody always walks in five minutes after the class has started. They used to
   land in a lobby of one that never began, and sat watching "waiting to start"
   for the rest of the lesson while the instructor had no idea. */
const { default: tick } = await import('../netlify/functions/tick.mjs');

await call('POST', `/api/cohort/${cohort.id}/start`, {}, 'tok:host');
const late = await call('POST', '/api/class/join',
  { code: cohort.code, name: 'Latecomer Ltd' });
console.log('\nA STUDENT ARRIVING AFTER THE CLASS HAS STARTED');
assert.equal(late.status, 200, 'a latecomer must still be able to join');
console.log(`  joined, group ${late.body.group}, status "${late.body.view.status}"`);
assert.equal(late.body.view.status, 'lobby', 'they wait briefly for other stragglers');

/* nothing has stranded them: the group carries its own starting deadline */
const lateGame = await db.getGame(late.body.code);
assert(lateGame.lobbyDeadline, 'a group opened mid-class must carry a start deadline');
console.log(`  and it starts itself at ${lateGame.lobbyDeadline}`);

/* wind that wait down, the way two minutes passing would */
lateGame.lobbyDeadline = new Date(Date.now() - 1000).toISOString();
await db.putGame(lateGame);
await tick();
const started = await db.getGame(late.body.code);
console.log(`  after the wait: "${started.status}", ${started.seats.length} companies ` +
            `(${started.seats.filter((s) => s.isBot).length} of them AI)`);
assert.equal(started.status, 'playing', 'a late group must start itself, not strand the student');
assert.equal(started.seats.length, 5, 'and fill out with AI companies');

/* the student can actually play it */
const lv = (await call('GET', `/api/state?code=${late.body.code}` +
  `&token=${encodeURIComponent(late.body.token)}`)).body.view;
assert(lv.you && lv.you.products.length, 'and the latecomer has a company to run');
console.log('  the latecomer has a company and can file:', !!lv.you.products.length);

/* ------------------------------------------------ names a class actually types */
console.log('\nNAMES A CLASS ACTUALLY TYPES');
for (const [typed, expect] of [['Group 3 :)', 'Group 3'],
                               ['Scunthorpe Ltd', 'Scunthorpe Ltd'],
                               ['The Best Company In The Whole World', null]]) {
  const r = await call('POST', '/api/class/join', { code: cohort.code, name: typed });
  const got = r.status === 200 ? r.body.view.you.name : 'REFUSED: ' + r.body.error;
  console.log(`  "${typed}" → ${got}`);
  assert.equal(r.status, 200, `"${typed}" should not stop a student in front of the class`);
  if (expect) assert.equal(got, expect, `"${typed}" should tidy to "${expect}"`);
}

console.log('\nconcurrency OK');
