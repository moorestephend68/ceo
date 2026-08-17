/* A whole class, start to finish.

   Forty students, eight groups, one seed. The things worth proving are the ones
   an instructor would ask about before adopting anything: does everyone really
   face the same market, can I hold the room still, what happens to the student
   who never submits, and what comes out at the end that I can put in a
   gradebook. */

import assert from 'node:assert';
import { memoryDb } from '../lib/db.mjs';
import * as A from '../lib/accounts.mjs';
import * as C from '../lib/cohorts.mjs';
import * as G from '../lib/game.mjs';

const db = memoryDb();
const t0 = Date.parse('2026-09-01T09:00:00Z');
const at = (ms) => new Date(ms).toISOString();

await db.ensureProfile('teacher', 'teacher@school.edu');
const held = await A.claimName(db, 'teacher', 'Prof Moore', at(t0));
await A.confirmPurchase(db, { owner: 'teacher', companyId: held.id, kind: 'facilitator', eventId: 'e1' });

const cohort = await C.createCohort(db, 'teacher', {
  name: 'MGT 481 — Autumn', groupSize: 5, rounds: 8, cadence: '15m', preset: 'standard',
});
console.log(`class "${cohort.name}" created, code ${cohort.join_code}, seed ${cohort.seed}`);

/* ------------------------------------------------------- forty students join */
const students = [];
for (let i = 1; i <= 40; i++) {
  const j = await C.joinCohort(db, cohort, `Company ${String(i).padStart(2, '0')}`, at(t0));
  await db.putGame(j.game);
  students.push({ name: `Company ${String(i).padStart(2, '0')}`, code: j.game.code, token: j.token, group: j.group });
}
let view = await C.board(db, cohort);
console.log(`\n${view.totals.players} students seated into ${view.totals.groups} groups of ${cohort.group_size}`);
assert.equal(view.totals.groups, 8, 'forty students at five a group is eight groups');
assert.equal(view.totals.players, 40);

/* the one that matters: identical markets */
const seeds = new Set((await db.gamesOfCohort(cohort.id)).map((g) => g.seed));
console.log('distinct market seeds across the eight groups:', seeds.size, `(${[...seeds][0]})`);
assert.equal(seeds.size, 1, 'every group must face the same market');

/* -------------------------------------------------------------- start them */
const started = await C.startAll(db, cohort, at(t0));
view = await C.board(db, cohort);
console.log(`\nstarted ${started.started} groups; each seats ${view.groups[0].seats} companies`);
assert.equal(view.totals.playing, 8);
assert(view.groups.every((g) => g.seats === 5), 'short groups should be filled with bots');

/* every group should have opened with the same market conditions */
const firstRoundNews = (await db.gamesOfCohort(cohort.id)).map((g) => JSON.stringify(g.news));
assert.equal(new Set(firstRoundNews).size, 1, 'identical seeds must produce identical news');
console.log('every group opened on identical conditions:', new Set(firstRoundNews).size === 1);

/* ------------------------------------------------------------ the clock */
console.log('\nHolding the room still:');
await C.setPaused(db, cohort, true);
let games = await db.gamesOfCohort(cohort.id);
const wayPast = at(t0 + 40 * 60000);
console.log('  paused; a group whose deadline passed resolves:',
            G.shouldResolve(games[0], wayPast));
assert.equal(G.shouldResolve(games[0], wayPast), false, 'a paused class must not tick on');

await C.setPaused(db, cohort, false);
games = await db.gamesOfCohort(cohort.id);
console.log('  resumed; the same group now resolves:', G.shouldResolve(games[0], wayPast));
assert.equal(G.shouldResolve(games[0], wayPast), true);

const ext = await C.extendAll(db, cohort, 10, at(t0));
console.log(`  gave all ${ext.extended} groups another ${ext.minutes} minutes`);
assert.equal(ext.extended, 8);

/* -------------------------------------------------------- play the class out */
/* Most students file most rounds; two never file at all, which is the case an
   instructor actually worries about. */
const slackers = new Set(['Company 07', 'Company 23']);
let round = 0;
while ((await C.board(db, cohort)).totals.playing > 0 && round < 20) {
  round += 1;
  for (const s of students) {
    if (slackers.has(s.name)) continue;
    const g = await db.getGame(s.code);
    if (!g || g.status !== 'playing') continue;
    const v = G.viewFor(g, s.token);
    if (!v.you || !v.you.products.length || v.you.bankrupt) continue;
    const products = {};
    for (const p of v.you.products) {
      products[p.name] = {
        price: Math.round(p.value * (0.94 + (s.group % 5) * 0.02)),
        produce: Math.max(0, Math.min(p.lastDemand || 1300, p.effCapacity) - p.inventory),
        rd: 30000, rdProcess: 10000, advertising: 5000,
        targetCapacity: p.capacity, discontinue: false,
      };
    }
    G.submitDecisions(g, s.token, { products, launch: false });
    await db.putGame(g);
  }
  const out = await C.resolveAll(db, cohort, at(t0 + round * 20 * 60000));
  if (!out.closed) break;
}
view = await C.board(db, cohort);
console.log(`\nplayed ${round} rounds; ${view.totals.finished} groups finished`);
assert.equal(view.totals.finished, 8);

/* the students who never filed were carried, and it shows */
const missed = view.groups.flatMap((g) => g.companies)
  .filter((c) => !c.isBot && c.missed > 0)
  .map((c) => `${c.name} (${c.missed})`);
console.log('students carried by standing orders:', missed.join(', ') || 'none');
assert(missed.some((m) => m.startsWith('Company 07')), 'the non-filer should be recorded');

/* ---------------------------------------------------------------- export */
const csv = await C.exportCsv(db, cohort);
const lines = csv.trim().split('\n');
console.log(`\nexport: ${lines.length - 1} rows`);
console.log('  ' + lines[0]);
for (const l of lines.slice(1, 4)) console.log('  ' + l);
assert.equal(lines[0], 'group,game,company,kind,place,company_value,rounds_played,rounds_filed,rounds_auto_filed,status');
assert.equal(lines.length - 1, 8 * 5, 'a row per company per group, bots included');

/* the participation column is the thing a gradebook wants */
const slackerRow = lines.find((l) => l.includes('Company 07'));
console.log('  ' + slackerRow);
const cols = slackerRow.split(',');
assert(Number(cols[8]) > 0, 'the non-filer must show auto-filed rounds');
/* a spreadsheet has to be able to sort and total the value column */
const valueCells = lines.slice(1).map((l) => l.split(',')[5]);
assert(valueCells.every((c) => /^-?\d+$/.test(c)),
  `company values must export as numbers, got e.g. ${valueCells.find((c) => !/^-?\d+$/.test(c))}`);
console.log('  company values export as sortable numbers, negatives included');
assert.equal(Number(cols[7]), Number(cols[6]) - Number(cols[8]), 'filed + auto should equal played');

/* a student company name starting with = must not become a formula */
const tricky = await C.joinCohort(db, cohort, '=cmd|calc', at(t0));
await db.putGame(tricky.game);
const csv2 = await C.exportCsv(db, cohort);
assert(csv2.includes("'=cmd|calc"), 'a formula-looking name must be neutralised in the CSV');
console.log('\na company called "=cmd|calc" is exported as text, not a formula');

console.log('\ncohort OK');
