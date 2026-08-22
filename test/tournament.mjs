/* Tournaments — the parts that decide who wins.

   §43 chose this format over the knockout that was asked for, on measurement.
   These are the properties that measurement assumed, checked rather than
   trusted:

     - every group in a stage faces an identical market, and stages differ
     - the draw is deterministic, so a stage recreated after a crash is the same
       tournament and not a different one
     - nobody is left out of a stage, and the same people are not short-changed
       every time
     - standings rank on the total, not on anybody's best table

   The last one matters most. §34 found a player's best single result is their
   *worst* statistic and gets worse the more they play. A tournament that ranked
   on it would be selling exactly the wrong number as its headline. */

import assert from 'node:assert';
import * as T from '../lib/tournament.mjs';

const money = (x) => '$' + Math.round(x).toLocaleString('en-US');
const entrants = (n) => Array.from({ length: n }, (_, i) =>
  ({ id: `e${i}`, name: `Company ${i + 1}` }));

/* ------------------------------------------------------------ the markets */
console.log('Every group in a stage faces the same market:');
{
  const seed = 12345;
  const a = T.seedForStage(seed, 0);
  const b = T.seedForStage(seed, 1);
  const c = T.seedForStage(seed, 2);
  console.log(`  stage 1 → ${a} · stage 2 → ${b} · stage 3 → ${c}`);
  assert.strictEqual(T.seedForStage(seed, 0), a, 'a stage seed is not stable');
  assert(a !== b && b !== c && a !== c, 'two stages share a market');
  console.log('  each stage has one seed, so every table in it is comparable —');
  console.log('  and no two stages are the same, so nobody carries the market forward');

  /* Two different events must not accidentally run the same markets. */
  assert.notStrictEqual(T.seedForStage(12346, 0), a, 'two events drew the same market');
  console.log('  and a different event is a different market\n');
}

/* --------------------------------------------------------------- the draw */
console.log('The draw:');
{
  const list = entrants(36);
  const g1 = T.drawGroups(list, 999, 0);
  const g2 = T.drawGroups(list, 999, 1);
  console.log(`  36 entrants → ${g1.length} groups of ${g1[0].members.length}`);
  assert.strictEqual(g1.length, 6);
  assert(g1.every((g) => g.members.length === 6), 'a group is the wrong size');

  /* Everybody plays, exactly once, every stage. */
  const seen = new Set(g1.flatMap((g) => g.members.map((m) => m.id)));
  assert.strictEqual(seen.size, 36, 'somebody was left out of a stage or seated twice');
  console.log('  everybody is seated exactly once');

  /* Deterministic — a stage rebuilt after a crash is the same tournament. */
  const again = T.drawGroups(list, 999, 0);
  assert.deepStrictEqual(again.map((g) => g.members.map((m) => m.id)),
                         g1.map((g) => g.members.map((m) => m.id)),
                         'the same stage drew different groups the second time');
  console.log('  and the same stage always draws the same groups');

  /* But a different stage is a genuinely different draw. */
  const same = JSON.stringify(g1.map((g) => g.members.map((m) => m.id)))
            === JSON.stringify(g2.map((g) => g.members.map((m) => m.id)));
  assert(!same, 'stage two re-used stage one’s tables');
  console.log('  stage two is a fresh draw, so who you sat with does not follow you\n');
}

/* ------------------------------------------------------- awkward numbers */
console.log('Numbers that do not divide by six:');
{
  for (const n of [12, 13, 17, 19, 25, 31, 37]) {
    const groups = T.drawGroups(entrants(n), 4242, 0);
    const sizes = groups.map((g) => g.members.length);
    const total = sizes.reduce((a, b) => a + b, 0);
    console.log(`  ${String(n).padStart(2)} entrants → ${sizes.join(' + ')}`);
    assert.strictEqual(total, n, `${n} entrants but ${total} seats`);
    /* Three is the engine's minimum and a thin market even then. Two is not a
       game at all, which is what slicing off sixes and keeping the remainder
       used to produce. */
    assert(sizes.every((s) => s >= 3), `${n} entrants made a table of ${Math.min(...sizes)}`);
    assert(Math.max(...sizes) - Math.min(...sizes) <= 1,
      `${n} entrants gave tables of ${Math.max(...sizes)} and ${Math.min(...sizes)}`);
    assert(sizes.every((s) => s <= 6), `${n} entrants made a table of ${Math.max(...sizes)}`);
  }
  console.log('  nobody sits out, no table is under three or over six,');
  console.log('  and no two tables in a stage differ by more than one seat');

  /* And the short table is not the same people every stage. */
  const list = entrants(31);
  const shortAt = [0, 1, 2].map((stage) => {
    const g = T.drawGroups(list, 777, stage);
    const small = Math.min(...g.map((x) => x.members.length));
    return g.filter((x) => x.members.length === small)
      .flatMap((x) => x.members.map((m) => m.id)).sort().join(',');
  });
  assert(new Set(shortAt).size > 1,
    'the same entrants were put on the short table every stage');
  console.log('  and a different set of people is on it each stage\n');
}

/* ----------------------------------------------------------- the standings */
console.log('Standings rank on the total, not on anybody\'s best table:');
{
  const list = entrants(4);
  /* e0 is steady. e1 has one enormous table and two poor ones — the shape §34
     says a leaderboard must not reward. */
  const results = [
    { entrantId: 'e0', stage: 0, value: 300000 },
    { entrantId: 'e0', stage: 1, value: 310000 },
    { entrantId: 'e0', stage: 2, value: 290000 },
    { entrantId: 'e1', stage: 0, value: 800000 },
    { entrantId: 'e1', stage: 1, value: 40000 },
    { entrantId: 'e1', stage: 2, value: 20000 },
    { entrantId: 'e2', stage: 0, value: 250000 },
    { entrantId: 'e2', stage: 1, value: 250000 },
    { entrantId: 'e2', stage: 2, value: 250000 },
  ];
  const rows = T.standings(list, results);
  for (const r of rows) {
    console.log(`  ${r.place}. ${r.name.padEnd(11)} ${money(r.total).padStart(11)} `
      + `over ${r.played} tables · best ${r.best === null ? '—' : money(r.best)}`);
  }
  assert.strictEqual(rows[0].id, 'e0', 'the steady player did not come first');
  assert(rows.findIndex((r) => r.id === 'e1') > 0,
    'one huge table beat three consistent ones — that is the statistic §34 refused');
  console.log('  the one enormous table does not win the event');

  /* Somebody who never turned up is last and cannot reach the final. */
  assert.strictEqual(rows[rows.length - 1].id, 'e3');
  assert.strictEqual(rows[rows.length - 1].played, 0);
  const six = T.finalists(rows, 6);
  assert(!six.some((r) => r.id === 'e3'), 'somebody who never played reached the final');
  console.log(`  and an entrant who never played takes no seat in the final `
    + `(${six.length} qualified, not 4)\n`);
}

/* ------------------------------------------------------------- the phases */
console.log('What the event is waiting for:');
{
  const cohort = { config: { tournament: { stages: 3, finalists: 6 } } };
  const seen = [];
  for (const done of [0, 1, 2, 3]) {
    const p = T.phaseOf(cohort, { stagesDone: done });
    seen.push(p.label);
    console.log(`  ${done} stages played → ${p.phase}: ${p.label}`);
  }
  assert.deepStrictEqual(seen, ['Stage 1 of 3', 'Stage 2 of 3', 'Stage 3 of 3', 'The final']);
  const over = T.phaseOf(cohort, { stagesDone: 3, finalDone: true });
  assert.strictEqual(over.phase, 'over');
  console.log(`  final played → ${over.phase}\n`);
}

/* --------------------------------------------------------- what it tells you */
console.log('What an entrant is told about their place:');
{
  const cohort = { config: { tournament: { stages: 3, finalists: 6 } } };
  const list = entrants(10);
  const results = list.map((e, i) => ({ entrantId: e.id, stage: 0, value: 400000 - i * 25000 }));
  const rows = T.standings(list, results);
  console.log(`  1st:  ${T.describe(cohort, rows, 1)}`);
  console.log(`  5th:  ${T.describe(cohort, rows, 5)}`);
  console.log(`  8th:  ${T.describe(cohort, rows, 8)}`);
  assert(/Top of the event/.test(T.describe(cohort, rows, 1)));
  assert(/above the cut/.test(T.describe(cohort, rows, 5)));
  assert(/outside the final/.test(T.describe(cohort, rows, 8)));
  console.log('  somebody outside the cut is told what it would take, not just their place');
}

/* ------------------------------------------------------------- the settings */
console.log('\nSettings are clamped rather than trusted:');
{
  const wild = { config: { tournament: { stages: 99, finalists: 0 } } };
  const s = T.settingsOf(wild);
  console.log(`  asked for 99 stages and 0 finalists → ${s.stages} stages, ${s.finalists} finalists`);
  assert(s.stages <= T.LIMITS.stages.max && s.stages >= T.LIMITS.stages.min);
  assert(s.finalists >= T.LIMITS.finalists.min);
  const bare = T.settingsOf({ config: { tournament: {} } });
  console.log(`  and asked for nothing → ${bare.stages} stages, ${bare.finalists} finalists`);
  assert.strictEqual(bare.stages, T.LIMITS.stages.default);
}

console.log('\ntournament OK');
