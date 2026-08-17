/* Cohorts — one person running many games at once.

   A class of forty is eight games of five, and the facilitator's problem is not
   playing but watching: who has filed, which group is stuck, whose company just
   went under, and what to put in a gradebook afterwards.

   The one thing that makes this defensible rather than merely convenient is that
   **every group shares the cohort's seed**. All eight face an identical market,
   so nobody can claim they drew a harder economy, and results can be compared
   directly. It is also the feature the incumbents charge for, and here it falls
   out of the fact that games were seeded from the very first prototype. */

import * as G from './game.mjs';
import { UniqueViolation } from './db.mjs';
import { randomBytes } from 'node:crypto';

/* Read aloud in a room, so the same unambiguous alphabet as a game code. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const codeOf = (n = 6) => {
  const b = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
};

export const LIMITS = {
  groupSize: { min: 3, max: 6, default: 5 },
  rounds: { min: 8, max: 20, default: 10 },
};

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/* ------------------------------------------------------------- creating */

export async function createCohort(db, facilitator, opts = {}) {
  const name = String(opts.name || '').trim().slice(0, 80) || 'Untitled class';
  const groupSize = clamp(Math.round(opts.groupSize || LIMITS.groupSize.default),
                          LIMITS.groupSize.min, LIMITS.groupSize.max);
  const rounds = clamp(Math.round(opts.rounds || LIMITS.rounds.default),
                       LIMITS.rounds.min, LIMITS.rounds.max);
  const config = {
    seats: groupSize, rounds,
    cadence: G.CADENCES[opts.cadence] ? opts.cadence : '15m',
    preset: G.PRESETS[opts.preset] ? opts.preset : 'standard',
    closeHour: opts.closeHour === undefined ? 18 : opts.closeHour,
  };
  const seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9);

  for (let i = 0; i < 5; i++) {
    try {
      return await db.createCohort({
        facilitator, name, join_code: codeOf(), seed, group_size: groupSize, config,
      });
    } catch (e) {
      if (!(e instanceof UniqueViolation || e.code === '23505')) throw e;
    }
  }
  throw new Error('Could not allocate a class code. Try again.');
}

/* --------------------------------------------------------------- joining */

/* Students all use one code. They are seated into the first group with room, and
   a new group opens when the others are full — so the facilitator does not have
   to know the number in advance or hand out eight different codes. */
export async function joinCohort(db, cohort, studentName, now) {
  if (cohort.status === 'closed') throw new Error('That class has finished.');
  const name = String(studentName || '').trim();
  if (!name) throw new Error('Your company needs a name.');

  const games = await db.gamesOfCohort(cohort.id);
  const open = games.filter((g) => g.status === 'lobby' && g.seats.length < g.config.seats);

  for (const g of open) {
    if (g.seats.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
    const { token } = G.joinGame(g, name, now);
    return { game: g, token, group: groupNumber(games, g), created: false };
  }

  /* Every group runs the same market — that is the point of the cohort. */
  const made = G.createGame({ ...cohort.config, hostName: name, seed: cohort.seed, now });
  const game = made.game;
  game.cohortId = cohort.id;
  game.cohortName = cohort.name;
  game.paused = cohort.status === 'paused';
  return { game, token: made.token, group: games.length + 1, created: true };
}

const groupNumber = (games, game) => {
  const sorted = games.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return sorted.findIndex((g) => g.code === game.code) + 1;
};

/* ---------------------------------------------------------------- control */

/* Start every group at once. Groups still short of players fill with bots, which
   is usually what a class wants: a group of three humans plays five companies
   rather than a thin market. */
export async function startAll(db, cohort, now) {
  const games = await db.gamesOfCohort(cohort.id);
  let started = 0;
  for (const g of games) {
    if (g.status !== 'lobby') continue;
    G.startGame(g, g.hostToken, now);
    g.paused = cohort.status === 'paused';
    await db.putGame(g);
    started += 1;
  }
  await db.updateCohort(cohort.id, { status: 'running' });
  return { started };
}

export async function setPaused(db, cohort, paused) {
  const games = await db.gamesOfCohort(cohort.id);
  for (const g of games) {
    if (g.status === 'over') continue;
    g.paused = !!paused;
    await db.putGame(g);
  }
  await db.updateCohort(cohort.id, { status: paused ? 'paused' : 'running' });
  return { paused: !!paused, games: games.length };
}

/* Give everyone more time — the commonest thing a facilitator needs, because
   somebody always says "we're not ready". */
export async function extendAll(db, cohort, minutes, now) {
  const add = clamp(Math.round(minutes || 5), 1, 24 * 60) * 60000;
  const games = await db.gamesOfCohort(cohort.id);
  let moved = 0;
  for (const g of games) {
    if (g.status !== 'playing' || !g.deadline) continue;
    const base = Math.max(Date.parse(g.deadline), Date.parse(now || new Date().toISOString()));
    g.deadline = new Date(base + add).toISOString();
    await db.putGame(g);
    moved += 1;
  }
  return { extended: moved, minutes: add / 60000 };
}

/* Close the current round everywhere, whatever the clock says. Standing orders
   cover anyone who has not filed, so this never strands a group. */
export async function resolveAll(db, cohort, now) {
  const games = await db.gamesOfCohort(cohort.id);
  let closed = 0;
  for (const g of games) {
    if (g.status !== 'playing') continue;
    G.resolveRound(g, now);
    closed += 1;
    await db.putGame(g);
  }
  return { closed };
}

/* ----------------------------------------------------------------- board */

/* What the facilitator watches. Everything here is already computed by the game;
   the work is arranging it so eight groups fit on one screen. */
export async function board(db, cohort) {
  const games = (await db.gamesOfCohort(cohort.id))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  const groups = games.map((g, i) => {
    const humans = g.seats.filter((s) => !s.isBot);
    const waiting = g.status === 'playing'
      ? humans.filter((s) => !s.firm.bankrupt && s.submittedRound !== g.round).map((s) => s.name)
      : [];
    return {
      group: i + 1, code: g.code, status: g.status, paused: !!g.paused,
      round: g.round, totalRounds: g.config.rounds, deadline: g.deadline,
      seats: g.seats.length, humans: humans.length,
      waitingOn: waiting,
      companies: g.seats.map((s) => ({
        name: s.name, isBot: !!s.isBot,
        value: g.status === 'lobby' ? null : Math.round(G.finalValue(s)),
        filed: s.isBot ? null : s.submittedRound === g.round,
        missed: s.autoRounds || 0,
        out: !!(s.firm && s.firm.bankrupt),
      })),
    };
  });

  const players = groups.reduce((a, g) => a + g.humans, 0);
  return {
    id: cohort.id, name: cohort.name, code: cohort.join_code, status: cohort.status,
    seed: cohort.seed, config: cohort.config,
    groups, totals: {
      groups: groups.length, players,
      playing: groups.filter((g) => g.status === 'playing').length,
      finished: groups.filter((g) => g.status === 'over').length,
      waiting: groups.reduce((a, g) => a + g.waitingOn.length, 0),
    },
  };
}

/* ---------------------------------------------------------------- export */

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  /* A leading =, + or @ makes a spreadsheet treat a cell as a formula, and
     company names are typed by students — so those get neutralised.
     A negative NUMBER must not be, or the value column arrives as text and the
     instructor cannot sort or total it, which is most of the point of an export. */
  const isNumber = /^-?\d+(\.\d+)?$/.test(s);
  const safe = !isNumber && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function exportCsv(db, cohort) {
  const b = await board(db, cohort);
  const header = ['group', 'game', 'company', 'kind', 'place', 'company_value',
                  'rounds_played', 'rounds_filed', 'rounds_auto_filed', 'status'];
  const lines = [header.join(',')];

  for (const g of b.groups) {
    const ranked = g.companies.slice().sort((a, x) => (x.value || 0) - (a.value || 0));
    ranked.forEach((c, i) => {
      lines.push([
        g.group, g.code, c.name, c.isBot ? 'AI' : 'student',
        g.status === 'over' ? i + 1 : '',
        c.value === null ? '' : c.value,
        g.round,
        Math.max(0, g.round - (c.missed || 0)),
        c.missed || 0,
        c.out ? 'went under' : g.status,
      ].map(csvCell).join(','));
    });
  }
  return lines.join('\n') + '\n';
}
