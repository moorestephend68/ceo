/* The hiring side, attacked rather than demonstrated.

   This is the part of the product where being wrong hurts a person rather than
   a number, so every test here is an attempt to do something that should be
   impossible: see somebody who never opted in, learn who they are, approach
   them twice, or mail the whole pool.

   The one thing being proved rather than prevented is that a company can find
   somebody who asked to be found and invite them once. */

import assert from 'node:assert';
import { memoryDb } from '../lib/db.mjs';
import * as A from '../lib/accounts.mjs';
import * as G from '../lib/game.mjs';
import * as P from '../lib/public.mjs';
import * as RC from '../lib/recruit.mjs';

const db = memoryDb();
globalThis.__CEO_DB__ = db;

const USERS = {
  'tok:willing': { id: 'u-willing', email: 'willing@example.com' },   // opted in, plays
  'tok:private': { id: 'u-private', email: 'private@example.com' },   // never opted in
  'tok:hirer': { id: 'u-hirer', email: 'hirer@example.com' },         // pays for access
  'tok:nosy': { id: 'u-nosy', email: 'nosy@example.com' },            // has not paid
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

/* ---- two players, one of whom wants to be found ------------------------- */
const CO = {};
for (const [owner, name] of [['u-willing', 'Ravenscarr Holdings'], ['u-private', 'Quietly Ltd']]) {
  await db.ensureProfile(owner, `${owner}@example.com`);
  const c = await A.claimName(db, owner, name, new Date().toISOString());
  await A.confirmPurchase(db, { owner, companyId: c.id, kind: 'name', eventId: `evt_${owner}` });
  CO[owner] = c;
}
await db.ensureProfile('u-hirer', 'hirer@example.com');
await db.ensureProfile('u-nosy', 'nosy@example.com');
await A.confirmPurchase(db, { owner: 'u-hirer', kind: 'recruiter', eventId: 'evt_hire' });

/* Both play enough ranked games to be describable. */
async function play(owner, n, seed0) {
  for (let i = 0; i < n; i++) {
    const t0 = Date.parse('2026-08-01T09:00:00Z') + i * 3600000;
    const at = (ms) => new Date(ms).toISOString();
    const { game } = G.createGame({ ...P.FORMAT, hostName: CO[owner].name, seed: seed0 + i, now: at(t0) });
    game.isPublic = true;
    G.startGame(game, game.hostToken, at(t0));
    const seat = game.seats.find((x) => !x.isBot);
    seat.companyId = CO[owner].id;
    let r = 0;
    while (game.status === 'playing') {
      const v = G.viewFor(game, seat.token);
      if (v.you && v.you.products.length && !v.you.bankrupt) {
        const products = {};
        for (const p of v.you.products) {
          products[p.name] = { price: Math.round(p.value * 0.98), rd: 28000, rdProcess: 11000,
            produce: Math.max(0, Math.min(Math.round((p.lastDemand || 1300) * 1.05), p.effCapacity) - p.inventory),
            advertising: 10000, targetCapacity: Math.round(p.capacity), discontinue: false };
        }
        try { G.submitDecisions(game, seat.token, { products, launch: false }); } catch {}
      }
      G.resolveRound(game, at(t0 + (++r) * 300000));
    }
    game.lastResolvedAt = at(t0 + r * 300000);
    await P.scoreGame(db, game);
  }
}
await play('u-willing', 8, 51000);
await play('u-private', 8, 52000);

/* Only one of them asks to be found. */
ok(await call('POST', '/api/talent/optin',
  { adult: true, openTo: 'Commercial strategy', region: 'UK' }, 'tok:willing'), 'opt in');

/* ---- you cannot look without paying ------------------------------------- */
console.log('Getting at the pool:');
{
  const anon = await call('GET', '/api/recruiter/pool');
  console.log(`  signed out: ${anon.status} — ${anon.body.error}`);
  assert.strictEqual(anon.status, 401, 'an anonymous request read the pool');

  const nosy = await call('GET', '/api/recruiter/pool', null, 'tok:nosy');
  console.log(`  signed in without paying: ${nosy.status} — ${nosy.body.error}`);
  assert.strictEqual(nosy.status, 402, 'somebody who has not paid read the pool');

  /* And a player cannot read it either — being in the pool is not the same
     permission as browsing it. */
  const player = await call('GET', '/api/recruiter/pool', null, 'tok:willing');
  assert.strictEqual(player.status, 402, 'a listed player could browse the pool');
  console.log('  a listed player, browsing: 402 — being in it is not the same as seeing it\n');
}

/* ---- what a paying company actually sees -------------------------------- */
console.log('What the paying company sees:');
const seen = ok(await call('GET', '/api/recruiter/pool', null, 'tok:hirer'), 'pool');
console.log(`  ${seen.total} player${seen.total === 1 ? '' : 's'} in the pool`);
assert.strictEqual(seen.total, 1, 'the pool is the wrong size');
const entry = seen.entries[0];
console.log(`  ${entry.profile.name} · ${entry.profile.games} games · ` +
            `${entry.profile.averageText} a game · open to: ${entry.openTo}`);

/* The player who never opted in must be absent, by name and by id. */
const asText = JSON.stringify(seen);
assert(!asText.includes('Quietly Ltd'), 'somebody who never opted in is in the pool');
assert(!asText.includes(CO['u-private'].id), 'their company id leaked into the pool');
console.log('  and the player who never opted in appears nowhere in it');

/* No identity, anywhere in the payload. */
for (const leak of ['willing@example.com', 'u-willing', 'email']) {
  assert(!asText.includes(leak), `"${leak}" reached a recruiter`);
}
console.log('  no email, no account id, no name of a person — a record and nothing else\n');

/* ---- the approach -------------------------------------------------------- */
console.log('Sending an invitation:');
{
  const bad = await call('POST', '/api/recruiter/invite',
    { companyId: entry.companyId, role: 'Analyst' }, 'tok:hirer');
  console.log(`  with no employer named: ${bad.status} — ${bad.body.error}`);
  assert(bad.status >= 400, 'an invitation from nobody in particular was allowed');

  const sent = ok(await call('POST', '/api/recruiter/invite', {
    companyId: entry.companyId, from: 'Halloway & Finch',
    role: 'Commercial Analyst', url: 'https://halloway.example/jobs/17',
    blurb: 'Two years out, commercial team of nine.',
  }, 'tok:hirer'), 'invite');
  console.log(`  to ${sent.to}: "${sent.invitation.reason}"`);
  assert.strictEqual(sent.to, 'Ravenscarr Holdings');

  /* Twice is the thing this must not allow. */
  const again = await call('POST', '/api/recruiter/invite', {
    companyId: entry.companyId, from: 'Halloway & Finch', role: 'Something else',
  }, 'tok:hirer');
  console.log(`  the same player again: ${again.status} — ${again.body.error}`);
  assert.strictEqual(again.status, 409, 'a player was approached twice by the same company');
  console.log('  one approach each, and it does not reset\n');
}

/* ---- the player's side --------------------------------------------------- */
console.log('What the player gets:');
{
  const mine = ok(await call('GET', '/api/talent/me', null, 'tok:willing'), 'me');
  assert.strictEqual(mine.invitations.length, 1, 'the invitation did not arrive');
  const inv = mine.invitations[0];
  console.log(`  from ${inv.from} — ${inv.role}`);
  console.log(`  "${inv.reason}"`);
  assert.strictEqual(inv.from, 'Halloway & Finch');
  assert(inv.url, 'no way to act on it');

  /* The recruiter's account id is not the player's business either. */
  assert(!JSON.stringify(inv).includes('u-hirer'), "the recruiter's account id reached the player");
  console.log('  and the approach carries no account id in either direction');

  const after = ok(await call('POST', '/api/talent/invitation/dismiss', { id: inv.id }, 'tok:willing'), 'dismiss');
  assert.strictEqual(after.invitations.length, 0, 'dismissing did nothing');
  console.log('  dismissed in one press\n');
}

/* ---- leaving the list ---------------------------------------------------- */
console.log('Taking yourself off the list:');
{
  ok(await call('POST', '/api/talent/optout', {}, 'tok:willing'), 'opt out');
  const empty = ok(await call('GET', '/api/recruiter/pool', null, 'tok:hirer'), 'pool after');
  console.log(`  the pool is now ${empty.total}`);
  assert.strictEqual(empty.total, 0, 'somebody who left is still visible');

  /* And an id kept from the earlier browse must not still work. */
  const stale = await call('POST', '/api/recruiter/invite',
    { companyId: entry.companyId, from: 'Halloway & Finch', role: 'Anything' }, 'tok:hirer');
  console.log(`  inviting them with a saved id: ${stale.status} — ${stale.body.error}`);
  assert(stale.status >= 400, 'a saved id reached somebody who had left the list');
  console.log('  a company id kept from a previous browse is worth nothing\n');
}

/* ---- the daily cap ------------------------------------------------------- */
console.log('The daily cap:');
{
  const at = '2026-09-01T09:00:00Z';
  for (let i = 0; i < RC.DAILY_LIMIT; i++) {
    await db.putInvitation({ recruiter: 'u-hirer', company_id: 'filler-' + i,
      from_name: 'X', role: 'Y', created_at: at });
  }
  await assert.rejects(() => RC.invite(db, 'u-hirer',
    { companyId: 'anything', from: 'X', role: 'Y', now: at }), /is the limit/);
  console.log(`  ${RC.DAILY_LIMIT} in a day, and the next one is refused`);
  console.log('  because an invitation is only worth opening if it is not sent to everybody');
}

console.log('\nrecruit OK');
