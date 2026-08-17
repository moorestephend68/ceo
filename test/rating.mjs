/* Can the leaderboard be farmed?

   That is the only question that matters about a rating system, and it has three
   parts: does a private game count (it must not), is beating weak bots worth
   anything (it must not be), and can one game be scored twice (it must not be).

   The bot ratings are the measured ones from §20 — Premium won 33% of 200
   five-company games, Marketer 9.5% — so "beating the Marketer is worth nothing"
   is a consequence of the measurements rather than an assertion. */

import assert from 'node:assert';
import { memoryDb } from '../lib/db.mjs';
import * as A from '../lib/accounts.mjs';
import * as R from '../lib/rating.mjs';
import * as P from '../lib/public.mjs';
import * as G from '../lib/game.mjs';

const db = memoryDb();
const now = '2026-09-01T09:00:00Z';

/* two accounts with purchased names, one player without */
async function account(id, name) {
  await db.ensureProfile(id, `${id}@example.com`);
  const held = await A.claimName(db, id, name, now);
  await A.confirmPurchase(db, { owner: id, companyId: held.id, eventId: `evt_${id}` });
  return held.id;
}
const alice = await account('alice', 'Ravensworth');
const bob = await account('bob', 'Sableworth Ltd');

/* ----------------------------------------------------- the maths in isolation */
console.log('What a win is worth, by who you beat:');
for (const [label, opponents] of [
  ['four weak bots      ', ['marketer', 'operator', 'marketer', 'operator']],
  ['four strong bots    ', ['premium', 'discounter', 'premium', 'discounter']],
  ['four 1500 humans    ', [null, null, null, null]],
  ['four 1800 humans    ', ['strong', 'strong', 'strong', 'strong']],
]) {
  const entrants = [{ key: 'me', rating: 1500, games: 40, place: 1, rated: true }].concat(
    opponents.map((o, i) => ({
      key: `o${i}`, place: i + 2, rated: false,
      rating: o === null ? 1500 : o === 'strong' ? 1800 : R.ratingOfBot(o),
    })));
  const [me] = R.updateRatings(entrants);
  console.log(`  winning against ${label} ${me.delta >= 0 ? '+' : ''}${me.delta}`);
}

const weak = R.updateRatings([{ key: 'me', rating: 1500, games: 40, place: 1, rated: true }]
  .concat(['marketer', 'operator', 'marketer', 'operator'].map((o, i) =>
    ({ key: `o${i}`, rating: R.ratingOfBot(o), place: i + 2, rated: false }))))[0];
const strong = R.updateRatings([{ key: 'me', rating: 1500, games: 40, place: 1, rated: true }]
  .concat([1800, 1800, 1800, 1800].map((r, i) =>
    ({ key: `o${i}`, rating: r, place: i + 2, rated: false }))))[0];
assert(strong.delta > weak.delta * 2, 'beating strong opposition must be worth much more');
console.log(`\n  beating strong players is worth ${(strong.delta / Math.max(1, weak.delta)).toFixed(1)}x beating weak bots`);

/* a highly rated player gains almost nothing from farming weak bots */
const farmer = R.updateRatings([{ key: 'me', rating: 1800, games: 60, place: 1, rated: true }]
  .concat(['marketer', 'operator', 'marketer', 'operator'].map((o, i) =>
    ({ key: `o${i}`, rating: R.ratingOfBot(o), place: i + 2, rated: false }))))[0];
console.log(`  a 1800-rated player beating four weak bots: ${farmer.delta >= 0 ? '+' : ''}${farmer.delta}`);
assert(farmer.delta <= 2, `farming bots gained ${farmer.delta}; it should be ~0`);

/* and losing to them costs plenty */
const flop = R.updateRatings([{ key: 'me', rating: 1800, games: 60, place: 5, rated: true }]
  .concat(['marketer', 'operator', 'marketer', 'operator'].map((o, i) =>
    ({ key: `o${i}`, rating: R.ratingOfBot(o), place: i + 1, rated: false }))))[0];
console.log(`  ...and coming last against them: ${flop.delta}`);
assert(flop.delta < -20, 'losing to weak bots must hurt');

/* ------------------------------------------------- scoring a whole game */
function playOut(game) {
  while (game.status === 'playing') {
    G.resolveRound(game, new Date(Date.parse(game.deadline) + 1000).toISOString());
  }
  return game;
}

console.log('\nA real public game, played to the end:');
const joinA = await P.joinPublic(db, { name: 'Ravensworth', companyId: alice, now });
await db.putGame(joinA.game);
const joinB = await P.joinPublic(db, { name: 'Sableworth Ltd', companyId: bob, now });
await db.putGame(joinB.game);
const joinC = await P.joinPublic(db, { name: 'Passing Stranger', companyId: null, now });
let game = joinC.game;
console.log(`  ${game.seats.length} humans at the table, ${game.config.seats - game.seats.length} seats left`);
assert.equal(game.code, joinA.game.code, 'all three should land at the same table');

P.startPublic(game, now);
console.log(`  started; bots filled ${game.seats.filter((s) => s.isBot).length} seats`);
playOut(game);
await db.putGame(game);

const scored = await P.scoreGame(db, game);
console.log('  places:', scored.places.map((p) => `${p.place}. ${p.name}`).join('  '));
console.log('  rating changes:', scored.changes.map((c) => `${c.name} ${c.delta >= 0 ? '+' : ''}${c.delta} -> ${c.rating}`).join(' · '));
assert(scored.scored);
/* only the two purchased companies move */
assert.equal(scored.changes.length, 2, 'only companies with a purchased name are rated');
assert(!scored.changes.some((c) => c.name === 'Passing Stranger'), 'an unnamed player must not be rated');

/* ------------------------------------------------------ scoring is once only */
const again = await P.scoreGame(db, game);
console.log('\n  scoring the same game again:', JSON.stringify(again));
assert(again.skipped, 'a game must not be scored twice');
const fresh = JSON.parse(JSON.stringify(game));
delete fresh.scored;                       // pretend the flag was lost
const third = await P.scoreGame(db, fresh);
console.log('  and again with the flag cleared:', JSON.stringify(third));
assert(third.skipped, 'the database must refuse a second scoring even without the flag');

const ratingsNow = await db.ratingsFor([alice, bob]);
console.log('  games recorded per company:', Object.values(ratingsNow).map((r) => r.games).join(', '));
assert(Object.values(ratingsNow).every((r) => r.games === 1), 'one game played, one game counted');

/* ------------------------------------------------------- private never counts */
console.log('\nA private game, played to the end:');
const { game: priv } = G.createGame({ hostName: 'Ravensworth', seats: 3, rounds: 8,
                                      cadence: '5m', preset: 'forgiving', now });
G.startGame(priv, priv.hostToken, now);
priv.seats[0].companyId = alice;
playOut(priv);
const privScore = await P.scoreGame(db, priv);
console.log('  scoring it:', JSON.stringify(privScore));
assert(privScore.skipped, 'a private game must never be rated');
const after = await db.ratingsFor([alice]);
assert.equal(after[alice].games, 1, 'a private game must not add to the record');
console.log('  Ravensworth still shows', after[alice].games, 'rated game');

/* --------------------------------------------------------------- the board */
const board = await db.leaderboard();
console.log('\nleaderboard:');
board.forEach((r, i) => console.log(`  ${i + 1}. ${r.name.padEnd(18)} ${r.rating}  ` +
  `${r.games} game${r.games === 1 ? '' : 's'}  ${R.band(r.rating)}`));
assert.equal(board.length, 2, 'only rated companies appear');
assert(board.every((r) => r.name !== 'Passing Stranger'));

console.log('\nrating OK');
