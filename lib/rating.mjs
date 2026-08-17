/* Rating, from finishing positions.

   The problem a leaderboard has in this game is that the host configures
   everything — seats, rounds, difficulty, length. Ranking on final company value
   over host-configured games is a scoreboard for whoever tunes the settings
   hardest: twenty rounds on Forgiving against two weak bots posts a number
   nobody playing properly can touch.

   So two rules. Only the fixed public format is rated, and the number being
   rated is who you beat rather than what you scored.

   The maths is the ordinary pairwise generalisation of Elo: every player is
   compared with every other, and the expected result of each comparison comes
   from the two ratings. Bots are in the pool as ordinary opponents with ratings
   of their own, which means beating them is worth almost nothing once you are
   better than they are — without any special case saying so. */

export const START = 1500;

/* Bot ratings are not guesses. §20 measured each personality's win rate over 200
   five-company games, and these are those results ordered and spaced:

     Premium 33.0%  ·  Discounter 30.5%  ·  Balanced 17.0%
     Operator 10.0% ·  Marketer 9.5%           (an even split would be 20%)

   So beating the Premium bot means something and beating the Marketer does not,
   which is exactly what the measurements say. */
export const BOT_RATING = {
  premium: 1560,
  discounter: 1540,
  balanced: 1470,
  operator: 1420,
  marketer: 1415,
};

export const ratingOfBot = (botId) => BOT_RATING[botId] || 1450;

/* Newcomers move fast so they reach roughly the right place quickly, then
   settle down so a bad evening does not undo a season. */
export const kFor = (gamesPlayed) => (gamesPlayed < 10 ? 48 : gamesPlayed < 30 ? 32 : 24);

const expected = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));

/* entrants: [{ key, rating, place, games, rated }]
   place is 1 for the winner; equal places are treated as draws.
   Only entries with rated: true receive a change — bots and unnamed players are
   opposition, not competitors. */
export function updateRatings(entrants) {
  const n = entrants.length;
  if (n < 2) return [];
  return entrants.map((me) => {
    if (!me.rated) return { key: me.key, delta: 0, rating: me.rating, rated: false };
    let score = 0, exp = 0;
    for (const other of entrants) {
      if (other === me) continue;
      score += me.place < other.place ? 1 : me.place === other.place ? 0.5 : 0;
      exp += expected(me.rating, other.rating);
    }
    const k = kFor(me.games || 0);
    const delta = Math.round((k * (score - exp)) / (n - 1));
    return { key: me.key, delta, rating: me.rating + delta, rated: true };
  });
}

/* Places from final company values. Ties share a place, as they should — two
   companies worth the same did equally well. */
export function placings(rows) {
  const sorted = rows.slice().sort((a, b) => b.value - a.value);
  const out = [];
  let place = 0, seen = 0, lastValue = null;
  for (const r of sorted) {
    seen += 1;
    if (lastValue === null || r.value !== lastValue) { place = seen; lastValue = r.value; }
    out.push({ ...r, place });
  }
  return out;
}

/* A rating on its own means little to a player, so give it a name. Bands are
   set against START rather than against the population, so they mean the same
   thing on day one as in a year. */
export function band(rating) {
  if (rating >= 1750) return 'Formidable';
  if (rating >= 1650) return 'Strong';
  if (rating >= 1550) return 'Capable';
  if (rating >= 1450) return 'Competent';
  if (rating >= 1350) return 'Learning';
  return 'New';
}
