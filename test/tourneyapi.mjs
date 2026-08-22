/* The tournament over HTTP.

   test/tourney.mjs plays a whole event against the library. This checks the
   layer in front of it, which is where the mistakes are about permission rather
   than arithmetic: who may create an event, who may advance it, and — the one
   that would matter most — whether an entrant's token is a way into anybody
   else's event. */

import assert from 'node:assert';
import { memoryDb } from '../lib/db.mjs';
import * as A from '../lib/accounts.mjs';
import * as TR from '../lib/tournament.mjs';

const db = memoryDb();
globalThis.__CEO_DB__ = db;

const USERS = {
  'tok:host': { id: 'u-host', email: 'host@example.com' },     // has the licence
  'tok:other': { id: 'u-other', email: 'other@example.com' },  // has one too
  'tok:nobody': { id: 'u-nobody', email: 'nobody@example.com' }, // has not paid
};
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
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
};
const ok = (r, what) => {
  assert(r.status === 200, `${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

for (const [, u] of Object.entries(USERS)) await db.ensureProfile(u.id, u.email);
await A.confirmPurchase(db, { owner: 'u-host', kind: 'facilitator', eventId: 'evt_h' });
await A.confirmPurchase(db, { owner: 'u-other', kind: 'facilitator', eventId: 'evt_o' });

/* ------------------------------------------------------------ the licence */
console.log('Creating an event:');
{
  const anon = await call('POST', '/api/tournaments', { name: 'Nope' });
  console.log(`  signed out: ${anon.status}`);
  assert.strictEqual(anon.status, 401, 'an anonymous request created an event');

  const unpaid = await call('POST', '/api/tournaments', { name: 'Nope' }, 'tok:nobody');
  console.log(`  signed in without the licence: ${unpaid.status} — ${unpaid.body.error}`);
  assert(unpaid.status >= 400, 'somebody without a licence created an event');
  assert(/facilitator licence/.test(unpaid.body.error),
    'the message does not say what is needed');
  console.log('  and it is the same licence that runs classes, not a new product\n');
}

const made = ok(await call('POST', '/api/tournaments',
  { name: 'Autumn Cup', stages: 3, finalists: 6, rounds: 10, cadence: 'manual' },
  'tok:host'), 'create').tournament;
console.log(`Created "${made.name}" — code ${made.code}, `
  + `${made.settings.stages} stages, top ${made.settings.finalists} in the final\n`);

/* ------------------------------------------------------------- entering */
console.log('Entering:');
const tokens = [];
for (let i = 0; i < 14; i++) {
  const r = ok(await call('POST', '/api/tournament/enter',
    { code: made.code, name: `Company ${i + 1}` }), 'enter');
  tokens.push(r.token);
}
console.log(`  ${tokens.length} entrants, none of whom needed an account`);

{
  const dup = await call('POST', '/api/tournament/enter',
    { code: made.code, name: 'company 3' });
  console.log(`  the same name in a different case: ${dup.status} — ${dup.body.error}`);
  assert(dup.status >= 400, 'two entrants took the same name');

  const nowhere = await call('POST', '/api/tournament/enter',
    { code: 'ZZZZZZ', name: 'Ghost' });
  assert.strictEqual(nowhere.status, 404, 'a made-up code found an event');
  console.log('  and a code that is not an event is a 404\n');
}

/* -------------------------------------------------------------- control */
console.log('Who may run it:');
{
  const stranger = await call('POST', `/api/tournament/${made.id}/stage`, {}, 'tok:other');
  console.log(`  another facilitator advancing it: ${stranger.status} — ${stranger.body.error}`);
  assert.strictEqual(stranger.status, 403, "somebody else's event was advanced");

  const anon = await call('GET', `/api/tournament/${made.id}`);
  assert.strictEqual(anon.status, 401, 'the console was readable signed out');
  console.log(`  reading the console signed out: ${anon.status}`);
  console.log('  a licence runs your own events and nobody else\'s\n');
}

/* ------------------------------------------------------ an entrant's view */
console.log('What an entrant can read:');
{
  const mine = ok(await call('GET', `/api/tournament/me?token=${tokens[0]}`), 'me').view;
  console.log(`  ${mine.event.name} · ${mine.event.phase.label} · `
    + `${mine.event.entrants} entrants`);
  assert.strictEqual(mine.standings.length, 14);

  /* An entrant token is not a way into the console. */
  const asConsole = await call('GET', `/api/tournament/${made.id}`, null, tokens[0]);
  console.log(`  using it on the console: ${asConsole.status}`);
  assert(asConsole.status >= 400, 'an entrant token opened the facilitator console');

  const fake = await call('GET', '/api/tournament/me?token=not-a-real-token');
  assert.strictEqual(fake.status, 404, 'a made-up token read an event');
  console.log('  and a token from nowhere reads nothing\n');
}

/* --------------------------------------------------------- running a stage */
console.log('Running it:');
{
  const started = ok(await call('POST', `/api/tournament/${made.id}/stage`, {}, 'tok:host'), 'stage');
  const sizes = started.started.tables.map((t) => t.seats);
  console.log(`  stage 1 drawn: ${started.started.tables.length} tables (${sizes.join(' + ')})`);
  assert.strictEqual(sizes.reduce((a, b) => a + b, 0), 14, 'somebody was left out');
  assert.strictEqual(started.tournament.phase.phase, 'stage');

  /* Pressing it twice must not double the field's money. */
  const again = await call('POST', `/api/tournament/${made.id}/stage`, {}, 'tok:host');
  console.log(`  pressing it again straight away: ${again.status} — ${again.body.error}`);
  assert(again.status >= 400, 'a stage was drawn twice over the API');

  /* And the entrant is now told where to go, with a token they never chose. */
  const mine = ok(await call('GET', `/api/tournament/me?token=${tokens[0]}`), 'me').view;
  console.log(`  entrant 1 is at table ${mine.table.groupNo}, game ${mine.table.code}`);
  assert(mine.table && mine.table.code, 'an entrant was not told which table they are at');
  assert(mine.table.token, 'an entrant was given no way into their game');
  assert.notStrictEqual(mine.table.token, tokens[0],
    'the seat token and the entrant token are the same thing');
  console.log('  the seat token is not the entrant token — one changes, the other does not');

  /* The field closes once the draw has happened. */
  const late = await call('POST', '/api/tournament/enter', { code: made.code, name: 'Latecomer' });
  console.log(`  entering after the draw: ${late.status} — ${late.body.error}`);
  assert(late.status >= 400, 'somebody entered an event already in progress');
}

console.log('\ntourney API OK');
