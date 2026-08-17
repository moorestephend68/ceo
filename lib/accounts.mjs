/* Accounts, company names and what an account has paid for.

   The purchase flow is deliberately ordered so that nobody can pay for a name
   somebody else ends up owning:

     1. claim   — the name is HELD in the database. The unique index decides the
                  winner here, before any money moves.
     2. pay     — Stripe checkout, for the holder only.
     3. confirm — the webhook flips the hold to permanent and grants hosting.

   The alternative — take the money, then try to reserve the name — is the
   version that produces refund emails. */

import { UniqueViolation } from './db.mjs';

/* Long enough for a slow checkout, short enough that an abandoned one frees the
   name the same afternoon. */
export const HOLD_MINUTES = 30;

export const NAME = { min: 3, max: 28 };

/* Names appear on a public leaderboard next to strangers, so they are filtered
   here rather than apologised for later. §16 called this cheap up front and
   awkward to retrofit, and a purchased name is exactly the thing you cannot
   quietly rename afterwards. */
const RESERVED = new Set([
  'admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'help',
  'ceo', 'ceothegame', 'official', 'system', 'null', 'undefined', 'anonymous',
  'root', 'owner', 'host', 'facilitator', 'instructor', 'teacher',
]);

/* Trademarks are a legal problem rather than a taste one: a purchased name sits
   on a public page, and "Walmart Inc" there is not something to discover later. */
const PROTECTED = [
  'walmart', 'amazon', 'apple', 'google', 'microsoft', 'meta', 'facebook',
  'tesla', 'netflix', 'nike', 'disney', 'coca-cola', 'cocacola', 'pepsi',
  'mcdonald', 'starbucks', 'samsung', 'sony', 'openai', 'anthropic',
];

const SLURS_STUB = ['fuck', 'shit', 'cunt', 'nigg', 'fagg', 'rape'];

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function checkName(raw) {
  const name = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (name.length < NAME.min) return { ok: false, error: `A company name needs at least ${NAME.min} characters.` };
  if (name.length > NAME.max) return { ok: false, error: `Keep it to ${NAME.max} characters or fewer.` };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '&.,\-]*$/u.test(name)) {
    return { ok: false, error: 'Letters, numbers and & . , - \' only, starting with a letter or number.' };
  }
  const flat = squash(name);
  if (RESERVED.has(flat)) return { ok: false, error: 'That name is reserved.' };
  if (PROTECTED.some((b) => flat.includes(b))) {
    return { ok: false, error: 'That looks like a real company’s trademark. Please pick something of your own.' };
  }
  if (SLURS_STUB.some((b) => flat.includes(b))) {
    return { ok: false, error: 'Please choose a different name.' };
  }
  return { ok: true, name };
}

export const isAvailable = async (db, name) => {
  const row = await db.companyByName(name);
  if (!row) return true;
  /* an expired hold is not a claim */
  return row.status === 'pending' && row.expires_at && Date.parse(row.expires_at) < Date.now();
};

/* Step 1. Whoever gets here first wins, decided by the index rather than by
   whose payment cleared. Returns the hold to check out against. */
export async function claimName(db, owner, raw, now) {
  const checked = checkName(raw);
  if (!checked.ok) throw new Error(checked.error);
  const at = now ? new Date(now) : new Date();
  const expires = new Date(at.getTime() + HOLD_MINUTES * 60000).toISOString();
  try {
    return await db.holdName(owner, checked.name, expires);
  } catch (e) {
    if (e instanceof UniqueViolation || e.code === '23505') {
      throw new Error('Somebody has just taken that name. Try another.');
    }
    throw e;
  }
}

/* Step 3. Idempotent in both directions: Stripe retries webhooks, and a
   customer can pay twice. */
export async function confirmPurchase(db, { owner, companyId, kind = 'host', eventId, ref }) {
  const ent = await db.grantEntitlement(owner, kind, eventId, ref);
  const company = companyId ? await db.activateCompany(companyId) : null;
  return { entitlement: ent, company };
}

export async function accountState(db, owner) {
  const [companies, ents] = await Promise.all([db.companiesOf(owner), db.entitlementsOf(owner)]);
  const active = companies.filter((c) => c.status === 'active');
  const pending = companies.filter((c) => c.status === 'pending');
  return {
    companies: active.map((c) => ({ id: c.id, name: c.name })),
    pending: pending.map((c) => ({ id: c.id, name: c.name, expires: c.expires_at })),
    entitlements: ents.map((e) => e.kind),
    canHost: ents.some((e) => e.kind === 'host'),
    canFacilitate: ents.some((e) => e.kind === 'facilitator'),
  };
}

/* The one rule the API enforces on every private game: hosting is what was
   bought, so it is checked on the server and never inferred from the client. */
export async function requireHost(db, owner) {
  if (!owner) throw new Error('Sign in to host a game.');
  const state = await accountState(db, owner);
  if (!state.canHost) throw new Error('Hosting a private game needs a company charter.');
  return state;
}
