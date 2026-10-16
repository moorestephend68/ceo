/* THE PRIZE HUNT — the third game, server side.

   The same shape as the other two: sealed simultaneous filings on a clock.
   CEO files a quarter, Cargo Run files a round in two windows, and this files
   an hour. One discriminator, game.kind, and the lobby machinery, the tick
   sweep and the read-apply-retry writer drive it without knowing which game
   they are driving.

   WHAT A CAPTAIN DOES IN A ROUND, which is the whole game:

     they pick one of the twelve places, and may not pick the one they are
     standing in — you move every round, always

     they list up to three ITEMS they will part with and up to three TYPES they
     want. They do not know who they are dealing with and never find out

   The round closes and the whole market clears at once.

   THE ITEMS SAY NOTHING ABOUT WHAT THEY DO, and that is not flavour. It is
   the single load-bearing decision in the design. Measured both ways over 300
   worlds: when players know their own recipes, the thoughtless churner wins
   42.7% against a 25% baseline, because the win condition is a race and every
   moment spent being careful is tempo surrendered. When the items are
   unexplained, the churner takes 1% and makes seven times as many trades as
   the player who beats them. Nothing else in this file matters as much as
   keeping the names meaningless. (HUNT-findings.md.)

   WHY THE BLINDNESS IS THE POINT, not a limitation. A market where you choose
   your partner needs the double coincidence of wants: you hold what I asked
   for AND want what I hold. A sealed market can do better. If A hands to B, B
   to C and C to A, all three got something they asked for and no two of them
   had anything to offer each other. Those deals cannot exist in any version
   where people pair off, and the matcher below looks for those rings as well
   as for straight swaps.

   WHAT THE OTHER TWO GAMES ARE FOR. Items arrive by finishing a CEO or Cargo
   Run season — about one a table. That is not a bonus, it is the engine: with
   no new items entering the world the hunt is unwinnable, 0.65 components of
   three ever built and not one letter earned. A hand of fourteen is nowhere
   near enough when you cannot aim.

   AND IT IS A RACE THAT NOBODY CAN RUSH. Rounds are hourly, which sounds fast
   and is safe: from four rounds a day to forty-eight the share of seasons won
   by judgement never leaves 94–99%. Item inflow flattens skill badly; round
   frequency does not. More inflow is more free stuff, more rounds is more
   chances to exercise judgement. */

import { CADENCES } from './game.mjs';

export const VERSION = 1;
export const KIND = 'hunt';

/* ---------------------------------------------------------------- economy */
export const C = {
  /* ITEMS. Thirty types, measured: twenty trades faster than sixty because
     overlap is what makes a deal possible at all, and a small pool keeps the
     first win inside a fortnight. */
  P: 30,
  HAND: 14,          // the opening hand, duplicates allowed and wanted
  /* Duplicates are not a wart in the deal, they are what starts the market:
     the only thing you can safely offer is something you hold more than one
     of, and a hand of fourteen DISTINCT types would leave nobody able to
     trade on the first morning. At a pool of thirty a hand lands with about
     ten types and four spares, and 8.6% of arrivals hold a finished component
     already — a real surprise without ever being the game. */

  COMP: 3,           // components: the GPS, the navigation module, the key
  PER: 3,            // items in each
  LETTERS: 5,        // places in the uncharted territory, one letter each

  /* THE MARKET. */
  PLACES: 12,        /* measured: at two places there is no decision, at eight
                        it bites, at twelve a drifter takes 8% against 40% for
                        anybody with a reason to be somewhere. Past sixteen the
                        signal keeps improving and the FEEL degrades — rounds
                        spent standing somewhere empty go from 33 to 61. */
  GIVE: 3,           // items a filing may offer
  WANT: 3,           // types a filing may ask for
  TAKE: 2,           /* how many trades actually go through for one player in
                        one round. It is also the only thing that makes a crowd
                        costly: in a group of twenty most of your possible
                        partners have already spent their allowance. */
  RING: 3,           // longest chain the matcher will build

  /* THE FIELD. */
  SEATS: 40,         // the hunt is capped; more qualifiers run as another hunt
  MIN_SEATS: 14,     /* below this it stalls. At eight qualifiers nearly half
                        the seasons produce no winner inside a month even with
                        items pouring in, because a thin market needs
                        COUNTERPARTIES and no amount of inflow is a substitute. */

  /* WHAT A FINISHED TABLE ELSEWHERE IS WORTH. */
  AWARD: 1,          // items for finishing a CEO or Cargo Run season
  BOT_DAY: 1,        // what a bot is dripped a day, to match the measured rate

  ROUND_MINUTES: 60,
  DAYS_MAX: 45,      /* the season's hard stop. Measured, 99% of seasons are
                        claimed by day 30 and the latest seen in 120 was day
                        31, so this is slack rather than a real limit — but a
                        prize needs a date by which it is either won or not. */
};

export const LIMITS = {
  seats:  { min: 2, max: 60, default: 40 },
  rounds: { min: 1, max: 1, default: 1 },
};

export const FORMAT = {
  seats: C.SEATS,
  cadence: '1h',
};

export const LOBBY_WAIT_SECONDS = 90;

export const describe = () =>
  `up to ${C.SEATS} captains · one shared market · a filing an hour · ` +
  `first to the safe takes it`;

/* ------------------------------------------------------------ randomness */
export const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuf = (r, a) => { const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b; };
const pick = (r, a) => a[Math.floor(r() * a.length)];

const randomToken = () => {
  const b = new Uint8Array(16);
  (globalThis.crypto || require('crypto').webcrypto).getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I, O, 0, 1
const randomCode = () => {
  const b = new Uint8Array(6);
  (globalThis.crypto || require('crypto').webcrypto).getRandomValues(b);
  return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
};

/* ------------------------------------------------------------- the world

   THIRTY NAMES THAT MEAN NOTHING. Chosen to sound like salvage worth having
   and to give away nothing whatever about what combines with what. A name a
   player can reason about is a name that costs the game its only real skill,
   so none of these may ever be renamed to something descriptive. */
export const ITEMS = [
  'Ceramic Shim', 'Vexil Ore', 'Dray Coupling', 'Hollow Spindle', 'Ashglass',
  'Tarn Resin', 'Pellet Core', 'Wick Harness', 'Grey Ballast', 'Fennic Coil',
  'Sable Gasket', 'Orrin Flake', 'Bright Cable', 'Mourn Alloy', 'Kessel Pin',
  'Dust Lens', 'Harrow Plate', 'Lint Filament', 'Varga Seal', 'Pell Bearing',
  'Nine Weave', 'Corvid Clasp', 'Tamm Bracket', 'Halvor Rod', 'Scarp Mesh',
  'Iron Wick', 'Drift Collar', 'Lantern Grit', 'Meridian Bolt', 'Cold Spool',
];

export const PLACE_NAMES = [
  'Tollgate', 'The Long Quay', 'Sparrow Yard', 'Kestrel Deep', 'Underhall',
  'The Dry Dock', 'Carrow Flats', 'Hask Landing', 'Pike Market', 'The Verge',
  'Stonebed', 'Marrow Lane',
];

export const COMPONENTS = ['galactic GPS', 'navigation module', 'the key'];

export const UNCHARTED = ['Null Reach', 'The Fathom', 'Ember Shoal', 'Last Bell', 'The Vault Road'];

/* which five letters this player's safe wants, and in what order. Derived from
   the game and the seat so a code shared with a friend opens nothing. */
function codeFor(game, seatIdx) {
  const r = mulberry32((game.seed ^ (0x9e3779b9 * (seatIdx + 1))) >>> 0);
  return Array.from({ length: C.LETTERS }, () => ALPHABET[Math.floor(r() * 24)]);
}

/* ---------------------------------------------------------------- seats */
const BOT_NAMES = ['Wick & Daughters', 'Pell Salvage', 'Okonjo Reclamation',
  'Brightsea Exchange', 'Halloran Trading', 'Ardo Lots', 'Corvid & Co',
  'Marrow Brokers', 'Tamm Consignment', 'Vance Clearing'];

/* The instincts the measurement found, so the field a captain meets is the
   field that was modelled. `judge` is the one that wins — it risks only
   singletons of types the market has been handing over — and it is
   deliberately not the whole field, because a table of nothing but the best
   reply is not the table anybody will actually sit at. */
const BOT_KIT = [
  { trade: 'judge',     travel: 'avoider'  },
  { trade: 'collector', travel: 'follower' },
  { trade: 'judge',     travel: 'follower' },
  { trade: 'naive',     travel: 'drifter'  },
  { trade: 'collector', travel: 'avoider'  },
  { trade: 'hoarder',   travel: 'drifter'  },
];

function blankSeat(name, token, isBot, kit) {
  return {
    name: String(name).trim().slice(0, 24) || 'Captain',
    token, isBot: !!isBot,
    trade: kit ? kit.trade : null,
    travel: kit ? kit.travel : null,
    hand: {},              // type index -> how many
    recipes: null,         // set at deal time; never leaves the server
    built: [false, false, false],
    letters: 0,
    at: 0,                 // where they are standing
    filed: null,           // this round's filing
    /* what the market has handed them, by type. The only read on scarcity a
       blind player gets, and the thing `judge` plays off. */
    seen: {},
    got: 0, gave: 0, alone: 0,
    won: false, wonRound: null,
  };
}

/* --------------------------------------------------------------- creating */
export function createGame(opts = {}) {
  const seed = opts.seed === undefined ? (Math.random() * 1e9) | 0 : opts.seed;
  const seats = Math.max(LIMITS.seats.min,
    Math.min(LIMITS.seats.max, opts.seats || C.SEATS));
  const token = randomToken();
  const game = {
    kind: KIND, version: VERSION,
    code: randomCode(), seed,
    status: 'lobby',
    isPublic: !!opts.isPublic,
    hostToken: randomToken(),
    config: { seats, cadence: opts.cadence || '1h', daysMax: C.DAYS_MAX },
    round: 0,
    day: 0,
    deadline: null,
    lobbyDeadline: opts.now || null,
    seats: [blankSeat(opts.hostName || 'Captain', token, false, null)],
    /* how many stood at each place when the last round closed. Public, and the
       only thing anybody can act on when choosing where to go. */
    crowd: Array(C.PLACES).fill(0),
    announced: [],         // {round, who, comp} — completing is public
    history: [],
    createdAt: opts.now || new Date().toISOString(),
  };
  return { game, token };
}

export function joinGame(game, name, now) {
  if (game.kind !== KIND) throw new Error('That is not a prize hunt.');
  if (game.status !== 'lobby') throw new Error('That hunt has already started.');
  if (game.seats.length >= game.config.seats) throw new Error('That hunt is full.');
  const token = randomToken();
  game.seats.push(blankSeat(name, token, false, null));
  if (now) game.lobbyDeadline = game.lobbyDeadline || now;
  return { game, token };
}

export const seatByToken = (game, token) =>
  game.seats.find((s) => s.token && s.token === token);

/* ------------------------------------------------------------- dealing

   WHAT YOU PLAYED DECIDES WHAT YOU HOLD. A captain's CEO industry and Cargo
   lane make some item types common for them and the rest scarce, which is the
   whole reason a trade can exist: two people who played differently hold
   different things. Identical opening hands would leave nothing to trade, and
   that is not a tuning problem, it is the market failing to exist.

   `profile` is a number the caller passes in — derived from the seasons that
   qualified them. Absent, it falls back to the seat index, which is fine for
   a private hunt and wrong for a ranked one. */
const AFFINITY = 8, AFF_W = 6;

function deal(game, seatIdx, profile) {
  const s = game.seats[seatIdx];
  const r = mulberry32(((game.seed ^ 0x51ed270b) + (profile | 0) * 2654435761 + seatIdx) >>> 0);
  const aff = new Set(shuf(r, [...Array(C.P).keys()]).slice(0, AFFINITY));
  const w = []; for (let t = 0; t < C.P; t++) w.push(aff.has(t) ? AFF_W : 1);
  const tot = w.reduce((a, b) => a + b, 0);
  const draw = () => { let x = r() * tot;
    for (let t = 0; t < C.P; t++) { x -= w[t]; if (x <= 0) return t; } return C.P - 1; };
  s.affinity = [...aff];
  s.hand = {};
  for (let k = 0; k < C.HAND; k++) { const t = draw(); s.hand[t] = (s.hand[t] || 0) + 1; }

  /* SECRET, AND THEIR OWN. Shared recipes were measured to kill the market
     outright — an item everybody needs is an item nobody holds spare, so
     there is demand and no supply and nothing clears: 1-7% of players ever
     finished and a hundred of them managed 69 trades between them. Per-player
     recipes took the same world to 222 trades and 90% finishing. */
  const types = shuf(r, [...Array(C.P).keys()]);
  s.recipes = [];
  for (let c = 0; c < C.COMP; c++) s.recipes.push(types.slice(c * C.PER, c * C.PER + C.PER));
  s.placeItems = types.slice(C.COMP * C.PER, C.COMP * C.PER + C.LETTERS);
  s.code = codeFor(game, seatIdx);
  s.at = Math.floor(r() * C.PLACES);
}

export function startGame(game, hostToken, now) {
  if (game.kind !== KIND) throw new Error('That is not a prize hunt.');
  if (game.status !== 'lobby') throw new Error('That hunt is already running.');
  if (hostToken && hostToken !== game.hostToken) throw new Error('Only the host can start it.');

  /* BOT FILL, to the floor rather than to the cap. A hunt of eight stalls; a
     hunt of fourteen works. So the machine makes up the difference and no
     further — a field of real captains is the point. */
  const want = Math.max(C.MIN_SEATS, Math.min(game.config.seats, game.seats.length));
  let k = 0;
  while (game.seats.length < want) {
    const kit = BOT_KIT[k % BOT_KIT.length];
    game.seats.push(blankSeat(BOT_NAMES[k % BOT_NAMES.length], null, true, kit));
    k++;
  }
  game.seats.forEach((s, i) => deal(game, i, s.profile === undefined ? i : s.profile));

  game.status = 'playing';
  game.round = 1;
  game.day = 0;
  game.lobbyDeadline = null;
  openRound(game, now);
  return game;
}

function openRound(game, now) {
  const mins = (CADENCES[game.config.cadence] || { minutes: C.ROUND_MINUTES }).minutes;
  game.deadline = new Date(Date.parse(now || new Date().toISOString()) + mins * 60000).toISOString();
  for (const s of game.seats) s.filed = null;
}

/* -------------------------------------------------- items from elsewhere

   Finishing a CEO or Cargo Run season hands a captain an item. This is the
   whole reason the other two games stay load-bearing for the length of the
   hunt rather than being a turnstile: with inflow at zero the hunt cannot be
   won at all. */
export function award(game, token, n = C.AWARD) {
  const s = seatByToken(game, token);
  if (!s || game.status !== 'playing') return 0;
  const r = mulberry32((game.seed ^ (s.got + s.gave + 7) * 2246822519) >>> 0);
  const aff = new Set(s.affinity || []);
  const w = []; for (let t = 0; t < C.P; t++) w.push(aff.has(t) ? AFF_W : 1);
  const tot = w.reduce((a, b) => a + b, 0);
  for (let k = 0; k < n; k++) {
    let x = r() * tot, t = C.P - 1;
    for (let i = 0; i < C.P; i++) { x -= w[i]; if (x <= 0) { t = i; break; } }
    s.hand[t] = (s.hand[t] || 0) + 1;
  }
  return n;
}

/* ------------------------------------------------------------- the filing */
const held = (s, t) => s.hand[t] || 0;
const distinctHeld = (s) => Object.keys(s.hand).filter((t) => s.hand[t] > 0).map(Number);
const absent = (s) => [...Array(C.P).keys()].filter((t) => !(held(s, t) > 0));
const dupesOver = (s, over) => distinctHeld(s).filter((t) => held(s, t) > over);

export function submitFiling(game, token, raw) {
  if (game.status !== 'playing') throw new Error('That hunt is not running.');
  const s = seatByToken(game, token);
  if (!s) throw new Error('That is not a seat in this hunt.');
  if (s.won) throw new Error('You have already opened the safe.');

  const place = Number(raw.place);
  if (!Number.isInteger(place) || place < 0 || place >= C.PLACES)
    throw new Error('There is no such place.');
  if (place === s.at) throw new Error('You have to move somewhere new.');

  /* you may only offer what you are holding, and only as many as the rules
     allow. Offering a type you hold only one of is permitted on purpose: it
     is the decision the measurement found to be the strongest skill in the
     game, and refusing to let a captain take that risk removes it. */
  const give = [];
  const spending = {};
  for (const x of (raw.give || []).slice(0, C.GIVE)) {
    const t = Number(x);
    if (!Number.isInteger(t) || t < 0 || t >= C.P) continue;
    if ((spending[t] || 0) + 1 > held(s, t)) continue;
    spending[t] = (spending[t] || 0) + 1;
    give.push(t);
  }
  const want = [];
  for (const x of (raw.want || []).slice(0, C.WANT)) {
    const t = Number(x);
    if (!Number.isInteger(t) || t < 0 || t >= C.P) continue;
    if (!want.includes(t)) want.push(t);
  }

  s.filed = { round: game.round, place, give, want };
  return s.filed;
}

export const humansOutstanding = (game) =>
  game.seats.filter((s) => !s.isBot && !s.won && !s.filed);

export function shouldResolve(game, now) {
  if (game.status !== 'playing') return false;
  if (game.paused) return false;
  if (humansOutstanding(game).length === 0) return true;
  if (!game.deadline) return false;
  return Date.parse(now || new Date().toISOString()) >= Date.parse(game.deadline);
}

/* ------------------------------------------------------------ the bots

   The policies the measurement found, no cleverer. A bot that reasoned about
   recipes would be teaching itself a game nobody else can play, because the
   items say nothing — so these play the shape of their hand, which is all
   anybody can do. */
function botFile(game, s, r) {
  /* where to go: avoiding and following measured within a point of each other
     at 41% and 40%, against 8% for drifting. The skill is having a reason. */
  const options = [...Array(C.PLACES).keys()].filter((p) => p !== s.at);
  let place;
  if (s.travel === 'avoider') place = options.slice().sort((a, b) => game.crowd[a] - game.crowd[b])[0];
  else if (s.travel === 'follower') place = options.slice().sort((a, b) => game.crowd[b] - game.crowd[a])[0];
  else place = pick(r, options);

  const over = s.trade === 'hoarder' ? 2 : 1;
  const dupes = dupesOver(s, over);
  const miss = absent(s);
  let give = [], want = [];

  if (s.trade === 'naive') {
    const all = [];
    for (const t of distinctHeld(s)) for (let k = 0; k < held(s, t); k++) all.push(t);
    give = shuf(r, all).slice(0, C.GIVE);
    want = shuf(r, [...Array(C.P).keys()]).slice(0, C.WANT);
  } else if (s.trade === 'judge') {
    /* duplicates first, because they cost nothing. Then fill the slate with
       singletons of types the market has actually delivered — if it turns out
       you needed one, you can get another. Never risk a type nobody has ever
       handed over. */
    const safe = distinctHeld(s)
      .filter((t) => held(s, t) === 1 && (s.seen[t] || 0) >= 1)
      .sort((a, b) => (s.seen[b] || 0) - (s.seen[a] || 0));
    give = dupes.slice(0, C.GIVE);
    for (const t of safe) { if (give.length >= C.GIVE) break; give.push(t); }
    want = shuf(r, miss).slice(0, C.WANT);
  } else {
    give = dupes.sort((a, b) => held(s, b) - held(s, a)).slice(0, C.GIVE);
    want = shuf(r, miss).slice(0, C.WANT);
  }
  s.filed = { round: game.round, place, give, want };
}

/* --------------------------------------------------------- the matcher

   Straight swaps first, then rings of three. A ring is the thing a sealed
   market can do that a market where you pick your partner cannot, and it is
   why "you never learn who you dealt with" is the design rather than a
   limitation of it. */
function clearPlace(game, here, r) {
  const taken = new Map(here.map((s) => [s, 0]));     // items gone from them
  const filled = new Map(here.map((s) => [s, 0]));    // items come to them
  let moved = 0;

  const canGive = (s, t) => s.filed.give.includes(t) && held(s, t) >= 1
    && taken.get(s) < C.TAKE;
  const wants = (s, t) => s.filed.want.includes(t) && filled.get(s) < C.TAKE;
  const hand = (from, to, t) => {
    from.hand[t] = held(from, t) - 1;
    to.hand[t] = held(to, t) + 1;
    from.gave++; to.got++;
    to.seen[t] = (to.seen[t] || 0) + 1;
    taken.set(from, taken.get(from) + 1);
    filled.set(to, filled.get(to) + 1);
    moved++;
  };

  for (const a of shuf(r, here)) {
    for (const b of shuf(r, here)) {
      if (a === b) continue;
      const out = a.filed.give.find((t) => canGive(a, t) && wants(b, t));
      const back = b.filed.give.find((t) => canGive(b, t) && wants(a, t));
      if (out === undefined || back === undefined || out === back) continue;
      hand(a, b, out); hand(b, a, back);
    }
  }

  if (C.RING >= 3) for (const a of shuf(r, here)) {
    for (const b of shuf(r, here)) {
      if (b === a) continue;
      const aToB = a.filed.give.find((t) => canGive(a, t) && wants(b, t));
      if (aToB === undefined) continue;
      for (const c of shuf(r, here)) {
        if (c === a || c === b) continue;
        const bToC = b.filed.give.find((t) => canGive(b, t) && wants(c, t));
        const cToA = c.filed.give.find((t) => canGive(c, t) && wants(a, t));
        if (bToC === undefined || cToA === undefined) continue;
        hand(a, b, aToB); hand(b, c, bToC); hand(c, a, cToA);
        break;
      }
    }
  }
  return moved;
}

/* ------------------------------------------------------------ resolving */
export function resolveRound(game, now) {
  if ((game.kind || 'ceo') !== KIND) throw new Error('That is not a prize hunt.');
  if (game.status !== 'playing') throw new Error('That hunt is not running.');
  const r = mulberry32((game.seed ^ (0x85ebca6b * game.round)) >>> 0);

  const live = game.seats.filter((s) => !s.won);
  for (const s of live) if (s.isBot && !s.filed) botFile(game, s, r);
  /* a captain who filed nothing stays put and trades nothing. Not a penalty,
     an absence: the measured cost of missing a round is a round. */
  for (const s of live) if (!s.filed) s.filed = { round: game.round, place: s.at, give: [], want: [] };

  /* everybody moves, having seen only where people stood last round */
  for (const s of live) s.at = s.filed.place;
  const crowd = Array(C.PLACES).fill(0);
  for (const s of live) crowd[s.at]++;

  /* each place clears on its own: you deal with who is there, or nobody */
  let moved = 0;
  for (let p = 0; p < C.PLACES; p++) {
    const here = live.filter((s) => s.at === p && (s.filed.give.length || s.filed.want.length));
    const standing = live.filter((s) => s.at === p);
    if (standing.length < 2) { for (const s of standing) s.alone++; continue; }
    if (here.length >= 2) moved += clearPlace(game, here, r);
  }

  /* ---- what got built, and who is told ------------------------------- */
  const built = [];
  for (const s of live) {
    s.recipes.forEach((items, c) => {
      if (s.built[c]) return;
      if (items.every((t) => held(s, t) >= 1)) {
        for (const t of items) s.hand[t] = held(s, t) - 1;
        s.built[c] = true;
        built.push({ round: game.round, who: game.seats.indexOf(s), comp: c });
      }
    });
    /* THE UNCHARTED TERRITORY. Three components open it, and each of its five
       places will exchange one letter of the code for the right item.

       NOTE, because it is a departure: the measurement granted a letter the
       moment a captain held the item, and that is what this does. The design
       as described has them travel to each of the five, which would slow the
       endgame — where the race is actually decided, since almost everybody
       builds all three components and the winner is whoever finishes the
       letters. Adding that travel is a change worth measuring before it is
       made, not a detail to slip in. */
    if (s.built.every(Boolean)) {
      while (s.letters < C.LETTERS && held(s, s.placeItems[s.letters]) >= 1) {
        s.hand[s.placeItems[s.letters]] = held(s, s.placeItems[s.letters]) - 1;
        s.letters++;
      }
      if (s.letters >= C.LETTERS && !s.won) { s.won = true; s.wonRound = game.round; }
    }
  }
  game.announced = game.announced.concat(built);
  game.crowd = crowd;

  game.history.push({
    round: game.round, day: game.day, moved,
    crowd, built,
    letters: game.seats.map((s) => s.letters),
    builtCount: game.seats.map((s) => s.built.filter(Boolean).length),
  });
  if (game.history.length > 48) game.history = game.history.slice(-48);
  game.lastResolvedAt = now || new Date().toISOString();

  /* ---- is it over? --------------------------------------------------- */
  const winner = game.seats.find((s) => s.won);
  const perDay = Math.max(1, Math.round(1440 / (CADENCES[game.config.cadence] || { minutes: 60 }).minutes));
  game.day = Math.floor(game.round / perDay);

  if (winner || game.day >= game.config.daysMax) {
    game.status = 'over';
    game.deadline = null;
    game.winner = winner ? game.seats.indexOf(winner) : null;
    /* the bots are dripped their share of what playing the other two games
       would have brought a person; it stops here with everything else */
  } else {
    game.round += 1;
    /* what finishing a table elsewhere brings a person, for the machine */
    if (game.round % perDay === 0) {
      for (const s of game.seats) if (s.isBot && !s.won) {
        const rr = mulberry32((game.seed ^ game.round ^ game.seats.indexOf(s) * 7919) >>> 0);
        const aff = new Set(s.affinity || []);
        const w = []; for (let t = 0; t < C.P; t++) w.push(aff.has(t) ? AFF_W : 1);
        const tot = w.reduce((a, b) => a + b, 0);
        for (let k = 0; k < C.BOT_DAY; k++) {
          let x = rr() * tot, t = C.P - 1;
          for (let i = 0; i < C.P; i++) { x -= w[i]; if (x <= 0) { t = i; break; } }
          s.hand[t] = (s.hand[t] || 0) + 1;
        }
      }
    }
    openRound(game, now);
  }
  return game;
}

/* ------------------------------------------------------------- the view

   WHAT ONE CAPTAIN MAY SEE. The list of what must NOT travel is longer than
   the list of what may, and it is written out because the last time a game in
   this repo grew a shared-state mechanic the owner of a warehouse leaked out
   through a history row that nothing on screen ever displayed — invisible,
   and one API response away.

   Never, to anybody: another captain's hand, their recipes, their affinity,
   their code, or where they are standing THIS round.

   Public on purpose: how many people stood at each place when the last round
   closed, which is the only thing anybody can act on when choosing where to
   go — and completing a component, because a hunt where nobody knows anybody
   is close is a hunt with no endgame. Letter counts go with it. */
export function viewFor(game, token) {
  const me = seatByToken(game, token);
  const meIdx = me ? game.seats.indexOf(me) : -1;
  const over = game.status === 'over';

  const pub = (s, i) => ({
    name: s.name, you: i === meIdx, bot: !!s.isBot,
    built: s.built.filter(Boolean).length,
    letters: s.letters,
    won: !!s.won,
  });

  const view = {
    kind: KIND, code: game.code, status: game.status,
    isPublic: !!game.isPublic,
    lobbyDeadline: game.lobbyDeadline || null,
    round: game.round, day: game.day, daysMax: game.config.daysMax,
    deadline: game.deadline,
    seats: game.seats.map(pub),
    places: PLACE_NAMES.slice(0, C.PLACES).map((name, i) => ({
      name, i, crowdLast: game.crowd[i] || 0,
    })),
    items: ITEMS.slice(0, C.P),
    components: COMPONENTS,
    uncharted: UNCHARTED.slice(0, C.LETTERS),
    rules: { give: C.GIVE, want: C.WANT, take: C.TAKE, places: C.PLACES,
             letters: C.LETTERS, perComponent: C.PER },
    /* the announcements, with names — this is the one thing about another
       captain's progress that is meant to travel */
    announced: game.announced.slice(-20).map((a) => ({
      round: a.round, who: game.seats[a.who] ? game.seats[a.who].name : '—',
      comp: COMPONENTS[a.comp], you: a.who === meIdx,
    })),
    you: me ? {
      name: me.name, at: me.at, place: PLACE_NAMES[me.at],
      /* the hand, by name and count. What each item DOES is not here, because
         it is not anywhere: not even its owner is told. */
      hand: distinctHeld(me).sort((a, b) => a - b)
        .map((t) => ({ t, name: ITEMS[t], n: held(me, t) })),
      built: me.built.slice(),
      letters: me.letters,
      /* only the letters already earned, in order, and never the rest */
      code: me.code ? me.code.slice(0, me.letters) : [],
      filed: me.filed && me.filed.round === game.round ? me.filed : null,
      got: me.got, gave: me.gave,
      /* what the market has handed them, which is the only read on scarcity
         the game offers and the thing the strongest play is built on */
      seen: Object.keys(me.seen).map(Number).sort((a, b) => (me.seen[b] || 0) - (me.seen[a] || 0))
        .slice(0, 12).map((t) => ({ t, name: ITEMS[t], n: me.seen[t] })),
    } : null,
    /* the last few rounds, in aggregate only */
    history: game.history.slice(-8).map((h) => ({
      round: h.round, moved: h.moved, crowd: h.crowd,
      built: h.built.map((b) => ({ who: game.seats[b.who] ? game.seats[b.who].name : '—',
                                   comp: COMPONENTS[b.comp] })),
    })),
  };

  if (over) {
    view.winner = game.winner === null || game.winner === undefined
      ? null : game.seats[game.winner].name;
    view.youWon = game.winner === meIdx;
    /* once it is over there is nothing left to protect */
    view.reveal = game.seats.map((s) => ({
      name: s.name, built: s.built.filter(Boolean).length, letters: s.letters,
      traded: s.got + s.gave, alone: s.alone,
    }));
  }
  return view;
}

/* --------------------------------------------------- the kind contract */
export function resolveWhileDue(game, now) {
  let changed = false, guard = 0;
  while (game.status === 'playing' && shouldResolve(game, now) && guard++ < 64) {
    resolveRound(game, now);
    changed = true;
    if (game.status === 'playing' && humansOutstanding(game).length === 0
        && Date.parse(now || Date.now()) < Date.parse(game.deadline)) break;
  }
  return changed;
}
