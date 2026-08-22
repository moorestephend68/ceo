/* The bot league.

   Somebody was always going to automate this. The client is HTTP, the state is
   JSON, and any player can write a program that reads one and posts the other.
   Measured, an evening's optimiser wins 35% of ranked tables against a thoughtful
   human's 30% — a real edge, and one that would quietly sour the human board.

   The response is not to fight it. It is to give it somewhere to go, and to make
   that somewhere better than the thing it was going to spoil: a pool where
   automation is the point, bots play other bots, and the board says whose program
   is best rather than whose was running most recently.

   Three decisions shape it.

   **We do not run anybody's code.** A bot lives on its author's machine and talks
   to the ordinary API with a key. Accepting uploaded programs would mean
   sandboxing them, which is a different and much larger product, and a security
   problem nobody needs on day one.

   **Rounds close when everyone has filed.** Bots do not need five minutes to
   think, so a league game finishes in seconds. There is still a deadline, short,
   because one stalled program must not freeze a table for everybody else.

   **The board is an average, not a total or a best.** A total ranks whoever ran
   their bot the most; a best ranks whoever got the luckiest market. An average
   over recent games ranks the program, which is the only thing worth ranking. */

import * as G from './game.mjs';
import { UniqueViolation } from './db.mjs';
import { randomBytes, createHash } from 'node:crypto';

export const FORMAT = {
  seats: 5,
  rounds: 10,
  preset: 'standard',
  /* The league is always the full game — a documented API against a smaller rule
     set would be a second protocol to keep in step, and the whole point of
     writing a bot is having everything to work with. */
  level: 2,
  /* Long enough that a bot on a slow connection is not cut off, short enough that
     one that has crashed does not hold a table for a minute. Rounds normally end
     well before this, the moment the last program files. */
  roundSeconds: 45,
  lobbySeconds: 20,
};

export const START_CASH = G.PRESETS[FORMAT.preset].cash;

/* How many games one key may start in an hour.

   A league game with no humans in it resolves as fast as the programs can post,
   so without a limit a single author could run thousands and the bill would be
   theirs to enjoy and ours to pay. Twenty an hour is far more than anybody needs
   to tune a bot and far less than anybody could use to hurt us. */
export const GAMES_PER_HOUR = 20;

/* How many recent games the ranking looks at, and how few is too few to rank. */
export const WINDOW = 20;
export const MIN_GAMES = 5;

export const newKey = () => 'ceobot_' + randomBytes(24).toString('base64url');

/* ------------------------------------------------------------------ keys */

/* One key per account. Shown once on creation and stored hashed, the way a key
   that can act on your behalf should be — if it leaks we can revoke it, and
   nobody including us can read it back out of the database. */
export async function issueKey(db, owner) {
  const key = newKey();
  await db.putBotKey(owner, hashKey(key));
  return key;
}

export function hashKey(key) {
  /* Not a password: a long random string with no user-chosen entropy, so a plain
     digest is the right tool and a slow KDF would only cost the request. */
  return 'sha256:' + createHash('sha256').update(String(key)).digest('hex');
}

export async function whoseKey(db, key) {
  if (!key || !String(key).startsWith('ceobot_')) return null;
  return db.botKeyOwner(hashKey(key));
}

/* ------------------------------------------------------------- joining */

/* Seat a bot. Waiting bots are put together; a bot that finds nobody waiting
   plays the built-in archetypes, so a lone author can still tune against
   something rather than sitting in an empty room. */
export async function joinLeague(db, { owner, name, companyId, now }) {
  const at = now || new Date().toISOString();

  const open = await db.openLeagueGame();
  if (open && open.status === 'lobby'
      && open.seats.length < open.config.seats
      && !open.seats.some((s) => s.botOwner === owner)) {
    return { game: open, join: true };
  }

  const made = G.createGame({ ...FORMAT, hostName: name, now: at,
                              cadenceMinutes: Math.ceil(FORMAT.roundSeconds / 60) });
  const game = made.game;
  game.league = 'bot';
  game.config.cadenceMinutes = FORMAT.roundSeconds / 60;   // fractional minutes: seconds
  game.lobbyDeadline = new Date(Date.parse(at) + FORMAT.lobbySeconds * 1000).toISOString();
  game.seats[0].botOwner = owner;
  game.seats[0].companyId = companyId || null;
  return { game, token: made.token, created: true, seat: game.seats[0] };
}

/* ------------------------------------------------------------- scoring */

/* Money made above what every company starts with, averaged over recent games.

   Deliberately the same measure as the human board, so a number means the same
   thing in both places — and deliberately averaged rather than decayed, because a
   program can play all night and a decaying board would rank whoever did. */
export function board(rows, { window = WINDOW, minGames = MIN_GAMES, top = 50 } = {}) {
  const byCompany = new Map();
  for (const r of rows) {
    if (!r.company_id) continue;
    if (!byCompany.has(r.company_id)) byCompany.set(r.company_id, []);
    byCompany.get(r.company_id).push(r);
  }
  const out = [];
  for (const [companyId, all] of byCompany) {
    const recent = all
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, window);
    if (recent.length < minGames) continue;
    const made = recent.map((r) => Number(r.value) - START_CASH);
    out.push({
      companyId,
      name: recent[0].name,
      games: recent.length,
      totalGames: all.length,
      average: made.reduce((a, b) => a + b, 0) / made.length,
      best: Math.max(...made),
      wins: recent.filter((r) => r.place === 1).length,
    });
  }
  return out
    .sort((a, b) => b.average - a.average)
    .slice(0, top)
    .map((e, i) => ({
      rank: i + 1, name: e.name, games: e.games, totalGames: e.totalGames,
      average: Math.round(e.average), best: Math.round(e.best),
      winRate: e.games ? e.wins / e.games : 0,
    }));
}

export { UniqueViolation };
