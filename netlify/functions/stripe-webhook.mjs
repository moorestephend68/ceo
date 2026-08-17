/* Stripe's callback.

   Its own function, on its own path, for two reasons. The signature is computed
   over the RAW body, so this must not sit behind anything that parses JSON
   first — that is the classic way a webhook ends up accidentally unauthenticated.
   And it is called by Stripe rather than by a player, so none of the session
   handling in api.mjs applies to it. */

import * as B from '../../lib/billing.mjs';
import { getDb } from '../../lib/runtime.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const raw = await req.text();
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('missing signature', { status: 400 });

  let event;
  try {
    event = B.verifyEvent(B.stripeClient(), raw, signature,
                          process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    /* Unsigned or tampered. 400 tells Stripe not to bother retrying. */
    return new Response(`signature: ${e.message}`, { status: 400 });
  }

  try {
    const result = await B.applyEvent(getDb(), event);
    console.log('stripe', event.type, JSON.stringify(result));
    return new Response('ok', { status: 200 });
  } catch (e) {
    /* A 500 makes Stripe retry, which is what we want for a transient database
       problem — applyEvent is idempotent, so a retry is safe. */
    console.error('stripe handler failed', e);
    return new Response('handler failed', { status: 500 });
  }
};

export const config = { path: '/hooks/stripe' };
