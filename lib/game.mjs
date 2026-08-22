/* CEO — live sessions.
   Pure game logic: every function here takes a state object and returns a new
   one. Nothing touches the network, the clock is injected, and randomness is
   derived from the game seed. That is deliberate — it means a whole twelve-round
   season with missed deadlines and a bankruptcy can be played out in a Node test
   in milliseconds, which is the only practical way to be sure an asynchronous
   game that takes twelve days in real life actually works. */

import { randomBytes } from 'node:crypto';
import * as E from './engine.mjs';
import * as SUPPLY from './contracts.mjs';
import * as LEASE from './capacity.mjs';

const {
  C, newProduct, newFirm, live, value, effCapacity, companyValue,
  resolve, upkeep, applyAdvertising, sharedDemands, spill, distributeCustomers,
  newShockState, shockTick, shockMult, mulberry32,
  BOTS, seatRivals, estimateShare, botDecide, humaniseBot, humanPrice, botObserve,
} = E;

export const VERSION = 1;

/* Unambiguous alphabet: no O/0, no I/1/L. People read these codes aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(n = 6) {
  const b = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return s;
}

export function randomToken() {
  return randomBytes(18).toString('base64url');
}

/* Starting cash and the credit limit are the two constants the whole economy was
   balanced against, so hosts pick a named preset rather than typing a number.
   A host who sets $50,000 produces a game where nothing works, and the people who
   suffer are the players who joined, not the host who chose it. */
export const PRESETS = {
  forgiving: { label: 'Forgiving', cash: 320000, credit: 260000,
               note: 'More room to recover from a bad round.' },
  standard:  { label: 'Standard',  cash: 250000, credit: 200000,
               note: 'What the economy was balanced against.' },
  brutal:    { label: 'Brutal',    cash: 190000, credit: 140000,
               note: 'One bad call can end you. Not for a first game.' },
};

/* Seat count barely matters — every seat brings its own customers as well as its
   own fixed costs (test/seats.mjs, 24 seasons per cell).

   Length was capped at 14 when a company could only ever run one product and had
   no answer to its decline. Launching fixed that, and re-measuring showed the
   decline plateaus rather than compounding: never launching, a 20-round game ends
   at $224k against a 12-round game's $229k. So the cap goes back up. */
export const LIMITS = {
  seats: { min: 3, max: 6, default: 4 },
  rounds: { min: 8, max: 20, default: 10 },
};

/* How much of the game is switched on.

   §40 measured this rather than guessing at it. Eight ways of playing, 300
   seeded seasons each: hiding process research and launching narrows the gap
   between the best style and the worst from $588,478 to $297,743. Those two
   levers alone are worth $290,735 of separation — three times what the supply
   contract and the leases add together.

   The reason to hide them is not that the game is too long, it is that the
   single most self-destructive thing available to a beginner here is
   over-investing in process research. The style that does it goes bankrupt in
   91% of seasons. A first game in which a student can destroy their company nine
   times in ten with an abstract lever nobody has taught them yet is a bad first
   game, and taking it away is a better decision than any amount of adding.

   So the levels are not "the game" and "the game plus extras". The first is a
   complete game about matching supply to demand at a price, and the second is
   everything — roughly three parts existing complexity revealed to one part new
   mechanics.

   Level 2 is the default, so every game that existed before this did keeps
   behaving exactly as it did. */
export const LEVELS = {
  1: {
    id: 1,
    label: 'First game',
    short: 'Five decisions a line',
    note: 'Price, how much to build, advertising, product research and the size of '
        + 'the plant. One product line. Teachable in ten minutes.',
    forWhom: 'A first sitting. Nobody has played before.',
    processRd: false,
    launch: false,
    contracts: false,
    leases: false,
    discontinue: false,
  },
  2: {
    id: 2,
    label: 'The full game',
    short: 'Everything',
    note: 'Adds process research, opening new product lines, supply contracts and '
        + 'leasing plant in and out. The headlines start carrying a price.',
    forWhom: 'A second sitting, with people who have played once.',
    processRd: true,
    launch: true,
    contracts: true,
    leases: true,
    discontinue: true,
  },
};

export const DEFAULT_LEVEL = 2;

/* The rules in force for one game. Everything that asks "is this lever on?"
   comes through here, so there is one answer rather than a condition repeated in
   six places that can drift apart. */
export const rulesOf = (game) =>
  LEVELS[(game && game.config && game.config.level) || DEFAULT_LEVEL] || LEVELS[DEFAULT_LEVEL];

/* How long a round lasts.

   A day suits a game played across a week in a group chat. Five minutes suits
   four people at their screens who want a whole company's life in an hour. They
   are the same game — only the clock changes — so the host picks. */
export const CADENCES = {
  '5m':  { label: '5 minutes', minutes: 5,
           note: 'A whole game in about an hour. Everyone at their screens.' },
  '15m': { label: '15 minutes', minutes: 15,
           note: 'Room to think without losing the thread.' },
  '1h':  { label: 'An hour', minutes: 60,
           note: 'Dip in and out across an afternoon.' },
  '4h':  { label: '4 hours', minutes: 240,
           note: 'A few rounds a day.' },
  '1d':  { label: 'A day', minutes: 1440,
           note: 'One round a day, at a fixed time everyone knows.' },
  /* A course meets once a week, so a round lasts a week. This is how the
     established classroom simulations are actually run — students file between
     lectures and the results are the material for the next one — and until it was
     added the clock simply stopped at "a day", which meant the commonest teaching
     rhythm in the world could not be expressed. */
  '1w':  { label: 'A week', minutes: 10080,
           note: 'One round between classes. How a course actually runs.' },
  /* And no clock at all, for a room where the instructor is the clock. Rounds
     close when everyone in the group has filed, or when the facilitator says so —
     which covers a round a week, three rounds in one session, and a class that
     overruns, without anybody having to pick a number that fits all three. */
  'manual': { label: 'When I say', minutes: null,
              note: 'No deadline. Rounds close when you close them, or when a group has all filed.' },
};

/* A round with no clock. Only classes use it, and it changes exactly one thing:
   nothing expires on its own. */
export const isManual = (game) => !game.config.cadenceMinutes;

export const cadenceOf = (game) =>
  (!game.config.cadenceMinutes ? CADENCES.manual
    : Object.values(CADENCES).find((c) => c.minutes === game.config.cadenceMinutes))
  || { label: `${game.config.cadenceMinutes} minutes`, minutes: game.config.cadenceMinutes, note: '' };

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/* ------------------------------------------------------------------ seats */

function humanSeat(name, token, cash) {
  return {
    id: randomToken().slice(0, 8),
    name: String(name).slice(0, 28).trim() || 'Unnamed Co',
    isBot: false, botId: null, token,
    firm: null, cash,
    lastPrice: null, lastShare: null, lastDemand: null, lastSales: null,
    lastPriceBy: null, lastDemandBy: null, settled: false,
    pending: null, standing: null, submittedRound: -1, autoRounds: 0,
    lastProduced: 0, contract: null, leases: [],
    out: false,
  };
}

function botSeat(seat, cash) {
  return {
    id: randomToken().slice(0, 8),
    name: seat.label,
    isBot: true, botId: seat.bot.id, token: null,
    firm: null, cash,
    lastPrice: null, lastShare: null, lastDemand: null, lastSales: null,
    lastPriceBy: null, lastDemandBy: null, settled: false,
    pending: null, standing: null, submittedRound: -1, autoRounds: 0,
    lastProduced: 0, contract: null, leases: [],
    out: false,
    botState: null,
  };
}

/* mulberry32 returns a closure, which JSON cannot hold. Rather than trying to
   serialise a generator, each bot gets a fresh stream per round derived from
   (seed, seat, round). Deterministic, replayable, and nothing to persist. */
function hydrate(seat, game, index) {
  const st = seat.botState;
  st.rand = mulberry32((game.seed ^ (index + 1) * 7919 ^ game.round * 104729) >>> 0);
  return st;
}

/* ------------------------------------------------------------- create/join */

export function createGame(opts = {}) {
  const preset = PRESETS[opts.preset] ? opts.preset : 'standard';
  const p = PRESETS[preset];
  const seats = clamp(Math.round(opts.seats || LIMITS.seats.default),
                      LIMITS.seats.min, LIMITS.seats.max);
  const rounds = clamp(Math.round(opts.rounds || LIMITS.rounds.default),
                       LIMITS.rounds.min, LIMITS.rounds.max);
  const token = randomToken();
  const game = {
    version: VERSION,
    code: opts.code || randomCode(),
    createdAt: opts.now || new Date().toISOString(),
    status: 'lobby',
    seed: opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e9),
    config: {
      seats, rounds, preset,
      cash: p.cash, credit: p.credit,
      /* How long each round lasts. A daily game is additionally anchored to a
         fixed hour, because "6pm" is easier to live with than "23 hours from
         whenever the last one happened to close". */
      /* null means "no clock" — see CADENCES.manual. Everything else is clamped
         to the range the named cadences cover, a week now being the longest. */
      cadenceMinutes: opts.cadence === 'manual' ? null
        : ((CADENCES[opts.cadence] || {}).minutes
           /* Fractions below a minute are the bot league, where a round closes as
              soon as every program has filed and the clock is only there to move
              a table on past one that has crashed. */
           || (opts.cadenceMinutes && opts.cadenceMinutes < 5
               ? Math.max(0.1, opts.cadenceMinutes)
               : clamp(Math.round(opts.cadenceMinutes || 1440), 5, 10080))),
      closeHour: clamp(Math.round(opts.closeHour === undefined ? 18 : opts.closeHour), 0, 23),
      /* Which levers are switched on. Defaults to everything, so nothing that
         existed before this changes behaviour. */
      level: LEVELS[opts.level] ? Number(opts.level) : DEFAULT_LEVEL,
    },
    round: 0,
    deadline: null,
    hostToken: token,
    seats: [humanSeat(opts.hostName || 'Host', token, p.cash)],
    history: [],
    news: [],
    shocks: null,
    lastResolvedAt: null,
  };
  return { game, token };
}

export function joinGame(game, name, now) {
  if (game.status !== 'lobby') throw new Error('That game has already started.');
  if (game.seats.length >= game.config.seats) throw new Error('That game is full.');
  const taken = game.seats.some((s) => s.name.toLowerCase() === String(name).trim().toLowerCase());
  if (taken) throw new Error('Someone in this game is already called that.');
  const token = randomToken();
  game.seats.push(humanSeat(name, token, game.config.cash));
  game.joinedAt = now || new Date().toISOString();
  return { game, token };
}

/* The host may start early; empty seats become bots. Nobody is told which. */
export function startGame(game, token, now) {
  if (token !== game.hostToken) throw new Error('Only the host can start the game.');
  if (game.status !== 'lobby') throw new Error('That game has already started.');
  const empty = game.config.seats - game.seats.length;
  if (empty > 0) {
    const bots = seatRivals(game.seed, Math.min(empty, BOTS.length), true);
    for (const b of bots) {
      const s = botSeat(b, game.config.cash);
      s.botState = { drift: 0, lastShare: null, lastStockout: false,
                     mistakeCd: 0, anchor: b.bot.priceRatio };
      game.seats.push(s);
    }
  }
  /* Seat order is shuffled so that "the host is always first" carries no
     information about who is real. */
  const rnd = mulberry32((game.seed ^ 0x9e3779b9) >>> 0);
  game.seats = E.shuffle(game.seats, rnd);

  for (const s of game.seats) {
    s.firm = newFirm(game.config.cash);
    s.firm.products.push(newProduct(s.id));
    s.lastPrice = value(live(s.firm)[0]) * 0.95;
    s.lastShare = 1 / game.seats.length;
  }
  game.status = 'playing';
  game.round = 0;
  game.shocks = newShockState(game.seed);
  game.news = shockTick(game.shocks, game.seats.map((s) => s.firm));
  for (const s of game.seats) upkeep(s.firm, 0);
  game.deadline = nextDeadline(game, now, true);
  game.startedAt = now || new Date().toISOString();
  return game;
}

/* When the current round closes.

   A daily game is anchored to the host's chosen hour, so it lands at the same
   time every day — and never four minutes from now because the host happened to
   create the game at 17:56. Anything shorter simply runs from the moment the
   previous round resolved, because a fixed hour means nothing at five minutes.

   The first round of a fast game gets extra time: everyone has just arrived and
   is reading the screen for the first time. */
export function nextDeadline(game, now, first) {
  const base = now ? new Date(now) : new Date();
  const mins = game.config.cadenceMinutes;

  /* No clock: the facilitator closes the round, or everyone filing does. */
  if (!mins) return null;

  if (mins >= 1440) {
    const d = new Date(base);
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(game.config.closeHour);
    /* A round must not land in the next few hours just because the game happened
       to be created in the morning. For a daily game six hours of lead is enough;
       for a weekly one it has to be most of a week, or the first round would
       close the same evening. */
    const MIN_LEAD_MS = mins >= 10080 ? 5 * 24 * 3600 * 1000 : 6 * 3600 * 1000;
    while (d.getTime() - base.getTime() < MIN_LEAD_MS) {
      d.setTime(d.getTime() + mins * 60000);
    }
    return d.toISOString();
  }

  const grace = first && mins <= 60 ? 2 : 1;
  return new Date(base.getTime() + mins * grace * 60000).toISOString();
}

/* ------------------------------------------------------------- decisions */

export const seatByToken = (game, token) =>
  game.seats.find((s) => s.token && s.token === token) || null;

/* What the client sends, normalised and clamped. Everything a player can type is
   bounded here rather than in the browser, because the browser is theirs. */
export function normaliseDecisions(raw, product, firm, rules) {
  const n = (x, d = 0) => (Number.isFinite(+x) ? +x : d);
  const r = rules || LEVELS[DEFAULT_LEVEL];
  const cap = Math.max(C.CAPACITY_FLOOR, n(raw.targetCapacity, product.capacity));
  return {
    price: Math.max(0, n(raw.price, value(product))),
    produce: Math.max(0, n(raw.produce, 0)),
    rd: Math.max(0, n(raw.rd, 0)),
    /* Levers the level does not offer are zeroed here rather than refused.

       A hidden control that throws when something sends it anyway is a trap for
       a standing order filed before the host changed anything, and for anybody
       replaying a saved request. Refusing belongs to the decisions a player
       makes deliberately — launching, signing a contract, taking a lease — where
       silence would be worse than an error. A number that is not on the screen
       is simply not spent. */
    rdProcess: r.processRd ? Math.max(0, n(raw.rdProcess, 0)) : 0,
    advertising: Math.max(0, n(raw.advertising, 0)),
    targetCapacity: cap,
    discontinue: r.discontinue ? !!raw.discontinue : false,
  };
}

/* What a company spends on advertising if nobody tells it otherwise.

   This was zero, and zero turned out to be close to the worst number available.
   Measured over 60 public games: a player who files the shipped defaults and
   changes nothing wins 5% of the time — against a 20% baseline for five seats —
   and finishes below their starting cash in 82% of games. The same player with
   $6,000 of advertising and nothing else changed wins 28% and is in profit 52%
   of the time.

   The whole beginner gap was one lever the game itself set to nothing. That is
   not difficulty, it is a bad opening move handed to somebody who has no way of
   knowing it is bad, and the people it punished hardest were the ones who missed
   a deadline and got carried by standing orders.

   $5,000 sits on a broad plateau — anything from $4,000 to $10,000 performs
   about the same — so this is a sane starting point rather than the optimum, and
   there is still something to be gained by paying attention to it. */
export const DEFAULT_ADVERTISING = 5000;

/* A product that has never had orders filed still has to trade. This is what it
   does: price at value, build to last round's demand, keep research ticking over.
   Deliberately unremarkable — it should never be better than showing up. */
function defaultFor(seat, p, rules) {
  /* The category grows with the number of sellers — each firm brings its own
     customers — so a product's demand is roughly its own pool, not a slice of one
     shared pot. Estimating from the pool rather than from share is what keeps a
     first-round auto-order from under-producing by half. */
  const target = (seat.lastDemandBy && seat.lastDemandBy[p.name]) || E.demandPool(p);
  return {
    price: Math.round(value(p)),
    produce: Math.max(0, Math.min(target, effCapacity(p)) - p.inventory),
    rd: 30000, rdProcess: rules.processRd ? 10000 : 0,
    advertising: DEFAULT_ADVERTISING,
    targetCapacity: p.capacity, discontinue: false,
  };
}

/* Orders for every line a company runs, plus whether it is opening another. */
function defaultOrders(seat, rules) {
  const products = {};
  for (const p of live(seat.firm)) products[p.name] = defaultFor(seat, p, rules);
  return { products, launch: false };
}

export function submitDecisions(game, token, raw) {
  if (game.status !== 'playing') throw new Error('That game is not running.');
  const seat = seatByToken(game, token);
  if (!seat) throw new Error('We do not recognise you in this game.');
  if (seat.out || seat.firm.bankrupt) throw new Error('Your company is out of the game.');
  const lines = live(seat.firm);
  if (!lines.length) throw new Error('You have no products left.');

  const rules = rulesOf(game);
  const products = {};
  const sent = (raw && raw.products) || {};
  for (const p of lines) {
    products[p.name] = normaliseDecisions(sent[p.name] || {}, p, seat.firm, rules);
  }
  /* Discontinuing everything is the same as quitting, and quitting mid-round is
     not a move the game offers. */
  if (lines.every((p) => products[p.name].discontinue)) {
    throw new Error('You cannot discontinue every product at once.');
  }

  let launch = !!(raw && raw.launch);
  const launchKind = E.KINDS[raw && raw.launchKind] ? raw.launchKind : 'hardware';
  if (launch) {
    if (!rules.launch) throw new Error('This game runs one product line. Opening another is part of the full game.');
    if (lines.length >= C.MAX_PRODUCTS) throw new Error(`You can run at most ${C.MAX_PRODUCTS} product lines.`);
    if (game.config.rounds - game.round < 3) throw new Error('There is not enough time left for a new line to pay back.');
    if (!canAfford(seat.firm, game, launchKind)) {
      throw new Error('A new line of that kind would leave you without enough credit to survive its first rounds.');
    }
  }
  /* A supply contract is signed in the same breath as the orders, and for the
     same reason: it is a commitment made without seeing what anybody else did.
     Signing is not part of the standing orders that repeat — a contract that
     renewed itself every round because somebody missed a deadline would be the
     single most expensive silent default in the game. */
  if (raw && raw.contract) {
    if (!rules.contracts) throw new Error('Supply contracts are part of the full game.');
    seat.contract = SUPPLY.sign(seat, game, raw.contract,
                                supplyReference(seat), baseUnitOf(seat, game));
  }

  /* Leases are signed in the same breath as the orders, like the supply
     contract, and for the same reason. They take effect in the round about to be
     resolved — renting plant that already exists is the one way to add capacity
     without waiting, and that immediacy is the entire reason to pay more for it
     than owning. */
  if (raw && Array.isArray(raw.leases) && raw.leases.length) {
    if (!rules.leases) throw new Error('Leasing plant is part of the full game.');
    const signed = raw.leases.map((l) => LEASE.lease(seat, game, l || {}));
    seat.leases = (seat.leases || []).concat(signed);
  }

  seat.pending = { products, launch, launchKind };
  seat.submittedRound = game.round;
  return game;
}

/* The throughput a supplier quotes against: how many units this company built
   last round. Before there is a last round, what it could build — a company in
   round one has produced nothing, and quoting against zero would mean no offer
   exists on the one screen where the idea has to be introduced.

   Production rather than sales, which is what it was first. The two differ by
   about 40% in a growing company, so quoting against sales meant "commit to one
   times your throughput" silently meant seven tenths of what the player was
   actually buying — a number nobody could reason about from the screen. What you
   built last round is a figure a player can check. */
function supplyReference(seat) {
  const built = Number(seat.lastProduced) || 0;
  if (built > 0) return built;
  const lines = live(seat.firm);
  if (!lines.length) return 0;
  return lines.reduce((a, p) => a + effCapacity(p), 0) * 0.6;
}

/* Charge or credit the round's supply contract, and let it count against the
   credit line like any other money.

   resolve() has already moved cash, converted an overdraft into debt and decided
   whether the company is bankrupt, so all three have to be redone rather than
   left to next round: a contract big enough to break a company should break it
   in the round it lands, not one round later when the player has already been
   told they survived. */
function settleSupply(seat, game, res, costShock) {
  const contract = seat.contract;
  const s = SUPPLY.settle(contract, res.log, costShock, game.round);
  if (!s.active) return null;

  /* Keep the rate the contract is quoted against fresh, for the round where a
     company produces nothing and there is no observed rate. */
  if (s.units > 0) contract.baseUnit = s.base;
  contract.paid = (contract.paid || 0) + Math.max(0, s.adjustment);
  contract.saved = (contract.saved || 0) + Math.max(0, -s.adjustment);

  const firm = seat.firm;
  /* The engine pushed this round's profit before the contract was known. */
  if (firm.profitHistory.length) {
    firm.profitHistory[firm.profitHistory.length - 1] -= s.adjustment;
  }
  firm.cash -= s.adjustment;
  if (firm.cash < 0) {
    firm.debt += -firm.cash;
    firm.cash = 0;
  } else if (firm.debt > 0) {
    const pay = Math.min(firm.cash, firm.debt);
    firm.debt -= pay;
    firm.cash -= pay;
  }
  if (firm.debt > game.config.credit) firm.bankrupt = true;

  return s;
}

/* Fold this round's leases into the plant, and return exactly what was applied
   so the same amount can be taken back out afterwards.

   Clamped at the engine's own capacity floor rather than trusted from the moment
   the lease was signed: a player can rent plant out and then sell more of the
   line underneath it, and the floor has to hold either way. Whatever cannot be
   applied simply is not — the rent is still owed, which is what renting
   something out and then selling it means. */
function applyLeases(seat, round) {
  const list = seat.leases;
  if (!list || !list.length) return null;
  const applied = new Map();
  for (const p of live(seat.firm)) {
    const want = LEASE.deltaFor(list, round, p.name);
    if (!want) continue;
    const room = want < 0 ? -Math.min(-want, Math.max(0, p.capacity - LEASE.C.FLOOR)) : want;
    if (!room) continue;
    p.capacity += room;
    applied.set(p.name, room);
  }
  return applied.size ? applied : null;
}

function releaseLeases(seat, applied) {
  if (!applied) return;
  for (const p of seat.firm.products) {
    const d = applied.get(p.name);
    if (d) p.capacity -= d;
  }
}

/* Rent, in and out, charged like any other money. Same shape as the supply
   contract settlement, and for the same reason: resolve() has already decided
   cash, debt and bankruptcy, so all three are redone once the rent is known. */
function settleLeases(seat, game) {
  const s = LEASE.settle(seat.leases, game.round);

  /* Anything with no rounds left after this one is dropped. `>` rather than
     `>=` because this runs before the round counter moves: a lease ending this
     round has just been paid for and is finished, and keeping it until the next
     settlement would leave a spent lease sitting in storage for a round. Done
     before the early return, since the round with nothing to settle is exactly
     the round with something to clear away. */
  seat.leases = (seat.leases || []).filter((l) => l.to > game.round);

  if (!s.active) return null;

  const firm = seat.firm;
  if (firm.profitHistory.length) {
    firm.profitHistory[firm.profitHistory.length - 1] -= s.adjustment;
  }
  firm.cash -= s.adjustment;
  if (firm.cash < 0) {
    firm.debt += -firm.cash;
    firm.cash = 0;
  } else if (firm.debt > 0) {
    const pay = Math.min(firm.cash, firm.debt);
    firm.debt -= pay;
    firm.cash -= pay;
  }
  if (firm.debt > game.config.credit) firm.bankrupt = true;
  return s;
}

/* What a unit costs to make with the market's blended shock divided back out
   across the lines this company runs. Only ever used for a round in which
   nothing at all is produced; see the note in lib/contracts.mjs. */
function baseUnitOf(seat, game) {
  const lines = live(seat.firm);
  if (!lines.length) return 0;
  const total = lines.reduce((a, p) => a + E.unitCost(p, 1), 0);
  return total / lines.length;
}

/* A launch may be paid for with cash, with borrowing, or with both. Requiring
   cash on the barrel made the lever unreachable: measured over 24 seasons at four
   companies, a player had $180,000 spare in fewer than one game in eight, so the
   answer to a maturing product effectively did not exist. Letting it be borrowed
   is what makes it a decision — and it is the decision the interest rate exists to
   price, because launching on credit is exactly when your borrowing gets dearer. */
function canAfford(firm, game, kind) {
  const cost = E.launchCostOf(kind || 'hardware');
  const headroom = Math.max(0, game.config.credit - firm.debt);
  /* Not just "can it be paid for" but "can the ramp be survived". A new line costs
     roughly $87,000 a round more than the round before it and takes two rounds to
     reach full demand, so a launch that empties the credit line is a company that
     goes under two rounds later — measured at 96% bankruptcy before this reserve
     existed. */
  return firm.cash + headroom - cost >= C.LAUNCH_RESERVE;
}

/* Engine-shaped orders from client-shaped ones. */
function toEngine(d, product) {
  const build = Math.max(0, d.targetCapacity - product.capacity);
  const sell = Math.max(0, product.capacity - d.targetCapacity);
  return {
    price: d.price, produce: d.produce, rd: d.rd, rdProcess: d.rdProcess,
    advertising: d.advertising, capex: build * C.CAPEX_PER_UNIT,
    sellCapacity: sell, discontinue: d.discontinue,
  };
}

/* Standing orders have to survive the product list changing under them: a line
   launched last round has no previous orders, and a discontinued one must not
   keep receiving them. */
function ordersFor(seat, game) {
  const rules = rulesOf(game);
  const filed = seat.submittedRound === game.round;
  const src = filed ? seat.pending : seat.standing;
  const products = {};
  for (const p of live(seat.firm)) {
    const prev = src && src.products && src.products[p.name];
    /* Standing orders are re-normalised rather than trusted. A host who moves a
       running game down a level would otherwise leave a repeating order still
       spending on a lever the game no longer offers, for the rest of the
       season, with nothing on the screen to explain it. */
    products[p.name] = normaliseDecisions(prev || defaultFor(seat, p, rules), p, seat.firm, rules);
  }
  return { products,
           launch: filed && rules.launch ? !!(src && src.launch) : false,
           launchKind: (src && src.launchKind) || 'hardware', filed };
}

export const activeSeats = (game) =>
  game.seats.filter((s) => !s.firm.bankrupt && live(s.firm).length > 0);

export const humansOutstanding = (game) =>
  activeSeats(game).filter((s) => !s.isBot && s.submittedRound !== game.round);

/* A round closes when everyone still playing has filed, or when the clock runs
   out — whichever comes first. A timer alone punishes the people who show up;
   waiting for everyone alone lets one absent player freeze the game for a week. */
export function shouldResolve(game, now) {
  if (game.status !== 'playing') return false;
  /* A facilitator can hold a class still — for a discussion, a fire drill, or
     because half the room is stuck. Nothing resolves until they let it. */
  if (game.paused) return false;
  if (!activeSeats(game).length) return true;
  if (humansOutstanding(game).length === 0) return true;
  /* With no clock there is nothing else to be waiting for. Without this guard a
     null deadline parses as 1970 and every round would close instantly. */
  if (!game.deadline) return false;
  return new Date(now || Date.now()).getTime() >= new Date(game.deadline).getTime();
}

/* -------------------------------------------------------------- the round */

export function resolveRound(game, now) {
  if (game.status !== 'playing') throw new Error('That game is not running.');
  const mult = (t) => (game.shocks ? shockMult(game.shocks, t) : 1.0);
  const rules = rulesOf(game);
  const playing = activeSeats(game);
  if (!playing.length) { game.status = 'over'; return game; }

  /* Everyone commits blind, and everyone may be running more than one line. Plans
     are built against LAST round's prices — the bots have no more information
     than the players do. */
  const seatPlans = playing.map((seat, i) => {
    const lines = live(seat.firm);
    const rivalProducts = playing.filter((_, j) => j !== i)
      .flatMap((s) => live(s.firm));
    const rivalPrices = playing.filter((_, j) => j !== i)
      .flatMap((s) => live(s.firm).map((rp) => (s.lastPriceBy && s.lastPriceBy[rp.name]) || s.lastPrice));

    if (seat.isBot) {
      const st = hydrate(seat, game, game.seats.indexOf(seat));
      const eff = humaniseBot(BOTS.find((b) => b.id === seat.botId), st);
      const decisions = {};
      for (const p of lines) {
        const price = humanPrice(value(p), eff.priceRatio, st.rand);
        const guess = estimateShare(p, price, rivalProducts, rivalPrices, mult('demand'));
        const plan = E.botDecideFor(seat.firm, eff, p, guess, {
          capacityMult: mult('capacity'), budgetShare: 1 / lines.length,
        });
        plan.price = price;
        /* The archetypes play by the level's rules too. A bot quietly spending on
           process research in a game where the control is not on the screen would
           be beating players with a lever they cannot reach, and the first anybody
           would know of it is a company that is inexplicably cheaper. */
        if (!rules.processRd) plan.rdProcess = 0;
        decisions[p.name] = plan;
      }
      const launch = rules.launch
        && E.botShouldLaunch(seat.firm, game.round, game.config.rounds, st.rand,
                             game.config.credit);
      /* Bots pick a kind the way their personality would: the discounter goes
         commodity, the premium and marketer go deep tech, the operator sticks to
         what it knows how to build. */
      const kindByBot = { discounter: 'commodity', premium: 'deeptech',
                          marketer: 'software', operator: 'hardware', balanced: 'software' };
      const launchKind = kindByBot[seat.botId] || 'hardware';
      delete st.rand;
      return { seat, decisions, client: null, auto: false, launch, launchKind };
    }

    /* Standing orders: if you did not file, last round's orders repeat. It keeps
       the game moving, it is what a company with no new decisions actually does,
       and it lets someone set something sensible and let a few rounds ride. */
    const orders = ordersFor(seat, game);
    if (!orders.filed) seat.autoRounds += 1;
    const decisions = {};
    for (const p of lines) decisions[p.name] = toEngine(orders.products[p.name], p);
    return { seat, decisions,
             client: { products: orders.products, launch: orders.launch,
                       launchKind: orders.launchKind },
             auto: !orders.filed, launch: orders.launch, launchKind: orders.launchKind };
  });

  /* Leased plant is folded into the products for exactly the length of this
     round and folded back out below. It has to happen here — after the build and
     sell orders were computed against owned capacity, so nobody can sell a
     factory they are renting, and before the market is divided, because the
     share split caps each company at what it can actually make. */
  const leased = new Map();
  for (const { seat } of seatPlans) {
    const applied = applyLeases(seat, game.round);
    if (applied) leased.set(seat, applied);
  }

  /* Advertising buys awareness, and awareness pulls share — so it has to land
     before the market is divided. */
  for (const { seat, decisions } of seatPlans) applyAdvertising(seat.firm, decisions);

  /* One entry per product, across every company. A firm running two lines
     competes with itself as well as with everyone else, which is exactly the
     trade-off launching is supposed to present. */
  const entries = [];
  for (const { seat, decisions } of seatPlans) {
    for (const p of live(seat.firm)) {
      entries.push({ seat, product: p, price: decisions[p.name].price,
                     plan: decisions[p.name] });
    }
  }
  const { demands, shares } = sharedDemands(
    entries.map((e) => ({ product: e.product, price: e.price })), mult('demand'));
  const avail = entries.map((e) =>
    e.product.inventory + Math.min(e.plan.produce, effCapacity(e.product) * mult('capacity')));
  const split = spill(demands, avail);

  const byName = {};
  entries.forEach((e, i) => {
    byName[e.product.name] = { demand: demands[i], share: shares[i], sales: split[i] };
  });

  const results = [];
  for (const { seat, decisions, client, auto } of seatPlans) {
    const lines = live(seat.firm);
    const sharedFor = {};
    for (const p of lines) sharedFor[p.name] = byName[p.name].sales;
    const res = resolve(seat.firm, decisions, game.round, {
      marketMult: mult('demand'), costShock: mult('cost'), capacityMult: mult('capacity'),
      sharedDemands: sharedFor, creditLimit: game.config.credit,
    });

    /* The supply contract settles here, after the engine and outside it: a cash
       difference against what the factory actually paid, charged the same way a
       loss is. See the long note in lib/contracts.mjs for why it is not folded
       into the unit cost. */
    const supply = settleSupply(seat, game, res, mult('cost'));

    /* Rent settles the same way, and the plant goes back to whoever owns it. */
    const rent = settleLeases(seat, game);
    releaseLeases(seat, leased.get(seat));

    /* A company's price and share in the market table are its whole book: the
       share it holds altogether, and what it charges weighted by how much of its
       own business sits behind each price. */
    const totShare = lines.reduce((a, p) => a + byName[p.name].share, 0);
    const wPrice = totShare > 0
      ? lines.reduce((a, p) => a + decisions[p.name].price * byName[p.name].share, 0) / totShare
      : (lines.length ? decisions[lines[0].name].price : seat.lastPrice);
    seat.lastPrice = wPrice;
    seat.lastShare = totShare;
    seat.lastPriceBy = {}; seat.lastDemandBy = {};
    for (const p of lines) {
      seat.lastPriceBy[p.name] = decisions[p.name].price;
      seat.lastDemandBy[p.name] = byName[p.name].demand;
    }
    seat.lastDemand = lines.reduce((a, p) => a + byName[p.name].demand, 0);
    seat.lastSales = lines.reduce((a, p) => a + byName[p.name].sales, 0);
    /* Units actually built. Only the supplier quote uses it, and it has to come
       from the engine's own record rather than from the orders — what was asked
       for and what capacity allowed are not the same number. */
    seat.lastProduced = (res.log || []).reduce((a, e) => a + (Number(e.produced) || 0), 0);

    if (seat.isBot) {
      const anyStockout = lines.some((p) => p.stockoutLast);
      botObserve(seat.botState, totShare, anyStockout);
    } else {
      seat.standing = client;
      seat.pending = null;
    }

    results.push({
      seatId: seat.id, name: seat.name,
      price: wPrice, share: totShare,
      demand: seat.lastDemand, sales: seat.lastSales,
      advertising: lines.reduce((a, p) => a + decisions[p.name].advertising, 0),
      profit: res.profit - (supply ? supply.adjustment : 0) - (rent ? rent.adjustment : 0),
      revenue: res.revenue,
      costs: res.costs + (supply ? supply.adjustment : 0) + (rent ? rent.adjustment : 0),
      interest: res.interest, rate: res.rate,
      supply: supply || null,
      supplyNote: SUPPLY.describe(supply),
      leases: rent || null,
      leaseNote: LEASE.describe(rent),
      cash: seat.firm.cash, debt: seat.firm.debt,
      quality: lines.length ? lines[0].quality : 0,
      lineCount: lines.length,
      lines: lines.map((p) => ({
        name: p.name, price: decisions[p.name].price, share: byName[p.name].share,
        demand: byName[p.name].demand, sales: byName[p.name].sales,
      })),
      value: companyValue(seat.firm),
      bankrupt: seat.firm.bankrupt,
      auto,
      detail: res.log,
    });
  }

  /* A company that just went under leaves customers behind. About two thirds find
     a new supplier, and they go to whoever is priced closest to what they lost. */
  const prices = {};
  for (const e of entries) prices[e.product.name] = e.price;
  const inherited = [];
  for (const { seat } of seatPlans) {
    if (seat.firm.bankrupt && !seat.settled) {
      const survivors = game.seats.filter((x) => x !== seat && !x.firm.bankrupt).map((x) => x.firm);
      const r2 = distributeCustomers(seat.firm, survivors, seat.lastPrice, prices);
      inherited.push({ name: seat.name, orphaned: r2.orphaned });
      seat.settled = true;
      seat.out = true;
    }
  }

  /* Launches land after the round, so a new line starts trading next round with
     orders its owner has actually chosen — rather than appearing mid-resolution
     with nobody having decided anything about it. */
  const launched = [];
  for (const { seat, launch, launchKind } of seatPlans) {
    if (!rules.launch || !launch || seat.firm.bankrupt) continue;
    if (live(seat.firm).length >= C.MAX_PRODUCTS) continue;
    const kind = E.KINDS[launchKind] ? launchKind : 'hardware';
    if (!canAfford(seat.firm, game, kind)) continue;
    seat.firm.cash -= E.launchCostOf(kind);
    /* Paid partly or wholly on the credit line if the cash is not there. The debt
       shows up in next round's borrowing rate, which is the point. */
    if (seat.firm.cash < 0) {
      seat.firm.debt += -seat.firm.cash;
      seat.firm.cash = 0;
    }
    const p = E.newLine(seat.firm, `${seat.id}-${seat.firm.products.length + 1}`, kind);
    seat.firm.products.push(p);
    launched.push({ name: seat.name, seatId: seat.id, kind,
                    kindLabel: E.KINDS[kind].label });
  }

  game.round += 1;
  game.history.push({
    round: game.round, results, news: game.news, inherited, launched,
    resolvedAt: now || new Date().toISOString(),
  });
  game.lastResolvedAt = now || new Date().toISOString();

  const stillIn = activeSeats(game);
  const humansLeft = stillIn.filter((s) => !s.isBot).length;
  if (game.round >= game.config.rounds || stillIn.length === 0 || humansLeft === 0) {
    game.status = 'over';
    game.deadline = null;
    return game;
  }

  game.news = shockTick(game.shocks, stillIn.map((s) => s.firm));
  for (const s of stillIn) upkeep(s.firm, game.round);
  game.deadline = nextDeadline(game, now);
  return game;
}

/* What a seat's company is finally worth. Used by the reveal and by scoring. */
export const finalValue = (seat) => companyValue(seat.firm);

/* --------------------------------------------------------------- the view */

/* What one player is allowed to see. Prices, quality and share are last round's
   only — never this round's. That rule is what makes committing blind mean
   anything, and it is enforced here rather than in the interface. */
export function viewFor(game, token) {
  const me = seatByToken(game, token);
  const isHost = token && token === game.hostToken;
  const over = game.status === 'over';

  const base = {
    code: game.code, status: game.status, round: game.round,
    totalRounds: game.config.rounds, seatCount: game.config.seats,
    preset: game.config.preset, closeHour: game.config.closeHour,
    /* Which levers this game runs. The page renders what this says and nothing
       else, so there is no second copy of the rules in the interface to drift
       away from the one the server enforces. */
    level: rulesOf(game).id,
    levelLabel: rulesOf(game).label,
    levelNote: rulesOf(game).note,
    cadenceMinutes: game.config.cadenceMinutes,
    cadenceLabel: cadenceOf(game).label,
    isPublic: !!game.isPublic,
    lobbyDeadline: game.lobbyDeadline || null,
    paused: !!game.paused,
    cohort: game.cohortName || null,
    /* The first round of a fast game gets double the time, because everyone has
       just arrived and is reading the screen for the first time. That was a
       reasonable decision and a bad silence: the front page promises a round
       every five minutes, the clock then says nine and a half, and the only
       conclusion available to a player is that the game is broken. So the view
       says which kind of round this is and the page explains it. */
    firstRoundGrace: game.status === 'playing' && game.round === 0
      && game.config.cadenceMinutes <= 60,
    deadline: game.deadline, isHost,
    joined: game.seats.filter((s) => !s.isBot).map((s) => ({ name: s.name })),
    news: game.status === 'playing' ? game.news : [],
  };

  if (game.status === 'lobby') {
    return { ...base, you: me ? { name: me.name } : null };
  }

  const meIndex = me ? game.seats.indexOf(me) : -1;
  base.market = game.seats.map((s) => ({
    seatId: s.id, name: s.name,
    you: s.id === (me && me.id),
    lastPrice: s.lastPrice, lastShare: s.lastShare,
    quality: live(s.firm).length ? live(s.firm)[0].quality : null,
    lineCount: live(s.firm).length,
    /* Enough of each rival's product for a player to work out their own likely
       share, and nothing beyond what the reveal already tells them: quality and
       price are shown after every round, and awareness is just their advertising
       history decayed. Their cash, their orders and their plans stay private. */
    pub: over ? null : live(s.firm).map((p) => ({
      quality: p.quality, awareness: p.awareness, age: p.age,
      inherited: p.inherited, stockoutLast: p.stockoutLast, kind: p.kind || 'hardware',
      price: (s.lastPriceBy || {})[p.name] || s.lastPrice,
    })),
    out: s.firm.bankrupt || !live(s.firm).length,
    /* Who has filed is public — it is what tells you whether the round is about
       to close. What they filed is not. */
    filed: s.isBot ? null : s.submittedRound === game.round,
    /* Identity is revealed only at the end. */
    isBot: over ? s.isBot : null,
    strategy: over && s.isBot ? (BOTS.find((b) => b.id === s.botId) || {}).strategy : null,
    finalValue: over ? companyValue(s.firm) : null,
  }));

  base.waitingOn = humansOutstanding(game).map((s) => s.name);
  base.history = game.history.map((h) => ({
    round: h.round, news: h.news, inherited: h.inherited,
    launched: (h.launched || []).map((l) => ({ name: l.name, kindLabel: l.kindLabel })),
    results: h.results.map((r) => ({
      seatId: r.seatId, name: r.name, price: r.price, share: r.share,
      advertising: r.advertising, bankrupt: r.bankrupt, lineCount: r.lineCount,
      /* your own numbers in full; everyone else's only what the market shows */
      ...(me && r.seatId === me.id
        ? { profit: r.profit, revenue: r.revenue, costs: r.costs, cash: r.cash,
            debt: r.debt, sales: r.sales, demand: r.demand, value: r.value,
            interest: r.interest, rate: r.rate, lines: r.lines,
            supply: r.supply || null, supplyNote: r.supplyNote || null,
            leases: r.leases || null, leaseNote: r.leaseNote || null,
            auto: r.auto, detail: r.detail }
        : {}),
    })),
  }));

  if (me) {
    const rules = rulesOf(game);
    const costShock = game.shocks ? shockMult(game.shocks, 'cost') : 1;
    const lines = live(me.firm);
    const standing = me.standing && me.standing.products;
    const pending = me.pending && me.pending.products;
    const rate = E.creditRate(me.firm, game.config.credit);
    const standingBand = E.creditStanding(me.firm, game.config.credit);
    base.you = {
      seatId: me.id, name: me.name,
      cash: me.firm.cash, debt: me.firm.debt, bankrupt: me.firm.bankrupt,
      value: companyValue(me.firm),
      filed: me.submittedRound === game.round,
      wantsLaunch: !!(me.pending && me.pending.launch),
      autoRounds: me.autoRounds,
      lastDemand: me.lastDemand, lastSales: me.lastSales, lastShare: me.lastShare,
      /* What borrowing costs this company right now, and why. Shown whether or not
         it currently owes anything, because the point is to make the price of the
         next loan visible before it is taken. */
      credit: {
        rate, label: standingBand.label, note: standingBand.note,
        limit: game.config.credit,
        drawn: me.firm.debt,
        headroom: Math.max(0, game.config.credit - me.firm.debt),
        costPerRound: me.firm.debt * rate,
        recentProfit: (me.firm.profitHistory || []).slice(-3),
      },
      /* The supply side: what is running, and what could be signed. The whole
         rate curve goes down rather than three chosen deals, so the page shows a
         trade-off instead of a menu — and so the page never has to hold a copy of
         the curve that could drift away from this one. */
      /* What this level offers. One object, read straight by the page. */
      rules: {
        level: rules.id, label: rules.label, note: rules.note,
        processRd: rules.processRd, launch: rules.launch,
        contracts: rules.contracts, leases: rules.leases,
        discontinue: rules.discontinue,
      },
      supply: !rules.contracts ? null : (() => {
        const running = me.contract && me.contract.to >= game.round ? me.contract : null;
        const open = SUPPLY.canSign(me, game);
        return {
          contract: running && {
            committed: running.committed, term: running.term, lock: running.lock,
            from: running.from, to: running.to,
            roundsLeft: running.to - game.round + 1,
            paid: running.paid || 0, saved: running.saved || 0,
          },
          canSign: open,
          offers: open
            ? SUPPLY.offers(supplyReference(me), { roundsLeft: game.config.rounds - game.round })
            : null,
          minTerm: SUPPLY.C.MIN_TERM, maxTerm: SUPPLY.C.MAX_TERM,
          /* The page projects the settlement against the orders being typed, so
             it needs the one constant the arithmetic turns on. */
          shortfallRate: SUPPLY.C.SHORTFALL,
          why: open ? null
            : (running ? `Your contract runs to round ${running.to}.`
                       : 'Not enough of the season left to sign one.'),
        };
      })(),
      /* Renting plant, both directions. Per line, because capacity is per line,
         and with the running leases alongside the offer so the screen never has
         to work out what is already out on rent. */
      leasing: !rules.leases ? null : {
        term: LEASE.C.TERM,
        inRate: LEASE.C.LEASE_IN, outRate: LEASE.C.LEASE_OUT,
        /* What owning the same unit costs over the same two rounds, so the two
           are comparable without the player doing the arithmetic. Buying and
           later selling loses 60% of the purchase price on the way out, and that
           is the number leasing actually competes with. */
        ownedTwoRoundCost: C.CAPEX_PER_UNIT * (1 - C.CAPACITY_RESALE)
          + C.CAPACITY_UPKEEP * LEASE.C.TERM,
        running: LEASE.activeAt(me.leases, game.round).map((l) => ({
          product: l.product, units: l.units, kind: l.kind, rate: l.rate,
          endsAfter: l.to, roundsLeft: l.to - game.round + 1,
        })),
        lines: lines.map((p) => ({
          product: p.name,
          maxIn: Math.round(LEASE.headroomFor(p, me.leases, game.round)),
          maxOut: Math.round(LEASE.spareFor(p, me.leases, game.round)),
        })),
      },
      canLaunch: rules.launch
        && lines.length < C.MAX_PRODUCTS
        && game.config.rounds - game.round >= 3
        && Object.keys(E.KINDS).some((k) => canAfford(me.firm, game, k)),
      wantsLaunchKind: (me.pending && me.pending.launchKind) || 'hardware',
      kinds: !rules.launch ? [] : Object.entries(E.KINDS).map(([id, k]) => ({
        id, label: k.label, blurb: k.blurb,
        cost: E.launchCostOf(id),
        affordable: lines.length < C.MAX_PRODUCTS
          && game.config.rounds - game.round >= 3
          && canAfford(me.firm, game, id),
        borrowing: Math.max(0, E.launchCostOf(id) - me.firm.cash),
      })),
      launchCost: C.LAUNCH_COST,
      maxProducts: rules.launch ? C.MAX_PRODUCTS : 1,
      products: lines.map((p) => ({
        name: p.name,
        label: `Line ${me.firm.products.indexOf(p) + 1}`,
        kind: p.kind || 'hardware',
        kindLabel: E.KINDS[p.kind || 'hardware'].label,
        physical: E.KINDS[p.kind || 'hardware'].inventory > 0,
        quality: p.quality, age: p.age,
        inventory: p.inventory, capacity: p.capacity, effCapacity: effCapacity(p),
        efficiency: p.efficiency, awareness: p.awareness, inherited: p.inherited,
        unitCost: E.unitCost(p, costShock), value: value(p),
        rdPipeline: p.rdPipeline.length, procPipeline: p.procPipeline.length,
        pendingCapacity: p.pendingCapacity,
        lastDemand: (me.lastDemandBy || {})[p.name] || null,
        orders: (pending && pending[p.name]) || (standing && standing[p.name]) || null,
      })),
      /* The player's own company as the engine actually holds it. Sending this
         lets the page run the real resolve() against the orders being typed, so
         the projection is the same arithmetic the server will do — not a
         reimplementation that can drift away from it. */
      firmState: {
        cash: me.firm.cash, debt: me.firm.debt, bankrupt: me.firm.bankrupt,
        profitHistory: (me.firm.profitHistory || []).slice(),
        products: lines.map((p) => ({ ...p, rdPipeline: p.rdPipeline.map((x) => ({ ...x })),
                                      procPipeline: p.procPipeline.map((x) => ({ ...x })),
                                      profitHistory: (p.profitHistory || []).slice() })),
      },
      marketMult: game.shocks ? shockMult(game.shocks, 'demand') : 1,
      costMult: costShock,
      capacityMult: game.shocks ? shockMult(game.shocks, 'capacity') : 1,
      constants: {
        CAPEX_PER_UNIT: C.CAPEX_PER_UNIT, CAPACITY_UPKEEP: C.CAPACITY_UPKEEP,
        CAPACITY_RESALE: C.CAPACITY_RESALE, CAPACITY_FLOOR: C.CAPACITY_FLOOR,
        CREDIT_LIMIT: game.config.credit, RD_DELAY: C.RD_DELAY,
        AD_DECAY: C.AD_DECAY, HOLDING: C.HOLDING, LAUNCH_COST: C.LAUNCH_COST,
      },
    };
  } else {
    base.you = null;
  }
  return base;
}
