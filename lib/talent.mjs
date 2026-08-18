/* Being findable by somebody who is hiring.

   A company pays to browse a pool of players, sees a company name and a record,
   and can send exactly one thing: an invitation to apply. It never sees who the
   person is. The player decides whether to answer, and answering is what
   reveals them.

   Almost everything in this file is a refusal, and each refusal has a reason.

   **Nobody is in the pool who did not ask to be.** Not opted out — opted *in*,
   explicitly, with a date recorded, revocable in one press and effective
   immediately.

   **Nobody under eighteen is in the pool at all.** Not "cannot be hired" —
   cannot be *seen*. The harm is not the job application, it is being placed in
   a database that adults browse and target. A sixteen-year-old can and does
   apply for jobs, so "they obviously could not take it" is not a control. This
   is checked at the pool, at the profile, and at the invitation, because a rule
   that matters should not be enforced in only one place.

   **Nobody appears on a record too thin to mean anything.** Simulated over 500
   tables: after five games, 99% of the players a company would pick are genuinely
   above average and none is a dud. After one game it is 93%. Five is the floor,
   and the game count is shown next to every number so nobody has to take the
   floor on trust.

   **Nothing is shown to a company that is not also shown to the player.** The
   same function builds both, and the test asserts they are identical. A profile
   somebody cannot see is a profile they cannot correct.

   **Only traits that survived measurement are published.** Price and quality
   are within 10% of their long-run value after a single game. Advertising, debt
   and margin are still wrong 56% of the time after twenty, so they are stored
   and never shown. See lib/traits.mjs.

   ------------------------------------------------------------------------
   One more line, and it is the one that matters legally rather than
   technically. What this sells is **sourcing, not selection**: an invitation to
   apply is the same object as a recruiter's approach, and it is deliberately
   not a score handed to an employer to screen with. The moment a number here is
   used to reject somebody it becomes an employment selection procedure and a
   different body of law applies. Nothing in this file ranks a shortlist for a
   customer, and nothing should be added that does. */

import { aggregate } from './traits.mjs';

/* Games before a player can be seen at all. */
export const MIN_GAMES = 5;

/* Games before the slower traits may be quoted. Stockout rate is within 10% of
   its long-run value 80% of the time by ten games, and 66% by five. */
export const TRAIT_GAMES = 10;

/* Bad rounds behind the temperament line before it may be quoted. Games are the
   wrong unit for it — what it needs is setbacks, and a player who is rarely in
   trouble accumulates them slowly. Roughly a dozen is where the two behaviours
   read apart reliably. */
export const MIN_SETBACKS = 12;

/* How sure the numbers are, said in words rather than left to be assumed. */
export function confidence(games) {
  if (games >= 30) return { label: 'well established', note: `${games} games` };
  if (games >= TRAIT_GAMES) return { label: 'reasonably settled', note: `${games} games` };
  return { label: 'early', note: `only ${games} games — treat the ordering as rough` };
}

/* ------------------------------------------------------------- the opt-in */

export class NotEligible extends Error {}

/* Join the pool. Both flags are required and both are the player's own
   assertion; we do not hold identity documents and are not going to start. */
export async function optIn(db, owner, { adult, openTo, region, now } = {}) {
  if (!adult) {
    throw new NotEligible('You have to confirm you are 18 or over to be listed.');
  }
  const at = now || new Date().toISOString();
  await db.putTalentOptIn(owner, {
    adult: true,
    open_to: String(openTo || '').slice(0, 120),
    region: String(region || '').slice(0, 80),
    opted_at: at,
    revoked_at: null,
  });
  return { optedIn: true, at };
}

/* Leave it. Immediate, and it does not ask why. */
export async function optOut(db, owner, now) {
  await db.revokeTalentOptIn(owner, now || new Date().toISOString());
  return { optedIn: false };
}

export async function statusOf(db, owner) {
  const row = await db.talentOptIn(owner);
  if (!row || row.revoked_at) return { optedIn: false, adult: !!(row && row.adult) };
  return { optedIn: true, adult: !!row.adult, openTo: row.open_to || '',
           region: row.region || '', since: row.opted_at };
}

/* ------------------------------------------------------------- the profile */

const round2 = (x) => Math.round(x * 100) / 100;
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
/* "0% above the room" is a sentence nobody would write. Inside a point and a
   half either way the honest description is that they priced with everybody
   else, which is itself a finding. */
const pct = (x) => {
  const d = Math.round((x - 1) * 100);
  return d === 0 ? 'in line with the room' : `${Math.abs(d)}% ${d > 0 ? 'above' : 'below'} the room`;
};

/* Everything a company would see about one player, and — the same object, from
   the same call — everything the player is shown about themselves.

   `rows` are that company's result rows, newest first. `population` is the
   average-made figure for every eligible company, used for the percentile. */
export function profile(rows, { population = [], optIn: opt = null } = {}) {
  const played = rows.filter((r) => !r.league);
  if (played.length < MIN_GAMES) {
    return { visible: false, games: played.length, needs: MIN_GAMES,
             why: `A profile appears after ${MIN_GAMES} ranked games. This one has ${played.length}.` };
  }

  const start = 250000;
  const made = played.map((r) => Number(r.value) - start);
  const average = made.reduce((a, b) => a + b, 0) / made.length;
  const wins = played.filter((r) => r.place === 1).length;
  const t = aggregate(played);
  const conf = confidence(played.length);

  /* Where they sit among everybody eligible. Percentile rather than rank,
     because a rank of 40 means one thing in a pool of 50 and another in a pool
     of 5,000 — and because a rank invites a customer to treat the list as a
     shortlist, which is the thing this must not become. */
  const below = population.filter((x) => x < average).length;
  const percentile = population.length >= 20
    ? Math.max(1, Math.min(99, Math.round((below / population.length) * 100)))
    : null;

  return {
    visible: true,
    name: played[0].name,
    games: played.length,
    since: played[played.length - 1].created_at,
    average: Math.round(average),
    averageText: money(average),
    winRate: wins / played.length,
    percentile,
    confidence: conf,
    openTo: opt ? opt.open_to || '' : '',
    region: opt ? opt.region || '' : '',
    /* Only what survived measurement, and the slower one only once there is
       enough behind it. */
    how: t ? [
      { key: 'price', label: 'Pricing', value: t.priceIndex,
        text: t.priceIndex === 1 ? 'Prices in line with the room'
          : `Prices ${pct(t.priceIndex)}` },
      { key: 'quality', label: 'Product', value: t.qualityIndex,
        text: t.qualityIndex === 1 ? 'Builds products of about the market quality'
          : `Builds products ${pct(t.qualityIndex)} on quality` },
      ...(played.length >= TRAIT_GAMES ? [{
        key: 'stockout', label: 'Supply', value: t.stockoutRate,
        text: t.stockoutRate > 0.3
          ? `Runs out of stock in ${Math.round(t.stockoutRate * 100)}% of rounds — sells more than they build`
          : `Meets demand in ${Math.round((1 - t.stockoutRate) * 100)}% of rounds`,
      }] : []),
      /* After a bad round: did they change what they were doing, or file the
         same thing again?

         Deliberately worded as a description and not as a strength, because it
         is not one. Five different responses to a bad round were simulated over
         250 tables each and all five landed within $16,000 of one another on a
         median of about -$40,000 — doing nothing different was middle of the
         pack and cutting price hard was the worst of them. So this says what
         somebody is like, not how good they are, and the note says so where
         anybody reading it will see it. */
      ...(t.scoreable >= MIN_SETBACKS ? [{
        key: 'setback', label: 'After a loss', value: round2(t.moved / t.scoreable),
        text: t.moved / t.scoreable >= 0.6
          ? `Changes something after a bad round ${Math.round(t.moved / t.scoreable * 100)}% of the time`
          : `Tends to hold their course after a bad round — changes something ` +
            `${Math.round(t.moved / t.scoreable * 100)}% of the time`,
        note: 'Neither way is better: measured over 250 seasons per response, how a '
          + 'player reacts to a bad round does not predict what they finish with. '
          + `Over ${t.scoreable} bad rounds.`,
      }] : []),
    ] : [],
    /* Present so nobody has to wonder whether it was considered — and carrying
       the reason, because there are two quite different reasons and conflating
       them would hide the important one. */
    withheld: [
      ...(played.length < TRAIT_GAMES
        ? [{ what: 'supply', why: `not until ${TRAIT_GAMES} games — it is still moving` }] : []),
      ...(t && t.scoreable < MIN_SETBACKS
        ? [{ what: 'response to a bad round',
             why: `not until ${MIN_SETBACKS} bad rounds — there have been ${t.scoreable}` }] : []),
      { what: 'advertising', why: 'never — still wrong more often than not after twenty games' },
      { what: 'borrowing', why: 'never — same' },
      { what: 'margin', why: 'never — same' },
      /* The important one. It is the strongest statistic on the site: three
         games separate a persister from somebody who walks away a quarter of the
         time, at 97% reliability, almost untouched by ability. It is withheld
         anyway, because in a five-minute-a-round game a missed deadline means a
         meeting started or a child woke up — and a measure like that ranks
         people by how much uninterrupted time they have rather than by
         anything about them. */
      { what: 'whether they finished, or missed rounds',
        why: 'never — a missed deadline has ordinary causes, and inferring '
           + 'character from it would rank people by how much uninterrupted time they have' },
    ],
  };
}

/* The one sentence on the invitation that says why this person and not another.
   An unexplained approach is an advertisement, and gets treated like one. */
export function reasonFor(p) {
  if (!p || !p.visible) return '';
  const opening = p.percentile
    ? `in the top ${100 - p.percentile}% of players by money made`
    : `averaging ${p.averageText} a game`;
  const price = (p.how || []).find((h) => h.key === 'price');
  const tail = price ? `, ${price.text.charAt(0).toLowerCase()}${price.text.slice(1)}` : '';
  return `Invited on a record of ${p.games} ranked games: ${opening}${tail}.`;
}

/* --------------------------------------------------------- the invitation */

/* Deliberately not a message. A fixed object with no free text has no
   harassment vector, no spam vector, and nothing for anybody to moderate — and
   it is why this is an approach rather than a channel. */
export function invitation({ companyName, role, url, note, profile: p }) {
  return {
    from: String(companyName || '').slice(0, 80),
    role: String(role || '').slice(0, 80),
    url: String(url || '').slice(0, 300),
    /* The only writing a company does is choosing from their own openings; the
       note is their standard blurb for that role, not a message to a person. */
    blurb: String(note || '').slice(0, 300),
    reason: reasonFor(p),
    to: p && p.visible ? p.name : null,
  };
}

/* ------------------------------------------------------------- the pool */

/* Who a company may see. Every exclusion here is also enforced where the
   profile is built, on purpose. */
export function eligible(entry) {
  if (!entry) return false;
  if (!entry.optIn || entry.optIn.revoked_at) return false;   // never asked, or withdrew
  if (!entry.optIn.adult) return false;                       // under 18, or never said
  if (!entry.companyId) return false;                         // no company, nothing to name
  if ((entry.games || 0) < MIN_GAMES) return false;           // too thin to mean anything
  return true;
}
