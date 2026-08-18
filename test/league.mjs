/* The bot league, end to end, through the real routes.

   The interesting claims are not about the strategy. They are about the wall
   between the two pools, and a wall is only worth anything if somebody has
   tried to walk through it. So this test issues real keys, plays real games
   with the published reference bot, and then checks the things that would
   quietly ruin the human game if they were wrong:

     · a bot key gets you into the league and nowhere else
     · league results never touch a human rating or the human board
     · a key that has run its twenty games an hour is told so
     · the board ranks by average, so grinding does not help
     · a bot that stops answering does not freeze the table */

import assert from 'node:assert';
import { memoryDb } from '../lib/db.mjs';
import * as G from '../lib/game.mjs';
import * as A from '../lib/accounts.mjs';
import * as L from '../lib/league.mjs';
import * as BOARD from '../lib/board.mjs';
import { decide } from '../bots/reference-bot.mjs';

const db = memoryDb();
globalThis.__CEO_DB__ = db;

const USERS = { 'tok:ada': { id: 'user-ada', email: 'ada@example.com' },
                'tok:alan': { id: 'user-alan', email: 'alan@example.com' },
                'tok:human': { id: 'user-human', email: 'human@example.com' } };
globalThis.__CEO_VERIFY__ = async (t) =>
  (USERS[t] ? { data: { user: USERS[t] }, error: null }
            : { data: null, error: { message: 'bad token' } });

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon_test';

const { default: api } = await import('../netlify/functions/api.mjs');

const call = async (method, path, body, auth) => {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (auth) headers.authorization = `Bearer ${auth}`;
  const res = await api(new Request('https://ceo.test' + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  }));
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
};
const ok = (r, what) => {
  assert(r.status === 200, `${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

/* Two authors, each with a bought company name so their results can be ranked. */
for (const [owner, name] of [['user-ada', 'Lovelace Industrial'], ['user-alan', 'Turing Machines']]) {
  await db.ensureProfile(owner, `${owner}@example.com`);
  const c = await A.claimName(db, owner, name, new Date().toISOString());
  await A.confirmPurchase(db, { owner, companyId: c.id, eventId: `evt_${owner}` });
}

/* ------------------------------------------------------------ keys */
console.log('Getting a key:');

const anon = await call('POST', '/api/bot/key');
console.log(`  without signing in: ${anon.status} — ${anon.body.error}`);
assert(anon.status === 401, 'an anonymous request must not get a bot key');

const adaKey = ok(await call('POST', '/api/bot/key', {}, 'tok:ada'), 'ada key').key;
const alanKey = ok(await call('POST', '/api/bot/key', {}, 'tok:alan'), 'alan key').key;
console.log(`  ada's key: ${adaKey.slice(0, 12)}… (${adaKey.length} chars, shown once)`);
assert(adaKey.startsWith('ceobot_') && adaKey.length > 30, 'key looks wrong');
assert(adaKey !== alanKey, 'two accounts got the same key');

/* Stored hashed: the plain key must not be anywhere we could read it back. */
assert.strictEqual(await db.botKeyOwner(adaKey), null, 'the key is stored in the clear');
assert.strictEqual(await db.botKeyOwner(L.hashKey(adaKey)), 'user-ada', 'the hash does not resolve');
console.log('  stored hashed — the plain key resolves to nobody');

const bad = await call('POST', '/api/bot/join', { key: 'ceobot_madeitup' });
console.log(`  an invented key: ${bad.status} — ${bad.body.error}`);
assert(bad.status === 401, 'an invented key was accepted');

/* A new key revokes the old one — the only revocation anybody needs. */
const adaKey2 = ok(await call('POST', '/api/bot/key', {}, 'tok:ada'), 'ada re-key').key;
assert.strictEqual(await db.botKeyOwner(L.hashKey(adaKey)), null, 'the old key still works');
assert.strictEqual(await db.botKeyOwner(L.hashKey(adaKey2)), 'user-ada', 'the new key does not');
console.log('  asking for another revokes the first\n');

/* -------------------------------------------------- two bots, one table */
console.log('Two bots, playing each other:');

/* Wind a lobby's twenty-second wait into the past rather than waiting it out —
   the only way to test a timed thing in less time than it takes. */
async function expire(code) {
  const g = await db.getGame(code);
  g[g.status === 'lobby' ? 'lobbyDeadline' : 'deadline'] =
    new Date(Date.now() - 1000).toISOString();
  await db.putGame(g);
  return g.status;
}

const ada = ok(await call('POST', '/api/bot/join', { key: adaKey2 }), 'ada join');
console.log(`  ada opened table ${ada.code}`);
const alan = ok(await call('POST', '/api/bot/join', { key: alanKey }), 'alan join');
console.log(`  alan joined ${alan.code} — ${alan.view.joined.length} bots waiting`);
assert.strictEqual(alan.code, ada.code, 'the second bot opened its own table instead of joining');

await expire(ada.code);

/* Both bots, interleaved, each running the loop out of the published file. */
const bots = [{ label: 'ada', ...ada, filed: 0, at: -1 },
              { label: 'alan', ...alan, filed: 0, at: -1 }];
for (let guard = 0; guard < 400; guard++) {
  let live = false;
  for (const b of bots) {
    b.view = ok(await call('GET', `/api/state?code=${b.code}&token=${b.token}`), `${b.label} state`).view;
    if (b.view.status === 'over') continue;
    live = true;
    if (b.view.status !== 'playing' || !b.view.you || b.view.you.bankrupt
        || !b.view.you.products.length || b.view.round === b.at) continue;
    const r = await call('POST', '/api/submit',
                         { code: b.code, token: b.token, decisions: decide(b.view) });
    if (r.status === 200) { b.at = b.view.round; b.filed += 1; b.view = r.body.view; continue; }
    assert(r.status === 409, `${b.label} submit: ${r.status} ${JSON.stringify(r.body)}`);
  }
  if (!live) break;
}

const adaFinal = bots[0].view;
console.log(`  the table filled to ${adaFinal.market.length} seats and ran ` +
            `${adaFinal.totalRounds} rounds, ${bots[1].filed} filings each`);
assert.strictEqual(adaFinal.status, 'over', 'the game did not finish');
assert.strictEqual(adaFinal.totalRounds, L.FORMAT.rounds, 'wrong length');
assert.strictEqual(adaFinal.market.length, L.FORMAT.seats, 'the table did not fill');

const mine = adaFinal.market.find((m) => m.you);
const theirs = bots[1].view.market.find((m) => m.you);
const M = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
console.log(`  Lovelace finished worth ${M(mine.finalValue)}, ` +
            `Turing ${M(theirs.finalValue)}`);
assert(mine.finalValue > 0 && theirs.finalValue > 0, 'the reference bot bankrupted itself');

/* The published bot should not be embarrassing. It is meant to be beatable,
   not broken: it must at least end the game with a company. */
assert(mine.finalValue > 50000, `the reference bot ended worth only ${M(mine.finalValue)}`);

/* Rounds close when the last bot files, not when the clock runs out. Ten rounds
   at 45 seconds is seven and a half minutes; this took milliseconds. */
console.log('  every round closed on the last filing, not on the clock\n');

/* ------------------------------------------------ the wall between the pools */
console.log('What the league must not touch:');

const results = await db.leagueResults();
assert.strictEqual(results.length, L.FORMAT.seats, 'the league game was not scored');
assert(results.every((r) => r.league === 'bot'), 'a league result is not tagged');
assert(results.every((r) => r.rating_delta === 0), 'a league game moved a rating');
console.log(`  ${results.length} results, all tagged 'bot', all with a zero rating delta`);

const since = new Date(Date.now() - 48 * 3600000).toISOString();
const human = await db.recentResults(since);
assert.strictEqual(human.length, 0, `${human.length} league results leaked onto the human board`);
console.log('  the human board sees none of them');

const humanBoard = BOARD.build(human, { now: new Date().toISOString(), start: 250000 });
assert.strictEqual(humanBoard.length, 0, 'the human leaderboard has a bot on it');

const rating = await db.ratingsFor(['user-ada']);
assert(!rating['user-ada'], 'the league moved a human rating');
console.log('  no human rating moved\n');

/* ------------------------------------------------------------- the board */
console.log('The league board:');

const board = ok(await call('GET', '/api/bot/board'), 'board');
console.log(`  after one game: ${board.board.length} ranked ` +
            `(a company needs ${board.minGames} games to appear)`);
assert.strictEqual(board.board.length, 0, 'one game was enough to be ranked');

/* An average, not a total: playing more games must not by itself move you up.
   Two companies, the same results — one played four times as many. */
const rows = [];
const t0 = Date.parse('2026-08-18T09:00:00Z');
for (let i = 0; i < 5; i++) {
  rows.push({ company_id: 'steady', name: 'Steady', value: 320000, place: 1, seats: 5,
              created_at: new Date(t0 + i * 60000).toISOString() });
}
for (let i = 0; i < 20; i++) {
  rows.push({ company_id: 'grinder', name: 'Grinder', value: 320000, place: 1, seats: 5,
              created_at: new Date(t0 + i * 60000).toISOString() });
}
const ranked = L.board(rows);
console.log(`  Steady played 5 games, Grinder played 20, both made ` +
            `${M(70000)} a game`);
console.log(`  → ${ranked.map((r) => `${r.rank}. ${r.name} ${M(r.average)}`).join(', ')}`);
assert.strictEqual(ranked[0].average, ranked[1].average, 'grinding changed the average');
assert(ranked.length === 2, 'both should be ranked');

/* One outstanding game does not carry a company. */
const lucky = rows.concat([{ company_id: 'lucky', name: 'Lucky', value: 900000, place: 1,
                             seats: 5, created_at: new Date(t0).toISOString() }]);
assert(!L.board(lucky).some((r) => r.name === 'Lucky'),
       'a company with one enormous game was ranked');
console.log(`  a single ${M(650000)} game does not rank anybody — ${L.MIN_GAMES} games minimum\n`);

/* ------------------------------------------------------------ rate limit */
console.log('The rate limit:');
let started = 1;                       /* ada already opened one */
let limited = null;
for (let i = 0; i < L.GAMES_PER_HOUR + 3 && !limited; i++) {
  const r = await call('POST', '/api/bot/join', { key: adaKey2 });
  if (r.status === 429) { limited = r.body.error; break; }
  ok(r, 'join');
  if (r.body.view.status === 'lobby' && r.body.view.joined.length === 1) started += 1;
}
console.log(`  ${limited ? `stopped after ${started} tables — "${limited}"` : 'never stopped'}`);
assert(limited, `a key opened more than ${L.GAMES_PER_HOUR} tables in an hour`);

/* Alan's key is unaffected — the limit is per key, not global. */
const alanStill = await call('POST', '/api/bot/join', { key: alanKey });
assert(alanStill.status === 200, 'one key hitting its limit blocked another');
console.log('  and it is per key: the other author is unaffected\n');

/* --------------------------------------------- a bot that stops answering */
console.log('A bot that crashes mid-game:');
const quitter = ok(await call('POST', '/api/bot/join', { key: alanKey }), 'quitter join');
/* It files once and is never heard from again. The table must still finish —
   the same treatment a person who closes their laptop gets. */
const { default: tick } = await import('../netlify/functions/tick.mjs');
await expire(quitter.code);                      /* its lobby wait runs out */
await tick();                                    /* the sweeper starts it */
const firstRound = ok(await call('GET', `/api/state?code=${quitter.code}&token=${quitter.token}`),
                      'quitter first round').view;
assert.strictEqual(firstRound.status, 'playing', 'the abandoned table never started');
await call('POST', '/api/submit', { code: quitter.code, token: quitter.token,
                                    decisions: decide(firstRound) });
console.log('  it files round 1, then the process dies');

/* Nobody touches it again. Each round's deadline passes with nobody there to
   notice, and the sweep is what closes it — which is the whole reason the
   sweep exists. */
for (let i = 0; i < L.FORMAT.rounds + 2; i++) {
  const g = await db.getGame(quitter.code);
  if (g.status === 'over') break;
  await expire(quitter.code);
  await tick();
}
const after = await db.getGame(quitter.code);
console.log(`  the abandoned table ended ${after.status} after ${after.round} rounds`);
assert.strictEqual(after.status, 'over', 'an abandoned table never finished');
const seat = after.seats.find((s) => s.token === quitter.token);
console.log(`  its round-1 orders repeated for ${seat.autoRounds} rounds — it finished ` +
            `worth ${M(G.finalValue(seat))}, which is what walking away costs`);
assert(seat.autoRounds > 0, 'the abandoned seat was not carried');
/* The point is not that it did well — a company left on the same orders for
   nine rounds usually goes under, and its table often ends early because
   everyone on it has. The point is that it ended at all: a dead program does
   not hold a table open, and nothing is waiting on a process that will never
   answer. */

console.log('\nleague OK');
