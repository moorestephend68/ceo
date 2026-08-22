/* The side of the hiring product a company sees.

   A company pays for access, browses players who asked to be found, and sends
   one thing: an invitation to apply for a named job. It never learns who
   anybody is. Replying happens on the employer's own site, so we are not in the
   middle of a conversation — we are the introduction and nothing more.

   lib/talent.mjs decides who may be seen and what may be said about them. This
   file decides what a company may do, and it is almost entirely a list of
   things they may not.

   **They see a record, never a person.** Company name, games played, average,
   percentile, how they play. No email, no real name, no location beyond what
   the player typed in themselves. The profile object handed to a recruiter is
   built by the same function that builds it for the player, so there is no
   second code path down which a field could quietly leak.

   **One approach per player, for ever.** Not per week — for ever. A company
   that has been ignored once does not get to ask again, and the unique index on
   (recruiter, company) is what enforces it rather than good manners.

   **A daily cap.** Twenty a day. Enough to work a shortlist, not enough to mail
   the whole pool and see who bites. The thing that makes an invitation worth
   opening is that it is not spam, and that property has to be defended from the
   people paying us.

   **No free text to a person.** The company states who they are, which job, a
   link, and their own standard blurb for that role — all facts about the
   employer, not messages to an individual. There is no field in which one
   person writes a sentence to another person, which is what makes this an
   approach rather than a channel, and why there is nothing here to moderate.

   **The player is anonymous; the employer is not.** Only one side of this needs
   protecting. An invitation from nobody in particular is worthless to receive
   and sinister to get, so the employer's name is required and travels with it.

   **Nothing ranks the pool for them.** It comes back in a fixed order with a
   percentile on each profile, and no sort control. A ranked shortlist handed to
   an employer is a selection procedure and a different body of law; an
   invitation to apply is sourcing. See the note at the top of lib/talent.mjs. */

import * as T from './talent.mjs';
import * as A from './accounts.mjs';

/* How many invitations one company may send in a day. */
export const DAILY_LIMIT = 20;

/* How many profiles come back at once. Deliberately modest: this is a pool to
   work through, not a list to mail. */
export const PAGE = 25;

export class NotAllowed extends Error {}

/* ----------------------------------------------------------------- access */

export async function requireRecruiter(db, owner) {
  if (!owner) throw new NotAllowed('Sign in first.');
  const state = await A.accountState(db, owner);
  if (!state.canRecruit) {
    throw new NotAllowed('Seeing players who are open to being approached needs hiring access.');
  }
  return state;
}

/* ------------------------------------------------------------------- pool */

/* Everybody who asked to be found, is over eighteen, has a company name, and
   has played enough for the record to mean anything. Every one of those is
   checked here as well as where the profile is built — a rule that matters
   should not be enforced in only one place. */
export async function pool(db, { start, limit = PAGE, offset = 0 } = {}) {
  const opted = await db.liveTalentOptIns();
  const out = [];

  for (const o of opted) {
    if (!o.adult || o.revoked_at) continue;              // belt, and braces
    const acct = await A.accountState(db, o.owner);
    const company = acct.companies[0];
    if (!company) continue;

    const rows = await db.resultsForCompany(company.id);
    const profile = T.profile(rows, { population: [], optIn: o });
    if (!profile.visible) continue;

    out.push({ companyId: company.id, profile, openTo: o.open_to || '', region: o.region || '' });
  }

  /* A percentile needs a population, and the population is this. Computed after
     the fact so that every profile is measured against the same set. */
  const averages = out.map((e) => e.profile.average);
  for (const e of out) {
    e.profile.percentile = percentileOf(e.profile.average, averages);
  }

  /* Newest first. Not "best first": the order a customer is handed a list in is
     itself a recommendation, and recommending people to an employer is the line
     between sourcing somebody and screening them. */
  out.sort((a, b) => Date.parse(b.profile.since || 0) - Date.parse(a.profile.since || 0));

  return { total: out.length, entries: out.slice(offset, offset + limit) };
}

function percentileOf(value, all) {
  if (all.length < 20) return null;      // too few for a percentile to mean anything
  const below = all.filter((x) => x < value).length;
  return Math.max(1, Math.min(99, Math.round((below / all.length) * 100)));
}

/* ------------------------------------------------------------ invitations */

/* Send one. Everything that could be wrong is checked before anything is
   written, and the write itself is what enforces the one-per-player rule —
   two requests in the same instant cannot both win a unique index. */
export async function invite(db, recruiter, { companyId, from, role, url, blurb, now } = {}) {
  if (!from || !String(from).trim()) throw new NotAllowed('Say which employer this is from.');
  if (!role || !String(role).trim()) throw new NotAllowed('Say which job you are inviting them to apply for.');
  const at = now || new Date().toISOString();

  const since = new Date(Date.parse(at) - 24 * 3600000).toISOString();
  const sent = await db.invitationsSentSince(recruiter, since);
  if (sent >= DAILY_LIMIT) {
    throw new NotAllowed(`That is ${DAILY_LIMIT} invitations today, which is the limit. `
      + 'It is a limit because an invitation is only worth opening if it is not sent to everybody.');
  }

  /* Re-checked at the moment of sending rather than trusted from the browse:
     somebody may have taken themselves off the list between the two. */
  const eligible = await isStillEligible(db, companyId);
  if (!eligible.ok) throw new NotAllowed(eligible.why);

  const invitation = T.invitation({
    companyName: from, role, url, note: blurb, profile: eligible.profile,
  });

  const row = await db.putInvitation({
    recruiter, company_id: companyId, from_name: invitation.from,
    role: invitation.role, url: invitation.url, blurb: invitation.blurb,
    reason: invitation.reason, created_at: at,
  });
  if (!row) {
    throw new NotAllowed('You have already invited this player. '
      + 'One approach each is the rule, and it does not reset.');
  }
  return { sent: true, to: invitation.to, invitation };
}

async function isStillEligible(db, companyId) {
  const company = await db.companyById(companyId);
  if (!company || company.status !== 'active') {
    return { ok: false, why: 'That player is no longer listed.' };
  }
  const opt = await db.talentOptIn(company.owner);
  if (!T.eligible({ optIn: opt, companyId, games: Infinity })) {
    return { ok: false, why: 'That player has taken themselves off the list.' };
  }
  const rows = await db.resultsForCompany(companyId);
  const profile = T.profile(rows, { population: [], optIn: opt });
  if (!profile.visible) return { ok: false, why: 'That player is no longer listed.' };
  return { ok: true, profile };
}

/* --------------------------------------------------------- for the player */

/* What the player sees. The recruiter's own account id never comes back — they
   are a company name and a job, which is all an invitation is. */
export async function inbox(db, companyId) {
  const rows = await db.invitationsFor(companyId);
  return rows.filter((r) => !r.dismissed_at).map((r) => ({
    id: r.id, from: r.from_name, role: r.role, url: r.url,
    blurb: r.blurb, reason: r.reason, at: r.created_at,
  }));
}
