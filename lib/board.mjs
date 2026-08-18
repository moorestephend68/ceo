/* The leaderboard.

   A rating is the right way to measure skill and the wrong thing to put on a
   front page. It is stable by design, which means the top of it belongs to
   whoever got there first, and a newcomer who buys a company name and plays
   brilliantly on Tuesday sees no evidence of it. The board is the reason to buy a
   name; it has to be winnable this afternoon.

   So the public board is a different thing from the rating, and it answers a
   different question: not "who is best" but "who has built the best company
   lately". Two decisions make that work.

   **It decays.** A result is worth 10% less every hour — half gone in under seven
   hours, ninety per cent gone inside a day. Nobody holds the top by having been
   good in March. It also means the board is never full: every entry on it is
   quietly making room.

   **It is your best single game, not your total.** This is the decision that
   stops the board becoming a stamina contest. Adding results up sounds fairer and
   is not: with a 10%-an-hour decay a player going back to back settles at about
   twelve games' worth, so six mediocre games beat one brilliant one and the board
   ranks free time rather than judgement. Taking the best means playing more only
   helps if you play better.

   The rating is kept. It is simply no longer the thing on the wall — it lives on
   your own record, where a permanent measure belongs. */

export const DECAY_PER_HOUR = 0.10;
export const TOP = 25;

/* How much of a result is left after a given age. */
export const decayFactor = (hours) =>
  Math.pow(1 - DECAY_PER_HOUR, Math.max(0, hours));

/* Half of it is gone after this long — useful for saying so on the page rather
   than making people work it out. */
export const HALF_LIFE_HOURS = Math.log(0.5) / Math.log(1 - DECAY_PER_HOUR);

/* Below this a row is not worth a line on a board of twenty-five. */
const FLOOR = 1000;

/* Build the board.

   `rows` are results: { company_id, name, value, created_at }. `start` is what
   every company began with, so "money made" means what it says. A game that
   ended below its starting cash scores nothing — it does not score negatively,
   because a leaderboard of losses is not a leaderboard, and because somebody
   having a bad afternoon should not be pushed below somebody who has never
   played. */
export function build(rows, { now, start, top = TOP } = {}) {
  const at = Date.parse(now || new Date().toISOString());
  const best = new Map();

  for (const r of rows) {
    if (!r.company_id) continue;                  // unnamed players are not ranked
    const made = Math.max(0, Number(r.value) - start);
    if (made <= 0) continue;
    const hours = (at - Date.parse(r.created_at)) / 3600000;
    const score = made * decayFactor(hours);
    const prev = best.get(r.company_id);
    if (!prev || score > prev.score) {
      best.set(r.company_id, {
        companyId: r.company_id, name: r.name, score, made, hours,
        at: r.created_at, place: r.place, seats: r.seats,
      });
    }
  }

  return [...best.values()]
    .filter((e) => e.score >= FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, top)
    .map((e, i) => ({
      rank: i + 1,
      name: e.name,
      /* What it is worth on the board now, and what it was actually worth when
         it happened — because "$41,000" next to a game somebody remembers as a
         $300,000 company needs explaining, and the honest explanation is the age. */
      score: Math.round(e.score),
      made: Math.round(e.made),
      hoursAgo: e.hours,
      place: e.place, seats: e.seats,
    }));
}

/* "2 hours ago", for a board where age is half the story. */
export function ago(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
