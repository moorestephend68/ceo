/* Stripe, kept behind a seam.

   The functions call these; the tests call them with a fake Stripe. Everything
   that decides anything lives here rather than in the HTTP handlers, so the
   interesting cases — a webhook delivered three times, a payment for a name
   whose hold expired, an event for a user who no longer exists — are testable
   without a network. */

import Stripe from 'stripe';
import * as A from './accounts.mjs';

let _stripe = null;
export function stripeClient() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe is not configured on the server.');
  _stripe = new Stripe(key);
  return _stripe;
}

/* What is for sale. Prices live in Stripe, not here — changing what you charge
   should not need a deploy, and it keeps currency and tax handling in the one
   place that understands them. */
export const PRODUCTS = {
  /* The name and the hosting used to be one purchase called a charter. They are
     two quite different things — one is an identity you keep, the other is a
     thing you do — and bundling them meant somebody who only wanted to be called
     something had to buy a feature they had no use for. Everyone who bought the
     bundle keeps both; see stage 9 of the schema. */
  name: {
    envPrice: 'STRIPE_PRICE_NAME',
    label: 'Company name',
    blurb: 'Your company name, kept for good. Ranked games count towards your record, '
         + 'and nobody else can take the name.',
  },
  host: {
    envPrice: 'STRIPE_PRICE_HOST',
    label: 'Private games',
    blurb: 'Host games for your friends, your team, or anybody you send a link to. '
         + 'You choose the length, the clock and the difficulty.',
    /* Hosting without a name is a purchase that cannot be used: creating a game
       needs a company to create it under. */
    needsName: true,
  },
  facilitator: {
    envPrice: 'STRIPE_PRICE_FACILITATOR',
    label: 'Facilitator licence',
    blurb: 'Run cohorts of games for a class or a team, with a dashboard and exports.',
  },
  recruiter: {
    envPrice: 'STRIPE_PRICE_RECRUITER',
    label: 'Hiring access',
    blurb: 'See the record of players who have asked to be found, and invite them to '
         + 'apply. You never see who they are; replying is theirs to decide.',
  },
};

/* Step 2 of the purchase. The name is already held by this account — see
   accounts.mjs — so checkout cannot be reached for a name somebody else owns. */
export async function startCheckout({ stripe, db, user, kind = 'host', companyName, origin, now }) {
  const product = PRODUCTS[kind];
  if (!product) throw new Error('There is nothing by that name for sale.');
  const price = process.env[product.envPrice];
  if (!price) throw new Error(`${product.label} is not configured for sale yet.`);

  const state = await A.accountState(db, user.id);

  let hold = null;
  if (kind === 'name') {
    if (!companyName) throw new Error('Choose a company name first.');
    /* Checked before the generic "you already own this" below, because naming
       the company they already have is a far more useful thing to be told. */
    if (state.companies.length) {
      throw new Error(`You already have a company: ${state.companies[0].name}.`);
    }
  }

  if (state.entitlements.includes(kind)) {
    throw new Error(`${product.label} is already on your account.`);
  }

  if (kind === 'name') hold = await A.claimName(db, user.id, companyName, now);

  /* Refused before any money moves rather than after. Somebody who pays for
     hosting with no company to host under has bought nothing they can use, and
     discovering that on the other side of a payment page is the worst possible
     moment. */
  if (product.needsName && !state.companies.length) {
    throw new Error('Get your company name first — a private game is created under it.');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price, quantity: 1 }],
    success_url: `${origin}/g/?paid=1&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/g/?cancelled=1`,
    client_reference_id: user.id,
    customer_email: user.email || undefined,
    /* Everything the webhook needs, so it never has to guess. */
    metadata: { user: user.id, kind, company: hold ? hold.id : '', name: hold ? hold.name : '' },
  });

  return { url: session.url, id: session.id, hold };
}

/* Step 3. Stripe retries until it gets a 2xx, so this runs more than once for
   the same payment as a matter of course rather than as an edge case. */
export async function applyEvent(db, event) {
  if (!event || event.type !== 'checkout.session.completed') {
    return { ignored: true, type: event && event.type };
  }
  const s = event.data.object;
  if (s.payment_status && s.payment_status !== 'paid') return { ignored: true, reason: 'unpaid' };

  const owner = (s.metadata && s.metadata.user) || s.client_reference_id;
  if (!owner) return { ignored: true, reason: 'no user on the session' };
  const kind = (s.metadata && s.metadata.kind) || 'name';
  const companyId = (s.metadata && s.metadata.company) || null;

  const result = await A.confirmPurchase(db, {
    owner, companyId: companyId || null, kind, eventId: event.id, ref: s.id,
  });

  /* A hold that expired while the buyer was in Stripe: they have paid, so the
     entitlement stands and the name is re-claimed if it is still free. Better a
     rare second attempt at the name than a charge with nothing behind it. */
  if (companyId && !result.company) {
    const wanted = (s.metadata && s.metadata.name) || null;
    if (wanted && await A.isAvailable(db, wanted)) {
      const again = await db.holdName(owner, wanted, null).catch(() => null);
      if (again) {
        await db.activateCompany(again.id);
        return { granted: true, kind, company: wanted, recovered: true };
      }
    }
    return { granted: true, kind, company: null, nameLost: wanted };
  }

  return {
    granted: true, kind,
    company: result.company ? result.company.name : null,
    replayed: !!(result.entitlement && (result.entitlement.replayed || result.entitlement.already)),
  };
}

/* Signature verification. The raw body matters: parsing it first breaks the
   signature, which is the classic way this ends up accidentally unauthenticated. */
export function verifyEvent(stripe, rawBody, signature, secret) {
  if (!secret) throw new Error('Stripe webhook secret is not configured.');
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}
