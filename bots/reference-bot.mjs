#!/usr/bin/env node
/* A complete CEO bot, in one file, with no dependencies.

   Run it:
     export CEO_BOT_KEY=ceobot_...
     node bots/reference-bot.mjs --site https://ceo-the-game.netlify.app --games 3

   It joins a league table, plays every round, and prints what it made. The
   protocol is three endpoints and is documented in BOTS.md; everything below
   the `decide` function is plumbing you can copy unchanged.

   The strategy is deliberately plain. It is a starting point rather than a
   target: it prices a little under what the market thinks the product is worth,
   builds what it expects to sell, spends steadily on both kinds of R&D, and
   adds capacity when it keeps running out. Anything thoughtful will beat it,
   which is the idea. */

/* ------------------------------------------------------------- the strategy */

/* Called once per round with the same view the browser renders. Return the
   orders. This is the only function worth rewriting. */
export function decide(view) {
  const products = {};

  for (const p of view.you.products) {
    /* `value` is what the market currently thinks one unit of this product is
       worth, given its quality and age. It is the natural anchor: price above it
       and demand falls away, price below it and you buy share with margin. */
    const price = Math.round(p.value * 0.97);

    /* Build what we expect to sell, less what is already in the warehouse.
       lastDemand is the true demand from last round — including the part we
       could not meet, which is the number that matters and the one the profit
       and loss account never shows. */
    const expect = p.lastDemand || 1300;
    const want = Math.max(0, Math.round(expect * 1.05) - p.inventory);
    const produce = Math.min(want, Math.floor(p.effCapacity));

    /* R&D arrives two rounds late, so it has to be paid for before it is
       obviously needed. A bot that maximises this round's profit spends nothing
       here and loses the second half of the game. Stop near the end, when it can
       no longer arrive in time to sell anything. */
    const roundsLeft = view.totalRounds - view.round;
    const invest = roundsLeft > 2;

    /* Awareness decays every round. Advertising is the only thing that refills
       it, and a product nobody has heard of does not sell however good it is. */
    const advertising = invest ? (p.awareness < 0.55 ? 12000 : 6000) : 0;

    /* Add capacity only when we actually ran out — capacity costs upkeep every
       round whether it is used or not, and sells back for less than it cost. */
    const shortOfRoom = expect > p.effCapacity * 0.95;
    const targetCapacity = Math.round(
      shortOfRoom && roundsLeft > 2 ? p.capacity * 1.2 : p.capacity,
    );

    products[p.name] = {
      price,
      produce,
      rd: invest ? 30000 : 0,
      rdProcess: invest ? 12000 : 0,
      advertising,
      targetCapacity,
      discontinue: false,
    };
  }

  /* A second line doubles the company's exposure to a market it is already in.
     Take it only when the first one is healthy and there is time for the ramp
     to be paid back — the game refuses a launch with fewer than three rounds
     left in any case. */
  const launch = view.you.canLaunch
    && view.you.products.length < 2
    && view.round >= 3
    && view.you.cash > 260000;

  return { products, launch, launchKind: 'software' };
}

/* ----------------------------------------------------------------- plumbing */

/* Everything below runs only when this file is the program. Importing it gives
   you `decide` and nothing else, which is what the test suite does — it plays
   two of these against each other through the real routes, so the strategy
   above is exercised rather than merely published. */
import { pathToFileURL } from 'node:url';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

let SITE = '', KEY = '', GAMES = 1, QUIET = false;

const say = (...a) => { if (!QUIET) console.log(...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

async function call(path, body) {
  const res = await fetch(SITE + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${data.error || text.slice(0, 200)}`);
  return data;
}

async function playOne() {
  const joined = await call('/api/bot/join', { key: KEY });
  const { code, token } = joined;
  say(`table ${code}${joined.ranked ? '' : ' (unranked — no company name on this account)'}`);

  let view = joined.view;
  let filedFor = -1;
  let idle = 0;

  /* A game is at most ten rounds of forty-five seconds, and normally finishes
     in well under a minute because every round closes the moment the last bot
     files. The cap is a guard against a table that has somehow stalled. */
  const deadline = Date.now() + 15 * 60 * 1000;

  while (view.status !== 'over' && Date.now() < deadline) {
    if (view.status === 'playing' && view.you && !view.you.bankrupt
        && view.you.products.length && view.round !== filedFor) {
      const round = view.round;
      try {
        const res = await call('/api/submit', { code, token, decisions: decide(view) });
        filedFor = round;
        view = res.view;
        say(`  round ${round + 1} of ${view.totalRounds} filed · ` +
            `cash ${money(view.you ? view.you.cash : 0)}`);
        idle = 0;
        continue;
      } catch (e) {
        /* The usual cause is that the round closed between reading and filing,
           which is not an error so much as a race we lost. Re-read and carry on. */
        if (!/already closed/.test(e.message)) throw e;
      }
    }

    await sleep(700);
    idle += 1;
    view = (await call(`/api/state?code=${code}&token=${encodeURIComponent(token)}`)).view;
    /* Waiting on a lobby or on slower opponents is normal; say so occasionally
       rather than looking hung. */
    if (idle % 14 === 0) say(`  waiting (${view.status}, round ${view.round + 1})`);
  }

  if (view.status !== 'over') { say('  table stalled — giving up on it'); return null; }

  const me = view.market.find((m) => m.you);
  const ranked = view.market.slice().sort((a, b) => b.finalValue - a.finalValue);
  const place = ranked.findIndex((m) => m.you) + 1;
  const made = me.finalValue - 250000;
  say(`  finished ${place} of ${ranked.length} · worth ${money(me.finalValue)} · ` +
      `made ${money(made)}`);
  return { place, value: me.finalValue, made };
}

async function main() {
  SITE = arg('site', process.env.CEO_SITE || 'https://ceo-the-game.netlify.app').replace(/\/$/, '');
  KEY = arg('key', process.env.CEO_BOT_KEY || '');
  GAMES = Number(arg('games', '1'));
  QUIET = process.argv.includes('--quiet');

  if (!KEY) {
    console.error('No key. Set CEO_BOT_KEY, or pass --key ceobot_...\n' +
                  'Create one on your account page; it is shown once.');
    process.exit(2);
  }

  const results = [];
  for (let i = 0; i < GAMES; i++) {
    try {
      const r = await playOne();
      if (r) results.push(r);
    } catch (e) {
      console.error('game failed:', e.message);
      /* A rate limit is worth waiting out rather than hammering. */
      if (/429|an hour/.test(e.message)) { console.error('rate limited — stopping.'); break; }
    }
    if (i + 1 < GAMES) await sleep(1500);
  }

  if (results.length) {
    const avg = results.reduce((a, r) => a + r.made, 0) / results.length;
    const wins = results.filter((r) => r.place === 1).length;
    console.log(`\n${results.length} games · won ${wins} · ` +
                `average made ${money(avg)} (this is what the board ranks)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
