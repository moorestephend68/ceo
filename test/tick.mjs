/* THE BACKSTOP SWEEP, WITH TWO GAMES ON THE RAILS.

   This is the regression test for a live bug, and it is worth saying plainly
   what it was. netlify/functions/tick.mjs was written when there was one game
   and called CEO's startPublic on every due lobby. When Cargo Run shipped, a
   cargo table whose 90-second wait ran out was therefore started by CEO's
   code: its four empty seats were filled with COMPANIES — seats carrying a
   balance sheet, no ship, and no declared route. Every request afterwards
   settled the table with the cargo engine and died on

       TypeError: Cannot read properties of undefined (reading 'eye')

   which a captain saw as an error card where the game should have been.

   The API's settle() had gone through kindOf() from the start. The sweep had
   not. So the test that matters is not "does the film play" — it is "does
   every door into a game know which game it is". */
import * as G from '../lib/game.mjs';
import * as K from '../lib/cargo.mjs';
import * as P from '../lib/public.mjs';
import { kindOf } from '../lib/kinds.mjs';
import { memoryDb } from '../lib/db.mjs';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) bad++; };
const t0 = Date.parse('2026-09-20T10:00:00Z');
const at = (ms) => new Date(t0 + ms).toISOString();

/* ---------------------------------------------------- the doors are guarded */
{
  const { game } = K.createGame({ seats: 5, rounds: 8, cadence: '5m',
    hostName: 'Salty Dogs & Co', seed: 1, now: at(0) });
  let refused = false;
  try { G.startGame(game, game.hostToken, at(0)); } catch { refused = true; }
  ok(refused, "CEO's startGame refuses a cargo table rather than filling it with companies");
  refused = false;
  try { P.startPublic(game, at(0)); } catch { refused = true; }
  ok(refused, "and so does the public-table starter that calls it");

  const ceo = G.createGame({ hostName: 'Ravensworth & Co', seats: 4, rounds: 10,
    preset: 'standard', seed: 2, cadence: '5m', now: at(0) }).game;
  refused = false;
  try { K.startGame(ceo, ceo.hostToken, at(0)); } catch { refused = true; }
  ok(refused, 'and the cargo starter refuses a CEO game, which is the same mistake backwards');
}

/* ------------------------------------------------- the sweep, as deployed */
{
  const db = memoryDb();
  globalThis.__CEO_DB__ = db;
  const tick = (await import('../netlify/functions/tick.mjs')).default;

  const cargo = K.createGame({ seats: 5, rounds: 8, cadence: '5m',
    hostName: 'Salty Dogs & Co', isPublic: true, seed: 3, now: at(0) }).game;
  cargo.isPublic = true;
  cargo.lobbyDeadline = at(90000);
  await db.putGame(cargo, null);

  const ceo = G.createGame({ hostName: 'Ravensworth & Co', seats: 4, rounds: 10,
    preset: 'standard', seed: 4, cadence: '5m', now: at(0) }).game;
  ceo.isPublic = true;
  ceo.lobbyDeadline = at(90000);
  await db.putGame(ceo, null);

  /* the sweep runs on the real clock, so the deadlines are put in the past */
  const past = new Date(Date.now() - 600000).toISOString();
  for (const code of [cargo.code, ceo.code]) {
    const g = await db.getGame(code);
    g.lobbyDeadline = past;
    await db.putGame(g, null);
  }
  await tick();

  const c2 = await db.getGame(cargo.code);
  ok(c2.status === 'playing', 'the sweep starts a cargo table whose wait has run out');
  ok(c2.seats.length === 5 && c2.seats.every((s) => Array.isArray(s.parts)),
    'and every seat it filled is a SHIP, not a company');
  ok(c2.seats.every((s) => s.declared === null), 'each one ready to declare a route');
  ok(c2.stage === 'declare' && !!c2.block, 'with the round actually opened');

  const e2 = await db.getGame(ceo.code);
  ok(e2.status === 'playing' && e2.seats.every((s) => s.firm),
    'and a CEO table swept in the same pass still gets companies');

  /* the cargo table now has to be playable, which is what the bug destroyed */
  let threw = null;
  try {
    const now = new Date(Date.now() + 3600000).toISOString();
    kindOf(c2).resolveWhileDue(c2, now);
  } catch (e) { threw = e.message; }
  ok(!threw, 'and a round of it resolves' + (threw ? ' — ' + threw : ''));
}

/* ------------------------------------------- and the tables already broken */
{
  /* Exactly the state the live bug left behind: a cargo game whose seats were
     filled by CEO's startGame before the guard existed. */
  const { game } = K.createGame({ seats: 5, rounds: 8, cadence: '5m',
    hostName: 'Salty Dogs & Co', isPublic: true, seed: 5, now: at(0) });
  game.isPublic = true;
  const human = game.seats[0];
  const ceo = G.createGame({ hostName: 'filler', seats: 5, rounds: 10,
    preset: 'standard', seed: 6, cadence: '5m', now: at(0) }).game;
  G.startGame(ceo, ceo.hostToken, at(0));
  game.seats = [human, ...ceo.seats.slice(0, 4)];   /* four companies at a spaceport */
  game.status = 'playing';
  game.round = 1;

  let threw = null;
  try { K.resolveStage(game, at(400000)); } catch (e) { threw = e.message; }
  ok(/eye|undefined/.test(threw || ''), 'the broken table reproduces the live error: ' + threw);

  const fixed = kindOf(game).resolveWhileDue(game, at(400000));
  ok(fixed, 'the next request puts it right instead of failing again');
  ok(game.seats.length === 5 && game.seats.every((s) => Array.isArray(s.parts)),
    'the companies are gone and five ships are at the table');
  ok(game.seats[0] === human && game.seats[0].token === human.token,
    "and the captain's own seat is untouched — a repair may not take somebody's place");
  ok(!!game.block && !!game.prices, 'with a proper round under it');

  let again = null;
  try { kindOf(game).resolveWhileDue(game, at(4000000)); } catch (e) { again = e.message; }
  ok(!again, 'and it keeps playing' + (again ? ' — ' + again : ''));
}

console.log(bad ? `\n${bad} FAILED` : '\ntick OK');
process.exitCode = bad ? 1 : 0;
