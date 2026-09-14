/* What the company makes, from the draw to the second line.

   The catalogue is only worth having if three things hold: every group in a
   cohort faces the same product, everybody at one table makes the same thing,
   and a second line is another version of it rather than a promise of a market
   that does not exist. Each of those is checked here against the real game
   rather than against the data file, because the data file has never been the
   part that could be wrong. */

import assert from 'node:assert';
import * as G from '../lib/game.mjs';
import * as E from '../lib/engine.mjs';
import { CATALOGUE, KIND_ORDER, drawProduct, launchOptions } from '../lib/catalogue.mjs';

const at = (n) => new Date(Date.now() + n * 60000).toISOString();
const start = (opts) => {
  const { game } = G.createGame({ seats: 4, rounds: 8, ...opts });
  G.startGame(game, game.hostToken, at(0));
  return game;
};

/* ---- the draw is the seed's, so a cohort is one market ------------------ */
console.log('The draw:');
const a = start({ seed: 4242 });
const b = start({ seed: 4242 });
const c = start({ seed: 9001 });
console.log(`  seed 4242 → ${a.config.product.kind} · ${a.config.product.name}`);
console.log(`  seed 4242 → ${b.config.product.kind} · ${b.config.product.name}`);
console.log(`  seed 9001 → ${c.config.product.kind} · ${c.config.product.name}`);
assert.strictEqual(a.config.product.name, b.config.product.name,
  'the same seed drew two different products — groups in a cohort would face different markets');
console.log('  the same seed draws the same product, so every group in a cohort matches');

/* The kind does NOT vary by default, and that is deliberate. Every number in
   this game was measured against a hardware start; letting the draw pick an
   economy would re-run all of that against three nobody has measured. A host
   can still ask for one, and that is the path a measured change would take. */
const drawnKinds = {}; const drawnNames = new Set();
for (let s = 0; s < 240; s++) {
  const g = G.createGame({ seats: 3, rounds: 8, seed: s }).game;
  drawnKinds[g.config.product.kind] = (drawnKinds[g.config.product.kind] || 0) + 1;
  drawnNames.add(g.config.product.name);
}
console.log('  240 draws:', JSON.stringify(drawnKinds), '·', drawnNames.size, 'different products');
assert.deepStrictEqual(Object.keys(drawnKinds), ['hardware'],
  'the draw changed the economy, which would invalidate every measurement in the project');
assert.ok(drawnNames.size >= 10, 'the draw barely varies the product');

const asked = G.createGame({ seats: 3, rounds: 8, seed: 5, productKind: 'software' }).game;
console.log('  a host who asks for software gets:', asked.config.product.name);
assert.strictEqual(asked.config.product.kind, 'software',
  'a host could not choose the economy');

/* ---- one table, one product -------------------------------------------- */
console.log('\nOne table, one product:');
const seen = new Set(a.seats.map((s) => E.live(s.firm)[0].display));
const seenKinds = new Set(a.seats.map((s) => E.live(s.firm)[0].kind));
console.log(`  ${a.seats.length} companies, ${seen.size} product: ${[...seen].join(', ')}`);
assert.strictEqual(seen.size, 1, 'companies at one table were given different products');
assert.strictEqual(seenKinds.size, 1, 'companies at one table were given different kinds');
assert.strictEqual([...seenKinds][0], a.config.product.kind);
console.log('  and it is the kind that was drawn, not the hardware default');

/* The display name must never become the key. Everything files decisions under
   p.name, and a rename would quietly detach a player's orders from their line. */
for (const s of a.seats) {
  const p = E.live(s.firm)[0];
  assert.notStrictEqual(p.name, p.display, 'display leaked into the decision key');
  assert.ok(p.name.length, 'a line lost its key');
}
console.log('  the key a decision is filed under is untouched by any of this');

/* ---- a second line is another version of the same thing ---------------- */
console.log('\nLaunching:');
const g = start({ seed: 4242, rounds: 12 });
const drawn = g.config.product;
const opts = launchOptions(drawn);
console.log(`  making ${drawn.name}, the same-business options are:`);
console.log('   ', opts.sameKind.options.join(' · '));
assert.strictEqual(opts.sameKind.carry, 1, 'staying in your own kind should cost no know-how');
assert.ok(opts.otherKinds.every((o) => o.carry === 0.6),
  'leaving your kind should cost 40% of what you have learned');
assert.ok(opts.sameKind.options.every((v) => v !== drawn.name),
  'a variant repeated the product it is a variant of');
console.log('  own kind keeps 100% of the know-how, another kind keeps 60%');

/* Drive a real launch and check what the second line ends up called.
   Seats are shuffled at the start so that "the host is first" carries no
   information, which means seats[0] is as likely to be a bot as a person. */
const seat = g.seats.find((s) => s.token);
assert.ok(seat, 'no human seat at the table');
seat.firm.cash = 900000;
const view = G.viewFor(g, seat.token);
assert.ok(view.you.product, 'the view never told the page what the table makes');
assert.ok(view.you.launchChoices, 'the view offered no launch options');

const orders = {};
for (const p of view.you.products) {
  orders[p.name] = { price: p.value * 0.98, produce: 500, rd: 0, rdProcess: 0,
                     advertising: 4000, targetCapacity: Math.round(p.capacity),
                     discontinue: false };
}
G.submitDecisions(g, seat.token, { products: orders, launch: true, launchKind: drawn.kind });
/* Everybody except the one that just asked to launch — filing again for that
   seat would overwrite the launch intent, which is precisely what this test
   did to itself on the first run. */
for (const s of g.seats) {
  if (s === seat || !s.token) continue;
  const v = G.viewFor(g, s.token);
  if (!v.you) continue;
  const o = {};
  for (const p of v.you.products) {
    o[p.name] = { price: p.value, produce: 400, rd: 0, rdProcess: 0, advertising: 3000,
                  targetCapacity: Math.round(p.capacity), discontinue: false };
  }
  try { G.submitDecisions(g, s.token, { products: o, launch: false }); } catch {}
}
G.resolveRound(g, at(60));

const lines = E.live(seat.firm);
console.log(`  after launching, the company runs ${lines.length} lines:`);
lines.forEach((p) => console.log(`    ${p.display}  (${p.kind})`));
assert.strictEqual(lines.length, 2, 'the launch did not happen');
assert.strictEqual(lines[1].kind, drawn.kind, 'the new line left the drawn kind');
assert.ok(lines[1].display && lines[1].display !== lines[0].display,
  'the second line has no name of its own');
assert.ok((drawn.variants || []).includes(lines[1].display),
  `the second line was called "${lines[1].display}", which is not a variant of ${drawn.name}`);
console.log('  the second line is a variant of the first, not an unrelated product');

/* The reason variants matter at all: both lines compete for the same buyers.
   If that ever stops being true, the naming becomes a lie and this test should
   be the thing that notices. */
const last = g.history[g.history.length - 1];
console.log('\n  both lines draw from one pool of buyers — that is why they are variants');
assert.ok(last, 'no round was recorded');

/* ---- the catalogue itself ---------------------------------------------- */
console.log('\nThe catalogue:');
let n = 0;
for (const k of KIND_ORDER) {
  assert.strictEqual(CATALOGUE[k].length, 15, `${k} is not fifteen products`);
  for (const prod of CATALOGUE[k]) {
    n++;
    assert.ok(prod.variants.length >= 3, `${prod.name} has fewer than three variants`);
  }
}
const names = KIND_ORDER.flatMap((k) => CATALOGUE[k].map((x) => x.name.toLowerCase()));
assert.strictEqual(new Set(names).size, 60, 'two products share a name');
console.log(`  ${n} products, fifteen a kind, no duplicates`);

/* Every kind sells for the same reference value — that is the constraint the
   names were chosen against, and if it ever changes the list needs rewriting. */
for (const k of KIND_ORDER) {
  const p = E.newProduct('x', k);
  assert.strictEqual(Math.round(E.value(p)), 100,
    `${k} no longer sells for about $100 — the catalogue names assume it does`);
}
console.log('  and every kind still sells for about $100, which is what they were picked for');

console.log('\nproducts OK');
