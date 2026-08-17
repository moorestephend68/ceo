/* The demo through the real routes.

   The claim being tested is "no login at the door", and the only way to test a
   claim about authentication is to make the requests without any. So every call
   below is anonymous except the ones that are deliberately not, and the
   interesting assertions are the refusals: a demo token must open its own class
   and nothing else, and it must not become a way around the facilitator licence
   that somebody is being asked to pay for. */

import assert from 'node:assert';
import { memoryDb } from '../lib/db.mjs';
import * as A from '../lib/accounts.mjs';

const db = memoryDb();
globalThis.__CEO_DB__ = db;

const USERS = { 'tok:teacher': { id: 'user-teacher', email: 'teacher@school.edu' },
                'tok:stranger': { id: 'user-stranger', email: 'nosy@example.com' } };
globalThis.__CEO_VERIFY__ = async (t) =>
  (USERS[t] ? { data: { user: USERS[t] }, error: null }
            : { data: null, error: { message: 'bad token' } });

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon_test';

const { default: api } = await import('../netlify/functions/api.mjs');

const call = async (method, path, body, auth) => {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (auth) headers.authorization = `Bearer ${auth}`;
  const res = await api(new Request('https://ceo.test' + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  }));
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers,
           body: type.includes('json') ? await res.json() : await res.text() };
};
const ok = (r, what) => {
  assert(r.status === 200, `${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

/* ------------------------------------------------ a stranger, no account */
console.log('A stranger with no account, no email, nothing:');
const made = ok(await call('POST', '/api/demo'), 'open the demo');
console.log(`  got a class: ${made.cohort.groups.length} groups, ` +
  `${made.cohort.totals.players} students, round ${made.cohort.groups[0].round}`);
console.log(`  and a seat: ${made.student.name}, group ${made.student.group}, ` +
  `game ${made.student.code}`);
assert(made.demoToken, 'a demo must hand back the token that opens it');
assert(made.cohort.isDemo, 'the board must say it is a demo');
assert(made.cohort.guide && made.cohort.guide.length >= 3,
  'a dashboard of six groups explains nothing without the guide');
console.log('  the guide points at:', made.cohort.guide.map((g) => g.what).join(' · '));

/* the board reads without an account too */
const seen = ok(await call('GET', `/api/cohort/${made.cohortId}?demo=${made.demoToken}`), 'read');
assert.equal(seen.cohort.totals.groups, made.cohort.totals.groups);
console.log('  reading it again, signed out: OK');

/* ------------------------------------------------------- what it will not do */
console.log('\nWhat the demo token does NOT open:');
const noToken = await call('GET', `/api/cohort/${made.cohortId}`);
console.log('  the same class with no token:', noToken.status, '-', noToken.body.error);
assert.equal(noToken.status, 401, 'without the token it must ask you to sign in');

const wrong = await call('GET', `/api/cohort/${made.cohortId}?demo=demo_not_it`);
console.log('  the same class with a made-up token:', wrong.status);
assert.equal(wrong.status, 401);

/* a signed-in stranger is no better off than an anonymous one */
const nosy = await call('GET', `/api/cohort/${made.cohortId}`, null, 'tok:stranger');
console.log('  a signed-in stranger without the token:', nosy.status, '-', nosy.body.error);
assert.equal(nosy.status, 403);

/* a second demo's token opens the second demo and not the first */
const other = ok(await call('POST', '/api/demo'), 'a second visitor');
const crossed = await call('GET', `/api/cohort/${made.cohortId}?demo=${other.demoToken}`);
console.log('  another visitor\'s demo token on this class:', crossed.status);
assert.equal(crossed.status, 401);
assert.notEqual(other.cohortId, made.cohortId, 'two visitors get two classes');

/* and it is not a way round the thing people pay for */
const paywall = await call('POST', '/api/cohorts',
  { name: 'A real class', demo: made.demoToken }, 'tok:stranger');
console.log('  using it to create a REAL class:', paywall.status, '-', paywall.body.error);
assert.equal(paywall.status, 402, 'running a real class still needs the licence');

/* --------------------------------------------------- a real class, unaffected */
await db.ensureProfile('user-teacher', 'teacher@school.edu');
const held = await A.claimName(db, 'user-teacher', 'Prof Moore', new Date().toISOString());
await A.confirmPurchase(db, { owner: 'user-teacher', companyId: held.id,
                              kind: 'facilitator', eventId: 'evt_fac' });
const real = ok(await call('POST', '/api/cohorts',
  { name: 'MGT 481', groupSize: 4, rounds: 8, cadence: '15m' }, 'tok:teacher'), 'real class');
console.log('\nA paying facilitator\'s class is untouched by any of this:');
console.log(`  created "${real.cohort.name}", demo flag:`, real.cohort.isDemo);
assert.equal(real.cohort.isDemo, false);
assert(!real.cohort.guide, 'a real class gets no demo guide');

const forged = await call('POST', `/api/cohort/${real.cohort.id}/resolve`,
  { demo: made.demoToken });
console.log('  a demo token pointed at it:', forged.status, '-', forged.body.error);
assert.equal(forged.status, 401);

const fastForward = await call('POST', `/api/cohort/${real.cohort.id}/advance`,
  { rounds: 5 }, 'tok:teacher');
console.log('  the owner trying to fast-forward it:', fastForward.status, '-', fastForward.body.error);
assert.equal(fastForward.status, 400, 'a real class\'s rounds belong to the people playing them');

/* ------------------------------------------------------- time compression */
console.log('\nPushing the demo forward, signed out throughout:');
const at = made.cohort.groups[0].round;
const adv = ok(await call('POST', `/api/cohort/${made.cohortId}/advance`,
  { rounds: 3, demo: made.demoToken }), 'advance');
console.log(`  round ${at} → ${adv.cohort.groups[0].round} in one request ` +
  `(${adv.advanced} rounds, all ${adv.cohort.totals.groups} groups)`);
assert.equal(adv.advanced, 3);
assert(adv.cohort.groups.every((g) => g.round === at + 3));
assert(adv.cohort.guide.length >= 3, 'the guide must be rebuilt from the new board');

/* the guide's numbers are live, not a fixed script */
const before = made.cohort.guide.find((g) => /does not submit/.test(g.what));
const after = adv.cohort.guide.find((g) => /does not submit/.test(g.what));
console.log('  before:', before.text.slice(0, 72) + '…');
console.log('  after: ', after.text.slice(0, 72) + '…');
assert.notEqual(before.text, after.text, 'the guide must follow the class, not narrate a script');

/* ------------------------------------------------------------- the seat */
const view = ok(await call('GET',
  `/api/state?code=${made.student.code}&token=${encodeURIComponent(made.student.token)}`), 'seat');
console.log(`\nThe seat handed to the visitor: ${view.view.you.name}, ` +
  `round ${view.view.round + 1} of ${view.view.totalRounds}, ` +
  `${view.view.you.products.length} line(s)`);
assert(view.view.you, 'the demo seat must open a real game');
assert(view.view.you.firmState, 'and carry what the projection needs');

/* it is a seat, not a skeleton key: it sees no more than a student would */
const rival = view.view.market.find((m) => !m.you);
console.log('  what it can see of a rival:', Object.keys(rival).filter((k) => rival[k] !== null).join(', '));
assert.equal(rival.isBot, null, 'who is who is not revealed mid-game, even in a demo');

/* filing works, because it is an ordinary seat in an ordinary game */
const orders = {};
for (const p of view.view.you.products) {
  orders[p.name] = { price: Math.round(p.value), produce: 800, rd: 30000,
                     rdProcess: 10000, advertising: 5000,
                     targetCapacity: Math.round(p.capacity), discontinue: false };
}
const filed = ok(await call('POST', '/api/submit', {
  code: made.student.code, token: made.student.token,
  decisions: { products: orders, launch: false },
}), 'file from the demo seat');
console.log('  filed orders from that chair:', filed.view.you.filed);
assert.equal(filed.view.you.filed, true);

/* ---------------------------------------------------------------- export */
const csv = await call('GET', `/api/cohort/${made.cohortId}/export?demo=${made.demoToken}`);
const lines = String(csv.body).trim().split('\n');
console.log('\nThe gradebook, downloaded without an account:');
console.log('  ' + csv.headers.get('content-disposition'));
console.log('  ' + lines[0]);
console.log(`  ${lines.length - 1} rows`);
assert.equal(csv.status, 200);
assert(csv.headers.get('content-type').includes('text/csv'));
assert.equal(lines.length - 1, made.cohort.totals.players);

const refusedCsv = await call('GET', `/api/cohort/${made.cohortId}/export`);
console.log('  the same export with no token:', refusedCsv.status);
assert.equal(refusedCsv.status, 401);

/* ------------------------------------------------------------ advertised */
const cfg = ok(await call('GET', '/api/config'), 'config');
console.log('\nconfig advertises the demo:', JSON.stringify(cfg.demo));
assert(cfg.demo && cfg.demo.groups && cfg.demo.students,
  'the page needs to know what it is offering before it offers it');

console.log('\ndemo API OK');
