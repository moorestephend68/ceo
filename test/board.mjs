/* The leaderboard.

   It exists to be winnable. A rating is stable by design, so the top of one
   belongs to whoever got there first and a newcomer who plays brilliantly on
   Tuesday sees no evidence of it — which is a poor advertisement for the thing
   they are being asked to buy a company name for.

   Three properties are worth proving, and one of them is the reason the design
   is what it is:

     it decays, so nobody holds the top by having been good yesterday;
     it cannot be ground out, because it is your best game and not your total;
     a losing game scores nothing rather than something negative. */

import assert from 'node:assert';
import * as B from '../lib/board.mjs';
import * as P from '../lib/public.mjs';

const START = P.START_CASH;
const now = '2026-09-01T18:00:00Z';
const hoursAgo = (h) => new Date(Date.parse(now) - h * 3600000).toISOString();
const M = (x) => '$' + Math.round(x).toLocaleString('en-US');

let n = 0;
const result = (company, value, h, place = 1) => ({
  company_id: company, name: company, value, place, seats: 5,
  created_at: hoursAgo(h), game_code: `G${++n}`,
});

/* ------------------------------------------------------------ the decay */
console.log('What one $300,000 company is worth as the day goes on:');
for (const h of [0, 1, 3, B.HALF_LIFE_HOURS, 12, 24, 48]) {
  console.log(`  ${B.ago(h).padEnd(10)} ${M(300000 * B.decayFactor(h))}`);
}
assert(Math.abs(B.decayFactor(B.HALF_LIFE_HOURS) - 0.5) < 1e-9,
  'the stated half-life must be the actual half-life');
console.log(`half of it is gone after ${B.HALF_LIFE_HOURS.toFixed(1)} hours`);
assert(B.decayFactor(24) < 0.1, 'a day old should be worth under a tenth');

/* ---------------------------------------------- it cannot be ground out */
/* This is the decision the whole design turns on. A player going back to back
   for a whole day against a player who had one brilliant game an hour ago. */
const grinder = [];
for (let i = 0; i < 24; i++) grinder.push(result('Treadmill Ltd', START + 120000, i * 0.85));
const artist = [result('Ravensworth & Co', START + 300000, 1)];

const board = B.build([...grinder, ...artist], { now, start: START });
console.log('\n24 games in a day at $120,000 each, against one $300,000 game an hour ago:');
for (const r of board) {
  console.log(`  ${r.rank}. ${r.name.padEnd(18)} ${M(r.score).padStart(9)}  ` +
              `(built ${M(r.made)}, ${B.ago(r.hoursAgo)})`);
}
assert.equal(board[0].name, 'Ravensworth & Co',
  'one brilliant game must beat a day of grinding — otherwise the board ranks free time');
console.log('the one good game wins, which is the point');

/* the grinder's own total would have been the bigger number, had we added it up */
const wouldHaveBeen = grinder.reduce((a, r) =>
  a + (r.value - START) * B.decayFactor((Date.parse(now) - Date.parse(r.created_at)) / 3600000), 0);
console.log(`  adding the grinder's games up would have given ${M(wouldHaveBeen)} — ` +
            `${(wouldHaveBeen / board[0].score).toFixed(1)}x the winner`);
assert(wouldHaveBeen > board[0].score * 2,
  'the measurement only means something if the totalling rule really would have won');

/* ------------------------------------------------- yesterday does not hold */
const stale = B.build([
  result('Yesterday & Co', START + 900000, 26),
  result('Today Ltd', START + 90000, 0.5),
], { now, start: START });
console.log('\nA $900,000 company a day ago against a $90,000 one half an hour ago:');
stale.forEach((r) => console.log(`  ${r.rank}. ${r.name.padEnd(16)} ${M(r.score).padStart(9)}  ${B.ago(r.hoursAgo)}`));
assert.equal(stale[0].name, 'Today Ltd', 'a day-old result must not hold the top');

/* --------------------------------------------------------- losses score nil */
const losers = B.build([
  result('Sank Without Trace', START - 200000, 1),
  result('Broke Even Ltd', START, 1),
  result('Made A Bit', START + 40000, 1),
], { now, start: START });
console.log('\nCompanies that finished at or below what they started with:');
console.log('  on the board:', losers.map((r) => r.name).join(', ') || 'none');
assert.equal(losers.length, 1, 'only the one that made money should be listed');
assert.equal(losers[0].name, 'Made A Bit');
console.log('  a bad afternoon scores nothing, not a negative — it does not push you below');
console.log('  somebody who has never played');

/* ------------------------------------------------------------ the shape */
const many = [];
for (let i = 0; i < 60; i++) many.push(result(`Company ${i}`, START + 50000 + i * 5000, 2));
const capped = B.build(many, { now, start: START });
console.log(`\n60 companies in contention, board shows ${capped.length}`);
assert.equal(capped.length, B.TOP, `the board should show ${B.TOP}`);
assert.equal(capped[0].name, 'Company 59', 'sorted by what it is worth now');

/* an unnamed player is not ranked, the same as with the rating */
const anon = B.build([{ company_id: null, name: 'Passing Stranger',
                        value: START + 500000, created_at: hoursAgo(0.2) }],
                     { now, start: START });
assert.equal(anon.length, 0, 'a player without a purchased name is not on the board');
console.log('a player without a purchased name is not ranked:', anon.length === 0);

console.log('\nboard OK');
