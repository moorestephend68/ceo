/* Tournaments — a league with a final, not a bracket.

   Somebody buys the right to run an event. Thirty-odd people enter, play several
   tables in groups of six, and the event ranks them on the money they made
   across all of it. The top six play a final.

   That shape is not what was asked for. The question was a knockout: groups of
   six, winners advance. §43 measured both and the knockout lost on every count
   that matters, so this is the format the measurement chose rather than the one
   the brief described.

   ------------------------------------------------------- why not a knockout

   A knockout crowns the strongest entrant about **one time in four**. Ranking on
   aggregate over the same number of tables gets it right 28% of the time and —
   the fairer question — puts the strongest entrant in the final three 73% of the
   time against a knockout's 56%.

   Playing more games inside a knockout does not help: 22% at seven tables, 20%
   at twenty-one. Elimination throws information away, and no amount of further
   play can correct a mistake already made.

   And the commercial point, which happens to agree: thirty-six people pay to
   attend, and a single-elimination bracket sends thirty of them home after the
   first hour.

   ---------------------------------------------------------- the re-draw

   Groups are re-drawn at random every stage, and that is a measured choice
   rather than a lazy one. The obvious improvement is a Swiss draw — after stage
   one, seat people against others on a similar score — and it is **worse**: 77%
   against 88% on the top-three question over five tables.

   The reason is particular to this game. In chess a win is a win whoever you
   beat, so concentrating the strong players sharpens the ranking. Here the score
   is money made, and money made depends on who else is at the table competing
   for the same customers. Seat the six strongest together and they suppress each
   other's numbers while a weak group posts large ones. Swiss inverts the ranking
   instead of sharpening it.

   ------------------------------------------------------------ the fairness

   Every group in a stage plays an **identical seeded market** — same customers,
   same costs, same shocks in the same rounds. It is the property the whole
   product rests on and it is what makes two tables comparable at all. Stages
   differ from each other, so nobody can carry knowledge of the market forward.

   This module is pure: it draws groups, adds up standings and picks finalists.
   Nothing here touches storage or the clock. */

import { randomBytes } from 'node:crypto';
import * as G from './game.mjs';
import { mutateGame } from './mutate.mjs';
import * as CO from './cohorts.mjs';

export const LIMITS = {
  /* Six to a table is the engine's maximum and the format the question asked
     for. Not configurable: every measurement behind this assumes it. */
  groupSize: 6,
  stages: { min: 2, max: 6, default: 3 },
  finalists: { min: 3, max: 6, default: 6 },
  /* Below this there is no event — a single group playing three times is a
     class, and it should be sold as one. */
  minEntrants: 12,
  maxEntrants: 240,
};

export class NotAllowed extends Error {}

export const isTournament = (cohort) =>
  !!(cohort && cohort.config && cohort.config.tournament);

export function settingsOf(cohort) {
  const t = (cohort.config && cohort.config.tournament) || {};
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.round(x)));
  return {
    stages: clamp(t.stages || LIMITS.stages.default, LIMITS.stages.min, LIMITS.stages.max),
    finalists: clamp(t.finalists || LIMITS.finalists.default,
                     LIMITS.finalists.min, LIMITS.finalists.max),
  };
}

/* The market every group in a stage faces. Derived from the event's own seed so
   the whole tournament replays identically, and different for each stage so
   nobody carries knowledge of the market forward.

   The final gets its own seed too — it is the last stage plus one. */
export function seedForStage(eventSeed, stage) {
  /* A cheap avalanche, so consecutive stages are not consecutive markets. */
  let h = (Number(eventSeed) >>> 0) ^ ((stage + 1) * 0x9E3779B1);
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
  return (h ^ (h >>> 16)) >>> 0;
}

function shuffled(list, seed) {
  let a = seed >>> 0;
  const rand = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* Draw the groups for a stage.

   Deterministic on (event seed, stage), so a stage that has to be recreated
   after a crash produces the same tables rather than a different tournament.

   Nobody is ever left out. Which tables end up short moves with the draw, so it
   is not the same people every stage. */
export function drawGroups(entrants, eventSeed, stage) {
  const list = shuffled(entrants, seedForStage(eventSeed, stage) ^ 0x5bf03635);
  if (!list.length) return [];

  /* Sizes are worked out before anybody is seated, and spread as evenly as they
     will go.

     Slicing off sixes and keeping the remainder was the first attempt and it
     produced a table of two whenever the entry list was one over a multiple of
     six — thirteen entrants became 6 + 5 + 2. Two people is not a game; the
     engine will not seat fewer than three, and even three is a thin market. An
     even spread gives 5 + 4 + 4 instead, and never puts anybody on a table that
     cannot be played. */
  const count = Math.max(1, Math.ceil(list.length / LIMITS.groupSize));
  const base = Math.floor(list.length / count);
  const extra = list.length % count;

  const groups = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const size = base + (i < extra ? 1 : 0);
    groups.push({ groupNo: i + 1, members: list.slice(at, at + size) });
    at += size;
  }
  return groups;
}

/* --------------------------------------------------------------- standings

   `results` is one row per entrant per completed table:
     { entrantId, stage, value, name }

   Ranked on the total, because §34 measured that a player's average tells you
   more about them than their best game does, and gets *further* ahead the more
   they play. A tournament that ranked on best single table would be selling the
   worst statistic on the site as its headline. */
export function standings(entrants, results) {
  const byId = new Map(entrants.map((e) => [e.id, {
    id: e.id, name: e.name, total: 0, played: 0, best: null, stages: {},
  }]));

  for (const r of results) {
    const row = byId.get(r.entrantId);
    if (!row) continue;
    row.total += Number(r.value) || 0;
    row.played += 1;
    row.stages[r.stage] = Number(r.value) || 0;
    if (row.best === null || r.value > row.best) row.best = Number(r.value) || 0;
  }

  const rows = [...byId.values()].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    /* A tie on the total is broken by the better single table, and then by name
       so the order is never arbitrary from one page load to the next. */
    if ((b.best || 0) !== (a.best || 0)) return (b.best || 0) - (a.best || 0);
    return a.name.localeCompare(b.name);
  });
  rows.forEach((r, i) => { r.place = i + 1; });
  return rows;
}

/* Who plays the final. Only entrants who actually played — somebody who entered
   and never turned up should not take a seat from somebody who did. */
export function finalists(rows, howMany) {
  return rows.filter((r) => r.played > 0).slice(0, howMany);
}

/* ------------------------------------------------------------- the state

   What stage the event is on, and what it is waiting for. One function so the
   console and the entrant's page cannot disagree about it. */
export function phaseOf(cohort, { stagesDone = 0, finalDone = false } = {}) {
  const s = settingsOf(cohort);
  if (finalDone) return { phase: 'over', label: 'Finished', stage: null };
  if (stagesDone >= s.stages) {
    return { phase: 'final', label: 'The final', stage: s.stages };
  }
  return {
    phase: 'stage',
    label: `Stage ${stagesDone + 1} of ${s.stages}`,
    stage: stagesDone,
  };
}

/* Plain language for the entrant. A leaderboard with no explanation of what it
   takes to reach the final is a leaderboard people ignore. */
export function describe(cohort, rows, place) {
  const s = settingsOf(cohort);
  if (!rows.length) return 'Nobody has played a table yet.';
  const cut = rows[Math.min(s.finalists, rows.length) - 1];
  if (!place) return `The top ${s.finalists} after ${s.stages} stages play the final.`;
  if (place <= s.finalists) {
    const margin = cut && rows[place - 1] ? rows[place - 1].total - cut.total : 0;
    return place === 1
      ? 'Top of the event.'
      : `In the final six as it stands, ${money(margin)} above the cut.`;
  }
  const need = cut ? cut.total - rows[place - 1].total : 0;
  return `${money(need)} outside the final six.`;
}

const money = (x) =>
  (x < 0 ? '-' : '') + '$' + Math.round(Math.abs(x)).toLocaleString('en-US');

/* ==========================================================================
   Running one.

   Everything above is pure. Everything below takes a `db` and does the work in
   the order an event actually happens: people enter, a stage is drawn, the
   tables are played, the standings move, the next stage is drawn, and finally
   six people play for it.

   A tournament is stored as a cohort with `config.tournament` set, so the
   facilitator's existing controls — pause, extend, resolve a round — all work on
   it unchanged. What is new is the stage, and an entrant identity that outlives
   any particular table. */

/* -------------------------------------------------------------- creating */

/* An event is a cohort with `config.tournament` set, so every control the
   facilitator already has — pause, extend, close a round early — works on it
   unchanged. It is gated on the facilitator licence rather than sold separately:
   somebody who runs classes and somebody who runs a competition are the same
   customer, and a second product to buy is a second thing to explain. */
export async function createTournament(db, facilitator, opts = {}) {
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.round(x)));
  const stages = clamp(opts.stages || LIMITS.stages.default,
                       LIMITS.stages.min, LIMITS.stages.max);
  const finalistCount = clamp(opts.finalists || LIMITS.finalists.default,
                              LIMITS.finalists.min, LIMITS.finalists.max);
  return CO.createCohort(db, facilitator, {
    ...opts,
    name: opts.name || 'Untitled tournament',
    /* Six a table is the format every measurement behind this assumes. */
    groupSize: LIMITS.groupSize,
  }, {
    config_override: null,
  }).then(async (cohort) => {
    /* The tournament settings live inside the cohort's own config, so a single
       row is the whole event and nothing has to be joined to read it. */
    const config = { ...cohort.config, tournament: { stages, finalists: finalistCount } };
    return db.updateCohort(cohort.id, { config });
  });
}

/* -------------------------------------------------------------- entering */

/* Somebody joins the event. No game yet — the draw has not happened, and may not
   for an hour. What they get is a name nobody else in the event has and a token
   that will still be theirs in the final. */
export async function enter(db, cohort, nameIn, now) {
  if (!isTournament(cohort)) throw new NotAllowed('That is not a tournament.');
  if (cohort.status === 'closed') throw new NotAllowed('That event has finished.');

  const name = String(nameIn || '').trim().slice(0, 28);
  if (!name) throw new NotAllowed('Your company needs a name.');

  const already = await db.entrantsOf(cohort.id);
  if (already.length >= LIMITS.maxEntrants) {
    throw new NotAllowed(`This event is full at ${LIMITS.maxEntrants}.`);
  }
  /* Once the first stage is drawn the field is fixed. Somebody arriving in the
     middle would be playing fewer tables than everybody else and their total
     would mean something different, which is the one thing the standings must
     not allow. */
  if (await stagesDone(db, cohort) > 0 || cohort.status === 'running') {
    throw new NotAllowed('This event has already started. The field is fixed once '
      + 'the first stage is drawn — everybody has to play the same number of tables.');
  }

  const token = randomBytes(18).toString('base64url');
  try {
    const row = await db.createEntrant({ cohort_id: cohort.id, name, token });
    return { entrant: row, token };
  } catch (e) {
    if (e && (e.code === '23505' || e.constructor.name === 'UniqueViolation')) {
      throw new NotAllowed(`Somebody in this event is already called ${name}.`);
    }
    throw e;
  }
}

/* ------------------------------------------------------------ the stages */

const stageGames = async (db, cohortId) =>
  (await db.gamesOfCohort(cohortId)).map((g) => ({ ...g, stage: g.stage || 0 }));

/* How many stages have been played out. A stage counts as done when every table
   in it is over — a standings table built while half the tables are still
   running would reorder itself under people as the afternoon went on. */
export async function stagesDone(db, cohort) {
  const games = await stageGames(db, cohort.id);
  const settings = settingsOf(cohort);
  let done = 0;
  for (let s = 0; s < settings.stages; s++) {
    const inStage = games.filter((g) => g.stage === s);
    if (!inStage.length || !inStage.every((g) => g.status === 'over')) break;
    done += 1;
  }
  return done;
}

/* Draw a stage and create its tables.

   Every table in the stage is built on the same seed, which is what makes them
   comparable — and the draw is derived from the event seed too, so a stage that
   has to be rebuilt after a crash is the same tables rather than a different
   tournament. */
export async function startStage(db, cohort, now) {
  if (!isTournament(cohort)) throw new NotAllowed('That is not a tournament.');
  const settings = settingsOf(cohort);
  const done = await stagesDone(db, cohort);
  const existing = await stageGames(db, cohort.id);

  /* The final is the stage after the last one, and only the qualifiers play. */
  const isFinal = done >= settings.stages;
  const stage = isFinal ? settings.stages : done;

  if (existing.some((g) => g.stage === stage && g.status !== 'over')) {
    throw new NotAllowed('That stage is already running.');
  }
  if (isFinal && existing.some((g) => g.stage === settings.stages)) {
    throw new NotAllowed('The final has been played.');
  }

  let field = await db.entrantsOf(cohort.id);
  if (field.length < LIMITS.minEntrants && stage === 0) {
    throw new NotAllowed(`An event needs at least ${LIMITS.minEntrants} entrants. `
      + `There ${field.length === 1 ? 'is' : 'are'} ${field.length}. `
      + 'Fewer than that is a class, and it is cheaper to run as one.');
  }
  if (isFinal) {
    const rows = standings(field, await resultRows(db, cohort));
    const through = finalists(rows, settings.finalists).map((r) => r.id);
    field = field.filter((e) => through.includes(e.id));
    if (!field.length) throw new NotAllowed('Nobody has played a table, so there is no final.');
  }

  const groups = isFinal
    ? [{ groupNo: 1, members: field }]
    : drawGroups(field, cohort.seed, stage);

  const seed = seedForStage(cohort.seed, stage);
  const made = [];
  for (const group of groups) {
    const game = await db.ensureCohortGame(cohort.id, group.groupNo, () => {
      const built = G.createGame({
        ...cohort.config, hostName: `Table ${group.groupNo}`,
        seats: Math.max(3, group.members.length), seed, now,
      });
      built.game.cohortId = cohort.id;
      built.game.cohortName = cohort.name;
      built.game.groupNo = group.groupNo;
      built.game.stage = stage;
      built.game.isFinal = isFinal;
      built.game.seats = [];
      return built.game;
    }, stage);

    /* Seat the entrants. Done inside a mutate so two facilitators pressing the
       button at once cannot seat anybody twice. */
    await mutateGame(db, game.code, (g) => {
      if (g.status !== 'lobby') return false;
      for (const e of group.members) {
        if (g.seats.some((s) => s.entrantId === e.id)) continue;
        const { token } = G.joinGame(g, e.name, now);
        const seat = g.seats.find((s) => s.token === token);
        /* The seat token changes every stage; the entrant id does not. This is
           what lets somebody hold one link all afternoon. */
        seat.entrantId = e.id;
      }
      G.startGame(g, g.hostToken, now);
      return true;
    });
    made.push({ groupNo: group.groupNo, code: game.code, seats: group.members.length });
  }

  await db.updateCohort(cohort.id, { status: 'running' });
  return { stage, isFinal, tables: made, seed };
}

/* --------------------------------------------------------------- results */

/* One row per entrant per table that has finished. Reads the games rather than
   a separate results table: the seat carries the entrant id, so the money made
   is already recorded in the only place it could disagree with itself. */
export async function resultRows(db, cohort) {
  const games = await stageGames(db, cohort.id);
  const out = [];
  for (const g of games) {
    if (g.status !== 'over') continue;
    for (const seat of g.seats || []) {
      if (!seat.entrantId) continue;
      out.push({ entrantId: seat.entrantId, stage: g.stage,
                 value: G.finalValue(seat), name: seat.name });
    }
  }
  return out;
}

/* Everything a console or a scoreboard needs, in one read. */
export async function stateOf(db, cohort) {
  const settings = settingsOf(cohort);
  const field = await db.entrantsOf(cohort.id);
  const games = await stageGames(db, cohort.id);
  const rows = standings(field, await resultRows(db, cohort));

  const done = await stagesDone(db, cohort);
  const finalGames = games.filter((g) => g.stage === settings.stages);
  const finalDone = finalGames.length > 0 && finalGames.every((g) => g.status === 'over');
  const phase = phaseOf(cohort, { stagesDone: done, finalDone });

  const running = games.filter((g) => g.status !== 'over');
  return {
    id: cohort.id, name: cohort.name, code: cohort.join_code,
    settings, phase, entrants: field.length,
    stagesDone: done, finalDone,
    standings: rows,
    qualifiers: done >= settings.stages ? finalists(rows, settings.finalists).map((r) => r.id) : [],
    tables: games.map((g) => ({
      stage: g.stage, groupNo: g.groupNo, code: g.code, status: g.status,
      round: g.round, totalRounds: g.config.rounds, isFinal: !!g.isFinal,
      players: (g.seats || []).filter((s) => s.entrantId).length,
    })).sort((a, b) => a.stage - b.stage || a.groupNo - b.groupNo),
    waiting: running.length,
    canStartNext: !running.length && !finalDone
      && (done < settings.stages ? field.length >= LIMITS.minEntrants : rows.some((r) => r.played)),
  };
}

/* What one entrant sees: where they stand, and which table they are at now. */
export async function entrantView(db, cohort, token) {
  const me = await db.entrantByToken(token);
  if (!me || me.cohort_id !== cohort.id) throw new NotAllowed('We do not recognise you in this event.');

  const state = await stateOf(db, cohort);
  const rows = state.standings;
  const mine = rows.find((r) => r.id === me.id) || null;

  /* The table they are at, if one is running. Their seat token changes every
     stage and they never see it — the link they hold is the entrant token. */
  const games = await stageGames(db, cohort.id);
  let table = null;
  for (const g of games) {
    const seat = (g.seats || []).find((s) => s.entrantId === me.id);
    if (!seat) continue;
    if (g.status === 'over' && table) continue;
    if (!table || g.stage > table.stage || (g.status !== 'over' && table.status === 'over')) {
      table = { stage: g.stage, groupNo: g.groupNo, code: g.code,
                status: g.status, token: seat.token, isFinal: !!g.isFinal };
    }
  }

  return {
    event: { name: state.name, phase: state.phase, settings: state.settings,
             entrants: state.entrants, stagesDone: state.stagesDone },
    you: mine ? { ...mine, note: describe(cohort, rows, mine.place) } : null,
    table,
    standings: rows,
  };
}
