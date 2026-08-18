/* The demo class.

   An instructor evaluating this has a specific fear, and it is not that the
   economy is wrong. It is that they will put thirty students in front of it and
   one of them will not file, and the whole group will sit there. So the demo is
   not a tour of the features: it is a class that is already five rounds in, with
   a student who has never filed once, a group that has been undercutting itself
   into the ground, and a company heading for the bank.

   Three rules shaped this file:

     No login at the door. An evaluation that begins with "create an account" is
     an evaluation that mostly does not happen.

     The same story every time. The seed is fixed, and so is every scripted
     decision, so the demo can be written about, screenshotted, and narrated in a
     sales call — "look at group three" means the same thing in every session.

     An empty dashboard demos terribly. Six groups of five are seated and played
     forward before the visitor ever sees it.

   Everything here uses the ordinary cohort and game code. Nothing about the demo
   is a special case inside the engine — the companies are human seats with
   tokens this module happens to hold, filing ordinary orders through the
   ordinary submit path. If the demo works, the product works. */

import { randomBytes } from 'node:crypto';
import * as G from './game.mjs';
import * as C from './cohorts.mjs';
import * as E from './engine.mjs';

export const DEMO = {
  name: 'MGT 481 — Strategy (demo class)',
  seed: 20260415,                 // fixed: the same market, every single time
  groups: 6,
  groupSize: 5,
  rounds: 12,
  cadence: '15m',
  preset: 'standard',
  opening: 5,                     // rounds already played when the door opens
  maxAdvance: 5,                  // rounds one "play forward" click may cover
  ttlMinutes: 240,                // demos are disposable; the sweeper clears them
};

/* Where the story lives. Referenced by the guide below so the prose and the
   simulation can never drift apart. */
export const STORY = {
  visitor: { group: 1, name: 'Ashcombe Trading' },
  war: { group: 3, from: 3, names: ['Kelmscott Industries', 'Langmere Systems'] },
  neverFiles: { group: 5, name: 'Yaxley Brothers' },
  stopsFiling: { group: 2, name: 'Ilminster Group', after: 2 },
};

/* --------------------------------------------------------------- the roll */

/* Five ways of running a company, none of them stupid and none of them a
   winner. They are the same shapes the bots have, played by "students" so the
   board shows filings and misses the way a real class does. */
const PERSONAS = {
  steady:  { price: 1.00, rd: 30000, proc: 10000, ads: 5000,  build: 1.00, grow: 1.00 },
  premium: { price: 1.08, rd: 40000, proc: 8000,  ads: 9000,  build: 0.97, grow: 1.00 },
  cutter:  { price: 0.96, rd: 22000, proc: 22000, ads: 4000,  build: 1.02, grow: 1.00 },
  spender: { price: 0.99, rd: 22000, proc: 10000, ads: 15000, build: 1.02, grow: 1.02 },
  drifter: { price: 1.03, rd: 22000, proc: 8000,  ads: 2500,  build: 0.96, grow: 1.00 },
};

/* Six groups of five. Names are dull English placenames on purpose: an
   instructor should be reading the numbers, not the jokes. */
const ROLL = [
  [['Ashcombe Trading', 'steady'], ['Brayford Mills', 'premium'],
   ['Coleridge Supply', 'cutter'], ['Datchet Works', 'spender'],
   ['Ellersby & Co', 'drifter']],

  [['Fenwick Instruments', 'steady'], ['Garrowby Devices', 'premium'],
   ['Halstead Manufacturing', 'cutter'], ['Ilminster Group', 'spender'],
   ['Jarrow Components', 'drifter']],

  /* The two at the front of this group run the SAME strategy, and the only thing
     that separates them from each other and from everyone else is the price war
     they talk themselves into. That is what makes group three worth a discussion
     rather than merely worth a look. */
  [['Kelmscott Industries', 'steady'], ['Langmere Systems', 'steady'],
   ['Marchwood Supply', 'cutter'], ['Netherby Works', 'premium'],
   ['Oakhanger Ltd', 'drifter']],

  [['Pentridge Labs', 'steady'], ['Quarrendon Tools', 'premium'],
   ['Ravenglass Trading', 'cutter'], ['Sedgemoor Plant', 'spender'],
   ['Thurlstone & Co', 'drifter']],

  [['Upwell Engineering', 'steady'], ['Vasterne Products', 'premium'],
   ['Wardington Mills', 'cutter'], ['Yaxley Brothers', 'spender'],
   ['Zennor Supply', 'drifter']],

  [['Alderley Works', 'steady'], ['Brantwood Supply', 'cutter'],
   ['Chettisham Ltd', 'premium'], ['Dunwich Trading', 'drifter'],
   ['Elveden Group', 'spender']],
];

/* Six groups of five people running the same five strategies would produce six
   identical boards — and an instructor scanning three columns of identical
   numbers would rightly conclude they were looking at a mock-up rather than a
   simulation. So each company is nudged off its archetype by an amount derived
   from its own name: deterministic, so the demo still tells the same story every
   time, but enough that every group is its own room. */
const hashOf = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

const tweaks = new Map();
function personaOf(group, name) {
  const row = (ROLL[group - 1] || []).find((r) => r[0] === name);
  const base = PERSONAS[row ? row[1] : 'steady'];
  const key = `${group}:${name}`;
  if (!tweaks.has(key)) {
    const r = E.mulberry32((hashOf(key) ^ DEMO.seed) >>> 0);
    tweaks.set(key, {
      price: 1 + (r() - 0.5) * 0.09,
      rd: 0.75 + r() * 0.6, proc: 0.75 + r() * 0.6, ads: 0.6 + r() * 0.9,
      build: 0.96 + r() * 0.09, grow: 1 + (r() - 0.5) * 0.035,
    });
  }
  const t = tweaks.get(key);
  return {
    price: base.price * t.price, rd: base.rd * t.rd, proc: base.proc * t.proc,
    ads: base.ads * t.ads, build: base.build * t.build, grow: base.grow * t.grow,
  };
}

const snap = (x, step) => Math.max(0, Math.round(x / step) * step);

/* --------------------------------------------------------------- filing */

/* Whether this student files this round.

   Two of them do not, and that is the point of them. One stops after the second
   round — the student who was keen for a week. One has never filed at all — the
   student the instructor is actually worried about. Both are carried by standing
   orders, and both show up on the board with a count against their name, which
   is the answer to "what happens if somebody doesn't submit". */
function filesThisRound(group, name, round) {
  const s = STORY;
  if (group === s.neverFiles.group && name === s.neverFiles.name) return false;
  if (group === s.stopsFiling.group && name === s.stopsFiling.name) {
    return round <= s.stopsFiling.after;
  }
  return true;
}

/* What this company charges.

   Two companies in group three are in a price war. Neither started it on
   purpose and neither is following a script that says "go to sixty per cent":
   each simply undercuts what the other charged last round, by six per cent,
   one round late. That is what a price war actually is, and it is why they do
   not stop — there is no round in which cutting is the wrong move for either of
   them, and they arrive at the bottom together.

   It is the single most useful thing on the demo board, because it is the
   mistake a class makes on its own without being told to. */
function priceFor(game, seat, group, round, worth, persona) {
  const w = STORY.war;
  if (group !== w.group || !w.names.includes(seat.name) || round < w.from) {
    return worth * persona.price;
  }
  const other = game.seats.find((s) => s !== seat && w.names.includes(s.name));
  const theirs = other && other.lastPrice ? other.lastPrice : worth * 0.93;
  /* A floor, so the demo cannot end with somebody charging nothing. Real ones
     stop at the point somebody runs out of money, which happens here too. */
  return Math.max(worth * 0.52, Math.min(worth * 0.93, theirs * 0.94));
}

/* One student's orders for one round. Filed through the ordinary submit path,
   so anything the game would refuse a real player it refuses here too. */
function fileOne(game, group, seat, round) {
  const persona = personaOf(group, seat.name);
  const products = {};

  for (const p of E.live(seat.firm)) {
    const worth = E.value(p);
    const want = (seat.lastDemandBy && seat.lastDemandBy[p.name]) || E.demandPool(p);
    const room = E.effCapacity(p);
    const target = Math.min(want * persona.build, room);
    products[p.name] = {
      price: Math.round(priceFor(game, seat, group, round, worth, persona) * 100) / 100,
      produce: Math.max(0, Math.round(target - p.inventory)),
      /* Rounded the way a person types a number. The jitter that makes each
         company its own is multiplicative, and left raw it put $40,327.44 of
         research on a student's slider — which is not what anybody's orders have
         ever looked like, and the demo is judged on exactly that kind of detail. */
      rd: snap(persona.rd, 500), rdProcess: snap(persona.proc, 500),
      advertising: snap(persona.ads, 250),
      /* Growers keep building; the spender builds faster than the business
         justifies, which is how it ends up on the wrong side of the bank. */
      targetCapacity: snap(p.capacity * persona.grow, 25),
      discontinue: false,
    };
  }

  /* One company opens a second line, so the demo has a launch in its history and
     the student view has more than one line to show. */
  const wantsLaunch = seat.name === 'Brayford Mills' && round === 4;
  try {
    G.submitDecisions(game, seat.token, { products, launch: wantsLaunch, launchKind: 'software' });
  } catch (e) {
    /* A launch the game will not allow is not worth failing the demo over. */
    if (!wantsLaunch) throw e;
    G.submitDecisions(game, seat.token, { products, launch: false });
  }
}

/* Everyone in one group who is meant to file, files. The visitor's seat is left
   alone once they have arrived — from then on it is theirs, and if they do
   nothing their standing orders repeat, which is worth them seeing. */
function fileGroup(game, group, { skipVisitor, someOnly } = {}) {
  const round = game.round + 1;
  for (const seat of game.seats) {
    if (seat.isBot || seat.out || (seat.firm && seat.firm.bankrupt)) continue;
    if (!E.live(seat.firm).length) continue;
    if (skipVisitor && group === STORY.visitor.group && seat.name === STORY.visitor.name) continue;
    if (!filesThisRound(group, seat.name, round)) continue;
    /* Mid-round, only some of a class has filed. A board where all thirty read
       "not yet" is the board of a class that has just started, and it wastes the
       one column an instructor actually watches. */
    if (someOnly && hashOf(`${group}:${seat.name}`) % 100 >= 78) continue;
    fileOne(game, group, seat, round);
  }
}

/* ------------------------------------------------------------- building it */

const groupsInOrder = (games) =>
  games.slice().sort((a, b) => (a.groupNo || 0) - (b.groupNo || 0));

const demoToken = () => 'demo_' + randomBytes(18).toString('base64url');

/* Build a whole class and play it forward. Cheap enough to do inside a request:
   six games of five companies for five rounds is thirty resolutions, and a
   resolution is arithmetic on twenty-odd products. */
export async function createDemo(db, now) {
  const t0 = Date.parse(now || new Date().toISOString());
  /* Joins are staggered by a second so group order is stable. Cohorts number
     groups by creation time, and thirty games created in the same millisecond
     would number themselves differently on every run — which would break the one
     promise the demo makes, that it tells the same story every time. */
  const at = (i) => new Date(t0 + i * 1000).toISOString();

  const cohort = await C.createCohort(db, null, {
    name: DEMO.name, groupSize: DEMO.groupSize, rounds: DEMO.rounds,
    cadence: DEMO.cadence, preset: DEMO.preset, seed: DEMO.seed,
  }, {
    is_demo: true,
    demo_token: demoToken(),
    expires_at: new Date(t0 + DEMO.ttlMinutes * 60000).toISOString(),
  });

  let i = 0;
  for (const group of ROLL) {
    for (const [name] of group) {
      await C.joinCohort(db, cohort, name, at(i++));
    }
  }

  await C.startAll(db, cohort, at(i));
  for (let r = 0; r < DEMO.opening; r++) {
    await playForward(db, cohort, at(i + 1 + r), { skipVisitor: false });
  }

  /* And then the class is caught mid-round: most of them have filed, a handful
     have not, and neither has the seat that is about to become the visitor's.
     That is the state an instructor recognises. */
  const games = groupsInOrder(await db.gamesOfCohort(cohort.id));
  for (let n = 0; n < games.length; n++) {
    fileGroup(games[n], n + 1, { skipVisitor: true, someOnly: true });
    await db.putGame(games[n]);
  }

  const mine = games[STORY.visitor.group - 1];
  const seat = mine.seats.find((s) => s.name === STORY.visitor.name);

  return {
    cohort,
    demoToken: cohort.demo_token,
    student: { code: mine.code, token: seat.token, name: seat.name,
               group: STORY.visitor.group },
  };
}

/* One round, everywhere at once. */
async function playForward(db, cohort, at, opts) {
  const games = groupsInOrder(await db.gamesOfCohort(cohort.id));
  let moved = 0;
  for (let n = 0; n < games.length; n++) {
    const g = games[n];
    if (g.status !== 'playing') continue;
    fileGroup(g, n + 1, opts);
    G.resolveRound(g, at);
    /* A demo that is paused is a demo that appears broken; pushing it forward
       implies letting it run. */
    g.paused = false;
    await db.putGame(g);
    moved += 1;
  }
  return moved;
}

/* Time compression — the thing that makes a demo demonstrable.

   Nobody is going to sit through fifteen-minute rounds in an evaluation, and
   nobody should have to imagine what round nine looks like. This plays the whole
   class forward at once, filing for every scripted student and leaving the
   visitor's own seat to its standing orders. */
export async function advanceDemo(db, cohort, rounds, now) {
  const want = Math.max(1, Math.min(DEMO.maxAdvance, Math.round(rounds || 1)));
  const t0 = Date.parse(now || new Date().toISOString());
  let played = 0;
  for (let r = 0; r < want; r++) {
    const moved = await playForward(db, cohort,
      new Date(t0 + r * 60000).toISOString(), { skipVisitor: true });
    if (!moved) break;
    played += 1;
  }
  if (cohort.status === 'paused') await db.updateCohort(cohort.id, { status: 'running' });
  return { advanced: played };
}

/* ---------------------------------------------------------------- the guide */

/* What to look at, written from the board rather than from a script — so if the
   simulation ever stops producing the story, the guide stops claiming it.

   This is the part that makes a demo sell rather than merely run. A dashboard of
   six groups is not self-explanatory; three sentences pointing at the two things
   that have gone wrong is. */
export function guide(board) {
  const out = [];
  const find = (n) => board.groups.find((g) => g.group === n);
  const co = (g, name) => (g ? g.companies.find((c) => c.name === name) : null);

  const mine = co(find(STORY.visitor.group), STORY.visitor.name);
  if (mine) {
    out.push({
      what: 'Your seat',
      text: `You are ${STORY.visitor.name} in group ${STORY.visitor.group}. Open the ` +
            `student's screen to see exactly what one of them sees — the sliders, the ` +
            `projection, the lot.`,
    });
  }

  const wg = find(STORY.war.group);
  if (wg) {
    const pair = STORY.war.names.map((n) => co(wg, n)).filter(Boolean);
    if (pair.length === 2) {
      const rest = wg.companies.filter((c) => !STORY.war.names.includes(c.name)
                                              && c.value !== null);
      const median = rest.length
        ? rest.map((c) => c.value).sort((a, b) => a - b)[Math.floor(rest.length / 2)]
        : null;
      const behind = median !== null
        ? ` Their group's other companies are worth about ${fmt(median)}.` : '';
      out.push({
        what: `Group ${STORY.war.group}`,
        text: `${pair[0].name} and ${pair[1].name} have been undercutting each other ` +
              `since round ${STORY.war.from}. They are now worth ${fmt(pair[0].value)} and ` +
              `${fmt(pair[1].value)}.${behind} Nobody told them to do this — it is the ` +
              `mistake a class makes on its own, and it is the discussion you actually want.`,
      });
    }
  }

  /* The instructor's real question, answered with the live number. */
  const missed = board.groups
    .flatMap((g) => g.companies.filter((c) => !c.isBot && c.missed > 0)
      .map((c) => ({ ...c, group: g.group })))
    .sort((a, b) => b.missed - a.missed);
  if (missed.length) {
    const worst = missed[0];
    out.push({
      what: 'The student who does not submit',
      text: `${worst.name} in group ${worst.group} has missed ${worst.missed} round` +
            `${worst.missed === 1 ? '' : 's'}. Nothing stalled: their last orders simply ` +
            `repeated, and the count follows them into the spreadsheet` +
            `${missed.length > 1 ? `. ${missed.length} students have missed at least one round`
              : ''}.`,
    });
  }

  /* A board of negative numbers looks like a broken simulation unless somebody
     says otherwise. It is the ramp: a product loses money for its first rounds
     and a company is valued on what it earns, so early on most of them are
     underwater. Saying so turns a confusing signal into the reason to press the
     button. */
  const seated = board.groups.flatMap((g) => g.companies).filter((c) => c.value !== null);
  const under = seated.filter((c) => c.value < 0).length;
  if (seated.length && under >= seated.length * 0.3) {
    out.push({
      what: 'Why so many are underwater',
      text: `${under} of ${seated.length} companies show a negative value, and this early ` +
            `that is the ramp rather than a mistake — a new product loses money for its ` +
            `first few rounds, and a company is valued on what it earns. Push the class ` +
            `forward a few rounds and watch the spread open up.`,
    });
  }

  out.push({
    what: 'The same market for everyone',
    text: `All ${board.totals.groups} groups run on seed ${board.seed}. The same shocks land ` +
          `in the same rounds for every group, so a difference between two groups is a ` +
          `difference in what they did.`,
  });

  return out;
}

const fmt = (v) => (v === null || v === undefined ? '—'
  : (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US'));

/* Whoever holds the token controls this one throwaway class and nothing else.
   It is not an account, it grants nothing, and it dies with the demo. */
export const opensDemo = (cohort, token) =>
  !!(cohort && cohort.is_demo && cohort.demo_token && token
     && String(token) === String(cohort.demo_token));
