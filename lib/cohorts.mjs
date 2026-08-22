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
import { mutateGame } from './mutate.mjs';
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

/* How long a group opened after the class has begun waits for other latecomers
   before starting itself with bots.

   Somebody always walks in five minutes late. They used to land in a lobby of one
   that never started, because starting groups is something the facilitator does
   and they had already done it — so the student sat watching "waiting to start"
   for the rest of the lesson while the instructor had no idea. Long enough for a
   couple of stragglers to find each other, short enough that nobody is stranded. */
export const LATE_WAIT_SECONDS = 120;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/* ------------------------------------------------------------- creating */

/* `extra` is spread into the row as-is. Only the demo uses it, to mark a class
   as throwaway and give it its own access token — a facilitator's class never
   carries either. */
export async function createCohort(db, facilitator, opts = {}, extra = {}) {
  const name = String(opts.name || '').trim().slice(0, 80) || 'Untitled class';
  const groupSize = clamp(Math.round(opts.groupSize || LIMITS.groupSize.default),
                          LIMITS.groupSize.min, LIMITS.groupSize.max);
  const rounds = clamp(Math.round(opts.rounds || LIMITS.rounds.default),
                       LIMITS.rounds.min, LIMITS.rounds.max);
  const config = {
    seats: groupSize, rounds,
    /* Ten rounds at fifteen minutes is two and a half hours — longer than any
       lesson period, and it was the default. A class that changes nothing now
       gets one the instructor drives, which fits a fifty-minute room, a weekly
       course, and three rounds in one sitting, all without choosing a number. */
    cadence: G.CADENCES[opts.cadence] ? opts.cadence : 'manual',
    preset: G.PRESETS[opts.preset] ? opts.preset : 'standard',
    closeHour: opts.closeHour === undefined ? 18 : opts.closeHour,
    /* Which levers this class runs. A course that runs the game twice runs level
       one early and level two later; see §40. Defaults to the full game, so a
       class created before this existed is unchanged. */
    level: G.LEVELS[opts.level] ? Number(opts.level) : G.DEFAULT_LEVEL,
  };
  const seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9);

  for (let i = 0; i < 5; i++) {
    try {
      return await db.createCohort({
        facilitator, name, join_code: codeOf(), seed, group_size: groupSize, config,
        ...extra,
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

  /* Take a number first, and let everything else follow from it.

     This used to read the list of groups, look for one with room, and open a new
     one if there was none — which is correct when students arrive one at a time
     and catastrophic when they arrive together, because they all read the list
     before any of them had written to it. Forty students pressing Join in the
     same ten seconds produced forty groups of one: the class, and the product,
     failing at the only moment that matters.

     The counter is incremented in a single statement the database performs
     atomically, so forty simultaneous students get forty different numbers, and
     the group is arithmetic rather than a search. */
  const size = cohort.group_size || LIMITS.groupSize.default;
  const seatNo = await db.takeCohortSeat(cohort.id);

  /* The seat number gives the group; if that group has already started — which is
     what a latecomer finds, and what the one after them finds again — walk on to
     the next. Bounded, so a class that somehow cannot seat anybody says so
     instead of looping. */
  for (let group = Math.ceil(seatNo / size), hop = 0; hop < 12; group += 1, hop += 1) {
    const game = await db.ensureCohortGame(cohort.id, group, () => {
      /* Every group runs the same market — that is the point of the cohort. */
      const made = G.createGame({ ...cohort.config, hostName: `Group ${group}`,
                                  seed: cohort.seed, now });
      made.game.cohortId = cohort.id;
      made.game.cohortName = cohort.name;
      made.game.paused = cohort.status === 'paused';
      made.game.groupNo = group;
      /* A group opened while the class is already running starts on its own,
         after a short wait for other stragglers. */
      if (cohort.status === 'running') {
        made.game.lobbyDeadline =
          new Date(Date.parse(now || new Date().toISOString())
                   + LATE_WAIT_SECONDS * 1000).toISOString();
      }
      /* Seats are added below, so nobody is accidentally the host of their
         own class group. */
      made.game.seats = [];
      return made.game;
    });
    if (game.status !== 'lobby') continue;

    let token = null;
    await mutateGame(db, game.code, (g) => {
      if (g.status !== 'lobby' || g.seats.length >= g.config.seats) return false;
      /* Two students in a class may well pick the same name. Rather than refusing
         the second one in front of the room, they are made distinguishable. */
      let candidate = name;
      for (let n = 2; g.seats.some((x) => x.name.toLowerCase() === candidate.toLowerCase()); n++) {
        candidate = `${name.slice(0, 24)} ${n}`;
      }
      token = G.joinGame(g, candidate, now).token;
      return true;
    });
    if (!token) continue;

    const fresh = await db.getGame(game.code);
    return { game: fresh, token, group, created: false };
  }
  throw new Error('Could not find you a group in this class. Ask whoever is running '
    + 'it to start the class again.');
}

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
  /* Ordered by the group number the seat counter assigned, which is stable —
     sorting by creation time was not, because a class is created in one burst. */
  const games = (await db.gamesOfCohort(cohort.id))
    .sort((a, b) => (a.groupNo || 0) - (b.groupNo || 0)
      || String(a.createdAt).localeCompare(String(b.createdAt)));

  const groups = games.map((g, i) => {
    const humans = g.seats.filter((s) => !s.isBot);
    const waiting = g.status === 'playing'
      ? humans.filter((s) => !s.firm.bankrupt && s.submittedRound !== g.round).map((s) => s.name)
      : [];
    return {
      group: g.groupNo || i + 1, code: g.code, status: g.status, paused: !!g.paused,
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
    seed: cohort.seed, config: cohort.config, isDemo: !!cohort.is_demo,
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
