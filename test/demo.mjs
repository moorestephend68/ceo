/* The demo class.

   A demo is a claim about the product, so the things worth proving are the
   claims: that a stranger with no account gets a class that is already running,
   that it tells the same story every time, that the story it tells is the one an
   instructor is actually worried about, and that the token which lets them push
   it around does not let them touch anything else. */

import assert from 'node:assert';
import { memoryDb } from '../lib/db.mjs';
import * as D from '../lib/demo.mjs';
import * as C from '../lib/cohorts.mjs';
import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';

const now = '2026-09-01T09:00:00Z';

/* ------------------------------------------------------- opening the door */
const db = memoryDb();
const t = process.hrtime.bigint();
const made = await D.createDemo(db, now);
const built = Number(process.hrtime.bigint() - t) / 1e6;
let board = await C.board(db, made.cohort);

console.log(`a whole class built in ${built.toFixed(0)}ms — ` +
  `${board.totals.groups} groups, ${board.totals.players} students, ` +
  `${board.groups[0].round} rounds already played`);
assert.equal(board.totals.groups, D.DEMO.groups);
assert.equal(board.totals.players, D.DEMO.groups * D.DEMO.groupSize);
assert(board.groups.every((g) => g.round === D.DEMO.opening),
  'every group should arrive at the same round');
assert(board.groups.every((g) => g.status === 'playing'), 'the class should be live');
assert(board.groups.every((g) => g.companies.every((c) => !c.isBot)),
  'a demo class is students, not bots — the bots are what the empty seats would be');

/* nobody owns it, and that is the point */
assert.equal(made.cohort.facilitator, null, 'a demo class must belong to nobody');
console.log('belongs to no account:', made.cohort.facilitator === null,
            '· expires:', made.cohort.expires_at);

/* ------------------------------------------------------ the same every time */
const db2 = memoryDb();
const again = await D.createDemo(db2, now);
const board2 = await C.board(db2, again.cohort);
const story = (b) => b.groups.map((g) => `${g.group}:` +
  g.companies.slice().sort((a, x) => a.name.localeCompare(x.name))
    .map((c) => `${c.name}=${c.value},${c.missed}`).join('|')).join('\n');
console.log('\ntwo separate visitors, identical class:', story(board) === story(board2));
assert.equal(story(board), story(board2),
  'the demo must tell the same story every time — it is written about and screenshotted');
assert.notEqual(made.cohort.demo_token, again.cohort.demo_token,
  'two visitors must not share a token');
assert.notEqual(made.student.code, again.student.code, 'and must not share a class');

/* ---------------------------------------------------------- the price war */
const wg = board.groups.find((g) => g.group === D.STORY.war.group);
const warPair = D.STORY.war.names.map((n) => wg.companies.find((c) => c.name === n));
const rest = wg.companies.filter((c) => !D.STORY.war.names.includes(c.name));
console.log(`\ngroup ${wg.group}, five rounds in:`);
for (const c of wg.companies.slice().sort((a, b) => b.value - a.value)) {
  const war = D.STORY.war.names.includes(c.name) ? '  ← in the price war' : '';
  console.log(`  ${c.name.padEnd(22)} ${String(Math.round(c.value)).padStart(9)}${war}`);
}
const bestWar = Math.max(...warPair.map((c) => c.value));
const worstRest = Math.min(...rest.map((c) => c.value));
assert(bestWar < worstRest,
  `the price war must visibly hurt: best warring company ${bestWar} vs worst bystander ${worstRest}`);
console.log(`  both undercutters sit below every company that stayed out of it`);

/* And it is a war rather than merely low prices: neither is following a script
   that says "charge 60%" — each undercuts what the other charged last round, so
   the gap to the rest of the group widens every round on its own. */
const wgame = (await db.gamesOfCohort(made.cohort.id))
  .find((g) => g.seats.some((s) => s.name === D.STORY.war.names[0]));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const gapAt = (r) => {
  const res = wgame.history[r - 1].results;
  const inWar = res.filter((x) => D.STORY.war.names.includes(x.name)).map((x) => x.price);
  const out = res.filter((x) => !D.STORY.war.names.includes(x.name)).map((x) => x.price);
  return mean(inWar) / mean(out);
};
console.log('\n  what the two of them charge, against the rest of their group:');
for (let r = 1; r <= D.DEMO.opening; r++) {
  console.log(`    round ${r}: ${(gapAt(r) * 100).toFixed(0)}% of what everyone else charges` +
    (r === D.STORY.war.from ? '   ← it starts here' : ''));
}
assert(gapAt(D.DEMO.opening) < gapAt(D.STORY.war.from) - 0.05,
  'the war must deepen on its own, not sit at a fixed discount');
assert(gapAt(D.STORY.war.from - 1) > 0.95,
  'before it starts, the two of them should be charging what everyone else does');

/* -------------------------------------------------- the student who never files */
const carried = board.groups.flatMap((g) => g.companies.filter((c) => c.missed > 0)
  .map((c) => `${c.name} (group ${g.group}, ${c.missed} missed)`));
console.log('\ncarried by standing orders:', carried.join(', '));
const never = board.groups.find((g) => g.group === D.STORY.neverFiles.group)
  .companies.find((c) => c.name === D.STORY.neverFiles.name);
assert.equal(never.missed, D.DEMO.opening, 'the non-filer must have missed every round');
const stopped = board.groups.find((g) => g.group === D.STORY.stopsFiling.group)
  .companies.find((c) => c.name === D.STORY.stopsFiling.name);
assert.equal(stopped.missed, D.DEMO.opening - D.STORY.stopsFiling.after,
  'the student who lost interest must show the rounds since');
/* the point of them: nothing stalled */
assert(never.value > 0, 'a company nobody files for should still be trading, not frozen');
console.log(`${never.name} never filed once and is still worth ` +
  `$${Math.round(never.value).toLocaleString('en-US')} — nothing stalled`);

/* ------------------------------------------------------------- the guide */
console.log('\nwhat the visitor is told to look at:');
for (const g of D.guide(board)) console.log(`  ${g.what}: ${g.text}`);
const guideText = D.guide(board).map((g) => g.text).join(' ');
assert(guideText.includes(D.STORY.war.names[0]), 'the guide must name the war');
assert(guideText.includes(String(D.DEMO.seed)), 'the guide must state the shared seed');
assert(guideText.includes(D.STORY.neverFiles.name),
  'the guide must point at the student who has not filed');

/* --------------------------------------------------------- time compression */
console.log('\nPushing it forward:');
const before = board.groups[0].round;
const adv = await D.advanceDemo(db, made.cohort, 3, now);
board = await C.board(db, made.cohort);
console.log(`  asked for 3 rounds, played ${adv.advanced}; now on round ${board.groups[0].round}`);
assert.equal(adv.advanced, 3);
assert(board.groups.every((g) => g.round === before + 3), 'every group must move together');

/* the visitor's own seat is theirs from the moment they arrive */
const mineGame = await db.getGame(made.student.code);
const mineSeat = mineGame.seats.find((s) => s.name === D.STORY.visitor.name);
console.log(`  ${mineSeat.name}: ${mineSeat.autoRounds} rounds auto-filed ` +
  `(${D.DEMO.opening} scripted rounds were filed for them, then it became theirs)`);
assert.equal(mineSeat.autoRounds, 3,
  'the visitor\'s seat should be left alone once they have arrived');

/* a real player can drive it — this is the seat handed to the browser */
const v = G.viewFor(mineGame, made.student.token);
console.log(`  the student view: ${v.you.products.length} line(s), ` +
  `${(v.you.cash < 0 ? '-$' : '$')}${Math.abs(Math.round(v.you.cash)).toLocaleString('en-US')} cash, ` +
  `borrowing at ${(v.you.credit.rate * 100).toFixed(1)}%`);
assert(v.you, 'the token handed to the visitor must open a real seat');
assert(v.you.products.length >= 1);
assert(v.you.firmState, 'the projection needs the firm state, or the sliders show nothing');

/* it runs out, rather than running forever */
const far = await D.advanceDemo(db, made.cohort, D.DEMO.maxAdvance + 20, now);
board = await C.board(db, made.cohort);
console.log(`  asking for ${D.DEMO.maxAdvance + 20} at once plays at most ` +
  `${D.DEMO.maxAdvance}: played ${far.advanced}, now round ${board.groups[0].round}`);
assert(far.advanced <= D.DEMO.maxAdvance, 'one click must not run the whole class out');

/* ------------------------------------------------------------ to the end */
let guard = 0;
while (board.totals.playing > 0 && guard++ < 20) {
  await D.advanceDemo(db, made.cohort, D.DEMO.maxAdvance, now);
  board = await C.board(db, made.cohort);
}
console.log(`\nplayed out: ${board.totals.finished} of ${board.totals.groups} groups finished`);
assert.equal(board.totals.finished, D.DEMO.groups);

const csv = await C.exportCsv(db, made.cohort);
const lines = csv.trim().split('\n');
console.log(`the gradebook: ${lines.length - 1} rows`);
console.log('  ' + lines[0]);
console.log('  ' + lines.find((l) => l.includes(D.STORY.neverFiles.name)));
assert.equal(lines.length - 1, D.DEMO.groups * D.DEMO.groupSize);
const slack = lines.find((l) => l.includes(D.STORY.neverFiles.name)).split(',');
assert(Number(slack[8]) > 0, 'the non-filer must reach the spreadsheet as a number');

/* ------------------------------------------------------------ the token */
console.log('\nWhat the demo token opens:');
console.log('  the right token:', D.opensDemo(made.cohort, made.demoToken));
console.log('  another visitor\'s token:', D.opensDemo(made.cohort, again.demoToken));
console.log('  no token at all:', D.opensDemo(made.cohort, ''));
console.log('  a real facilitator\'s class:',
  D.opensDemo({ facilitator: 'someone', is_demo: false, demo_token: null }, made.demoToken));
assert(D.opensDemo(made.cohort, made.demoToken));
assert(!D.opensDemo(made.cohort, again.demoToken));
assert(!D.opensDemo(made.cohort, ''));
assert(!D.opensDemo(made.cohort, null));
assert(!D.opensDemo({ is_demo: true, demo_token: null }, null),
  'a class with no token must not be opened by having no token');
assert(!D.opensDemo({ facilitator: 'someone', is_demo: false, demo_token: made.demoToken },
                    made.demoToken), 'a real class is never opened by a demo token');

/* ----------------------------------------------------------- housekeeping */
const stillThere = (await db.gamesOfCohort(made.cohort.id)).length;
const swept = await db.purgeExpiredDemos(
  new Date(Date.parse(now) + (D.DEMO.ttlMinutes + 1) * 60000).toISOString());
console.log(`\nswept ${swept} expired demo class; ` +
  `${stillThere} games before, ${(await db.gamesOfCohort(made.cohort.id)).length} after`);
assert.equal(swept, 1);
assert.equal((await db.gamesOfCohort(made.cohort.id)).length, 0,
  'sweeping a demo must take its games with it');
assert.equal(await db.cohort(made.cohort.id), null);
/* and a demo that has not expired is left alone */
assert.equal(await db2.purgeExpiredDemos(now), 0, 'a live demo must not be swept');

console.log('\ndemo OK');
