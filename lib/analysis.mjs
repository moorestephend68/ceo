/* What happened in a class, and what is worth talking about.

   A dashboard tells an instructor the state of play. It does not help them run
   the hour afterwards, which is the hour the whole exercise exists for. That hour
   is spent on questions like "why did group three end up worth less than they
   started" and "what did group five do that nobody else did", and an instructor
   who has been supervising forty students has had no chance to work either out.

   Two things make this answerable rather than decorative.

   **Every group ran the identical market.** Same seed, same shocks, same rounds.
   So a difference between two groups is a difference in what they decided, and
   that sentence — which no generic dashboard can say — is what makes a comparison
   worth putting on a screen.

   **Every decision is on the record.** Each round stores what each company
   charged, what it spent on advertising and research, what it sold, what it could
   not supply, and what it was worth afterwards. The findings below are read out
   of that rather than guessed at, and each one carries its numbers so an
   instructor can be challenged and answer.

   Nothing here is generated prose. Each finding is a shape somebody looked for —
   a price war, a company that never advertised, a queue of customers turned away
   — with the evidence attached and a question to ask the room. */

const money = (x) => (x < 0 ? '-$' : '$') + Math.abs(Math.round(x)).toLocaleString('en-US');
const pct = (x) => `${(x * 100).toFixed(0)}%`;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/* ------------------------------------------------------------ the reading */

/* One company's whole run, flattened out of the round history. */
function companyRuns(game) {
  const runs = new Map();
  for (const seat of game.seats) {
    runs.set(seat.id, {
      seatId: seat.id, name: seat.name, isBot: !!seat.isBot,
      missed: seat.autoRounds || 0,
      out: !!(seat.firm && seat.firm.bankrupt),
      rounds: [],
    });
  }
  for (const h of game.history || []) {
    for (const r of h.results || []) {
      const run = runs.get(r.seatId);
      if (!run) continue;
      const lines = r.detail || [];
      run.rounds.push({
        round: h.round,
        price: r.price, share: r.share, demand: r.demand, sales: r.sales,
        advertising: r.advertising, profit: r.profit, cash: r.cash, debt: r.debt,
        quality: r.quality, value: r.value, lineCount: r.lineCount,
        bankrupt: r.bankrupt, auto: r.auto,
        rd: lines.reduce((a, l) => a + (l.rd || 0), 0),
        lost: lines.reduce((a, l) => a + (l.lostSales || 0), 0),
        stock: lines.reduce((a, l) => a + (l.inventory || 0), 0),
      });
    }
  }
  for (const run of runs.values()) {
    const rs = run.rounds;
    run.played = rs.length;
    run.value = rs.length ? rs[rs.length - 1].value : 0;
    run.avgPrice = mean(rs.map((r) => r.price));
    run.avgAds = mean(rs.map((r) => r.advertising));
    run.avgRd = mean(rs.map((r) => r.rd));
    run.endQuality = rs.length ? rs[rs.length - 1].quality : 0;
    run.startQuality = rs.length ? rs[0].quality : 0;
    run.peakDebt = Math.max(0, ...rs.map((r) => r.debt));
    run.lostTotal = rs.reduce((a, r) => a + r.lost, 0);
    run.launched = rs.some((r, i) => i > 0 && r.lineCount > rs[i - 1].lineCount);
  }
  return [...runs.values()];
}

/* ---------------------------------------------------------- the findings */

/* Two companies talking each other down.

   Looked for rather than assumed: both prices falling across three or more
   consecutive rounds, ending materially below what everybody else charged. It is
   the single most useful thing that happens in a class, because nobody is told to
   do it and everybody involved can explain why each individual step was
   reasonable. */
function priceWar(group, runs, classPrice) {
  const live = runs.filter((r) => r.rounds.length >= 4);
  const falling = live.filter((r) => {
    const p = r.rounds.map((x) => x.price);
    let best = 0, run = 0;
    for (let i = 1; i < p.length; i++) {
      run = p[i] < p[i - 1] * 0.985 ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return best >= 3 && r.avgPrice < classPrice * 0.94;
  });
  if (falling.length < 2) return null;
  const pair = falling.sort((a, b) => a.avgPrice - b.avgPrice).slice(0, 3);
  const rest = runs.filter((r) => !pair.includes(r) && r.rounds.length);
  const from = (() => {
    const p = pair[0].rounds.map((x) => x.price);
    for (let i = 1; i < p.length; i++) if (p[i] < p[i - 1] * 0.985) return i + 1;
    return 2;
  })();
  return {
    kind: 'price war',
    severity: (classPrice - mean(pair.map((r) => r.avgPrice))) / classPrice,
    group: group.group,
    companies: pair.map((r) => r.name),
    headline: `${pair.map((r) => r.name).join(' and ')} undercut each other from round ${from}`,
    detail: `They ended up charging ${money(mean(pair.map((r) => r.avgPrice)))} on average against `
      + `${money(classPrice)} across the class, and are worth `
      + `${pair.map((r) => money(r.value)).join(' and ')}`
      + (rest.length ? `, while the rest of their group averaged ${money(mean(rest.map((r) => r.value)))}` : '')
      + '.',
    ask: 'Ask them who started it, and in which round each of them decided they had no choice. '
      + 'Nobody in a price war believes they began it.',
  };
}

/* The company nobody could buy from because they had never heard of it.

   This is the finding with the most measured weight behind it: filing with
   nothing on advertising wins 5% of games against a 20% baseline, and $6,000
   changes that to 28% (§"the opening move"). A class where several companies did
   this is a class that needs the lecture about awareness. */
function invisible(group, runs, classAds) {
  const quiet = runs.filter((r) => r.rounds.length >= 3 && r.avgAds < Math.max(1500, classAds * 0.35));
  if (!quiet.length) return null;
  const loud = runs.filter((r) => !quiet.includes(r) && r.rounds.length);
  /* Only worth raising if it actually cost them.

     The first version reported this whenever somebody spent little, and produced
     "spent almost nothing on advertising, and ended worth $737,316 against
     -$210,810" — evidence against its own claim, which an instructor would read
     out and be contradicted by in front of the room. A company that spent nothing
     and won is not this finding; it is a different lesson, and inventing one is
     worse than staying quiet. */
  if (loud.length && median(quiet.map((r) => r.value)) >= median(loud.map((r) => r.value))) {
    return null;
  }
  return {
    kind: 'nobody knew they existed',
    severity: loud.length
      ? median(loud.map((r) => r.value)) - median(quiet.map((r) => r.value)) : 0,
    group: group.group,
    companies: quiet.map((r) => r.name),
    headline: `${quiet.map((r) => r.name).join(', ')} spent almost nothing on advertising`,
    detail: `${money(mean(quiet.map((r) => r.avgAds)))} a round against `
      + `${money(classAds)} across the class`
      + (loud.length ? `, and ended worth ${money(median(quiet.map((r) => r.value)))} against `
        + `${money(median(loud.map((r) => r.value)))}` : '') + '.',
    ask: 'Ask them what a buyer has to know before a price can persuade them of anything. '
      + 'A good product nobody has heard of sells nothing.',
  };
}

/* Customers turned away — the mistake that looks like success. */
function turnedAway(group, runs) {
  const short = runs.filter((r) => r.lostTotal > 200
    && r.rounds.filter((x) => x.lost > x.demand * 0.08).length >= 2);
  if (!short.length) return null;
  const worst = short.sort((a, b) => b.lostTotal - a.lostTotal)[0];
  return {
    kind: 'sold out',
    severity: worst.lostTotal,
    group: group.group,
    companies: short.map((r) => r.name),
    headline: `${worst.name} could not supply ${Math.round(worst.lostTotal)} buyers who wanted to buy`,
    detail: `Across the game they turned away ${Math.round(worst.lostTotal)} units of demand`
      + `${short.length > 1 ? `, and ${short.length - 1} other compan${short.length > 2 ? 'ies' : 'y'} in the group did the same` : ''}.`
      + ' Demand you cannot supply goes to whoever can.',
    ask: 'Ask whether selling out is good news. They will say yes. Then ask where those '
      + 'buyers went, and whether they came back.',
  };
}

/* Borrowing to stand still. */
function debtSpiral(group, runs) {
  const sinking = runs.filter((r) => {
    let run = 0, best = 0;
    for (let i = 1; i < r.rounds.length; i++) {
      run = r.rounds[i].debt > r.rounds[i - 1].debt && r.rounds[i].profit < 0 ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return best >= 3 && r.peakDebt > 60000;
  });
  if (!sinking.length) return null;
  const worst = sinking.sort((a, b) => b.peakDebt - a.peakDebt)[0];
  return {
    kind: 'borrowing to stand still',
    severity: worst.peakDebt + (worst.out ? 1e6 : 0),
    group: group.group,
    companies: sinking.map((r) => r.name),
    headline: `${worst.name} borrowed for ${worst.rounds.length >= 4 ? 'round after round' : 'several rounds'} `
      + `while losing money`,
    detail: `Debt peaked at ${money(worst.peakDebt)}${worst.out ? ' and the bank called it in' : ''}. `
      + 'Borrowing gets dearer exactly as the business behind it gets weaker, which is '
      + 'the trap rather than the punishment.',
    ask: 'Ask at which round it stopped being a bad patch and started being a direction, '
      + 'and what they would have had to give up to change it.',
  };
}

/* Somebody backed a second product, which is the biggest decision in the game. */
function launches(group, runs) {
  const opened = runs.filter((r) => r.launched);
  if (!opened.length) return null;
  const others = runs.filter((r) => !r.launched && r.rounds.length);
  return {
    kind: 'a second product line',
    severity: Math.abs(median(opened.map((r) => r.value))
      - (others.length ? median(others.map((r) => r.value)) : 0)),
    group: group.group,
    companies: opened.map((r) => r.name),
    headline: `${opened.map((r) => r.name).join(', ')} opened a second product line`,
    detail: `They finished worth ${median(opened.map((r) => r.value)) >= 0 ? '' : ''}`
      + `${money(median(opened.map((r) => r.value)))}`
      + (others.length ? ` against ${money(median(others.map((r) => r.value)))} for the companies that did not`
        : '') + '.',
    ask: 'Ask what it cost them in the rounds right after they launched, and whether they '
      + 'would do it earlier or later next time.',
  };
}

/* The one that won, and the thing it did differently. */
function whatWon(group, runs, classAvg) {
  const live = runs.filter((r) => r.rounds.length);
  if (live.length < 2) return null;
  const best = live.slice().sort((a, b) => b.value - a.value)[0];
  const rest = live.filter((r) => r !== best);
  const diffs = [];
  const cmp = (label, mine, theirs, unit) => {
    if (!theirs) return;
    const d = (mine - theirs) / Math.abs(theirs);
    if (Math.abs(d) >= 0.15) {
      diffs.push(`${label} ${d > 0 ? 'higher' : 'lower'} by ${pct(Math.abs(d))} (${unit(mine)} against ${unit(theirs)})`);
    }
  };
  cmp('priced', best.avgPrice, mean(rest.map((r) => r.avgPrice)), money);
  cmp('advertised', best.avgAds, mean(rest.map((r) => r.avgAds)), money);
  cmp('researched', best.avgRd, mean(rest.map((r) => r.avgRd)), money);
  return {
    kind: 'what the leader did differently',
    severity: diffs.length ? best.value : 0,
    group: group.group,
    companies: [best.name],
    headline: `${best.name} leads group ${group.group} at ${money(best.value)}`,
    detail: diffs.length
      ? `Against the rest of their group they ${diffs.join(', ')}.`
      : 'They did nothing markedly different from the rest of their group — which is '
        + 'worth saying out loud, because it means the difference is timing rather than policy.',
    ask: 'Ask the group whether they noticed at the time, and what they would have had to '
      + 'do to respond.',
  };
}

/* ------------------------------------------------------------- assembling */

export function analyse(cohort, gamesIn) {
  const games = (gamesIn || []).slice()
    .sort((a, b) => (a.groupNo || 0) - (b.groupNo || 0));

  const groups = games.map((g, i) => {
    const runs = companyRuns(g);
    const humans = runs.filter((r) => !r.isBot);
    const live = runs.filter((r) => r.rounds.length);
    return {
      group: g.groupNo || i + 1,
      code: g.code,
      status: g.status,
      round: g.round,
      totalRounds: g.config.rounds,
      runs,
      humans: humans.length,
      avgPrice: mean(live.map((r) => r.avgPrice)),
      avgAds: mean(live.map((r) => r.avgAds)),
      avgRd: mean(live.map((r) => r.avgRd)),
      medianValue: median(live.map((r) => r.value)),
      bestValue: live.length ? Math.max(...live.map((r) => r.value)) : 0,
      out: runs.filter((r) => r.out).length,
      missed: humans.reduce((a, r) => a + r.rounds.filter((x) => x.auto).length, 0),
    };
  });

  const played = groups.filter((g) => g.round > 0);
  const allRuns = groups.flatMap((g) => g.runs).filter((r) => r.rounds.length);
  const classPrice = mean(allRuns.map((r) => r.avgPrice));
  const classAds = mean(allRuns.map((r) => r.avgAds));

  /* Findings, group by group, most useful kind first. */
  const findings = [];
  for (const g of groups) {
    if (!g.round) continue;
    const live = g.runs.filter((r) => r.rounds.length);
    for (const f of [priceWar(g, live, classPrice), invisible(g, live, classAds),
                     turnedAway(g, live), debtSpiral(g, live),
                     launches(g, live), whatWon(g, live, classPrice)]) {
      if (f) findings.push(f);
    }
  }
  /* How many of each is worth showing.

     Six identical "borrowed while losing money" entries is not six findings, it
     is one observation printed six times, and a list where everything is a
     finding is a list nobody reads to the end. Only the most extreme instances of
     the repetitive kinds survive; the rare kinds all do, because rarity is what
     makes them worth the room's time. */
  const LIMIT = {
    'price war': 4,
    'nobody knew they existed': 3,
    'sold out': 3,
    'borrowing to stand still': 2,
    'a second product line': 2,
    'what the leader did differently': 2,
  };
  /* Rank within a kind by how pronounced it is, so the two that survive are the
     two worth talking about. */
  const severity = (f) => f.severity || 0;
  const kept = [];
  for (const kind of Object.keys(LIMIT)) {
    kept.push(...findings.filter((f) => f.kind === kind)
      .sort((a, b) => severity(b) - severity(a))
      .slice(0, LIMIT[kind]));
  }
  findings.length = 0;
  findings.push(...kept);

  const order = Object.keys(LIMIT);
  findings.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.group - b.group);

  /* Ranked by outcome, so "what did the top group do differently" is one glance. */
  const table = groups.filter((g) => g.round > 0)
    .slice().sort((a, b) => b.medianValue - a.medianValue);

  /* Counted from the record rather than inferred from it.

     `round - autoRounds` looked equivalent and was not: a company that goes under
     stops being counted at all, so a student who never filed once in twelve rounds
     was reported as having filed three of them. Every round carries a flag saying
     whether it was the player's own orders or last round's repeated, so that is
     what is counted. */
  const students = groups.flatMap((g) => g.runs.filter((r) => !r.isBot).map((r) => ({
    group: g.group, name: r.name, value: r.value,
    filed: r.rounds.filter((x) => !x.auto).length,
    missed: r.rounds.filter((x) => x.auto).length,
    played: r.rounds.length,
    out: r.out,
  })));

  return {
    name: cohort.name,
    seed: cohort.seed,
    identical: groups.length > 1,
    totals: {
      groups: groups.length,
      students: students.length,
      rounds: played.length ? Math.max(...played.map((g) => g.round)) : 0,
      totalRounds: groups.length ? groups[0].totalRounds : 0,
      inProfit: allRuns.filter((r) => r.value > 0).length,
      companies: allRuns.length,
      out: groups.reduce((a, g) => a + g.out, 0),
      carried: students.reduce((a, s) => a + s.missed, 0),
    },
    spread: {
      best: allRuns.length ? Math.max(...allRuns.map((r) => r.value)) : 0,
      median: median(allRuns.map((r) => r.value)),
      worst: allRuns.length ? Math.min(...allRuns.map((r) => r.value)) : 0,
    },
    classPrice, classAds,
    table: table.map((g) => ({
      group: g.group, medianValue: g.medianValue, bestValue: g.bestValue,
      avgPrice: g.avgPrice, avgAds: g.avgAds, avgRd: g.avgRd,
      out: g.out, missed: g.missed, round: g.round,
      /* Against the class, since the market was the same for everyone. */
      priceIndex: classPrice ? g.avgPrice / classPrice : 1,
      adsIndex: classAds ? g.avgAds / classAds : 1,
    })),
    findings,
    students: students.sort((a, b) => b.missed - a.missed || a.group - b.group),
  };
}

/* Round-by-round, one row per company per round: everything the analysis read,
   for an instructor who would rather do their own. */
export function roundsCsv(cohort, gamesIn) {
  const games = (gamesIn || []).slice().sort((a, b) => (a.groupNo || 0) - (b.groupNo || 0));
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    const isNumber = /^-?\d+(\.\d+)?$/.test(s);
    const safe = !isNumber && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ['group', 'game', 'company', 'kind', 'round', 'filed_by_hand',
                'price', 'advertising', 'product_rd', 'quality', 'demand', 'sales',
                'lost_sales', 'share', 'inventory', 'profit', 'cash', 'debt',
                'lines', 'company_value', 'went_under'];
  const lines = [head.join(',')];
  for (const [i, g] of games.entries()) {
    for (const run of companyRuns(g)) {
      for (const r of run.rounds) {
        lines.push([
          g.groupNo || i + 1, g.code, run.name, run.isBot ? 'AI' : 'student',
          r.round, r.auto ? 'no' : 'yes',
          r.price.toFixed(2), Math.round(r.advertising), Math.round(r.rd),
          r.quality.toFixed(1), Math.round(r.demand), Math.round(r.sales),
          Math.round(r.lost), (r.share || 0).toFixed(4), Math.round(r.stock),
          Math.round(r.profit), Math.round(r.cash), Math.round(r.debt),
          r.lineCount, Math.round(r.value), r.bankrupt ? 'yes' : 'no',
        ].map(cell).join(','));
      }
    }
  }
  return lines.join('\n') + '\n';
}

export { money as fmtMoney, pct as fmtPct };
