/* Public games — the free, ranked tier.

   Everything here exists to make results comparable. A private game's host picks
   the seats, the length, the difficulty and the clock, so ranking private games
   would rank whoever configured the softest table. Public games have exactly one
   configuration and nobody can change it, which is what a rating needs to mean
   anything.

   The format is chosen for strangers rather than for friends. Five minutes a
   round and eight rounds is about forty-five minutes: long enough for the arc of
   a company to happen, short enough that somebody with no social obligation to
   the table will see it through. Friends will finish a two-hour game because
   they would be letting each other down; strangers simply close the tab. */

import * as G from './game.mjs';
import * as R from './rating.mjs';
import { UniqueViolation } from './db.mjs';
import { traitsOf } from './traits.mjs';

export const FORMAT = {
  seats: 5,
  /* Ten, not eight.
     Eight was chosen for wall-clock alone, and measuring what it produced showed
     it ended the game in the trough: a company at round 8 is still paying for the
     ramp, so the median finished worth $187,916 against a $250,000 start and only
     a quarter of players ever saw a profit. The winner of a ranked table was
     whoever lost least, which is a strange thing to be best at.
     Ten rounds moves the median to +$52,571 and puts 60% of players in profit,
     for ten more minutes. Twelve is better still and an hour is too long to ask
     of somebody with no social reason to see it out. */
  rounds: 10,
  cadence: '5m',
  preset: 'standard',
};

/* What a company started with, which is what "money made" is measured against.
   Public tables always run one preset, so this is a fact rather than a guess. */
export const START_CASH = G.PRESETS[FORMAT.preset].cash;

/* How long an opening table waits for other people before it starts with bots
   filling the rest. Nobody should sit staring at an empty lobby, and the hidden
   bots mean a single player still gets a real game. */
export const LOBBY_WAIT_SECONDS = 90;

export const describe = () =>
  `${FORMAT.seats} companies · ${FORMAT.rounds} rounds · a round every ` +
  `${G.CADENCES[FORMAT.cadence].label.toLowerCase()} · about ` +
  `${Math.round(FORMAT.rounds * G.CADENCES[FORMAT.cadence].minutes)} minutes`;

/* -------------------------------------------------------------- joining */

/* Find a table with room, or open one. Returns { game, token, created }. */
export async function joinPublic(db, { name, companyId, now, forceNew }) {
  const at = now || new Date().toISOString();
  /* forceNew is set when a table filled up underneath somebody mid-join. Rather
     than refusing them, open another — public tables are interchangeable. */
  let game = forceNew ? null : await db.openPublicGame();
  let created = false;

  if (game && game.seats.length >= game.config.seats) game = null;
  /* Two strangers can easily pick the same company name. Refusing the second one
     would be strange — public tables are interchangeable, so open another rather
     than making them think of a new name. */
  if (game && game.seats.some((s) => s.name.toLowerCase() === String(name).trim().toLowerCase())) {
    game = null;
  }

  if (!game) {
    const made = G.createGame({ ...FORMAT, hostName: name, now: at });
    game = made.game;
    game.isPublic = true;
    game.lobbyDeadline = new Date(Date.parse(at) + LOBBY_WAIT_SECONDS * 1000).toISOString();
    /* The first player through the door is not the host in any meaningful sense
       — a public table has no host, and nobody is given this token. */
    game.seats[0].companyId = companyId || null;
    created = true;
    return { game, token: made.token, created, seat: game.seats[0] };
  }

  const { token } = G.joinGame(game, name, at);
  const seat = game.seats[game.seats.length - 1];
  seat.companyId = companyId || null;
  return { game, token, created, seat };
}

/* A table starts when it fills, or when its wait runs out. Bots take whatever
   seats are still empty and nobody is told which. */
export function shouldStart(game, now) {
  if (!game || game.status !== 'lobby') return false;
  if (game.paused) return false;
  if (!game.lobbyDeadline) return false;        // a private lobby waits for its host
  if (game.seats.length >= game.config.seats) return true;
  return Date.parse(now || Date.now()) >= Date.parse(game.lobbyDeadline);
}

export function startPublic(game, now) {
  /* startGame checks the host token; a public table's token was never handed to
     anyone, so passing it here is the whole point rather than a workaround. */
  G.startGame(game, game.hostToken, now);
  game.lobbyDeadline = null;
  return game;
}

/* ------------------------------------------------------------- scoring */

/* Score a finished public game, once.

   Who is rated: seats that arrived with a purchased company. Everyone else —
   bots, and players without a company name — is opposition rather than a
   competitor. They still count as opponents, because beating them should be
   worth whatever beating them is worth, but they have no rating to move. */
export async function scoreGame(db, game) {
  const league = game && game.league === 'bot';
  if (!game || (!game.isPublic && !league) || game.status !== 'over') {
    return { skipped: 'not a finished public game' };
  }
  if (game.scored) return { skipped: 'already scored' };

  const rows = game.seats.map((s) => ({
    seat: s,
    name: s.name,
    companyId: s.isBot ? null : (s.companyId || null),
    isBot: !!s.isBot,
    botId: s.botId || null,
    value: G.finalValue(s),
    /* How they played, not merely what they made — computed now because the
       game document is about to stop existing and the result row is not. Only
       for a seat with a company behind it: there is nobody to describe
       otherwise, and an archetype's habits are a constant we already know. */
    traits: s.isBot || !s.companyId ? null : traitsOf(game, s),
  }));

  const placed = R.placings(rows);
  const rated = placed.filter((r) => r.companyId);
  const current = await db.ratingsFor(rated.map((r) => r.companyId));

  const entrants = placed.map((r) => ({
    key: r.companyId || r.name,
    rating: r.isBot ? R.ratingOfBot(r.botId)
      : (current[r.companyId] ? current[r.companyId].rating : R.START),
    games: current[r.companyId] ? current[r.companyId].games : 0,
    place: r.place,
    rated: !!r.companyId,
  }));

  const deltas = R.updateRatings(entrants);
  const byKey = Object.fromEntries(deltas.map((d) => [d.key, d]));

  /* Written first, and the unique index on (game, name) is what stops a game
     being scored twice if two requests finish it at the same moment. */
  try {
    /* Stamped with when the game actually ended rather than when this ran. The
       board decays by the hour, so a result's age is part of its score and
       "whenever the row happened to be written" is not good enough. */
    await db.saveResults(game.code, placed.map((r) => ({
      company_id: r.companyId, name: r.name, place: r.place,
      seats: placed.length, value: Math.round(r.value),
      rating_delta: league ? 0 : ((byKey[r.companyId || r.name] || {}).delta || 0),
      was_bot: r.isBot,
      traits: r.traits || null,
      /* Tagged, so the two boards never see each other's games. A program's
         results must not move a person's rating, and a person's must not appear
         on a board that ranks programs. */
      league: league ? 'bot' : null,
    })), game.lastResolvedAt || undefined);
  } catch (e) {
    if (e instanceof UniqueViolation || e.code === '23505') return { skipped: 'already scored' };
    throw e;
  }

  const changes = [];
  for (const r of placed) {
    if (league) break;                 /* the human rating is not a bot's to move */
    if (!r.companyId) continue;
    const d = byKey[r.companyId];
    const after = await db.bumpRating(r.companyId, {
      rating: d.rating, won: r.place === 1, value: Math.round(r.value),
    });
    changes.push({ name: r.name, place: r.place, delta: d.delta, rating: after.rating });
  }

  game.scored = true;
  return { scored: true, changes, places: placed.map((r) => ({ name: r.name, place: r.place })) };
}
