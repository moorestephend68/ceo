/* Payments, without a network.

   Stripe is faked for checkout and real for signatures — the SDK can generate a
   valid test signature, so verification is exercised properly rather than
   stubbed past. The cases that matter are the ones that happen to real
   customers: the same webhook arriving three times, a forged webhook, somebody
   whose name hold expired while they were typing their card in, and somebody
   trying to buy a second company. */

import assert from 'node:assert';
import Stripe from 'stripe';
import { memoryDb } from '../lib/db.mjs';
import * as A from '../lib/accounts.mjs';
import * as B from '../lib/billing.mjs';

process.env.STRIPE_PRICE_HOST = 'price_test_host';

const db = memoryDb();
await db.ensureProfile('user-a', 'a@example.com');
await db.ensureProfile('user-b', 'b@example.com');

/* a fake Stripe for checkout */
const created = [];
const fakeStripe = {
  checkout: { sessions: { create: async (opts) => {
    created.push(opts);
    return { id: `cs_${created.length}`, url: `https://checkout.stripe.test/${created.length}` };
  } } },
};

const now = '2026-09-01T09:00:00Z';
const origin = 'https://ceo-the-game.netlify.app';

/* ------------------------------------------------------------- checkout */
const co = await B.startCheckout({
  stripe: fakeStripe, db, user: { id: 'user-a', email: 'a@example.com' },
  kind: 'host', companyName: 'Ravensworth & Co', origin, now,
});
console.log('checkout created:', co.url);
console.log('  name held before payment:', co.hold.name, `(${co.hold.status})`);
assert.equal(co.hold.status, 'pending', 'the name must be held before checkout');
assert.equal(created[0].metadata.user, 'user-a');
assert.equal(created[0].metadata.company, co.hold.id);
assert(created[0].success_url.includes('paid=1'));

/* somebody else cannot check out for the same name */
await assert.rejects(() => B.startCheckout({
  stripe: fakeStripe, db, user: { id: 'user-b' }, kind: 'host',
  companyName: 'ravensworth & co', origin, now,
}), /just taken/);
console.log('  a second buyer for the same name never reaches Stripe');

/* ------------------------------------------------- the webhook, for real */
const SECRET = 'whsec_test_secret';
const stripe = new Stripe('sk_test_dummy');

const event = {
  id: 'evt_001', type: 'checkout.session.completed',
  data: { object: { id: 'cs_1', payment_status: 'paid',
    client_reference_id: 'user-a',
    metadata: { user: 'user-a', kind: 'host', company: co.hold.id, name: 'Ravensworth & Co' } } },
};
const raw = JSON.stringify(event);
const header = stripe.webhooks.generateTestHeaderString({ payload: raw, secret: SECRET });

const verified = B.verifyEvent(stripe, raw, header, SECRET);
console.log('\nsignature verified, event:', verified.type);

const first = await B.applyEvent(db, verified);
console.log('applied:', JSON.stringify(first));
assert.equal(first.granted, true);
assert.equal(first.company, 'Ravensworth & Co');
assert.equal((await A.accountState(db, 'user-a')).canHost, true);

/* Stripe retries. Three deliveries, one grant. */
await B.applyEvent(db, verified);
await B.applyEvent(db, verified);
const ents = await db.entitlementsOf('user-a');
console.log(`delivered three times -> ${ents.length} entitlement, 1 company`);
assert.equal(ents.length, 1);
assert.equal((await db.companiesOf('user-a')).length, 1);

/* A forged webhook must not be accepted. */
const forged = JSON.stringify({ ...event, id: 'evt_forged',
  data: { object: { ...event.data.object, metadata: { user: 'user-b', kind: 'host' } } } });
assert.throws(() => B.verifyEvent(stripe, forged, header, SECRET), /signature/i);
console.log('a tampered payload with a stolen signature: rejected');
assert.equal((await A.accountState(db, 'user-b')).canHost, false);

/* An unpaid session grants nothing. */
const unpaid = await B.applyEvent(db, { id: 'evt_x', type: 'checkout.session.completed',
  data: { object: { id: 'cs_x', payment_status: 'unpaid', metadata: { user: 'user-b', kind: 'host' } } } });
console.log('an unpaid session:', JSON.stringify(unpaid));
assert(unpaid.ignored);
assert.equal((await A.accountState(db, 'user-b')).canHost, false);

/* Events we do not care about are ignored rather than erroring. */
assert((await B.applyEvent(db, { id: 'e', type: 'invoice.paid', data: { object: {} } })).ignored);
console.log('an unrelated event type: ignored, not an error');

/* ------------------------------------- the hold expired during checkout */
console.log('\nSomebody takes too long in Stripe and their hold expires:');
const slow = await A.claimName(db, 'user-b', 'Ketteridge', now);
await db.releaseExpiredHolds('2026-09-01T10:00:00Z');       // hold gone
console.log('  hold released while they were paying');
const late = await B.applyEvent(db, {
  id: 'evt_late', type: 'checkout.session.completed',
  data: { object: { id: 'cs_late', payment_status: 'paid',
    metadata: { user: 'user-b', kind: 'host', company: slow.id, name: 'Ketteridge' } } },
});
console.log('  webhook outcome:', JSON.stringify(late));
assert.equal(late.granted, true, 'somebody who paid must always get what they paid for');
assert.equal(late.recovered, true, 'the name was still free, so it should be recovered');
assert.equal((await A.accountState(db, 'user-b')).canHost, true);
assert.equal((await db.companiesOf('user-b')).filter((c) => c.status === 'active')[0].name, 'Ketteridge');

/* and if the name went to somebody else in the meantime, they still get hosting */
const taken = await A.claimName(db, 'user-a', 'Larkfield', now);
await db.activateCompany(taken.id);
const clash = await B.applyEvent(db, {
  id: 'evt_clash', type: 'checkout.session.completed',
  data: { object: { id: 'cs_clash', payment_status: 'paid',
    metadata: { user: 'user-b', kind: 'host', company: 'gone', name: 'Larkfield' } } },
});
console.log('  and if the name went to someone else:', JSON.stringify(clash));
assert.equal(clash.granted, true, 'the entitlement stands even when the name is lost');

/* ------------------------------------------------- one company per account */
await assert.rejects(() => B.startCheckout({
  stripe: fakeStripe, db, user: { id: 'user-a' }, kind: 'host',
  companyName: 'Something Else', origin, now,
}), /already have a company/);
console.log('\nbuying a second company: refused');

console.log('\nbilling OK');
