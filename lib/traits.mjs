/* What a player did, compressed to something that survives being stored.

   A finished game is a large document and it is thrown away. A result row is
   kept forever. So if a profile is ever going to say anything about *how*
   somebody plays rather than merely how much they made, the how has to be
   computed while the game is still in front of us and written alongside the
   result.

   Everything here is measured against the rest of that particular table rather
   than in absolute terms. "Charged $1,240" means nothing across games with
   different markets and different shocks; "charged 4% under the room" means the
   same thing everywhere, which is what makes an average over games legitimate.

   ---------------------------------------------------------------------------
   Which of these may be shown to anybody is NOT decided here. It is decided in
   lib/talent.mjs, from measurement, and most of them do not qualify. Simulated
   over 500 tables, asking how many games before a trait sits within 10% of its
   own long-run value:

     price index      91% after a single game      publishable early
     quality index    96% after a single game      publishable early
     stockout rate    80% after ten games          publishable late
     advertising      44% after twenty games       never as a number
     debt rate        40% after twenty games       never as a number
     margin           29% after twenty games       never as a number

   The last three are ratios with small, noisy denominators. They are stored
   because they are free to store and useful in aggregate, and they are not
   published because a number that moves 60% between one player's tenth and
   twentieth game is not a fact about the player. */

export function median(a) {
  if (!a || !a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

/* Was this round a setback?

   Losing money while leading is an investment. Losing money while last is
   trouble. So: a round that lost money AND left them in the bottom half of the
   table. Every game has some — 4.6 on average — so this is a measure that
   actually triggers rather than one that sounds good and never fires. */
function isSetback(h, seat) {
  const mine = h.results.find((r) => r.seatId === seat.id);
  if (!mine || !mine.lineCount) return false;
  const ranked = h.results.slice().sort((a, b) => (b.value || 0) - (a.value || 0));
  const place = ranked.findIndex((r) => r.seatId === seat.id) + 1;
  return mine.profit < 0 && place > Math.ceil(h.results.length / 2);
}

/* One seat's play in one finished game.

   Returns null for a seat that never traded — a lobby that emptied, or a
   company that went under in the first round leaves nothing to describe, and
   inventing a profile for it would be worse than having none. */
export function traitsOf(game, seat) {
  if (!game || !game.history || !seat) return null;
  const rows = [];
  let filed = 0, played = 0;

  for (const h of game.history) {
    const mine = h.results.find((r) => r.seatId === seat.id);
    if (!mine || !mine.lineCount) continue;
    played += 1;
    /* `auto` means the round was played by repeating standing orders because
       nobody filed. Counted from the flag rather than inferred from rounds
       missed — inferring it once reported a student who never filed as having
       filed three rounds of twelve. */
    if (!mine.auto) filed += 1;

    const others = h.results.filter((r) => r.seatId !== seat.id && r.lineCount > 0);
    if (!others.length) continue;

    rows.push({
      /* Against the room, not against a currency. */
      price: mine.price / (median(others.map((o) => o.price)) || mine.price || 1),
      quality: mine.quality / (median(others.map((o) => o.quality)) || 1),
      /* +500 on both sides so a table where everybody spent nothing does not
         divide by zero and report somebody as infinitely loud. */
      ads: (mine.advertising + 500) / (median(others.map((o) => o.advertising)) + 500),
      /* Demand that could not be met. It never appears as a loss in the
         accounts — it appears as somebody else's market share — which is
         exactly why it is worth recording. */
      stockout: mine.demand > mine.sales * 1.001 ? 1 : 0,
      debt: mine.debt > 0 ? 1 : 0,
      margin: mine.revenue > 0 ? mine.profit / mine.revenue : -1,
    });
  }

  /* ---- what happens after a bad round -----------------------------------

     Two counts, and only one of them may ever be shown.

     `moved` is how they responded, measured against the room rather than
     against their own last price. That correction is not a nicety: comparing
     with last round's own price scored a player filing one fixed rule as
     "adapting" 89% of the time, because the natural price drifts every round as
     quality grows and products age. It was measuring the market, not the
     player.

     `stayed` is whether they filed at all. It is by far the stronger signal —
     three games separate a persister from a quarter-of-the-time quitter with
     97% reliability — and it is the one thing here that must never be published
     about anybody. In a five-minute-a-round game a missed deadline means a
     meeting started or a battery died, and calling that character would be
     wrong about the person and would rank people by how much uninterrupted time
     they have. It is counted because the denominator needs it. */
  let setbacks = 0, scoreable = 0, moved = 0, stayed = 0;
  for (let i = 0; i < game.history.length - 1; i++) {
    if (!isSetback(game.history[i], seat)) continue;
    setbacks += 1;
    const a = game.history[i].results.find((r) => r.seatId === seat.id);
    const b = game.history[i + 1].results.find((r) => r.seatId === seat.id);
    if (!b || !b.lineCount) continue;
    if (!b.auto) stayed += 1;
    /* Only rounds they were demonstrably present for are scoreable. A round
       they missed is not evidence of anything and is skipped rather than held
       against them. */
    if (b.auto) continue;
    scoreable += 1;
    const others = (k) => median(game.history[k].results
      .filter((r) => r.seatId !== seat.id && r.lineCount > 0).map((o) => o.price));
    const ia = a.price / (others(i) || a.price || 1);
    const ib = b.price / (others(i + 1) || b.price || 1);
    const dp = Math.abs(ib - ia) / (ia || 1);
    const da = Math.abs(b.advertising - a.advertising) / (a.advertising + 1000);
    if (dp > 0.02 || da > 0.15) moved += 1;
  }

  if (!rows.length) return null;
  const rate = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;

  return {
    rounds: rows.length,
    /* Medians for the ratios, because one round of panic pricing should not
       redescribe how somebody plays. */
    priceIndex: round3(median(rows.map((r) => r.price))),
    qualityIndex: round3(median(rows.map((r) => r.quality))),
    adsIndex: round3(median(rows.map((r) => r.ads))),
    stockoutRate: round3(rate('stockout')),
    debtRate: round3(rate('debt')),
    margin: round3(median(rows.map((r) => r.margin))),
    filedRate: played ? round3(filed / played) : 0,
    setbacks, scoreable, moved, stayed,
  };
}

const round3 = (x) => Math.round(x * 1000) / 1000;

/* Many games into one description of a player.

   Straight means across games, deliberately: a player who has had one
   extraordinary table and nine ordinary ones plays like the ordinary ones. The
   count travels with the numbers everywhere they go, because how many games are
   behind an average is part of the average. */
export function aggregate(rowsWithTraits) {
  const t = rowsWithTraits.map((r) => r.traits).filter(Boolean);
  if (!t.length) return null;
  const avg = (k) => t.reduce((a, x) => a + (x[k] || 0), 0) / t.length;
  const total = (k) => t.reduce((a, x) => a + (x[k] || 0), 0);
  return {
    games: t.length,
    rounds: t.reduce((a, x) => a + (x.rounds || 0), 0),
    priceIndex: round3(avg('priceIndex')),
    qualityIndex: round3(avg('qualityIndex')),
    adsIndex: round3(avg('adsIndex')),
    stockoutRate: round3(avg('stockoutRate')),
    debtRate: round3(avg('debtRate')),
    margin: round3(avg('margin')),
    filedRate: round3(avg('filedRate')),
    /* Summed rather than averaged: what matters is how many bad rounds there
       were altogether, not the average per game. A player with ten games has
       roughly forty-six setbacks behind the figure. */
    setbacks: total('setbacks'),
    scoreable: total('scoreable'),
    moved: total('moved'),
    stayed: total('stayed'),
  };
}
