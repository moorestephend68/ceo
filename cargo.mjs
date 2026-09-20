/* CARGO RUN — the engine, server side.

   The same economy the simulation measured and the single-player page plays,
   with the yard bolted to the front of each round. It deliberately mirrors the
   shape of game.mjs — createGame / joinGame / startGame / submit / shouldResolve
   / resolveRound / viewFor — so the lobby machinery, the code-join, the public
   matchmaking, the bot fill and the tick sweep all drive it without knowing
   which game they are driving. One discriminator, game.kind, and the rest is
   shared.

   THE ROUND HAS TWO STAGES, and that is not an implementation detail.

     declare — where you load, what you load, and your sealed bids for the
               refit that settles at the end of this round
     route   — every manifest is now public: what is in each hold and which
               three stations each captain can reach, but NOT which one they
               will pick. You choose your port knowing that.

   Publishing the hold and withholding the destination is the measured
   information rule. Publishing the destination as well let the sharp players
   route around the naive ones perfectly and tripled the skill gap; publishing
   nothing left the first round a coin flip. So a round is two windows, and the
   refit rides along with the first one rather than adding a third.

   THE REFIT SETTLES AT THE END OF THE ROUND, not the start. That means a
   captain bids against the purse they had when the window opened, before the
   run has paid out, and a bid they can no longer cover once the trade settles
   is void — the lot goes to the next captain. Measured (ahead.mjs): against
   settling at the top of the round it makes the season slightly FAIRER, not
   worse — the halfway leader holds on 59% of the time instead of 64%, and
   coming back from last goes from 2% to 5%, because the stale purse is a brake
   on whoever is ahead. The yard's decision survives it: best-to-worst across
   bidding levels is $13,849 against $17,506.

   THE WAREHOUSES ARE ON, including ranked, and the note that used to sit here
   saying they were deliberately left out is two versions out of date. What is
   worth keeping from it is the reason they were held back — a third decision in
   a round, and a pile of shared state — because that is still what they cost.
   See C.RENT below for what they are now and what it took to get there. */

import { CADENCES } from './game.mjs';

export const VERSION = 1;
export const KIND = 'cargo';

/* ---------------------------------------------------------------- economy */
/* Kept identical to the playable page. If these drift, the multiplayer game
   stops being the game that was measured, and nobody would notice for weeks. */
export const C = {
  NP: 8, ND: 5, NC: 5, RP: 5, RD: 3,
  BASE: 100, SPREAD: 1.30, SIGMA: 0.18, DRIFT: 0.35,
  LOAD: 100, FUEL: 6, ELAS: 0.35, REF: 100,
  UPKEEP: 6000, CASH: 40000,
  /* the yard, at the settings the page ships */
  SLOTS: 6, HOLD_LO: 0.55, HOLD_HI: 1.45,
  GRADE_LO: 0.30, GRADE_HI: 1.00,
  BROKEN: 0.05, SCRAP: 0.30, PARTS: 4,
  RULE: 46,          // $ per unit of hold per round, measured on this board
  /* ---- the warehouses ----------------------------------------------------
     A captain may buy stock at a loading spot and leave it there. It is bought
     ON TOP of a full hold — storage is not in the ship, and if it competed with
     the cargo for room the hold's opportunity cost would come straight back in
     and the whole point would be lost (that mistake cost the mechanic $49,000 a
     season in the harness before it was found).

     THE SECOND VERSION. The first one took a 40% cut of what the goods finally
     sold for, ON TOP of the carrier paying the market full posted price. The
     goods were paid for twice and both payments came out of the carrier, so a
     pile was not an opportunity, it was a hazard: across 400 seasons, 953 runs
     drew out of a shed and every single one of the 953 was left worse off —
     $3,219 a run, worst case $9,479. Nobody chose it either, because the
     engine draws from the piles first for whatever was bought at that rock.

     The rule now is the simplest one there is: WHAT A CARRIER BUYS OUT OF A
     SHED IS PAID TO THE CAPTAIN WHO PUT IT THERE INSTEAD OF TO THE MARKET.
     Same money, a different till. A pile can never cost a carrier anything —
     measured over the same 400 seasons, 0% of runs worse off, worst case +$8 —
     and the keeper is selling goods rather than levying a toll on somebody
     else's sale.

     RENT is $2 and the shed is CLEARED AT THE END OF THE SEASON at the rock's
     posted price. Both of those are the same correction: stock is stock, not a
     bonfire. Under the old rules 31% of everything stored was never lifted and
     simply burnt — $8,645 of goods a season — and keeping a shed cost $12,622
     against not keeping one. It now costs $616, which is noise.

     What the measurement will not give is a shed that MAKES money, and no rule
     can. A dollar spent on cargo comes back with 26 cents in one round; a
     dollar in a shed does not compound. Storing more is monotonically worse,
     all the way down. So this is a tool — free your hold, damp the squeeze at a
     rock, get paid when somebody lifts it — and never a way to win.
     (SHED-strategy.md.) */
  RENT: 2,           // per unit, per round, on everything still in a shed
  WIND_DOWN: 2,      // no storing in the last two rounds: it could not sell
  STORE_MAX: 200,    // the most one captain may leave in one round
};

export const LIMITS = {
  seats:  { min: 2, max: 5, default: 5 },
  rounds: { min: 4, max: 16, default: 8 },
};

/* The ranked format. One configuration nobody can change, for the same reason
   CEO's public tier has one: a rating across tables with different lengths and
   different seat counts would rank whoever picked the softest table. */
export const FORMAT = {
  seats: 5,
  rounds: 8,
  cadence: '5m',
  /* On, including ranked. Measured on THIS engine and this format rather than
     inherited from the long board — which is how the first version shipped
     broken: keeping a shed cost $12,622 against not keeping one, and every one
     of 953 runs that touched a pile lost money. Under the rules above a shed
     costs $616, which is noise, and a pile has never once cost a carrier a
     penny. (SHED-strategy.md.) */
  warehouses: true,
};

export const LOBBY_WAIT_SECONDS = 90;

export const describe = () =>
  `${FORMAT.seats} captains · ${FORMAT.rounds} rounds · two filings a round · ` +
  `about ${Math.round(FORMAT.rounds * 2 * (CADENCES[FORMAT.cadence] || { minutes: 5 }).minutes)} minutes`;

/* ------------------------------------------------------------ randomness */
export const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const gauss = (r) =>
  Math.sqrt(-2 * Math.log(Math.max(r(), 1e-9))) * Math.cos(2 * Math.PI * r());

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

export const PICKS = ['Kepler Reach','Ash Flats','Corvid Rock','Halvorsen Deep','Tamm Belt',
  'Iron Wake','Sable Drift','Nine Pillars','Cold Harrow','Bright Scarp','Varga Shelf',
  'Dust Meridian','Orrin Hollow','Pell Crag','Lantern Field'];
export const DROPS = ['Meridian Station','Calloway Port','High Anchor','Saint Lys','Terminus Gate'];
export const GOODS = ['Ore','Grain','Fuel Cells','Medicine','Alloys'];
export const SLOTNAMES = ['Coolant Loop','Drive Coil','Hull Plate','Nav Unit',
                          'Power Cell','Thrust Bearing'];
export const CONDITION = (g) => g >= 0.88 ? 'factory-sealed' : g >= 0.72 ? 'reconditioned'
                              : g >= 0.55 ? 'serviceable' : g >= 0.40 ? 'well-used' : 'salvage';

/* ---------------------------------------------------------------- the board */
/* Derived from the seed every time rather than stored. It is a few hundred
   numbers and regenerating costs nothing, where storing it would put a copy of
   the board in every row and invite the two copies to disagree. */
export function boardFor(seed) {
  const r = mulberry32(seed >>> 0);
  const shuffle = (a) => { a = [...a];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a; };
  const pn = shuffle(PICKS), dn = shuffle(DROPS);
  const pick = Array.from({ length: C.NP }, (_, i) => ({ i, name: pn[i], x: 6 + r() * 88, y: 6 + r() * 88 }));
  const drop = Array.from({ length: C.ND }, (_, i) => ({ i, name: dn[i], x: 6 + r() * 88, y: 6 + r() * 88 }));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const near = (from, list, k) => list.map((n) => ({ n, d: dist(from, n) }))
    .sort((a, b) => a.d - b.d).slice(0, k).map((x) => x.n.i);
  /* Each loading spot ships to three stations WRITTEN ON IT rather than its
     three nearest: measured, "three nearest" left the list unchanged on 39% of
     switches, so the rule was real and invisible. Dealing out all ten possible
     triples drops that to 5%. */
  const triples = [];
  for (let i = 0; i < C.ND; i++) for (let j = i + 1; j < C.ND; j++) for (let k = j + 1; k < C.ND; k++)
    triples.push([i, j, k]);
  for (let i = triples.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1)); [triples[i], triples[j]] = [triples[j], triples[i]];
  }
  return {
    pick, drop,
    reachP: drop.map((s) => near(s, pick, C.RP)),
    reachD: Array.from({ length: C.NP }, (_, p) => triples[p % triples.length]),
    pbias: pick.map(() => Array.from({ length: C.NC }, () => Math.exp(C.SIGMA * gauss(r)))),
    dbias: drop.map(() => Array.from({ length: C.NC }, () => Math.exp(C.SIGMA * gauss(r)))),
    pdist: pick.map((p) => drop.map((s) => dist(p, s))),
    sdist: drop.map((s) => pick.map((p) => dist(s, p))),
  };
}

/* One week's prices. The shocks carry over, so the board drifts rather than
   being new every round — without the carry-over nobody can plan, and with a
   full one the best route never moves and everybody queues on it. */
export function spotFor(board, prev, rnd) {
  const sh = (o) => C.DRIFT * (o || 0) + Math.sqrt(1 - C.DRIFT * C.DRIFT) * gauss(rnd) * C.SIGMA;
  const sbuy = board.pbias.map((row, p) => row.map((_, c) => sh(prev && prev.sbuy[p][c])));
  const ssell = board.dbias.map((row, d) => row.map((_, c) => sh(prev && prev.ssell[d][c])));
  return {
    sbuy, ssell,
    buy: board.pbias.map((row, p) => row.map((b, c) => C.BASE * b * Math.exp(sbuy[p][c]))),
    sell: board.dbias.map((row, d) => row.map((b, c) => C.BASE * C.SPREAD * b * Math.exp(ssell[d][c]))),
  };
}

export const buyMult = (q) => Math.pow((q + C.REF) / (C.LOAD + C.REF), C.ELAS);
export const sellMult = (q) => Math.pow((q + C.REF) / (C.LOAD + C.REF), -C.ELAS);

/* ----------------------------------------------------------------- the ship */
export const shipQ = (seat) => seat.parts.reduce((a, b) => a + b, 0) / C.SLOTS;
export const holdOf = (seat) =>
  Math.round(C.LOAD * (C.HOLD_LO + (C.HOLD_HI - C.HOLD_LO) * shipQ(seat)));
const perPoint = () => (C.HOLD_HI - C.HOLD_LO) * C.LOAD * C.RULE;
/* The yard settles BETWEEN the two windows, so a part serves the round it was
   bought in as well as the ones after it — one more than when the refit landed
   at the end of the round. The hold range narrowed from 0.40–1.60 to
   0.55–1.45 to pay for that: measured, the immediate part makes an early lead
   arrive sooner and last longer, and the narrower range buys the comeback back
   (MIDYARD-findings.md). */
export const roundsLeft = (game) => Math.min(game.config.rounds - game.round + 1, C.SLOTS);
/* What a part is worth: what it beats the NEXT one down by, because that is
   what you get if you let this one go. Not the average of everything below it
   — that made the second lot look worth more than the first whenever the tail
   was poor, which is nonsense a player spots in one round. */
export const fallbackAt = (game, j) => {
  const g = game.block.grades;
  return (j + 1 < g.length) ? g[j + 1] : C.SCRAP;
};
export const worthOf = (game, grade, fallback) =>
  Math.max(0, grade - fallback) / C.SLOTS * perPoint() * roundsLeft(game);

/* ---------------------------------------------------------------- creating */
const humanSeat = (name, token) => ({
  name: String(name).trim().slice(0, 24) || 'Captain',
  token, isBot: false, at: 0, cash: C.CASH,
  parts: Array(C.SLOTS).fill(0.5), hold: C.LOAD, onParts: 0,
  declared: null, routed: null, submittedStage: null, lastRefit: null,
  stored: 0, takings: 0, rentPaid: 0, soldBack: 0,
});

/* The rivals, at the shades measured near the equilibrium. Spread rather than
   identical, because the best answer is to file about what the table files —
   a table all bidding the same number would hand the answer over. */
const BOT_NAMES = ['Vance Haulage','Okonjo Lines','Reyes & Co.','Brightsea Freight','Ardo Transit'];
const BOT_KIT = [
  { habit: 'greedy', shade: 0.55 },
  { habit: 'model',  shade: 0.65 },
  /* One of them keeps a shed, so the mechanic is in every game rather than
     only the ones where a person thinks of it. It is also the only style at
     the table that WANTS the crowd to turn up, which is worth a captain
     meeting once. */
  { habit: 'keeper', shade: 0.50 },
  { habit: 'model',  shade: 0.60 },
  { habit: 'greedy', shade: 0.58 },
];
const botSeat = (k) => ({
  name: BOT_NAMES[k % BOT_NAMES.length], token: null, isBot: true,
  habit: BOT_KIT[k % BOT_KIT.length].habit, shade: BOT_KIT[k % BOT_KIT.length].shade,
  at: 0, cash: C.CASH, parts: Array(C.SLOTS).fill(0.5), hold: C.LOAD, onParts: 0,
  declared: null, routed: null, submittedStage: null, lastRefit: null,
  stored: 0, takings: 0, rentPaid: 0, soldBack: 0,
});

export function createGame(opts = {}) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const seats = clamp(Math.round(opts.seats || LIMITS.seats.default),
                      LIMITS.seats.min, LIMITS.seats.max);
  const rounds = clamp(Math.round(opts.rounds || LIMITS.rounds.default),
                       LIMITS.rounds.min, LIMITS.rounds.max);
  const token = randomToken();
  const game = {
    version: VERSION, kind: KIND,
    code: opts.code || randomCode(),
    createdAt: opts.now || new Date().toISOString(),
    status: 'lobby',
    seed: opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9),
    config: {
      seats, rounds,
      public: !!opts.isPublic,
      /* On everywhere unless a table asks for them off. They were a config
         flag defaulting to false while the mechanic was unmeasured on this
         format; it is measured now. */
      warehouses: opts.warehouses === undefined ? true : !!opts.warehouses,
      cadenceMinutes: opts.cadence === 'manual' ? null
        : ((CADENCES[opts.cadence] || {}).minutes || clamp(Math.round(opts.cadenceMinutes || 5), 1, 10080)),
      closeHour: clamp(Math.round(opts.closeHour === undefined ? 18 : opts.closeHour), 0, 23),
    },
    round: 0,
    stage: null,           // 'declare' | 'route'
    deadline: null,
    hostToken: token,
    seats: [humanSeat(opts.hostName || 'Captain', token)],
    prices: null,
    block: null,
    /* every pile in every shed: "p:c" -> [{ owner, units }] */
    piles: {},
    history: [],
    lastResolvedAt: null,
  };
  return { game, token };
}

export function joinGame(game, name, now) {
  if (game.status !== 'lobby') throw new Error('That game has already started.');
  if (game.seats.length >= game.config.seats) throw new Error('That table is full.');
  const want = String(name).trim().toLowerCase();
  if (game.seats.some((s) => s.name.toLowerCase() === want))
    throw new Error('Someone at this table is already called that.');
  const token = randomToken();
  game.seats.push(humanSeat(name, token));
  game.joinedAt = now || new Date().toISOString();
  return { game, token };
}

/* Empty seats become bots, and nobody is told which. A table of one human is
   still a real game — which is the whole reason a public lobby can start at
   all before there are hundreds of players. */
export function startGame(game, token, now) {
  if ((game.kind || 'ceo') !== KIND) throw new Error('That is not a Cargo Run table.');
  if (token && token !== game.hostToken) throw new Error('Only the host can start the table.');
  if (game.status !== 'lobby') throw new Error('That game has already started.');
  const empty = game.config.seats - game.seats.length;
  for (let k = 0; k < empty; k++) game.seats.push(botSeat(k));
  game.status = 'playing';
  game.round = 1;
  openRound(game, now);
  return game;
}

/* ------------------------------------------------------- putting it right

   A cargo table that was started by CEO's code.

   The five-minute sweep in netlify/functions/tick.mjs was written when there
   was one game, and it called CEO's startPublic on every due lobby — so a
   cargo table whose wait ran out had its empty seats filled with COMPANIES:
   seats with a balance sheet, no ship, and no declared route. The next request
   settled it with this engine and died reaching for a price perception that
   was never there. The sweep is fixed; this is for the tables it already hit.

   Every seat it replaces is a bot. A human joined through joinGame and has a
   proper seat with their token on it, so the repair cannot take anybody's
   place away — and the round had not opened, so nothing played is lost. */
export function repair(game, now) {
  if (!game || (game.kind || 'ceo') !== KIND) return false;
  let fixed = false;
  game.seats = game.seats.map((s, k) => {
    if (s && Array.isArray(s.parts) && s.declared !== undefined) return s;
    fixed = true;
    return botSeat(k);
  });
  /* CEO's startGame set the table playing without ever opening a cargo round,
     so there is no block, no prices and no stage to be in. */
  if (game.status === 'playing' && (!game.block || !game.prices || !game.stage)) {
    game.round = game.round || 1;
    openRound(game, now);
    fixed = true;
  }
  return fixed;
}

/* ------------------------------------------------------------ a new round */
/* Prices for the week, and the parts that will be auctioned at the END of it.
   The block has to be drawn now because the bids are filed in the declare
   stage, which is the whole point of folding the yard into the first window. */
function openRound(game, now) {
  const board = boardFor(game.seed);
  /* A stream keyed on the round, so replaying a game from its seed lands on
     the same week every time and a lost write cannot shift the board. */
  const rnd = mulberry32((game.seed ^ (0x9e3779b9 * game.round)) >>> 0);
  game.prices = spotFor(board, game.prices, rnd);

  const failed = game.seats.map((s) => {
    const k = Math.floor(rnd() * C.SLOTS);
    return k;
  });
  const grades = Array.from({ length: C.PARTS },
    () => C.GRADE_LO + rnd() * (C.GRADE_HI - C.GRADE_LO)).sort((a, b) => b - a);
  /* Each captain reads the grades slightly differently — without it the bots
     file identical bids and every lot is a tie. */
  const eyes = game.seats.map(() => grades.map(() => Math.exp(0.06 * gauss(rnd))));
  game.block = { failed, grades, eyes };

  for (const s of game.seats) { s.declared = null; s.routed = null; s.submittedStage = null; }
  game.refit = null;              /* this round's yard has not been called yet */
  game.stage = 'declare';
  game.deadline = nextDeadline(game, now);
}

export function nextDeadline(game, now) {
  const mins = game.config.cadenceMinutes;
  if (!mins) return null;
  return new Date(new Date(now || Date.now()).getTime() + mins * 60000).toISOString();
}

/* ------------------------------------------------------------- what a route
   is worth to a captain who thinks they are alone, which is all anybody can
   see when they file. */
export function routesFor(game, seat, eye) {
  const board = boardFor(game.seed);
  const pr = game.prices;
  const out = [];
  for (const p of board.reachP[seat.at]) {
    for (const d of board.reachD[p]) {
      for (let c = 0; c < C.NC; c++) {
        const bp = pr.buy[p][c] * (eye ? eye.b[p][c] : 1);
        const sp = pr.sell[d][c] * (eye ? eye.s[d][c] : 1);
        const load = Math.min(seat.hold, Math.floor(seat.cash / bp));
        const fuel = C.FUEL * (board.sdist[seat.at][p] + board.pdist[p][d]);
        out.push({ p, c, d, load, fuel, gain: load * (sp - bp) - fuel - C.UPKEEP });
      }
    }
  }
  return out.sort((a, b) => b.gain - a.gain);
}

/* --------------------------------------------------------------- filing */
export const seatByToken = (game, token) => game.seats.find((s) => s.token && s.token === token);

export function submitDeclaration(game, token, raw) {
  if (game.status !== 'playing') throw new Error('That game is not running.');
  if (game.stage !== 'declare') throw new Error('The manifests are already out.');
  const seat = seatByToken(game, token);
  if (!seat) throw new Error('That is not a seat at this table.');
  const board = boardFor(game.seed);
  const p = Number(raw.pickup), c = Number(raw.commodity);
  if (!board.reachP[seat.at].includes(p)) throw new Error('Your ship cannot reach that spot.');
  if (!(c >= 0 && c < C.NC)) throw new Error('That is not a commodity.');
  /* the bids: one per lot, never more than the cash on hand when the window
     opened, and never negative */
  const bids = (game.block.grades).map((g, j) => {
    const v = Math.max(0, Math.round(Number((raw.bids || [])[j]) || 0));
    return Math.min(v, Math.max(0, Math.floor(seat.cash * 0.6)));
  });
  /* THE SHED. Two orders, both optional, both filed with the manifest.

     `store` is bought on top of a full hold and left at the spot. `collect`
     takes units back out of your own pile there and into the hold — the first
     version of this mechanic skipped your own lots when drawing from a pile,
     which made storage a one-way street and looked exactly like the idea not
     working. Both are clamped here rather than trusted. */
  let store = 0, collect = 0;
  if (game.config.warehouses) {
    store = Math.max(0, Math.round(Number(raw.store) || 0));
    if (!canStore(game)) store = 0;
    store = Math.min(store, C.STORE_MAX);
    collect = Math.max(0, Math.round(Number(raw.collect) || 0));
    collect = Math.min(collect, myStock(game, game.seats.indexOf(seat), p, c));
  }
  seat.declared = { round: game.round, p, c, bids, purse: seat.cash, store, collect };
  seat.submittedStage = 'declare';
  return game;
}

export function submitRoute(game, token, raw) {
  if (game.status !== 'playing') throw new Error('That game is not running.');
  if (game.stage !== 'route') throw new Error('The manifests are not out yet.');
  const seat = seatByToken(game, token);
  if (!seat) throw new Error('That is not a seat at this table.');
  if (!seat.declared) throw new Error('You did not file a manifest this round.');
  const board = boardFor(game.seed);
  const d = Number(raw.drop);
  if (!board.reachD[seat.declared.p].includes(d))
    throw new Error('That station does not take deliveries from where you loaded.');
  seat.routed = { round: game.round, d };
  seat.submittedStage = 'route';
  return game;
}

export const humansOutstanding = (game) =>
  game.seats.filter((s) => !s.isBot && s.submittedStage !== game.stage);

/* A stage closes when everyone still at the table has filed, or when the clock
   runs out. A timer alone punishes whoever shows up; waiting for everybody
   alone lets one absent captain freeze the table for a week. */
export function shouldResolve(game, now) {
  if (game.status !== 'playing') return false;
  if (game.paused) return false;
  if (humansOutstanding(game).length === 0) return true;
  if (!game.deadline) return false;
  return new Date(now || Date.now()).getTime() >= new Date(game.deadline).getTime();
}

/* ------------------------------------------------------------- the bots */
const eyesFor = (rnd) => ({
  b: Array.from({ length: C.NP }, () => Array.from({ length: C.NC }, () => Math.exp(0.05 * gauss(rnd)))),
  s: Array.from({ length: C.ND }, () => Array.from({ length: C.NC }, () => Math.exp(0.05 * gauss(rnd)))),
});

function botDeclare(game, seat, rnd) {
  const eye = eyesFor(rnd);
  const mine = routesFor(game, seat, eye);
  let chosen = mine[0];
  if (seat.habit === 'model') {
    /* prices the crowd rather than simply avoiding it: assume each rival takes
       one of its own top three, add up the tonnage, and value your own routes
       at the prices that crowd would actually produce */
    const eb = new Map(), es = new Map(), W = [0.6, 0.25, 0.15];
    for (const other of game.seats) {
      if (other === seat) continue;
      const rj = routesFor(game, other, eye);
      W.forEach((w, k) => {
        const t = rj[Math.min(k, rj.length - 1)];
        eb.set(t.p + ':' + t.c, (eb.get(t.p + ':' + t.c) || 0) + w * t.load);
        es.set(t.d + ':' + t.c, (es.get(t.d + ':' + t.c) || 0) + w * t.load);
      });
    }
    const board = boardFor(game.seed), pr = game.prices;
    let top = null;
    for (const x of mine) {
      const qb = (eb.get(x.p + ':' + x.c) || 0) + x.load;
      const qs = (es.get(x.d + ':' + x.c) || 0) + x.load;
      const g = x.load * (pr.sell[x.d][x.c] * eye.s[x.d][x.c] * sellMult(qs)
                        - pr.buy[x.p][x.c] * eye.b[x.p][x.c] * buyMult(qb))
                - x.fuel - C.UPKEEP;
      if (!top || g > top.g) top = { g, x };
    }
    chosen = top.x;
  }
  const bids = game.block.grades.map((g, j) => {
    const idx = game.seats.indexOf(seat);
    const full = worthOf(game, g, fallbackAt(game, j)) * game.block.eyes[idx][j];
    return Math.max(0, Math.min(seat.shade * full, Math.max(0, seat.cash) * 0.6));
  });
  /* A KEEPER'S RULE. Buy where the market is cheap against what the rock
     usually charges, and only while there is season left for somebody to come
     and want it. Deliberately simple: a bot that stored cleverly would be
     teaching the mechanic to itself, and the thing worth showing a captain is
     that somebody at this table is playing for traffic rather than away from
     it. */
  let store = 0, collect = 0;
  if (game.config.warehouses) {
    const mine = myStock(game, game.seats.indexOf(seat), chosen.p, chosen.c);
    if (mine > 0) collect = Math.min(mine, seat.hold);
    if (seat.habit === 'keeper' && canStore(game)) {
      const bd = boardFor(game.seed);
      const bp = game.prices.buy[chosen.p][chosen.c];
      const usual = C.BASE * bd.pbias[chosen.p][chosen.c];
      const cheap = usual / Math.max(bp, 1);
      /* 1.10 and 15%, not 1.02 and 35%. The old numbers had this bot tipping a
         third of its spare purse into a shed on a 2% signal, which under rules
         that burnt the leftovers made it a punching bag at every ranked table —
         a fifth of the field playing a style that lost $23,000 a season. What
         it stores now costs it $616 against never storing, and storing MORE is
         monotonically worse at every level measured, so this is about as far as
         the bot should go. */
      if (cheap > 1.10) {
        const spare = Math.max(0, seat.cash - chosen.load * bp - C.UPKEEP * 2);
        store = Math.min(C.STORE_MAX, Math.floor(spare * 0.15 / Math.max(bp, 1)));
      }
    }
  }
  seat.declared = { round: game.round, p: chosen.p, c: chosen.c, bids,
                    purse: seat.cash, eye, store, collect };
  seat.submittedStage = 'declare';
}

function botRoute(game, seat) {
  const board = boardFor(game.seed), pr = game.prices;
  const dec = seat.declared, eye = dec.eye || { b: null, s: null };
  const es = new Map();
  if (seat.habit === 'model') {
    for (const other of game.seats) {
      if (other === seat || !other.declared) continue;
      /* a rival holding this cargo has to land somewhere it can reach; assume
         its best posted station */
      const od = other.declared;
      let best = null;
      for (const d of board.reachD[od.p]) {
        const g = pr.sell[d][od.c];
        if (!best || g > best.g) best = { g, d };
      }
      es.set(best.d + ':' + od.c, (es.get(best.d + ':' + od.c) || 0) + other.hold);
    }
  }
  /* valued as a whole trip rather than per unit — the first version compared a
     per-unit price against a whole-trip fuel bill divided by the hold, which is
     the sort of dimensional slip that quietly makes long lanes look free */
  const bp = pr.buy[dec.p][dec.c];
  const load = Math.max(0, Math.min(seat.hold, Math.floor(seat.cash / bp)));
  let top = null;
  for (const d of board.reachD[dec.p]) {
    const qs = (es.get(d + ':' + dec.c) || 0) + load;
    const mult = seat.habit === 'model' ? sellMult(qs) : 1;
    const got = pr.sell[d][dec.c] * (eye.s ? eye.s[d][dec.c] : 1) * mult;
    const g = load * got - C.FUEL * (board.sdist[seat.at][dec.p] + board.pdist[dec.p][d]);
    if (!top || g > top.g) top = { g, d };
  }
  seat.routed = { round: game.round, d: top.d };
  seat.submittedStage = 'route';
}

/* ------------------------------------------------------------- the sheds

   A pile at a loading spot is SUPPLY. Three ships buying ore at the same rock
   bid the price up against each other — but not if there is already ore
   sitting there. So a keeper quietly damps the squeeze for everybody,
   including the rivals they are competing with, which is the one cooperative
   thread in an otherwise zero-sum table and the reason the mechanic is worth
   having at all.

   Everything here is deliberately public except who owns what. The stock is
   physically at the rock: anybody flying in can see it, and it is already in
   the price. Whose it is stays hidden until it sells, which is the whole
   fiction — you buy ore at Nine Pillars without knowing you just made a rival
   richer. */
export const pileKey = (p, c) => p + ':' + c;
export const pileAt = (game, p, c) => (game.piles || {})[pileKey(p, c)] || [];
export const stockAt = (game, p, c) =>
  pileAt(game, p, c).reduce((a, l) => a + l.units, 0);
export const myStock = (game, seatIdx, p, c) =>
  pileAt(game, p, c).filter((l) => l.owner === seatIdx).reduce((a, l) => a + l.units, 0);
/* How much of the sheds is yours, everywhere. READ off the piles rather than
   counted alongside them: a separate tally is a second copy of the truth, and
   the first time a captain buys back their own stock at market without meaning
   to, the two disagree and the screen starts lying about how much is out
   there. */
export const storedBy = (game, seatIdx) =>
  Object.keys(game.piles || {}).reduce((a, k) => {
    const [p, c] = k.split(':').map(Number);
    return a + myStock(game, seatIdx, p, c);
  }, 0);
/* stock absorbs the squeeze before the ships ever reach the market */
export const buyMultAt = (game, q, p, c) =>
  buyMult(Math.max(0, q - stockAt(game, p, c)));
/* Nothing goes into a shed in the closing rounds: stock still sitting there
   when the season ends is money burnt, and a rule nobody can see is a trap. */
export const canStore = (game) =>
  !!game.config.warehouses && (game.config.rounds - game.round) >= C.WIND_DOWN;

/* Units come out of the oldest lots first, so a pile that has been waiting
   longest is the one that clears. Returns what was drawn, by owner. */
function drawFromPiles(game, p, c, want) {
  const lots = pileAt(game, p, c);
  const out = [];
  let left = want;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(lot.units, left);
    if (take <= 0) continue;
    lot.units -= take; left -= take;
    out.push({ owner: lot.owner, units: take });
  }
  const left2 = lots.filter((l) => l.units > 0.0001);
  if (left2.length) game.piles[pileKey(p, c)] = left2;
  else delete game.piles[pileKey(p, c)];
  return out;
}

/* ------------------------------------------------------------- resolving */
export function resolveStage(game, now) {
  if ((game.kind || 'ceo') !== KIND) throw new Error('That is not a Cargo Run table.');
  if (game.status !== 'playing') throw new Error('That game is not running.');
  const rnd = mulberry32((game.seed ^ (0x85ebca6b * game.round) ^ (game.stage === 'route' ? 7 : 0)) >>> 0);

  if (game.stage === 'declare') {
    for (const s of game.seats) if (s.isBot && !s.declared) botDeclare(game, s, rnd);
    /* a human who filed nothing takes the best posted route, so an absent
       captain is idle rather than destroyed */
    for (const s of game.seats) if (!s.isBot && !s.declared) {
      const best = routesFor(game, s, null)[0];
      s.declared = { round: game.round, p: best.p, c: best.c,
                     bids: game.block.grades.map(() => 0), purse: s.cash, auto: true };
    }
    /* ---- AND THEN THE YARD, BEFORE ANYBODY PICKS A PORT ----------------
       The sealed bids are opened here rather than at the end of the round, so
       a captain chooses their destination already knowing who won which part
       and therefore how much every rival can carry. The purse is unchanged by
       it — the run has not paid yet, which is what kept the stale-purse
       property the original design was measured for. What changes is that the
       part you just won carries cargo on THIS run. */
    for (const s of game.seats) s.holdBefore = s.hold;
    game.refit = runRefit(game);
    game.stage = 'route';
    game.deadline = nextDeadline(game, now);
    return game;
  }

  /* ---- the run settles ------------------------------------------------- */
  const board = boardFor(game.seed), pr = game.prices;
  for (const s of game.seats) if (s.isBot && !s.routed) botRoute(game, s);
  for (const s of game.seats) if (!s.routed) {
    const dec = s.declared;
    let best = null;
    for (const d of board.reachD[dec.p]) {
      const g = pr.sell[d][dec.c];
      if (!best || g > best.g) best = { g, d };
    }
    s.routed = { round: game.round, d: best.d, auto: true };
  }

  /* WHERE EVERYBODY WAS STANDING WHEN THE ROUND OPENED.

     Captured before the settlement moves anybody, because the resolution is
     going to be animated and an animation needs the leg each ship flew, not
     just where it ended up. Cheap to record and impossible to reconstruct
     afterwards — once s.at is the destination, the origin is gone. */
  const startedAt = game.seats.map((s) => s.at);
  const startedCash = game.seats.map((s) => Math.round(s.cash));
  const startedHold = game.seats.map((s) => s.hold);   /* already refitted */

  const wh = !!game.config.warehouses;
  const qb = new Map(), qs = new Map();
  const plans = game.seats.map((s) => {
    const dec = s.declared, rt = s.routed;
    const bp = pr.buy[dec.p][dec.c];
    /* What comes out of your own shed costs nothing to buy — it is already
       yours — so it rides on top of what the purse can afford. */
    const collect = wh ? Math.min(dec.collect || 0, myStock(game, game.seats.indexOf(s), dec.p, dec.c)) : 0;
    const room = Math.max(0, s.hold - collect);
    const bought = Math.max(0, Math.min(room, Math.floor(s.cash / bp)));
    const load = bought + collect;
    qb.set(dec.p + ':' + dec.c, (qb.get(dec.p + ':' + dec.c) || 0) + bought);
    qs.set(rt.d + ':' + dec.c, (qs.get(rt.d + ':' + dec.c) || 0) + load);
    return { s, dec, rt, load, bought, collect };
  });

  /* Your own goods leave the shed before anybody else's are drawn from it. */
  if (wh) for (const x of plans) {
    if (x.collect <= 0) continue;
    const me = game.seats.indexOf(x.s);
    const lots = pileAt(game, x.dec.p, x.dec.c);
    let left = x.collect;
    for (const lot of lots) {
      if (left <= 0) break;
      if (lot.owner !== me) continue;
      const take = Math.min(lot.units, left);
      lot.units -= take; left -= take;
    }
    game.piles[pileKey(x.dec.p, x.dec.c)] = lots.filter((l) => l.units > 0.0001);
    void left;   /* what is in the shed is read off the piles, never counted */
  }

  const rows = plans.map((x) => {
    const { s, dec, rt, load, bought, collect } = x;
    /* stock at the rock absorbs the squeeze before the ships reach the market */
    const bm = wh ? buyMultAt(game, qb.get(dec.p + ':' + dec.c), dec.p, dec.c)
                  : buyMult(qb.get(dec.p + ':' + dec.c));
    const sm = sellMult(qs.get(rt.d + ':' + dec.c));
    const paid = pr.buy[dec.p][dec.c] * bm, got = pr.sell[rt.d][dec.c] * sm;
    const fuel = C.FUEL * (board.sdist[s.at][dec.p] + board.pdist[dec.p][rt.d]);
    let profit = load * got - bought * paid - fuel - C.UPKEEP;

    /* WHOSE GOODS THOSE WERE. What a carrier buys at a rock comes out of the
       piles sitting there first, and that part of the bill goes to the captain
       who left them rather than to the market — without the carrier ever
       learning whose it was, and without it costing them a penny. The carrier
       pays for the cargo once, at the posted price, exactly as they would at an
       empty rock. `profit` is already net of the whole purchase, so nothing is
       taken off it here: this moves money into a seat, it does not levy. */
    const from = wh ? drawFromPiles(game, dec.p, dec.c, bought) : [];
    const takings = [];
    for (const src of from) {
      if (src.owner === game.seats.indexOf(s)) continue;   /* your own, already yours */
      const due = src.units * paid;
      game.seats[src.owner].cash += due;
      game.seats[src.owner].takings = (game.seats[src.owner].takings || 0) + due;
      takings.push({ owner: src.owner, units: src.units, paid: Math.round(due) });
    }

    s.cash += profit; s.at = rt.d;
    return { name: s.name, p: dec.p, c: dec.c, d: rt.d, load, paid, got, profit,
             bought, collect,
             /* how much of what this captain bought came out of somebody's
                shed — the number, never the name */
             fromPiles: Math.round(from.filter((f) => f.owner !== game.seats.indexOf(s))
               .reduce((a, f) => a + f.units, 0)),
             takings,
             stackB: Math.round(qb.get(dec.p + ':' + dec.c) / C.LOAD),
             stackS: Math.round(qs.get(rt.d + ':' + dec.c) / C.LOAD) };
  });

  /* ---- and what gets left behind ---------------------------------------
     Bought on top of a full hold, at the price the round settled at, and only
     if the captain can still cover it once the run has paid. */
  const stored = [];
  if (wh) for (const x of plans) {
    const want = canStore(game) ? Math.max(0, x.dec.store || 0) : 0;
    if (want <= 0) continue;
    const price = rows[plans.indexOf(x)].paid;
    const units = Math.min(want, Math.floor(Math.max(0, x.s.cash) / Math.max(price, 0.01)));
    if (units <= 0) continue;
    x.s.cash -= units * price;
    const key = pileKey(x.dec.p, x.dec.c);
    game.piles[key] = (game.piles[key] || []).concat(
      [{ owner: game.seats.indexOf(x.s), units }]);
    stored.push({ who: game.seats.indexOf(x.s), p: x.dec.p, c: x.dec.c,
                  units, paid: Math.round(units * price) });
  }

  /* rent falls due on everything still sitting in a shed */
  const rents = game.seats.map(() => 0);
  if (wh) {
    for (const key of Object.keys(game.piles)) {
      for (const lot of game.piles[key]) {
        const due = lot.units * C.RENT;
        game.seats[lot.owner].cash -= due;
        game.seats[lot.owner].rentPaid = (game.seats[lot.owner].rentPaid || 0) + due;
        rents[lot.owner] += due;
      }
    }
  }

  /* The yard already ran, between the two windows, and everybody has seen it.
     Its log rides along in the history so the round can still be read whole. */
  const refit = game.refit || { lots: [], scrapped: [] };

  /* Everything the round needs to be watched rather than read. It rides in the
     history entry rather than being reassembled by the page, so the picture and
     the arithmetic cannot come apart — the page draws what happened, it does
     not work out what must have happened. About sixty numbers a round. */
  const replay = {
    round: game.round,
    at: startedAt,
    declared: game.seats.map((s) => ({ p: s.declared.p, c: s.declared.c })),
    rows: rows.map((r) => ({ p: r.p, c: r.c, d: r.d, load: r.load,
      paid: +r.paid.toFixed(2), got: +r.got.toFixed(2), profit: Math.round(r.profit),
      stackB: r.stackB, stackS: r.stackS })),
    prices: { buy: pr.buy, sell: pr.sell },
    block: { grades: game.block.grades, failed: game.block.failed },
    refit: {
      lots: refit.lots.map((l) => ({ lot: l.lot, grade: l.grade, who: l.who,
        paid: Math.round(l.paid), slot: l.slot,
        bids: (l.bids || []).map((b) => (b === null ? null : Math.round(b))) })),
      scrapped: refit.scrapped,
    },
    stored, rents: rents.map((x) => Math.round(x)),
    before: { cash: startedCash, hold: startedHold },
    after: { cash: game.seats.map((s) => Math.round(s.cash)),
             hold: game.seats.map((s) => s.hold) },
    names: game.seats.map((s) => s.name),
  };
  game.history.push({ round: game.round, rows, refit, replay, stored,
    cash: game.seats.map((s) => s.cash), holds: game.seats.map((s) => s.hold) });
  game.lastResolvedAt = now || new Date().toISOString();

  if (game.round >= game.config.rounds) {
    /* THE SHEDS ARE CLEARED. Whatever is still sitting in one is sold back at
       the rock's posted price. Stock is stock — it was bought with real money
       and it is still there — and burning it was the single biggest cost of
       the first version: 31% of everything stored, $8,645 a season, gone for
       no reason a captain could see or plan around. What a keeper is exposed
       to is the PRICE, which is the bet they meant to make. */
    if (game.config.warehouses) {
      for (const key of Object.keys(game.piles || {})) {
        const [sp, sc] = key.split(':').map(Number);
        for (const lot of game.piles[key]) {
          const back = lot.units * pr.buy[sp][sc];
          game.seats[lot.owner].cash += back;
          game.seats[lot.owner].soldBack = (game.seats[lot.owner].soldBack || 0) + back;
        }
      }
      game.piles = {};
    }
    game.status = 'over';
    game.stage = null;
    game.deadline = null;
  } else {
    game.round += 1;
    openRound(game, now);
  }
  return game;
}

export function runRefit(game) {
  const { failed, grades } = game.block;
  const done = game.seats.map(() => false);
  const log = [];
  for (let j = 0; j < grades.length; j++) {
    const bids = game.seats.map((s, i) => {
      if (done[i]) return null;
      const want = (s.declared && s.declared.bids[j]) || 0;
      /* void if the round has left them unable to cover it */
      return want > s.cash ? 0 : want;
    });
    let top = 0, who = -1;
    bids.forEach((b, i) => { if (b !== null && b > top) { top = b; who = i; } });
    if (who < 0) {
      who = done.findIndex((x) => !x);
      if (who < 0) { log.push({ lot: j, grade: grades[j], who: -1, paid: 0, bids }); continue; }
      top = 0;
    }
    const s = game.seats[who];
    s.cash -= top; s.onParts += top;
    s.parts[failed[who]] = grades[j];
    s.hold = holdOf(s);
    s.lastRefit = { lot: j, grade: grades[j], paid: top, slot: failed[who] };
    done[who] = true;
    log.push({ lot: j, grade: grades[j], who, paid: top, slot: failed[who], bids });
  }
  const scrapped = [];
  game.seats.forEach((s, i) => {
    if (done[i]) return;
    s.parts[failed[i]] = C.SCRAP; s.hold = holdOf(s);
    s.lastRefit = { lot: null, grade: C.SCRAP, paid: 0, slot: failed[i] };
    scrapped.push(i);
  });
  return { lots: log, scrapped };
}

/* ------------------------------------------------------------- the view */
/* What one captain is allowed to see. The manifests are public in the route
   stage — the hold and the three stations it could reach, never the station
   chosen — and nobody's sealed bids are visible until the yard has settled. */
export function viewFor(game, token) {
  const board = boardFor(game.seed);
  const me = seatByToken(game, token);
  const meIdx = game.seats.indexOf(me);
  const pub = (s, i) => ({
    name: s.name, at: s.at, cash: s.cash, hold: s.hold,
    ship: Math.round(100 * shipQ(s)), onParts: s.onParts,
    you: i === meIdx,
    filed: s.submittedStage === game.stage,
  });
  const view = {
    kind: KIND, code: game.code, status: game.status, round: game.round,
    /* the page needs this to know not to offer the code: a public table is
       dealt by matchmaking and the API refuses a code join, so showing one
       would be inviting a captain to do something that cannot work */
    isPublic: !!game.isPublic,
    lobbyDeadline: game.lobbyDeadline || null,
    rounds: game.config.rounds, stage: game.stage, deadline: game.deadline,
    seats: game.seats.map(pub),
    board: { pick: board.pick, drop: board.drop, reachP: board.reachP,
             reachD: board.reachD, pdist: board.pdist, sdist: board.sdist },
    prices: game.prices ? { buy: game.prices.buy, sell: game.prices.sell } : null,
    you: me ? { name: me.name, at: me.at, cash: me.cash, hold: me.hold,
                parts: me.parts, ship: Math.round(100 * shipQ(me)),
                declared: me.declared, routed: me.routed, lastRefit: me.lastRefit } : null,
    block: game.block ? {
      grades: game.block.grades,
      failed: me ? game.block.failed[meIdx] : null,
      worth: game.block ? game.block.grades.map((g, j) => worthOf(game, g, fallbackAt(game, j))) : [],
    } : null,
    /* THE ROUND, WITH THE NAMES FILED OFF.

       Two things in a history entry carry a seat index and must not travel:
       `row.takings` says which seat was paid for the goods a carrier loaded,
       and `stored` says who left what at which rock. Either one hands a captain
       the answer to the only question the mechanic keeps from them — whose
       shed that was — and the page never needed them, because it only ever
       looks for its OWN entries. So the server sends only those. This was a
       live leak in the first version, invisible on screen and one API response
       away for anybody who looked. */
    history: game.history.slice(-1).map((h) => ({
      ...h,
      rows: h.rows.map((r) => ({
        ...r,
        takings: (r.takings || []).filter((q) => q.owner === meIdx),
      })),
      stored: (h.stored || []).filter((x) => x.who === meIdx),
    })),
    perUnit: C.RULE,
    /* The numbers the page needs to work out what a run would pay, sent from
       here rather than written into the page. The projection has to be the
       arithmetic the server will actually do — a second copy of the economy in
       the client is a copy that drifts, and the first time it drifts the page
       is lying to a captain about money. */
    econ: { LOAD: C.LOAD, FUEL: C.FUEL, UPKEEP: C.UPKEEP,
            ELAS: C.ELAS, REF: C.REF,
            RENT: C.RENT, STORE_MAX: C.STORE_MAX },
    /* THE SHEDS.

       What is sitting at each loading spot is public: it is physically there,
       anybody flying in can see it, and it is already in the price — stock is
       supply, so a pile damps the squeeze for everybody. WHOSE it is stays
       private until it sells, which is the whole point of the mechanic: you
       buy ore at Nine Pillars without knowing you just made a rival richer.

       So `stock` names no owners, and `mine` is only ever this seat's. */
    sheds: game.config.warehouses ? {
      on: true, canStore: canStore(game),
      windDown: C.WIND_DOWN, rent: C.RENT, max: C.STORE_MAX,
      stock: Object.keys(game.piles || {}).map((k) => {
        const [p, c] = k.split(':').map(Number);
        return { p, c, units: Math.round(stockAt(game, p, c)) };
      }).filter((x) => x.units > 0),
      mine: me ? Object.keys(game.piles || {}).map((k) => {
        const [p, c] = k.split(':').map(Number);
        return { p, c, units: Math.round(myStock(game, meIdx, p, c)) };
      }).filter((x) => x.units > 0) : [],
      stored: me ? Math.round(storedBy(game, meIdx)) : 0,
      takings: me ? Math.round(me.takings || 0) : 0,
      rentPaid: me ? Math.round(me.rentPaid || 0) : 0,
      soldBack: me ? Math.round(me.soldBack || 0) : 0,
    } : { on: false },
  };
  /* the manifests, once they are out */
  if (game.stage === 'route' || game.status === 'over') {
    view.manifests = game.seats.map((s, i) => s.declared ? {
      name: s.name, you: i === meIdx, c: s.declared.c, p: s.declared.p,
      couldSell: board.reachD[s.declared.p],
    } : null).filter(Boolean);

    /* THE ENVELOPES, OPENED.

       Every bid on every lot, with a name against it. This is the one moment
       in the round where nothing is hidden, and it has to be complete: a
       reveal that showed only the winner would leave a captain guessing how
       close they came, which is the single most useful thing they can learn
       about how to bid next week. It is published only once the yard has
       actually settled — before that these are sealed, and the server is the
       only thing that has seen them. */
    if (game.refit) {
      view.refit = {
        lots: game.refit.lots.map((l) => ({
          lot: l.lot, grade: l.grade, who: l.who, slot: l.slot,
          paid: Math.round(l.paid),
          bids: (l.bids || []).map((b) => (b === null ? null : Math.round(b))),
        })),
        scrapped: game.refit.scrapped,
        names: game.seats.map((x) => x.name),
        holdNow: game.seats.map((x) => x.hold),
        holdWas: game.seats.map((x) => x.holdBefore === undefined ? x.hold : x.holdBefore),
      };
    }
  }

  /* WHO YOU WERE PLAYING AGAINST.

     Held back until the season is over, and then given in full — which of the
     five were people, and what the yard's own captains were actually doing.
     Withholding it during play is the point of the bots; withholding it
     afterwards is just refusing to answer the first question anybody asks. */
  if (game.status === 'over') {
    view.who = game.seats.map((s, i) => ({
      name: s.name, you: i === meIdx, isBot: !!s.isBot,
      style: s.isBot ? HABITS[s.habit] || 'trades on the posted board' : null,
    }));
  }
  return view;
}

/* What a bot was doing, in words a person would use. The habit is the bot's
   own field — this is only the translation, so the two cannot drift. */
const HABITS = {
  greedy: 'took the best-looking run each week',
  model: 'worked out where the others would go, and went elsewhere',
};
