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

/* Whole words, not stems.

   Stems are the obvious design and the wrong one: "rape" catches Rapeseed Oil
   Company, "shit" catches Shitake Farms. Every one of those refusals lands on
   somebody typing a real name, and they do not write in to complain — they leave.
   So the list is of words as they are actually used, and the two prefixes that
   survive are the two with no innocent continuation. */
const BLOCKED = new Set([
  'fuck', 'fucks', 'fucked', 'fucking', 'fucker', 'fuckers', 'fuk', 'fuks',
  'phuck', 'fvck', 'stfu',
  'shit', 'shits', 'shitty', 'shite', 'bullshit',
  'cunt', 'cunts', 'twat', 'wank', 'wanker', 'wankers',
  'bitch', 'bitches', 'whore', 'whores', 'slut', 'sluts',
  'rape', 'raped', 'rapes', 'raping', 'rapist', 'rapists',
  'retard', 'retards', 'retarded',
  'nigger', 'niggers', 'nigga', 'niggas', 'kike', 'kikes', 'spic', 'spics',
  'paki', 'pakis', 'chink', 'chinks', 'tranny', 'trannies', 'fag', 'fags',
  'faggot', 'faggots',
]);

/* The two where anything following the stem is still the same word. */
const BLOCKED_PREFIXES = ['nigg', 'fagg'];

/* Names that exist to be mistaken for us. "Official CEO Support" is not a company
   somebody wants to run; it is a handle somebody wants on a leaderboard. */
const IMPERSONATION = new Set(['official', 'admin', 'support', 'staff', 'help',
                               'moderator', 'team', 'system']);

/* Letters people substitute for digits when they know a filter is watching. */
const DELEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's' };
const deleet = (s) => String(s).toLowerCase().replace(/[013457 8@$]/g, (c) => DELEET[c] || c);

/* Words, with the punctuation between them thrown away but the gaps kept.

   Keeping the gaps is the whole point. The previous version squashed the name to
   bare letters and asked whether a banned stem appeared anywhere in it, which
   refused "Scunthorpe Trading", "Rapeseed Oil Company" and "Shitake Farms" — and
   did so on the payment page, to somebody about to hand over money. Nobody
   reports being wrongly refused; they just leave. */
const words = (s) => deleet(s).split(/[^a-z0-9]+/).filter(Boolean);

/* The one thing squashing was good for: "f u c k it ltd". That is a spelling
   nobody arrives at by accident, so it is recognised by its shape — three or more
   single letters in a row — rather than by flattening every name ever typed. */
const spacedOut = (s) => {
  const w = words(s);
  let run = 0;
  for (const t of w) {
    run = t.length === 1 ? run + 1 : 0;
    if (run >= 3) return true;
  }
  return false;
};

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const hitsBlocked = (name) => {
  const w = words(name);
  if (w.some((t) => BLOCKED.has(t))) return true;
  if (w.some((t) => BLOCKED_PREFIXES.some((b) => t.startsWith(b)))) return true;
  /* only for names deliberately spelled out letter by letter */
  if (spacedOut(name)) {
    const flat = deleet(squash(name));
    if ([...BLOCKED].some((b) => b.length >= 4 && flat.includes(b))) return true;
  }
  return false;
};

/* Impersonating the site itself, which reads as official to everyone else. */
const hitsImpersonation = (name) => {
  const w = words(name);
  return w.includes('ceo') && w.some((t) => IMPERSONATION.has(t));
};

/* A trademark is matched as a word, not as a substring — otherwise "Pineapple
   Ltd" is refused for containing "apple". */
const hitsProtected = (name) =>
  words(name).some((t) => PROTECTED.some((b) => t === b || t.startsWith(b)));

/* Making a typed name usable instead of refusing it.

   A purchased name is refused when it breaks a rule, because the buyer is paying
   for that exact string. A name typed by a student in a classroom is not: they
   are one of forty people with an instructor waiting, and "Letters, numbers and
   & . , - ' only" in front of the room is a worse outcome than quietly turning
   "Group 3 :)" into "Group 3". Only the cosmetic rules are relaxed — a blocked
   word is still blocked. */
function tidyName(raw) {
  let s = String(raw == null ? '' : raw)
    .replace(/[^\p{L}\p{N} '&.,\-]/gu, ' ')      // drop what the format forbids
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+/u, '')             // must start with a letter or digit
    .trim();
  if (s.length > NAME.max) {
    s = s.slice(0, NAME.max).replace(/[\s'&.,\-]+$/, '');
  }
  return s;
}

export function checkName(raw, { tidy = false } = {}) {
  const name = tidy ? tidyName(raw)
    : String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (name.length < NAME.min) return { ok: false, error: `A company name needs at least ${NAME.min} characters.` };
  if (name.length > NAME.max) return { ok: false, error: `Keep it to ${NAME.max} characters or fewer.` };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '&.,\-]*$/u.test(name)) {
    return { ok: false, error: 'Letters, numbers and & . , - \' only, starting with a letter or number.' };
  }
  if (RESERVED.has(squash(name))) return { ok: false, error: 'That name is reserved.' };
  if (hitsProtected(name)) {
    return { ok: false, error: 'That looks like a real company\u2019s trademark. Please pick something of your own.' };
  }
  if (hitsBlocked(name)) {
    return { ok: false, error: 'Please choose a different name.' };
  }
  if (hitsImpersonation(name)) {
    return { ok: false, error: 'That reads as though it belongs to us. Please pick something of your own.' };
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
    /* An active company row IS the name, so either is enough to say they have
       one. The entitlement exists for the payment record and its idempotency;
       the company row is the thing that means anything. */
    hasName: ents.some((e) => e.kind === 'name') || active.length > 0,
    canHost: ents.some((e) => e.kind === 'host'),
    canFacilitate: ents.some((e) => e.kind === 'facilitator'),
    canRecruit: ents.some((e) => e.kind === 'recruiter'),
  };
}

/* The one rule the API enforces on every private game: hosting is what was
   bought, so it is checked on the server and never inferred from the client. */
export async function requireHost(db, owner) {
  if (!owner) throw new Error('Sign in to host a game.');
  const state = await accountState(db, owner);
  if (!state.canHost) throw new Error('Hosting a private game is a separate purchase.');
  return state;
}
