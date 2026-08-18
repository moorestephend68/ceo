/* Can the learning measurement be fooled?

   That is the only question worth asking of it. Any arithmetic will produce a
   rising line; the useful property is refusing to produce one when there is
   nothing there. So this test builds three populations where the truth is known
   by construction and checks what each measurement says about them:

     · nobody learns, and nobody leaves      → must report nothing
     · nobody learns, but losers leave       → the naive curve MUST be fooled,
                                               and the matched one must not be
     · everybody learns                      → must be found

   The middle one is the point of the whole file. If the measurement cannot be
   shown to catch a fake, it is not evidence of anything when it agrees with us. */

import assert from 'node:assert';
import * as PR from '../lib/progress.mjs';

const M = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

/* A deterministic generator, so this test says the same thing every time. */
let seed = 20260818;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
/* Roughly normal, from the middle of twelve uniforms. */
const noise = (sd) => {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rand();
  return (s - 6) * sd;
};

const t0 = Date.parse('2026-06-01T09:00:00Z');
function rows(players) {
  const out = [];
  players.forEach((games, p) => {
    games.forEach((made, i) => {
      out.push({ company_id: `c${p}`, name: `Company ${p}`, value: PR.START + made,
                 place: 3, seats: 5, created_at: new Date(t0 + (p * 40 + i) * 3600000).toISOString() });
    });
  });
  return out;
}

/* ------------------------------------------------------------ population 1 */
/* Fixed skill, everybody plays ten games, nobody improves. */
console.log('A world where nobody learns and nobody leaves:');
{
  const players = [];
  for (let p = 0; p < 120; p++) {
    const skill = noise(120000);
    players.push(Array.from({ length: 10 }, () => skill + noise(90000)));
  }
  const r = PR.learning(rows(players), { n: 5, rounds: 200, rand });
  console.log(`  matched change from game 1 to game 5: ${M(r.change)} over ${r.players} players`);
  console.log(`  where the real ordering falls among 200 reshuffles: ${(r.percentile * 100).toFixed(0)}%`);
  console.log(`  verdict: ${r.verdict}`);
  assert(!r.real, 'the measurement invented learning in a world with none');
}

/* ------------------------------------------------------------ population 2 */
/* THE ONE THAT MATTERS. Still nobody learns. But a player whose first game goes
   badly is likelier to stop playing — which is exactly what real players do. */
console.log('\nA world where nobody learns, but the ones who do badly leave:');
{
  const players = [];
  for (let p = 0; p < 400; p++) {
    const skill = noise(120000);
    const games = [skill + noise(90000)];
    /* The worse it went, the likelier they are to walk. Nothing about them
       changes; the population changes. */
    for (let i = 1; i < 10; i++) {
      const disheartened = games[0] < 0 ? 0.45 : 0.08;
      if (rand() < disheartened) break;
      games.push(skill + noise(90000));
    }
    players.push(games);
  }
  const r = PR.learning(rows(players), { n: 5, rounds: 200, rand });

  console.log(`  the naive curve — median made at each game, over whoever got that far:`);
  console.log('    ' + r.naive.slice(0, 5).map((x) => `game ${x.game}: ${M(x.median)} (${x.players})`).join('\n    '));
  console.log(`  which reads as ${M(r.naiveChange)} of "improvement" from game 1 to game 5.`);
  console.log(`  the matched cohort — the SAME players' game 1 against their game 5: ${M(r.change)}`);
  console.log(`  survivorship, in dollars: ${M(r.survivorship)}`);
  console.log(`  ordering percentile: ${(r.percentile * 100).toFixed(0)}%  →  ${r.verdict}`);

  /* The naive statistic must be fooled — if it is not, this population is not
     testing anything and the test itself is wrong. */
  assert(r.naiveChange > 20000,
         `the naive curve was supposed to be fooled here and reported ${M(r.naiveChange)}`);
  /* And the one that is actually reported must not be. */
  assert(!r.real, 'survivorship was reported as learning — the exact failure this exists to prevent');
  console.log('  → the obvious statistic lies by a wide margin; the reported one does not.');
}

/* ------------------------------------------------------------ population 3 */
/* Everybody genuinely improves, by an amount smaller than the noise on any one
   game — because if it only works when the effect is obvious, it is useless. */
console.log('\nA world where everybody really does learn (and losers still leave):');
{
  const players = [];
  for (let p = 0; p < 400; p++) {
    const skill = noise(120000);
    const games = [];
    for (let i = 0; i < 10; i++) {
      if (i && games[0] < 0 && rand() < 0.45) break;
      if (i && rand() < 0.08) break;
      games.push(skill + i * 26000 + noise(90000));
    }
    players.push(games);
  }
  const r = PR.learning(rows(players), { n: 5, rounds: 200, rand });
  console.log(`  matched change: ${M(r.change)} over ${r.players} players`);
  console.log(`  reshuffles land between ${M(r.nullRange[0])} and ${M(r.nullRange[1])}, ` +
              `middle ${M(r.nullMedian)}`);
  console.log(`  ordering percentile: ${(r.percentile * 100).toFixed(0)}%`);
  console.log(`  verdict: ${r.verdict}`);
  assert(r.real, 'real learning of $26,000 a game was missed');
  /* The true per-game gain is $26,000, so four games on should be near $104,000.
     Not asserted tightly — it is a median over a truncated population — but it
     must be in the right country. */
  assert(r.change > 50000, `recovered only ${M(r.change)} of a true ${M(104000)}`);
  console.log(`  and it recovers ${M(r.change)} of a true ${M(104000)} — it UNDERSTATES.`);
  /* The direction of the residual bias is the property that makes the whole
     thing usable, so it is asserted rather than hoped for. Understating means a
     positive result can be believed; overstating would mean it could not. */
  assert(r.change < 104000,
         'the estimator overstated real learning — a positive result could not then be trusted');
  console.log(`  ${r.caveat.slice(0, 96)}…`);
}

/* ---------------------------------------------------- refusing to answer */
console.log('\nBefore there is enough data:');
{
  const players = [];
  for (let p = 0; p < 6; p++) players.push(Array.from({ length: 6 }, () => noise(100000)));
  const r = PR.learning(rows(players), { n: 5, rand });
  console.log(`  ${r.why}`);
  assert(!r.enough, 'a number was computed from six players');
  assert(!('change' in r), 'a change was reported despite not having enough to report it from');
}

/* ------------------------------------------------------- one player's own */
console.log("\nOne player's own curve:");
{
  const one = rows([[-80000, -20000, 40000, 60000, 90000, 120000]])
    .map((r) => ({ ...r, company_id: 'c0' }));
  const c = PR.curveFor(one);
  console.log(`  ${c.games} games · early ${M(c.early)} · lately ${M(c.late)} · ` +
              `difference ${M(c.change)} (over thirds of ${c.span})`);
  assert(c.enough && c.change > 0, 'a plainly improving player was not shown as improving');

  const thin = PR.curveFor(rows([[10000]]));
  console.log(`  and with one game: "${thin.why}"`);
  assert(!thin.enough, 'a curve was drawn through a single point');
}

console.log('\nprogress OK');
