/* A whole tournament, played out.

   The pure parts — the draw, the standings, who reaches the final — are checked
   in test/tournament.mjs. This one runs an actual event end to end against a
   database: thirty people enter, three stages are drawn and played, six qualify,
   and one of them wins it.

   The things that can only go wrong here are the ones that involve storage and
   time: an entrant whose seat token changes underneath them every stage and who
   must never notice, a stage that is drawn twice, somebody arriving after the
   field is fixed, and a standings table that reorders itself while half the
   tables are still running. */

import assert from 'node:assert';
import { memoryDb } from '../lib/db.mjs';
import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';
import * as T from '../lib/tournament.mjs';
import { mutateGame } from '../lib/mutate.mjs';

const db = memoryDb();
const money = (x) => (x < 0 ? '-' : '') + '$' + Math.round(Math.abs(x)).toLocaleString('en-US');
const at = (i) => new Date(Date.parse('2026-09-01T09:00:00Z') + i * 3600000).toISOString();

await db.ensureProfile('u-host', 'host@example.com');

/* ------------------------------------------------------------- the event */
console.log('Setting one up:');
const event = await T.createTournament(db, 'u-host', {
  name: 'Autumn Cup', rounds: 10, cadence: 'manual', stages: 3, finalists: 6, seed: 5150,
});
console.log(`  "${event.name}" — code ${event.join_code}, `
  + `${T.settingsOf(event).stages} stages, top ${T.settingsOf(event).finalists} in the final`);
assert(T.isTournament(event), 'the cohort was not marked as a tournament');
assert.strictEqual(event.group_size, 6, 'a tournament table is not six seats');

/* ------------------------------------------------------------- entering */
console.log('\nEntering:');
const FIELD = 30;
const tokens = [];
for (let i = 0; i < FIELD; i++) {
  const { token } = await T.enter(db, event, `Company ${i + 1}`, at(0));
  tokens.push(token);
}
console.log(`  ${FIELD} entrants`);

/* Two people cannot be called the same thing — a scoreboard with two
   Ravenscarrs on it is a scoreboard nobody can read. */
await assert.rejects(() => T.enter(db, event, 'Company 4', at(0)), /already called/,
  'two entrants took the same name');
console.log('  and the same name twice is refused');

/* Too few is a class, and should be sold as one. */
{
  const tiny = await T.createTournament(db, 'u-host', { name: 'Too small', seed: 7 });
  await T.enter(db, tiny, 'Only one', at(0));
  await assert.rejects(() => T.startStage(db, tiny, at(0)), /at least/,
    'an event of one was allowed to start');
  console.log(`  an event with fewer than ${T.LIMITS.minEntrants} refuses to start\n`);
}

/* --------------------------------------------------------- playing it out */

/* A competent, unremarkable way to play, so the results differ because the draws
   and the markets differ rather than because this file decided who wins. */
async function playOut(code) {
  await mutateGame(db, code, (g) => {
    let guard = 0;
    while (g.status === 'playing' && guard++ < 40) {
      for (const seat of g.seats) {
        if (seat.isBot || seat.out || seat.firm.bankrupt) continue;
        const v = G.viewFor(g, seat.token);
        if (!v.you || !v.you.products.length) continue;
        const products = {};
        for (const p of v.you.products) {
          /* Spread out by seat, so a table has a spread of behaviour in it. */
          const n = g.seats.indexOf(seat);
          products[p.name] = {
            price: Math.round(p.value * (0.93 + n * 0.02)),
            rd: 30000, rdProcess: 12000, advertising: 8000,
            targetCapacity: Math.round(p.capacity), discontinue: false,
            produce: Math.max(0, Math.min(
              Math.round((p.lastDemand || 1300) * (1.0 + n * 0.06)), p.effCapacity) - p.inventory),
          };
        }
        try { G.submitDecisions(g, seat.token, { products }); } catch {}
      }
      G.resolveRound(g, at(g.round + 2));
    }
    return true;
  });
}

console.log('The stages:');
let lastState = null;
for (let s = 0; s < 3; s++) {
  const cohort = await db.cohort(event.id);
  const started = await T.startStage(db, cohort, at(s * 5 + 1));
  const sizes = started.tables.map((t) => t.seats);
  console.log(`  stage ${started.stage + 1}: ${started.tables.length} tables `
    + `(${sizes.join(' + ')}), all on market ${started.seed}`);
  assert.strictEqual(sizes.reduce((a, b) => a + b, 0), FIELD, 'somebody was left out of a stage');

  /* Every table in a stage must face the identical market, or nothing about the
     standings means anything. */
  const games = await db.gamesOfCohort(event.id);
  const inStage = games.filter((g) => (g.stage || 0) === started.stage);
  assert(new Set(inStage.map((g) => g.seed)).size === 1,
    'two tables in the same stage played different markets');

  /* Drawing the same stage twice would double everybody's money. */
  const fresh = await db.cohort(event.id);
  await assert.rejects(() => T.startStage(db, fresh, at(s * 5 + 2)),
    /already running/, 'a stage was drawn twice');

  for (const t of started.tables) await playOut(t.code);
  lastState = await T.stateOf(db, await db.cohort(event.id));
  console.log(`    played · ${lastState.stagesDone} of 3 stages done · `
    + `leader ${lastState.standings[0].name} on ${money(lastState.standings[0].total)}`);
}
console.log('  every table in a stage shared one market, and no stage ran twice\n');

/* --------------------------------------------------- the field is fixed */
console.log('Arriving late:');
{
  const now = await db.cohort(event.id);
  await assert.rejects(() => T.enter(db, now, 'Latecomer', at(20)),
    /already started/, 'somebody joined an event in progress');
}
console.log('  refused — everybody has to have played the same number of tables\n');

/* ----------------------------------------------------------- the standings */
console.log('The standings after three stages:');
{
  const st = await T.stateOf(db, await db.cohort(event.id));
  for (const r of st.standings.slice(0, 8)) {
    console.log(`  ${String(r.place).padStart(2)}. ${r.name.padEnd(12)} `
      + `${money(r.total).padStart(12)} over ${r.played} tables`);
  }
  assert(st.standings.every((r) => r.played === 3),
    'somebody played a different number of tables from everybody else');
  assert.strictEqual(st.phase.phase, 'final', `the event is in ${st.phase.phase}, not the final`);
  assert.strictEqual(st.qualifiers.length, 6, 'the wrong number qualified');
  console.log(`  everybody played exactly 3 tables, and ${st.qualifiers.length} qualified\n`);
}

/* --------------------------------------------------------------- the final */
console.log('The final:');
{
  const before = await T.stateOf(db, await db.cohort(event.id));
  const qualified = before.qualifiers;
  const started = await T.startStage(db, await db.cohort(event.id), at(30));
  assert.strictEqual(started.isFinal, true, 'the final was drawn as an ordinary stage');
  assert.strictEqual(started.tables.length, 1, 'the final was more than one table');
  assert.strictEqual(started.tables[0].seats, 6, 'the final did not seat six');
  console.log(`  one table, six seats, on its own market`);

  /* And it is the six who qualified, not six other people. */
  const games = await db.gamesOfCohort(event.id);
  const finalGame = games.find((g) => g.isFinal);
  const seated = (finalGame.seats || []).map((s) => s.entrantId).filter(Boolean);
  assert.deepStrictEqual(seated.slice().sort(), qualified.slice().sort(),
    'somebody who did not qualify was seated in the final');
  console.log('  seated by the standings, not by a fresh draw');

  await playOut(started.tables[0].code);
  const after = await T.stateOf(db, await db.cohort(event.id));
  assert.strictEqual(after.phase.phase, 'over', 'the event did not finish');
  console.log(`  played · the event is ${after.phase.phase}`);

  /* The final is a table like any other, so its money counts towards the total —
     which means the winner of the event is not automatically the winner of the
     final, and both are worth showing. */
  const champ = (await db.gamesOfCohort(event.id)).find((g) => g.isFinal);
  const order = champ.seats.filter((s) => s.entrantId)
    .map((s) => ({ name: s.name, value: E.companyValue(s.firm) }))
    .sort((a, b) => b.value - a.value);
  console.log(`  won by ${order[0].name} on ${money(order[0].value)}`);
  console.log(`  top of the event overall: ${after.standings[0].name} `
    + `on ${money(after.standings[0].total)}\n`);
}

/* --------------------------------------------- what one entrant actually sees */
console.log('What an entrant sees, all the way through:');
{
  const view = await T.entrantView(db, await db.cohort(event.id), tokens[3]);
  console.log(`  ${view.you.name}: ${view.you.place} of ${view.standings.length}, `
    + `${money(view.you.total)} over ${view.you.played} tables`);
  console.log(`  "${view.you.note}"`);
  assert(view.you, 'an entrant could not find themselves in the standings');
  assert.strictEqual(view.event.phase.phase, 'over');

  /* The seat token changed three times underneath them and they never had to
     know: the token they hold is the one they entered with. */
  const games = await db.gamesOfCohort(event.id);
  const me = await db.entrantByToken(tokens[3]);
  const seats = games.flatMap((g) => (g.seats || []).filter((s) => s.entrantId === me.id));
  const distinct = new Set(seats.map((s) => s.token)).size;
  console.log(`  played ${seats.length} tables under ${distinct} different seat tokens,`);
  console.log(`  holding one entrant token the whole time`);
  assert(distinct >= 3, 'the seat token did not change between stages');

  /* And somebody else's token is not a way in. */
  const cur = await db.cohort(event.id);
  await assert.rejects(() => T.entrantView(db, cur, 'not-a-token'),
    /do not recognise/, 'a made-up token read the event');
  console.log('  and a token from nowhere reads nothing');
}

console.log('\ntourney OK');
