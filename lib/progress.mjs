/* Does anybody actually get better at this?

   Every claim worth making to a player rests on it — that the game teaches
   something, that a record means anything, that a fifth game is worth playing
   after a disappointing first one. It has never been measured, because it
   cannot be: every measurement on this project so far used simulated policies,
   and a simulated player learns nothing because it was born knowing. Only
   people can answer this, so the arithmetic has to be waiting for them.

   The whole difficulty is that the obvious way to measure it lies.

   ---------------------------------------------------------------------------
   THE SURVIVORSHIP PROBLEM

   The obvious statistic is "median money made at game 1, at game 2, at game 5",
   plotted. It will curve upwards. It will curve upwards even if not one person
   has learned a single thing, because the people still playing at game five are
   not the people who played game one. Somebody who has a terrible first game is
   likelier to leave, so every later point is measured on a population that has
   quietly had its worst members removed. The line goes up because the sample
   improved, not because anybody did.

   This is not a subtle effect and it is not a small one — `test/progress.mjs`
   builds a population where nobody learns at all and the naive curve reports
   confident improvement anyway.

   The fix is to hold the population still: take only players who reached game
   n, and compare *those same people's* first game with their nth. Same people
   at both ends, so nothing can be improved by leaving.

   THE ORDERING PROBLEM

   Matching fixes who is measured but not whether the order matters. Results are
   noisy, so some difference between "your first" and "your fifth" turns up by
   chance. So the matched figure is compared against a null built by shuffling
   each player's own games into a random order and recomputing. If the real
   ordering does not stand outside the shuffled ones, there is no learning here
   — only variance wearing a hat.

   Reported together, with the sample size, and with the naive figure alongside
   so the size of the bias is visible rather than hidden.

   WHAT MATCHING DOES NOT FIX, AND WHY THAT IS FINE

   Matching removes the change in *who* is measured. It introduces a smaller
   problem in its place, which was found by building the fake population rather
   than by reasoning about it: if leaving depends on how the first game went,
   then everybody who reached game five had an unusually good first game, so
   measuring from it starts the comparison too high. The estimate comes out
   LOW — in the simulated world where players truly gained $26,000 a game, this
   reports about half of it.

   That is the right direction to be wrong in, and it is left alone deliberately.
   It means the measurement understates learning and never overstates it, so:

     a positive result can be believed
     a null result is not proof that nobody learned

   Both of those sentences are printed with the answer rather than left in a
   comment for nobody to read. */

const median = (a) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const START = 250000;

/* Result rows into one series per company, oldest first — which is the order
   they were played in, and the only order that means anything here. */
export function byCompany(rows, { start = START } = {}) {
  const out = new Map();
  for (const r of rows) {
    if (!r.company_id || r.league) continue;
    if (!out.has(r.company_id)) out.set(r.company_id, []);
    out.get(r.company_id).push({
      at: Date.parse(r.created_at || 0),
      made: Number(r.value) - start,
      place: r.place, seats: r.seats,
    });
  }
  for (const series of out.values()) series.sort((a, b) => a.at - b.at);
  return out;
}

/* One player's own series, for showing them. */
export function curveFor(rows, { start = START } = {}) {
  const series = (byCompany(rows, { start }).values().next().value) || [];
  if (series.length < 2) {
    return { games: series.length, enough: false,
             need: 2, why: 'Two games is the least that can be compared.' };
  }
  const made = series.map((g) => g.made);
  /* Thirds rather than first-versus-last, because a single game either end is
     mostly luck and a player looking at their own page deserves better than
     being told they are improving because one table went well. */
  const cut = Math.max(1, Math.floor(made.length / 3));
  const early = made.slice(0, cut);
  const late = made.slice(-cut);
  return {
    games: made.length, enough: true,
    made,
    first: made[0],
    best: Math.max(...made),
    early: Math.round(median(early)),
    late: Math.round(median(late)),
    change: Math.round(median(late) - median(early)),
    /* Deliberately not called "improvement". Over a handful of games the honest
       word is "difference", and the page says how many games are behind it. */
    span: cut,
  };
}

/* --------------------------------------------------------- the population */

/* The naive figure: median money made at each game index, over everybody who
   got that far. Computed only so the bias it carries can be shown next to the
   matched one. Never reported on its own. */
export function naiveCurve(groups, { upTo = 10 } = {}) {
  const out = [];
  for (let i = 0; i < upTo; i++) {
    const at = [];
    for (const series of groups.values()) if (series[i]) at.push(series[i].made);
    if (!at.length) break;
    out.push({ game: i + 1, players: at.length, median: Math.round(median(at)) });
  }
  return out;
}

/* The matched figure: only players who reached game n, comparing their own
   first game with their own nth. */
export function matchedAt(groups, n) {
  const deltas = [];
  for (const series of groups.values()) {
    if (series.length < n) continue;
    deltas.push(series[n - 1].made - series[0].made);
  }
  return { n, players: deltas.length, change: Math.round(median(deltas)), deltas };
}

/* The null: the same computation on each player's own games in a shuffled
   order. If playing them in the order they happened is no different from
   playing them in any other order, nothing was learned. */
export function shuffledAt(groups, n, { rounds = 200, rand = Math.random } = {}) {
  const draws = [];
  for (let r = 0; r < rounds; r++) {
    const deltas = [];
    for (const series of groups.values()) {
      if (series.length < n) continue;
      const s = series.slice();
      for (let i = s.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [s[i], s[j]] = [s[j], s[i]];
      }
      deltas.push(s[n - 1].made - s[0].made);
    }
    draws.push(median(deltas));
  }
  draws.sort((a, b) => a - b);
  return draws;
}

/* Everything together, in the form somebody should read it. */
export function learning(rows, { n = 5, rounds = 200, rand = Math.random,
                                 start = START, minPlayers = 20 } = {}) {
  const groups = byCompany(rows, { start });
  const matched = matchedAt(groups, n);
  const naive = naiveCurve(groups);

  if (matched.players < minPlayers) {
    return {
      enough: false, n, players: matched.players, need: minPlayers,
      why: `${matched.players} player${matched.players === 1 ? ' has' : 's have'} reached `
         + `${n} games. This needs ${minPlayers} before it means anything, and saying so `
         + `is more use than a number computed from ${matched.players}.`,
      naive,
    };
  }

  const draws = shuffledAt(groups, n, { rounds, rand });
  /* Where the real ordering falls among the shuffled ones. Near 1 means playing
     them in the order they happened beat almost every reshuffle, which is what
     learning looks like. Near 0.5 means the order did not matter. */
  const beaten = draws.filter((d) => d < matched.change).length;
  const percentile = draws.length ? beaten / draws.length : 0;

  /* The naive number for the same n, which is what would have been reported by
     anybody who did not think about who left. */
  const naiveAt = naive[n - 1];
  const naiveFirst = naive[0];
  const naiveChange = naiveAt && naiveFirst ? naiveAt.median - naiveFirst.median : null;

  return {
    enough: true, n,
    players: matched.players,
    change: matched.change,
    /* Two-sided in spirit but reported as it is: how unusual the real ordering
       was, and the middle of the shuffles for comparison. */
    percentile: Math.round(percentile * 100) / 100,
    nullMedian: Math.round(median(draws)),
    nullRange: [Math.round(draws[Math.floor(draws.length * 0.05)]),
                Math.round(draws[Math.floor(draws.length * 0.95)])],
    real: percentile >= 0.95,
    naiveChange: naiveChange === null ? null : Math.round(naiveChange),
    /* The gap between the two is the survivorship effect, in dollars. It is
       reported because it is the most interesting number here: it is how wrong
       the obvious statistic would have been. */
    survivorship: naiveChange === null ? null : Math.round(naiveChange - matched.change),
    naive,
    verdict: percentile >= 0.95
      ? 'Players do better as they play more, beyond what reordering their own games explains.'
      : 'No learning shown yet. The order somebody played their games in makes no more '
        + 'difference than shuffling them would.',
    /* Travels with the number, because the number is meaningless without it. */
    caveat: percentile >= 0.95
      ? 'This understates. Everybody who reached game ' + n + ' had an unusually good '
        + 'first game — that is why they kept playing — so the comparison starts too '
        + 'high. The true gain is larger than the figure above, not smaller.'
      : 'This is not proof that nobody learns. The same bias that makes a positive '
        + 'result trustworthy makes a null one weak: measuring from a first game that '
        + 'was good enough to keep somebody playing hides part of any real gain.',
  };
}
