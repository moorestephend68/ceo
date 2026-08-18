/* What the instructor is handed after the class.

   The demo class exists precisely because it contains, on purpose, the things a
   real class contains by accident: a price war, a student who never files, a
   company borrowing its way downhill. So it is also the right thing to point the
   analysis at — if the analysis cannot find what was deliberately put there, it
   will not find anything an actual class does.

   Two properties matter beyond "it produces output". Every finding must carry the
   numbers behind it, because an instructor will be challenged in front of the
   room and needs to be able to answer. And it must not invent: a finding that
   names a company must be about that company. */

import assert from 'node:assert';
import { memoryDb } from '../lib/db.mjs';
import * as D from '../lib/demo.mjs';
import * as C from '../lib/cohorts.mjs';
import * as AN from '../lib/analysis.mjs';

const db = memoryDb();
const now = '2026-09-01T09:00:00Z';
const made = await D.createDemo(db, now);

/* play it out, the way an instructor would by the end of a session */
let guard = 0;
while ((await C.board(db, made.cohort)).totals.playing > 0 && guard++ < 20) {
  await D.advanceDemo(db, made.cohort, D.DEMO.maxAdvance, now);
}

const a = AN.analyse(made.cohort, await db.gamesOfCohort(made.cohort.id));

console.log(`"${a.name}" — ${a.totals.groups} groups, ${a.totals.students} students, ` +
            `${a.totals.rounds} of ${a.totals.totalRounds} rounds`);
console.log(`  best ${AN.fmtMoney(a.spread.best)} · median ${AN.fmtMoney(a.spread.median)} ` +
            `· worst ${AN.fmtMoney(a.spread.worst)}`);
console.log(`  ${a.totals.out} companies went under · ${a.totals.carried} rounds carried by ` +
            `standing orders`);
assert.equal(a.totals.groups, D.DEMO.groups);
assert.equal(a.totals.students, D.DEMO.groups * D.DEMO.groupSize);

/* ------------------------------------------ what separated the groups */
console.log('\nGROUPS, RANKED — every one of them ran the identical market:');
console.log('  grp   median value      price vs class   advertising vs class   out');
for (const g of a.table) {
  console.log(`  ${String(g.group).padStart(3)}   ${AN.fmtMoney(g.medianValue).padStart(12)}` +
    `   ${((g.priceIndex - 1) * 100).toFixed(0).padStart(11)}%` +
    `   ${((g.adsIndex - 1) * 100).toFixed(0).padStart(18)}%` +
    `   ${String(g.out).padStart(3)}`);
}
assert.equal(a.table.length, D.DEMO.groups, 'every group should be in the table');
assert(a.table[0].medianValue >= a.table[a.table.length - 1].medianValue,
  'the table must be ranked by outcome');
/* the comparison is only worth making because the market was identical */
assert(a.identical && a.seed === D.DEMO.seed, 'the shared seed is what makes this comparable');

/* ------------------------------------------------- things worth discussing */
console.log('\nTHINGS WORTH DISCUSSING:');
for (const f of a.findings) {
  console.log(`\n  [group ${f.group}] ${f.headline}`);
  console.log(`      ${f.detail}`);
  console.log(`      → ${f.ask}`);
}

assert(a.findings.length >= 4, 'a played-out class should yield several findings');
/* every finding carries its evidence and a question */
for (const f of a.findings) {
  assert(f.headline && f.detail && f.ask, `finding "${f.kind}" is missing part of itself`);
  assert(/\$|\d/.test(f.detail), `finding "${f.kind}" states no numbers`);
  assert(f.companies.length, `finding "${f.kind}" names nobody`);
}

/* the price war was deliberately built into group three; it must be found */
const war = a.findings.find((f) => f.kind === 'price war');
console.log(`\nthe price war was found: ${!!war}` + (war ? ` (group ${war.group})` : ''));
assert(war, 'the price war put into the demo on purpose must be found');
assert.equal(war.group, D.STORY.war.group, 'and attributed to the right group');
for (const n of D.STORY.war.names) {
  assert(war.companies.includes(n), `${n} was in the price war and is not named`);
}

/* ---------------------------------------------------------- participation */
console.log('\nSTUDENTS CARRIED BY STANDING ORDERS:');
for (const s of a.students.filter((x) => x.missed > 0).slice(0, 5)) {
  console.log(`  group ${s.group}  ${s.name.padEnd(22)} filed ${s.filed}/${s.played}` +
              `  worth ${AN.fmtMoney(s.value)}`);
}
const never = a.students.find((s) => s.name === D.STORY.neverFiles.name);
assert(never && never.filed <= 1, 'the student who never filed must show it');
assert.equal(a.students.length, D.DEMO.groups * D.DEMO.groupSize);

/* ------------------------------------------------------- the deep export */
const csv = AN.roundsCsv(made.cohort, await db.gamesOfCohort(made.cohort.id));
const rows = csv.trim().split('\n');
console.log(`\nround-by-round export: ${rows.length - 1} rows`);
console.log('  ' + rows[0]);
console.log('  ' + rows[1]);
assert.equal(rows[0].split(',').length, 21, 'the deep export should carry every column');
assert(rows.length - 1 >= D.DEMO.groups * D.DEMO.groupSize * 5,
  'one row per company per round');
/* numbers must stay numbers, or the spreadsheet is useless */
const priceCol = rows[0].split(',').indexOf('price');
assert(rows.slice(1).every((r) => /^-?\d+(\.\d+)?$/.test(r.split(',')[priceCol])),
  'prices must export as numbers');
console.log('  every price exports as a sortable number');

/* ------------------------------------------------- a class barely started */
/* An instructor may open this in the first five minutes. It must not throw, and
   it must not claim to have found things. */
const db2 = memoryDb();
const fresh = await D.createDemo(db2, now);
const early = AN.analyse(fresh.cohort, await db2.gamesOfCohort(fresh.cohort.id));
console.log(`\nopened ${early.totals.rounds} rounds in: ${early.findings.length} findings, ` +
            `no crash`);
assert(early.totals.rounds > 0);

const db3 = memoryDb();
const empty = AN.analyse({ name: 'Nobody yet', seed: 1 }, []);
console.log(`an empty class: ${empty.totals.groups} groups, ${empty.findings.length} findings`);
assert.equal(empty.findings.length, 0, 'an empty class must claim nothing');
assert.equal(empty.totals.groups, 0);

console.log('\nanalysis OK');
