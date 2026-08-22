/* Would a tournament find the best player, or the luckiest one?

   The proposal: somebody buys a licence, runs a tournament, players are drawn
   into groups of six, the winner of each group advances, and there is a
   leaderboard inside the event. Groups of six and a leaderboard are close to
   what a class already does. The bracket is the new part, and the bracket is
   also the part that could quietly be a lottery.

   There is a reason to expect trouble. §34 measured whether a single result says
   anything about a player and found it says less the more they play: correlation
   with actual ability 0.45 at ten games, 0.21 at forty, 0.14 at eighty. A
   bracket is made of nothing but single results.

   ---------------------------------------------------------------- two errors

   This was wrong twice before it was right, and both errors flattered the
   product, so both are worth keeping.

   **It drew 36 seats from 12 policies with replacement.** The best policy
   appeared about three times, so the question being answered was "does the best
   strategy win", not "does the best player win". Every entrant now sits on a
   different point of the grid and the field never contains a tie.

   **Simulated players are far steadier than people.** A fixed rule facing a
   seeded market varies only as much as the market does. A person misreads a
   round, gets interrupted, changes their mind. With no within-player noise the
   bracket looked 91% accurate — which is not a finding about tournaments, it is
   a finding about how easy it is to tell two deterministic rules apart.

   So entrants carry a jitter, and the answer is a curve against it rather than a
   number. **How inconsistent real players are has never been measured here**, so
   the honest output of this file is a range and the shape of the trade-off.

   Run: node test/tourneysim.mjs [tournaments]  */

import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';

const TOURNAMENTS = Number(process.argv[2]) || 60;
const ROUNDS = 10;
const GROUP = 6;

const pct = (x) => (x * 100).toFixed(0) + '%';
const money = (x) => (x < 0 ? '-' : '') + '$' + Math.round(Math.abs(x)).toLocaleString('en-US');
const at = (i) => new Date(Date.parse('2026-09-01T09:00:00Z') + i * 3600000).toISOString();
const sorted = (xs) => [...xs].sort((a, b) => a - b);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = sorted(xs), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const wobble = (r) => (r() + r() + r() - 1.5) * 1.15;   /* roughly normal, cheaply */

/* ------------------------------------------------------------- the entrants

   A grid, so no two entrants are identical and "did the best one win" has an
   answer. The axes are the two that actually move the outcome: what you charge
   against what the product is worth, and how much you build against last
   round's demand. */
const POOL = [];
{
  let n = 0;
  for (const price of [0.90, 0.93, 0.96, 0.99, 1.02, 1.05, 1.08, 1.11]) {
    for (const buffer of [0.85, 0.95, 1.05, 1.15, 1.25, 1.35, 1.45, 1.55, 1.65]) {
      POOL.push({ id: `p${String(++n).padStart(2, '0')}`, price, buffer,
                  rd: Math.round(30000 + (price - 1.0) * 200000), proc: 12000 });
    }
  }
}

function ordersFor(v, p, jig) {
  const products = {};
  for (const prod of v.you.products) {
    const price = p.price * (1 + jig.p);
    const buffer = p.buffer * (1 + jig.b);
    const want = Math.round((prod.lastDemand || 1300) * buffer);
    products[prod.name] = {
      price: Math.round(prod.value * price),
      rd: p.rd, rdProcess: p.proc, advertising: 8000,
      targetCapacity: Math.round(prod.capacity), discontinue: false,
      produce: Math.max(0, Math.min(want, prod.effCapacity) - prod.inventory),
    };
  }
  return products;
}

/* One table. The market is the same for everybody at it and — because the seed
   is passed in — the same for every table in a stage. That property is the whole
   fairness claim, so it is what a tournament has to be built on. */
function playTable(seed, policies, sigma) {
  const { game, token } = G.createGame({
    hostName: `${policies[0].id}`, seats: policies.length, rounds: ROUNDS,
    preset: 'standard', seed, now: at(0), level: 2,
  });
  const tokens = [token];
  for (let i = 1; i < policies.length; i++) {
    tokens.push(G.joinGame(game, `${policies[i].id}-${i}`, at(0)).token);
  }
  G.startGame(game, token, at(0));
  const noise = policies.map((_, i) => rng((seed ^ ((i + 1) * 2654435761)) >>> 0));

  while (game.status === 'playing') {
    for (let i = 0; i < tokens.length; i++) {
      const v = G.viewFor(game, tokens[i]);
      if (!v.you || !v.you.products.length || v.you.bankrupt) continue;
      const jig = sigma > 0
        ? { p: wobble(noise[i]) * sigma * 0.35, b: wobble(noise[i]) * sigma }
        : { p: 0, b: 0 };
      try { G.submitDecisions(game, tokens[i], { products: ordersFor(v, policies[i], jig) }); }
      catch { /* nothing filed; standing orders repeat */ }
    }
    G.resolveRound(game, at(game.round + 1));
  }

  return tokens.map((t, i) => {
    const seat = game.seats.find((s) => s.token === t);
    return { idx: i, policy: policies[i], value: E.companyValue(seat.firm) };
  }).sort((a, b) => b.value - a.value);
}

/* --------------------------------------------------- how good is each one

   Measured with no jitter, against random fields: this is the underlying ability
   a tournament is trying to find, separate from how reliably anybody expresses
   it on the day. */
console.log(`Working out the true strength of ${POOL.length} ways of playing.`);
const strength = {};
{
  const r = rng(20260822);
  const totals = Object.fromEntries(POOL.map((p) => [p.id, []]));
  for (let f = 0; f < 700; f++) {
    const field = Array.from({ length: GROUP }, () => POOL[Math.floor(r() * POOL.length)]);
    for (const row of playTable(700000 + f * 13, field, 0)) totals[row.policy.id].push(row.value);
  }
  for (const p of POOL) strength[p.id] = median(totals[p.id]);
}
const ranked = [...POOL].sort((a, b) => strength[b.id] - strength[a.id]);
const desc = (p) => `${p.price.toFixed(2)}× value, builds ${p.buffer.toFixed(2)}×`;
console.log(`  best   ${desc(ranked[0])} — ${money(strength[ranked[0].id])}`);
console.log(`  worst  ${desc(ranked[ranked.length - 1])} — `
  + `${money(strength[ranked[ranked.length - 1].id])}`);

/* The field a paying tournament actually has: people who have played before.
   The bottom half is dropped, which is what makes the bracket's job hard — the
   closer the field, the less one game tells you. */
const TIGHT = ranked.slice(0, 36);
console.log(`\n  An entry list is not the whole grid. The top ${TIGHT.length} — everybody who`);
console.log(`  broadly knows what they are doing — run from ${money(strength[TIGHT[0].id])}`);
console.log(`  down to ${money(strength[TIGHT[TIGHT.length - 1].id])}.`);

/* -------------------------------------------- how much does one game tell you */
console.log('\n' + '='.repeat(78));
console.log('HOW MUCH DOES ONE TABLE TELL YOU?\n');
console.log('  A fixed rule is far steadier than a person, so before anything else:');
console.log('  what does jitter do to a single table — how often does the strongest');
console.log('  player at it actually win it?\n');

function tableAccuracy(sigma, n = 200) {
  const r = rng(555 + Math.round(sigma * 1000));
  let hit = 0;
  for (let i = 0; i < n; i++) {
    const bag = TIGHT.slice();
    for (let k = bag.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1));
      [bag[k], bag[j]] = [bag[j], bag[k]];
    }
    const field = bag.slice(0, GROUP);
    const best = field.reduce((a, p) => (strength[p.id] > strength[a.id] ? p : a));
    if (playTable(810000 + i * 19, field, sigma)[0].policy.id === best.id) hit += 1;
  }
  return hit / n;
}

const SIGMAS = [0, 0.05, 0.10, 0.20, 0.35];
const acc = {};
console.log('  ' + 'how steady the players are'.padEnd(30) + 'strongest wins their table'.padStart(28));
console.log('  ' + '-'.repeat(58));
for (const s of SIGMAS) {
  acc[s] = tableAccuracy(s);
  const label = s === 0 ? 'perfectly — a fixed rule' : `wobbles ${Math.round(s * 100)}% a round`;
  console.log('  ' + label.padEnd(30) + pct(acc[s]).padStart(28));
}
console.log(`\n  Six at a table, so chance is ${pct(1 / GROUP)}. Which row describes a real`);
console.log('  person is not something this site has ever measured, so everything below');
console.log('  is reported across the range rather than at one point.');

/* -------------------------------------------------------------- the bracket */
function runTournament(seed, entrants, { advance = 1, games = 1 }, sigma) {
  const r = rng(seed);
  let field = entrants.slice();
  let stage = 0;
  const stages = [];

  const decide = (grp, stageSeed) => {
    const totals = new Map(grp.map((e) => [e, 0]));
    for (let g = 0; g < games; g++) {
      const table = playTable(stageSeed + g * 31, grp.map((e) => e.policy), sigma);
      /* Matched by seat index rather than by policy: two entrants could sit on
         the same point of the grid and their totals must not merge. */
      for (const row of table) totals.set(grp[row.idx], totals.get(grp[row.idx]) + row.value);
    }
    return grp.slice().sort((a, b) => totals.get(b) - totals.get(a));
  };

  while (field.length > GROUP) {
    const stageSeed = seed + stage * 977;
    const shuffled = field.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const groups = [];
    for (let i = 0; i < shuffled.length; i += GROUP) groups.push(shuffled.slice(i, i + GROUP));
    const through = [];
    for (const grp of groups) {
      if (grp.length < 2) { through.push(...grp); continue; }
      through.push(...decide(grp, stageSeed).slice(0, advance));
    }
    stages.push({ groups: groups.length });
    field = through;
    stage += 1;
    if (stage > 6) break;
  }
  const order = decide(field, seed + stage * 977);
  stages.push({ groups: 1 });
  return { winner: order[0], podium: order.slice(0, 3), stages };
}

/* No elimination at all: everybody plays the same number of tables in re-drawn
   groups, and the event is ranked on the money made across all of them.

   This is here because the knockout numbers point at it. §34 found that a
   player's *best* result is a worse measure of them than their *average*, and
   gets worse the more they play — which is exactly the property a bracket relies
   on and the bot league already refuses to. */
function runAggregate(seed, entrants, rounds, sigma, swiss) {
  const r = rng(seed);
  const totals = new Map(entrants.map((e) => [e, 0]));
  for (let stage = 0; stage < rounds; stage++) {
    const stageSeed = seed + stage * 977;
    let shuffled = entrants.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    /* Swiss: after the first stage, seat people with others on a similar score.
       It is the standard answer to ranking a field accurately in few rounds —
       every table is then a contest between people it is actually hard to
       separate, which is where the information is. */
    if (swiss && stage > 0) {
      shuffled = shuffled.sort((a, b) => totals.get(b) - totals.get(a));
    }
    for (let i = 0; i < shuffled.length; i += GROUP) {
      const grp = shuffled.slice(i, i + GROUP);
      if (grp.length < 2) continue;
      const table = playTable(stageSeed, grp.map((e) => e.policy), sigma);
      for (const row of table) totals.set(grp[row.idx], totals.get(grp[row.idx]) + row.value);
    }
  }
  const order = entrants.slice().sort((a, b) => totals.get(b) - totals.get(a));
  return { winner: order[0], podium: order.slice(0, 3),
           stages: Array.from({ length: rounds }, () => ({ groups: entrants.length / GROUP })) };
}

function measure(size, opts, sigma) {
  const r = rng(31415 + size + (opts.games || 1) * 7 + (opts.advance || 1) * 3
                + Math.round(sigma * 1000));
  let bestWins = 0, top3Wins = 0, bestOnPodium = 0, tables = 0;
  const places = [];

  for (let t = 0; t < TOURNAMENTS; t++) {
    const bag = TIGHT.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    const entrants = bag.slice(0, size).map((policy, n) => ({ n, policy }));
    const order = entrants.slice().sort((a, b) => strength[b.policy.id] - strength[a.policy.id]);
    const best = order[0];
    const placeOf = new Map(order.map((e, i) => [e, i + 1]));

    const res = opts.aggregate
      ? runAggregate(900000 + t * 17, entrants, opts.aggregate, sigma, opts.swiss)
      : runTournament(900000 + t * 17, entrants, opts, sigma);
    tables = res.stages.reduce((a, s) => a + s.groups, 0) * (opts.games || 1);

    if (res.winner === best) bestWins += 1;
    if (placeOf.get(res.winner) <= 3) top3Wins += 1;
    if (res.podium.includes(best)) bestOnPodium += 1;
    places.push(placeOf.get(res.winner));
  }
  return { bestWins: bestWins / TOURNAMENTS, top3: top3Wins / TOURNAMENTS,
           podium: bestOnPodium / TOURNAMENTS, chance: 1 / size,
           medianPlace: median(places), tables };
}

console.log('\n' + '='.repeat(78));
console.log('DOES THE BRACKET FIND THE BEST PLAYER?\n');
console.log(`  ${TOURNAMENTS} tournaments per cell. 36 distinct entrants from the tight field,`);
console.log('  so chance is 3%.\n');

const FORMATS = [
  { label: '1 game a stage, top 1 through', opts: { advance: 1, games: 1 } },
  { label: '2 games a stage, top 1 through', opts: { advance: 1, games: 2 } },
  { label: '3 games a stage, top 1 through', opts: { advance: 1, games: 3 } },
  { label: '2 games a stage, top 2 through', opts: { advance: 2, games: 2 } },
  { label: 'no elimination, 3 tables each', opts: { aggregate: 3 } },
  { label: 'no elimination, 5 tables each', opts: { aggregate: 5 } },
  { label: 'swiss draw, 3 tables each', opts: { aggregate: 3, swiss: true } },
  { label: 'swiss draw, 5 tables each', opts: { aggregate: 5, swiss: true } },
];
const SHOW = [0, 0.10, 0.20, 0.35];
const head = 'format'.padEnd(33) + SHOW.map((s) =>
  (s === 0 ? 'steady' : `${Math.round(s * 100)}% wobble`).padStart(13)).join('')
  + 'tables'.padStart(9);

const cells = {};
console.log('  The best entrant takes the trophy:');
console.log('  ' + head);
console.log('  ' + '-'.repeat(head.length));
for (const f of FORMATS) {
  const row = [];
  let tables = 0;
  for (const s of SHOW) {
    const m = measure(36, f.opts, s);
    cells[`${f.label}|${s}`] = m;
    tables = m.tables;
    row.push(pct(m.bestWins).padStart(13));
  }
  console.log('  ' + f.label.padEnd(33) + row.join('') + String(tables).padStart(9));
}

console.log('\n  The best entrant at least reaches the final three:');
console.log('  ' + head);
console.log('  ' + '-'.repeat(head.length));
for (const f of FORMATS) {
  const row = SHOW.map((s) => pct(cells[`${f.label}|${s}`].podium).padStart(13));
  console.log('  ' + f.label.padEnd(33) + row.join('')
    + String(cells[`${f.label}|${SHOW[0]}`].tables).padStart(9));
}

/* ------------------------------------------------------------ the verdict */
const at20 = (label) => cells[`${label}|0.2`];
const one = at20('1 game a stage, top 1 through');
const three = at20('3 games a stage, top 1 through');
const two2 = at20('2 games a stage, top 2 through');
const agg3 = at20('no elimination, 3 tables each');
const agg5 = at20('no elimination, 5 tables each');
const sw3 = at20('swiss draw, 3 tables each');
const sw5 = at20('swiss draw, 5 tables each');

console.log('\n' + '='.repeat(78));
console.log('WHAT THIS MEANS\n');
console.log('  Read the 20% column — a guess at how steady a person is, and stated as');
console.log('  one. It is the number this whole answer hangs on and it is not measured.\n');
console.log(`  One game a stage:            best entrant wins ${pct(one.bestWins)}, `
  + `reaches the final three ${pct(one.podium)}`);
console.log(`  Three games a stage:         ${pct(three.bestWins)}, ${pct(three.podium)}`);
console.log(`  Two games, top two through:  ${pct(two2.bestWins)}, ${pct(two2.podium)}`);
console.log(`  No elimination, 3 tables:    ${pct(agg3.bestWins)}, ${pct(agg3.podium)}`);
console.log(`  No elimination, 5 tables:    ${pct(agg5.bestWins)}, ${pct(agg5.podium)}`);
console.log(`  Swiss draw, 3 tables:        ${pct(sw3.bestWins)}, ${pct(sw3.podium)}`);
console.log(`  Swiss draw, 5 tables:        ${pct(sw5.bestWins)}, ${pct(sw5.podium)}`);
console.log(`  Chance:                      ${pct(one.chance)}\n`);
console.log(`  Tables to run: ${one.tables} · ${three.tables} · ${two2.tables}. Ten rounds each, so at a`);
console.log('  five-minute cadence the shortest format is about an hour of play.\n');

console.log(`  one table is a weak signal about a player:  `
  + `${acc[0.2] < 0.5 ? 'YES' : 'no'} (strongest wins ${pct(acc[0.2])} of tables)`);
console.log(`  more tables per stage materially helps:     `
  + `${three.bestWins > one.bestWins * 1.15 ? 'yes' : 'NO'}`);
console.log(`  the podium is much kinder than the crown:   `
  + `${one.podium > one.bestWins * 1.4 ? 'yes' : 'no'}`);
console.log(`  a swiss draw beats a random re-draw:        `
  + `${sw3.podium > agg3.podium ? 'yes' : 'NO'}`
  + ` (top-three ${pct(sw3.podium)} against ${pct(agg3.podium)})`);
console.log(`  ranking on aggregate beats a knockout:      `
  + `${agg3.bestWins > three.bestWins ? 'YES' : 'no'}`
  + ` (${pct(agg3.bestWins)} against ${pct(three.bestWins)} for the same ${agg3.tables} tables)`);
console.log('\n' + '='.repeat(78));
