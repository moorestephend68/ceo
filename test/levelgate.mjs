/* Levels — what a first game does not have.

   §40 measured which levers to hide and why. This is about whether hiding them
   actually holds, and there are three ways it could fail to.

   The first is the obvious one: a control disappears from the page and the
   server still accepts it. Everything below sends the hidden levers anyway,
   because a page is not a permission.

   The second is quieter and worse: the bots keep using a lever the players
   cannot see. Nothing would look broken. One company would just be
   inexplicably cheaper than everyone else all game, and the instructor would
   have no way to explain it.

   The third is standing orders. A player files orders, a host changes the
   level, and the repeat carries on spending on something that is no longer on
   the screen for the rest of the season. */

import assert from 'node:assert';
import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';

const at = (i) => new Date(Date.parse('2026-09-01T09:00:00Z') + i * 3600000).toISOString();
const money = (x) => (x < 0 ? '-' : '') + '$' + Math.round(Math.abs(x)).toLocaleString('en-US');

const make = (level, opts = {}) => {
  const { game, token } = G.createGame({
    hostName: 'Ravenscarr', seats: 4, rounds: 12, preset: 'standard',
    seed: 8080, now: at(0), level, ...opts,
  });
  G.startGame(game, token, at(0));
  return { game, token, me: game.seats.find((s) => s.token === token) };
};

const orders = (v, tweak) => {
  const products = {};
  for (const p of v.you.products) {
    products[p.name] = {
      price: Math.round(p.value * 0.97), rd: 30000, rdProcess: 12000,
      advertising: 8000, targetCapacity: Math.round(p.capacity), discontinue: false,
      produce: Math.max(0, Math.min(Math.round((p.lastDemand || 1300) * 1.05),
                                    p.effCapacity) - p.inventory),
      ...(tweak ? tweak(p) : {}),
    };
  }
  return products;
};

/* ------------------------------------------------------------- the default */
console.log('Nothing changes for a game that does not ask:');
{
  const { game } = make(undefined);
  console.log(`  a game created without naming a level runs level ${game.config.level} — `
    + `"${G.LEVELS[game.config.level].label}"`);
  assert.strictEqual(game.config.level, G.DEFAULT_LEVEL, 'the default level moved');
  assert.strictEqual(G.DEFAULT_LEVEL, 2, 'the default is not the full game');

  /* Nonsense is not a level either. */
  assert.strictEqual(G.createGame({ hostName: 'x', level: 7, seed: 1 }).game.config.level, 2);
  assert.strictEqual(G.createGame({ hostName: 'x', level: 'first', seed: 1 }).game.config.level, 2);
  console.log('  and an unrecognised level falls back to it rather than inventing one\n');
}

/* --------------------------------------------------------- what is on offer */
console.log('What a first game offers:');
{
  const one = make(1), two = make(2);
  const v1 = G.viewFor(one.game, one.token), v2 = G.viewFor(two.game, two.token);

  console.log(`  level 1 — ${v1.levelLabel}: launch ${v1.you.rules.launch}, `
    + `process R&D ${v1.you.rules.processRd}, contracts ${v1.you.rules.contracts}, `
    + `leases ${v1.you.rules.leases}`);
  console.log(`  level 2 — ${v2.levelLabel}: launch ${v2.you.rules.launch}, `
    + `process R&D ${v2.you.rules.processRd}, contracts ${v2.you.rules.contracts}, `
    + `leases ${v2.you.rules.leases}`);

  /* The page is handed nothing at all for a lever it must not draw, rather than
     a flag it has to remember to check. */
  assert.strictEqual(v1.you.supply, null, 'a first game was offered supply contracts');
  assert.strictEqual(v1.you.leasing, null, 'a first game was offered leases');
  assert.strictEqual(v1.you.canLaunch, false, 'a first game was offered a second line');
  assert.strictEqual(v1.you.kinds.length, 0, 'a first game was shown the product kinds');
  assert.strictEqual(v1.you.maxProducts, 1, 'a first game thinks it can run more than one line');
  assert(v2.you.supply && v2.you.leasing && v2.you.kinds.length,
    'the full game lost something it used to have');
  console.log('  a hidden lever is absent from the view, not flagged in it\n');
}

/* ----------------------------------------------- the page is not a permission */
console.log('Sending the hidden levers anyway:');
{
  const { game, token, me } = make(1);
  const v = G.viewFor(game, token);
  const line = E.live(me.firm)[0];

  assert.throws(() => G.submitDecisions(game, token, {
    products: orders(v), launch: true, launchKind: 'software',
  }), /part of the full game/, 'a first game accepted a launch');
  console.log('  launching a second line: refused');

  assert.throws(() => G.submitDecisions(game, token, {
    products: orders(v), contract: { committed: 500, term: 5 },
  }), /part of the full game/, 'a first game accepted a supply contract');
  console.log('  signing a supply contract: refused');

  assert.throws(() => G.submitDecisions(game, token, {
    products: orders(v), leases: [{ product: line.name, units: 300, kind: 'in' }],
  }), /part of the full game/, 'a first game accepted a lease');
  console.log('  taking a lease: refused');

  /* Process research is different, and deliberately: it is a number rather than
     a decision, so it is zeroed rather than thrown at. A standing order filed
     before a host moved the level should keep working, not start failing. */
  G.submitDecisions(game, token, { products: orders(v, () => ({ rdProcess: 90000 })) });
  assert.strictEqual(me.pending.products[line.name].rdProcess, 0,
    'process research was spent in a game that does not offer it');
  console.log('  spending on process research: zeroed rather than refused,');
  console.log('  because a number nobody can see should not break a filing\n');
}

/* ------------------------------------------------------------- and it holds */
console.log('Over a whole season, the hidden levers stay hidden:');
{
  const { game, token, me } = make(1);
  while (game.status === 'playing') {
    const v = G.viewFor(game, token);
    if (v.you && v.you.products.length && !v.you.bankrupt) {
      /* Try it every single round. */
      try {
        G.submitDecisions(game, token, {
          products: orders(v, () => ({ rdProcess: 60000 })), launch: true,
        });
      } catch {
        G.submitDecisions(game, token, { products: orders(v, () => ({ rdProcess: 60000 })) });
      }
    }
    G.resolveRound(game, at(game.round + 1));
  }

  /* Measured as efficiency, not as a spend line. The engine's per-product log
     carries `rd` and not `rdProcess`, so counting the spend reads zero whether
     the gate works or not — which is exactly the shape of a test that passes for
     the wrong reason. Efficiency is the only thing process research moves, so it
     is the evidence. */
  const effs = game.seats.flatMap((s) => s.firm.products.map((p) => p.efficiency));
  console.log(`  efficiency across every line at the end: `
    + `${effs.map((e) => e.toFixed(1)).join(', ')}`);
  assert(effs.every((e) => e <= 100.0001),
    'a line got cheaper to run in a game with no process research');

  const lines = game.seats.map((s) => s.firm.products.length);
  console.log(`  product lines at the end, every seat: ${lines.join(', ')}`);
  assert(lines.every((n) => n === 1), 'somebody opened a second line in a first game');

  /* And efficiency, which is the only thing process research moves, should not
     have gone up under anybody. */
  const gained = game.seats.filter((s) => s.firm.products.some((p) => p.efficiency > 100));
  console.log(`  seats whose efficiency improved: ${gained.length}`);
  assert.strictEqual(gained.length, 0,
    'somebody got cheaper to run in a game with no process research — including a bot');
  console.log('  including the archetypes, who play by the same rules\n');
}

/* -------------------------------------------- standing orders survive a change */
console.log('A host who changes the level mid-season:');
{
  /* A survivable amount of process research and a forgiving credit line — the
     first attempt at this test spent $60,000 a round and the company was
     bankrupt by round five, at which point nothing repeats and the test proved
     nothing at all. */
  const { game, token, me } = make(2, { rounds: 16, preset: 'forgiving', seed: 606 });
  const line = () => (E.live(me.firm)[0] || me.firm.products[0]);
  const v = G.viewFor(game, token);

  /* File once, at level 2, spending on process research — and then never file
     again. Everything after this is the standing order repeating. */
  G.submitDecisions(game, token, { products: orders(v, () => ({ rdProcess: 15000 })) });
  for (let i = 1; i <= 6 && game.status === 'playing'; i++) G.resolveRound(game, at(i));

  assert(!me.firm.bankrupt, 'the company went under before the level was changed');
  const atLevelTwo = line().efficiency;
  const queuedThen = line().procPipeline.length;
  console.log(`  six rounds at level 2, never re-filing: efficiency `
    + `${atLevelTwo.toFixed(1)}, ${queuedThen} improvements still in the pipeline`);
  assert(atLevelTwo > 100.5,
    'the standing order never bought any process research, so there is nothing to lose');
  assert(queuedThen > 0, 'nothing was in flight, so the drain below proves nothing');

  /* Now the host drops the level. Nothing is filed. The repeat must stop buying
     something the game no longer offers — and what was already paid for must
     still arrive, because it was bought under the old rules. */
  game.config.level = 1;
  for (let i = 7; i <= 12 && game.status === 'playing'; i++) G.resolveRound(game, at(i));

  const queuedNow = line().procPipeline.length;
  console.log(`  six more at level 1: ${queuedNow} in the pipeline — `
    + 'what was already bought landed, and nothing new was ordered');
  assert.strictEqual(queuedNow, 0,
    'the repeating order kept buying process research after the level was dropped');
  console.log(`  efficiency ${atLevelTwo.toFixed(1)} → ${line().efficiency.toFixed(1)}: `
    + 'the last improvements landed, then it decays');
  console.log('  the repeat is re-read against the rules rather than replayed\n');
}

/* ------------------------------------------------ ranked and league are pinned */
console.log('Where the level is not a choice:');
{
  const P = await import('../lib/public.mjs');
  const L = await import('../lib/league.mjs');
  console.log(`  ranked tables: level ${P.FORMAT.level} · bot league: level ${L.FORMAT.level}`);
  assert.strictEqual(P.FORMAT.level, 2,
    'ranked tables are not the full game, so the leaderboard compares unlike things');
  assert.strictEqual(L.FORMAT.level, 2, 'the league is not the full game');
  console.log('  both pinned to the full game — one leaderboard, one record, one rule set\n');
}

/* ------------------------------------------------------- a first game still works */
console.log('And a first game is still a game:');
{
  const { game, token, me } = make(1, { seed: 4242 });
  while (game.status === 'playing') {
    const v = G.viewFor(game, token);
    if (v.you && v.you.products.length && !v.you.bankrupt) {
      try { G.submitDecisions(game, token, { products: orders(v) }); } catch {}
    }
    G.resolveRound(game, at(game.round + 1));
  }
  const finals = game.seats.map((s) => E.companyValue(s.firm)).sort((a, b) => b - a);
  console.log(`  ${game.history.length} rounds played, finishing values `
    + `${money(finals[0])} down to ${money(finals[finals.length - 1])}`);
  assert.strictEqual(game.status, 'over', 'a first game did not finish');
  assert(finals[0] - finals[finals.length - 1] > 10000,
    'every company finished in the same place, so there was nothing to decide');
  console.log(`  and ${money(finals[0] - finals[finals.length - 1])} between first and last, `
    + 'so there is still a game in it');
}

console.log('\nlevelgate OK');
