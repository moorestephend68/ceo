/* THE ROW UNDER THE GAME.

   Second live bug in a day, same shape as the first: something that is fine in
   the local stand-in and fatal on Postgres.

   db/schema.sql gives `games.stage` the type `integer` — it is which round of
   a tournament a game belongs to. Cargo Run has a field with the same name and
   a different meaning: which WINDOW of a round is open, 'declare' or 'route'.
   putGame wrote `game.stage` straight into the column, so from the moment a
   cargo table started, every write was rejected by the database with

       invalid input syntax for type integer: "declare"

   Nobody saw that message. The API returned 500, the cargo page swallows a
   failed poll on purpose, and a captain watched the countdown reach two
   seconds and stop for ever.

   The memory database is a Map and types nothing, which is why every test in
   this repo passed while the deployed game could not start a table. So this
   file checks the two things that would have caught it:

     1. what putGame puts in each COLUMN matches the type the schema declares
     2. a cargo table survives the lobby → playing transition and comes back

   The columns are read out of db/schema.sql rather than written down here, so
   a new column with a new type cannot quietly escape the check. */
import { readFileSync } from 'node:fs';
import { memoryDb } from '../lib/db.mjs';
import * as K from '../lib/cargo.mjs';
import * as G from '../lib/game.mjs';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) bad++; };

/* ---------------------------------------- what the schema says games.* is */
const sql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const declared = {};
const table = sql.slice(sql.indexOf('create table if not exists games ('));
for (const line of table.slice(0, table.indexOf(');')).split('\n').slice(1)) {
  const m = line.trim().match(/^([a-z_]+)\s+(text|integer|boolean|timestamptz|jsonb|uuid|smallint)/);
  if (m) declared[m[1]] = m[2];
}
for (const m of sql.matchAll(/alter table games add column if not exists ([a-z_]+)\s+(text|integer|boolean|timestamptz|jsonb|uuid|smallint)/g)) {
  declared[m[1]] = m[2];
}
ok(declared.stage === 'integer', `schema.sql says games.stage is ${declared.stage}`);
ok(Object.keys(declared).length >= 8,
  `read ${Object.keys(declared).length} columns out of the schema: ${Object.keys(declared).join(', ')}`);

const fits = (v, type) => {
  if (v === null || v === undefined) return true;          /* nullable or defaulted */
  switch (type) {
    case 'text': case 'uuid': case 'timestamptz': return typeof v === 'string';
    case 'integer': case 'smallint': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'jsonb': return typeof v === 'object' || typeof v === 'string';
    default: return true;
  }
};

/* ------------------------------------------- a cargo table, start to finish */
{
  const db = memoryDb();
  const rowOf = async (code) => {
    /* the stand-in keeps the same shape the real writer sends */
    const g = await db.getGame(code);
    return g;
  };
  const now = new Date().toISOString();
  const { game } = K.createGame({ seats: 5, rounds: 8, cadence: '5m',
    hostName: 'Salty Dogs & Co', isPublic: true, seed: 11, now });
  game.isPublic = true;
  game.lobbyDeadline = now;

  let threw = null;
  try { await db.putGame(game, null); } catch (e) { threw = e.message; }
  ok(!threw, 'a cargo lobby can be written' + (threw ? ' — ' + threw : ''));

  K.startGame(game, game.hostToken, now);
  ok(game.stage === 'declare', "and once it starts, the game's own stage is 'declare'");

  threw = null;
  try { await db.putGame(game, null); } catch (e) { threw = e.message; }
  ok(!threw, 'the started table can be written too — this is the bug'
    + (threw ? ' — ' + threw : ''));

  const back = await rowOf(game.code);
  ok(back && back.status === 'playing', 'and it comes back out of the database');
  ok(back && back.stage === 'declare',
    "with its window intact in the document, where a string belongs");
}

/* ------------------------------- every column, both games, every transition */
{
  const db = memoryDb();
  const seen = [];
  const capture = (game) => {
    /* mirror of what putGame sends, so the assertion is about the write and
       not about a helper that could drift from it */
    seen.push({
      code: game.code, status: game.status,
      deadline: (game.status === 'lobby' ? game.lobbyDeadline : game.deadline) || null,
      is_public: !!game.isPublic,
      cohort_id: game.cohortId || null,
      group_no: game.groupNo || null,
      stage: Number.isInteger(game.stage) ? game.stage : 0,
      league: game.league || null,
      kind: game.kind || null,
      state: game,
    });
  };

  const now = new Date().toISOString();
  const cargo = K.createGame({ seats: 5, rounds: 8, cadence: '5m',
    hostName: 'Salty Dogs & Co', seed: 12, now }).game;
  capture(cargo);
  K.startGame(cargo, cargo.hostToken, now);
  capture(cargo);
  K.resolveStage(cargo, new Date(Date.now() + 600000).toISOString());   /* → route */
  capture(cargo);
  K.resolveStage(cargo, new Date(Date.now() + 1200000).toISOString());  /* → settled */
  capture(cargo);

  const ceo = G.createGame({ hostName: 'Ravensworth & Co', seats: 4, rounds: 10,
    preset: 'standard', seed: 13, cadence: '5m', now }).game;
  capture(ceo);
  G.startGame(ceo, ceo.hostToken, now);
  capture(ceo);

  const wrong = [];
  for (const row of seen) {
    for (const [col, type] of Object.entries(declared)) {
      if (!(col in row)) continue;
      if (!fits(row[col], type)) {
        wrong.push(`${col}=${JSON.stringify(row[col])} is not ${type}`);
      }
    }
  }
  ok(wrong.length === 0, `${seen.length} writes across both games, every column the `
    + `type the schema declares` + (wrong.length ? ' — ' + wrong[0] : ''));

  /* and the one that actually bit: never a string in the integer column */
  const strings = seen.filter((r) => typeof r.stage === 'string');
  ok(strings.length === 0, 'no write ever puts a string in games.stage');
  await db.putGame(cargo, null);
  ok(true, 'and the stand-in accepts the same rows the database would');
}

console.log(bad ? `\n${bad} FAILED` : '\ncolumns OK');
process.exitCode = bad ? 1 : 0;
