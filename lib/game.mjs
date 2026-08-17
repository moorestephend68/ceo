/* CEO — live sessions.
   Pure game logic: every function here takes a state object and returns a new
   one. Nothing touches the network, the clock is injected, and randomness is
   derived from the game seed. That is deliberate — it means a whole twelve-round
   season with missed deadlines and a bankruptcy can be played out in a Node test
   in milliseconds, which is the only practical way to be sure an asynchronous
   game that takes twelve days in real life actually works. */

import { randomBytes } from 'node:crypto';
import * as E from './engine.mjs';

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
};

export const cadenceOf = (game) =>
  (game.config.cadenceMinutes >= 1440 ? CADENCES['1d']
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
      cadenceMinutes: (CADENCES[opts.cadence] || {}).minutes
        || clamp(Math.round(opts.cadenceMinutes || 1440), 5, 1440),
      closeHour: clamp(Math.round(opts.closeHour === undefined ? 18 : opts.closeHour), 0, 23),
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

  if (mins >= 1440) {
    const d = new Date(base);
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(game.config.closeHour);
    const MIN_LEAD_MS = 6 * 3600 * 1000;
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
export function normaliseDecisions(raw, product, firm) {
  const n = (x, d = 0) => (Number.isFinite(+x) ? +x : d);
  const cap = Math.max(C.CAPACITY_FLOOR, n(raw.targetCapacity, product.capacity));
  return {
    price: Math.max(0, n(raw.price, value(product))),
    produce: Math.max(0, n(raw.produce, 0)),
    rd: Math.max(0, n(raw.rd, 0)),
    rdProcess: Math.max(0, n(raw.rdProcess, 0)),
    advertising: Math.max(0, n(raw.advertising, 0)),
    targetCapacity: cap,
    discontinue: !!raw.discontinue,
  };
}

/* A product that has never had orders filed still has to trade. This is what it
   does: price at value, build to last round's demand, keep research ticking over.
   Deliberately unremarkable — it should never be better than showing up. */
function defaultFor(seat, p) {
  /* The category grows with the number of sellers — each firm brings its own
     customers — so a product's demand is roughly its own pool, not a slice of one
     shared pot. Estimating from the pool rather than from share is what keeps a
     first-round auto-order from under-producing by half. */
  const target = (seat.lastDemandBy && seat.lastDemandBy[p.name]) || E.demandPool(p);
  return {
    price: Math.round(value(p)),
    produce: Math.max(0, Math.min(target, effCapacity(p)) - p.inventory),
    rd: 30000, rdProcess: 10000, advertising: 0,
    targetCapacity: p.capacity, discontinue: false,
  };
}

/* Orders for every line a company runs, plus whether it is opening another. */
function defaultOrders(seat) {
  const products = {};
  for (const p of live(seat.firm)) products[p.name] = defaultFor(seat, p);
  return { products, launch: false };
}

export function submitDecisions(game, token, raw) {
  if (game.status !== 'playing') throw new Error('That game is not running.');
  const seat = seatByToken(game, token);
  if (!seat) throw new Error('We do not recognise you in this game.');
  if (seat.out || seat.firm.bankrupt) throw new Error('Your company is out of the game.');
  const lines = live(seat.firm);
  if (!lines.length) throw new Error('You have no products left.');

  const products = {};
  const sent = (raw && raw.products) || {};
  for (const p of lines) {
    products[p.name] = normaliseDecisions(sent[p.name] || {}, p, seat.firm);
  }
  /* Discontinuing everything is the same as quitting, and quitting mid-round is
     not a move the game offers. */
  if (lines.every((p) => products[p.name].discontinue)) {
    throw new Error('You cannot discontinue every product at once.');
  }

  let launch = !!(raw && raw.launch);
  const launchKind = E.KINDS[raw && raw.launchKind] ? raw.launchKind : 'hardware';
  if (launch) {
    if (lines.length >= C.MAX_PRODUCTS) throw new Error(`You can run at most ${C.MAX_PRODUCTS} product lines.`);
    if (game.config.rounds - game.round < 3) throw new Error('There is not enough time left for a new line to pay back.');
    if (!canAfford(seat.firm, game, launchKind)) {
      throw new Error('A new line of that kind would leave you without enough credit to survive its first rounds.');
    }
  }
  seat.pending = { products, launch, launchKind };
  seat.submittedRound = game.round;
  return game;
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
  const filed = seat.submittedRound === game.round;
  const src = filed ? seat.pending : seat.standing;
  const products = {};
  for (const p of live(seat.firm)) {
    const prev = src && src.products && src.products[p.name];
    products[p.name] = prev || defaultFor(seat, p);
  }
  return { products, launch: filed ? !!(src && src.launch) : false,
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
  return new Date(now || Date.now()).getTime() >= new Date(game.deadline).getTime();
}

/* -------------------------------------------------------------- the round */

export function resolveRound(game, now) {
  if (game.status !== 'playing') throw new Error('That game is not running.');
  const mult = (t) => (game.shocks ? shockMult(game.shocks, t) : 1.0);
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
        decisions[p.name] = plan;
      }
      const launch = E.botShouldLaunch(seat.firm, game.round, game.config.rounds, st.rand,
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
      profit: res.profit, revenue: res.revenue, costs: res.costs,
      interest: res.interest, rate: res.rate,
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
    if (!launch || seat.firm.bankrupt) continue;
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
            auto: r.auto, detail: r.detail }
        : {}),
    })),
  }));

  if (me) {
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
      canLaunch: lines.length < C.MAX_PRODUCTS
        && game.config.rounds - game.round >= 3
        && Object.keys(E.KINDS).some((k) => canAfford(me.firm, game, k)),
      wantsLaunchKind: (me.pending && me.pending.launchKind) || 'hardware',
      kinds: Object.entries(E.KINDS).map(([id, k]) => ({
        id, label: k.label, blurb: k.blurb,
        cost: E.launchCostOf(id),
        affordable: lines.length < C.MAX_PRODUCTS
          && game.config.rounds - game.round >= 3
          && canAfford(me.firm, game, id),
        borrowing: Math.max(0, E.launchCostOf(id) - me.firm.cash),
      })),
      launchCost: C.LAUNCH_COST,
      maxProducts: C.MAX_PRODUCTS,
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
