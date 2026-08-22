/* Can two people buy the same company name?

   This is the question that forced the move off object storage, so it deserves a
   test that would actually fail if the guarantee were not there. The in-memory
   database enforces the same unique index Postgres does and raises the same
   SQLSTATE, so "one of them loses" is being proved rather than assumed.

   The ordering under test is: hold the name, THEN take the money. The failure
   mode being designed out is a customer who pays and then discovers the name
   went to somebody else. */

import assert from 'node:assert';
import { memoryDb, UniqueViolation } from '../lib/db.mjs';
import * as A from '../lib/accounts.mjs';

const db = memoryDb();
const now = '2026-09-01T09:00:00Z';

await db.ensureProfile('user-a', 'a@example.com');
await db.ensureProfile('user-b', 'b@example.com');
await db.ensureProfile('user-c', 'c@example.com');

/* ------------------------------------------------------- what a name may be */
console.log('Name rules:');
for (const [input, why] of [
  ['Ravensworth & Co', 'ordinary'],
  ['Xu', 'too short'],
  ['A company name that is far too long to fit', 'too long'],
  ['admin', 'reserved'],
  ['Walmart Holdings', 'someone else’s trademark'],
  ['<script>alert(1)</script>', 'not a name'],
  ['Dunmore & Sons', 'ordinary'],
]) {
  const r = A.checkName(input);
  console.log(`  ${r.ok ? 'ok    ' : 'refused'}  ${JSON.stringify(input).padEnd(44)} ${r.ok ? '' : r.error}`);
}
assert(A.checkName('Ravensworth & Co').ok);
assert(!A.checkName('admin').ok, 'reserved names must be refused');
assert(!A.checkName('Walmart Holdings').ok, 'trademarks must be refused');
assert(!A.checkName('<script>alert(1)</script>').ok);

/* --------------------------------------------------------------- the race */
console.log('\nTwo people claim the same name at the same moment:');
const results = await Promise.allSettled([
  A.claimName(db, 'user-a', 'Sableworth Ltd', now),
  A.claimName(db, 'user-b', 'Sableworth Ltd', now),
]);
const won = results.filter((r) => r.status === 'fulfilled');
const lost = results.filter((r) => r.status === 'rejected');
console.log(`  winners: ${won.length}   losers: ${lost.length}`);
console.log(`  the loser is told: "${lost[0].reason.message}"`);
assert.equal(won.length, 1, 'exactly one claim must succeed');
assert.equal(lost.length, 1, 'the other must be refused');

/* and case does not get you round it */
await assert.rejects(() => A.claimName(db, 'user-c', 'sableworth ltd', now),
  /just taken/, 'a different case must not be a different name');
console.log('  "sableworth ltd" is the same name as "Sableworth Ltd": refused');

/* --------------------------------------------- nobody pays for a lost name */
const holder = won[0].value;
console.log(`\n  the winner holds it until ${holder.expires_at} (${A.HOLD_MINUTES} minutes)`);
assert.equal(holder.status, 'pending');
/* The loser never reached checkout, which is the point of holding first. */

/* ----------------------------------------------------- confirming the sale */
const first = await A.confirmPurchase(db, {
  owner: 'user-a', companyId: holder.id, eventId: 'evt_1', ref: 'cs_1',
});
assert.equal(first.company.status, 'active');
console.log('\nAfter payment:', first.company.name, 'is', first.company.status);

/* Stripe redelivers webhooks. Granting must happen once. */
const replay = await A.confirmPurchase(db, {
  owner: 'user-a', companyId: holder.id, eventId: 'evt_1', ref: 'cs_1',
});
const entsA = await db.entitlementsOf('user-a');
console.log(`webhook delivered twice -> ${entsA.length} entitlement (replayed: ${!!replay.entitlement.replayed})`);
assert.equal(entsA.length, 1, 'a redelivered webhook must not grant twice');

/* And a customer who simply pays again is not double-granted either. */
await A.confirmPurchase(db, { owner: 'user-a', companyId: null, eventId: 'evt_2', ref: 'cs_2' });
assert.equal((await db.entitlementsOf('user-a')).length, 1, 'paying twice must not stack entitlements');
console.log('customer pays a second time ->', (await db.entitlementsOf('user-a')).length, 'entitlement');

/* -------------------------------------------------- abandoned checkouts */
console.log('\nSomebody claims a name and never pays:');
await A.claimName(db, 'user-b', 'Ketteridge', now);
assert.equal(await A.isAvailable(db, 'Ketteridge'), false);
console.log('  held, so unavailable to others');
const later = '2026-09-01T10:00:00Z';           // past the hold
const freed = await db.releaseExpiredHolds(later);
console.log(`  ${A.HOLD_MINUTES} minutes later the hold expires; ${freed} name released`);
assert.equal(freed, 1);
assert.equal(await A.isAvailable(db, 'Ketteridge'), true);
const reclaimed = await A.claimName(db, 'user-c', 'Ketteridge', later);
console.log('  somebody else can now take it:', reclaimed.owner);
assert.equal(reclaimed.owner, 'user-c');

/* ------------------------------------------------------------- hosting */
console.log('\nHosting is checked on the server:');
await assert.rejects(() => A.requireHost(db, 'user-c'), /separate purchase/);
console.log('  an account with no charter: refused');
const hostOk = await A.requireHost(db, 'user-a');
console.log('  the account that paid:', hostOk.canHost ? 'allowed' : 'REFUSED');
assert(hostOk.canHost);
await assert.rejects(() => A.requireHost(db, null), /Sign in/);
console.log('  signed out: refused');

const state = await A.accountState(db, 'user-a');
console.log('\naccount state:', JSON.stringify(state));
assert.deepEqual(state.companies.map((c) => c.name), ['Sableworth Ltd']);

console.log('\naccounts OK');
