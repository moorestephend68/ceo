/* Supply contracts and leases, through the interface.

   The thing worth testing here is not that the controls draw. It is that the
   projection panel agrees with the round.

   That panel runs the real engine in the page against the orders being typed,
   and it is the strongest claim the product makes about itself: the same
   arithmetic, not a reimplementation that can drift. Contracts and leases break
   that, once. Their settlement lives in lib/contracts.mjs and lib/capacity.mjs,
   which the page cannot import, so the page has a second copy of the sums. This
   file is the guard on that copy: sign a contract, take a lease, read what the
   page predicts, let the round resolve, and compare with what was actually
   charged. A cent of drift here is a number shown to a player that is not the
   number they get. */
/* Playwright is not a dependency — see test/browser.mjs. */
const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => {
  console.error('Playwright not found. npm i -D playwright && npx playwright install chromium');
  process.exit(2);
});
const { chromium } = pw.default || pw;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 2400 } });
await ctx.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const fail = (m) => { throw new Error(m); };
const money = (x) => (x < 0 ? '-$' : '$') + Math.round(Math.abs(x)).toLocaleString('en-US');

await page.goto('http://localhost:8899/g/');
await page.waitForTimeout(400);
await page.click('#seatchoice .choice[data-seats="3"]');
await page.click('#cadencechoice .choice[data-cadence="5m"]');
await page.click('#roundchoice .choice[data-rounds="12"]');
await page.click('#levelchoice .choice[data-level="2"]');
await page.click('#create');
await page.waitForSelector('.code');
await page.click('#start');
await page.waitForSelector('.ctrl input[type=range]');

/* ---------------------------------------------------------------- the grid */
const grid = await page.$$eval('#ratecells .ratecell', (ns) => ns.map((n) => ({
  committed: +n.dataset.committed, term: +n.dataset.term, lock: +n.dataset.lock,
})));
console.log(`The rate grid offers ${grid.length} combinations of volume and term.`);
if (!grid.length) fail('the supply contract card drew no rates');

/* The two levers must visibly pull against each other on the page itself, or
   there is no trade-off to see. */
const row = grid.filter((g) => g.term === Math.min(...grid.map((x) => x.term)));
const col = grid.filter((g) => g.committed === row[row.length - 1].committed);
console.log(`  along a row, more volume: ${row[0].lock.toFixed(3)} → `
  + `${row[row.length - 1].lock.toFixed(3)} (better)`);
console.log(`  down a column, longer term: ${col[0].lock.toFixed(3)} → `
  + `${col[col.length - 1].lock.toFixed(3)} (worse)`);
if (!(row[row.length - 1].lock < row[0].lock)) fail('volume does not improve the rate on screen');
if (!(col[col.length - 1].lock > col[0].lock)) fail('term does not worsen the rate on screen');

/* -------------------------------------------------------------- choosing */
/* The best rate on the board — furthest from 1.000, so a settlement that is
   wrong by a factor shows up as a number rather than as a rounding cent. */
const pick = grid.reduce((a, g) => (g.lock < a.lock ? g : a));
await page.click(`#ratecells .ratecell[data-committed="${pick.committed}"][data-term="${pick.term}"]`);
await page.waitForTimeout(250);
const chose = await page.evaluate(() => D.contract);
console.log(`\nClicked ${pick.committed} units for ${pick.term} rounds — `
  + `the page holds ${chose.committed}/${chose.term} at ${chose.lock.toFixed(3)}×`);
if (chose.committed !== pick.committed || chose.term !== pick.term) {
  fail('clicking a rate selected something else');
}
if (!/Signed when you file/i.test(await page.textContent('body'))) {
  fail('nothing tells the player when the contract is actually signed');
}

/* ---------------------------------------------------------------- a lease */
const before = await page.evaluate(() => {
  const p = Object.keys(D.orders)[0];
  return { cap: [...document.querySelectorAll('[data-field="produce"]')]
    .map((n) => +n.max)[0], name: p };
});
const maxIn = await page.$eval('[data-leasein]', (n) => +n.max);
const take = Math.min(600, Math.floor(maxIn / 100) * 100);
await page.fill('[data-leasein]', String(take));
await page.dispatchEvent('[data-leasein]', 'change');
await page.waitForTimeout(300);

const after = await page.evaluate(() => ({
  leases: D.leases,
  cap: [...document.querySelectorAll('[data-field="produce"]')].map((n) => +n.max)[0],
}));
console.log(`\nRented in ${take} units of plant.`);
console.log(`  the "units to make" slider now reaches ${after.cap}, was ${before.cap}`);
if (after.leases.length !== 1 || after.leases[0].units !== take) {
  fail('the lease did not reach the page state');
}
/* This is the wrinkle §39 flagged: rented plant arrives in the round it is
   signed for, so a form that clamps production to owned capacity would let
   somebody pay rent for plant they cannot use. */
if (!(after.cap > before.cap)) {
  fail('the production slider does not reach the plant being rented — paid for, unusable');
}

/* ------------------------------------------------ the projection against the round */
/* Build to the commitment so the contract settles on covered units rather than a
   shortfall, then read what the page says before anything is sent. */
await page.evaluate((units) => {
  const name = Object.keys(D.orders)[0];
  D.orders[name].produce = units;
  render();
}, pick.committed);
await page.waitForTimeout(250);

const predicted = await page.evaluate(() => {
  const pr = project(S.view);
  return { supply: pr.supplyAdj, rentPaid: pr.rentPaid, rentEarned: pr.rentEarned,
           profit: pr.profit };
});
const shown = await page.textContent('#projection');
console.log(`\nThe projection, before filing:`);
console.log(`  supply contract ${money(-predicted.supply)} · `
  + `rent ${money(-predicted.rentPaid)} · expected profit ${money(predicted.profit)}`);
if (!/Supply contract/i.test(shown)) fail('the projection does not show the contract at all');
if (!/Renting plant in/i.test(shown)) fail('the projection does not show the rent');

await page.click('#file');
await page.waitForTimeout(800);
for (let i = 0; i < 40; i++) {
  const r = await page.evaluate(() => S.view && S.view.round);
  if (r >= 1) break;
  await page.waitForTimeout(1000);
  await page.evaluate(() => refresh());
}

const actual = await page.evaluate(() => {
  const h = S.view.history[0];
  const me = h.results.find((r) => r.supply !== undefined && r.cash !== undefined);
  return me ? { supply: me.supply ? me.supply.adjustment : null,
                rentPaid: me.leases ? me.leases.rentPaid : null,
                note: me.supplyNote, leaseNote: me.leaseNote } : null;
});
if (!actual) fail('the round produced no settlement to compare against');
console.log(`\nWhat the round actually charged:`);
console.log(`  ${actual.note}`);
console.log(`  ${actual.leaseNote}`);

const drift = Math.abs(actual.supply - predicted.supply);
const rentDrift = Math.abs(actual.rentPaid - predicted.rentPaid);
console.log(`\n  contract: predicted ${money(predicted.supply)} · `
  + `charged ${money(actual.supply)} · drift ${money(drift)}`);
console.log(`  rent:     predicted ${money(predicted.rentPaid)} · `
  + `charged ${money(actual.rentPaid)} · drift ${money(rentDrift)}`);
if (rentDrift > 0.01) fail(`the page's rent disagrees with the round by ${money(rentDrift)}`);
/* The contract settles against what was actually built, and production can be
   trimmed by a capacity shock the page already accounts for — so this is exact
   in the ordinary case and allowed a rounding cent. */
if (drift > 1) fail(`the page's contract settlement disagrees with the round by ${money(drift)}`);
console.log('  the page and the server agree');

/* --------------------------------------------------- and the state is cleared */
const held = await page.evaluate(() => ({ contract: D.contract, leases: D.leases,
  running: S.view.you.leasing.running.length, signed: !!S.view.you.supply.contract }));
console.log(`\nAfter filing: pending contract ${held.contract}, pending leases `
  + `${held.leases.length}, running leases ${held.running}, contract signed ${held.signed}`);
if (held.contract || held.leases.length) {
  fail('the pending commitments were not cleared, so they would be counted twice');
}
if (!held.signed || !held.running) fail('the commitments never became real');

/* ------------------------------------------------------------ the shortfall */
/* The harder branch, and the one that carries the mechanic: build less than the
   commitment and pay for the gap anyway. Two settlement terms instead of one,
   and a constant the page only knows because the server sent it. */
console.log('\nNow building well under the commitment:');
{
  const short = Math.round(pick.committed * 0.35);
  await page.evaluate((u) => {
    const name = Object.keys(D.orders)[0];
    D.orders[name].produce = u;
    render();
  }, short);
  await page.waitForTimeout(250);

  const p2 = await page.evaluate(() => {
    const pr = project(S.view);
    return { supply: pr.supplyAdj, short: pr.supply.short, covered: pr.supply.covered };
  });
  console.log(`  building ${short} against a commitment of ${pick.committed}`);
  console.log(`  the page expects to pay ${money(p2.supply)}, `
    + `${Math.round(p2.short)} units short`);
  if (!(p2.short > 0)) fail('the page did not notice the shortfall');
  if (!(p2.supply > 0)) fail('falling short of the commitment was projected as free');
  const warned = /short of the commitment/i.test(await page.textContent('#projection'));
  console.log(`  and it says so on the panel: ${warned}`);
  if (!warned) fail('the projection charges for a shortfall without naming it');

  const r0 = await page.evaluate(() => S.view.round);
  await page.click('#file');
  await page.waitForTimeout(800);
  for (let i = 0; i < 40; i++) {
    const r = await page.evaluate(() => S.view && S.view.round);
    if (r > r0) break;
    await page.waitForTimeout(1000);
    await page.evaluate(() => refresh());
  }
  const a2 = await page.evaluate((n) => {
    const h = S.view.history[n];
    const me = h.results.find((r) => r.cash !== undefined);
    return { supply: me.supply ? me.supply.adjustment : null,
             short: me.supply ? me.supply.shortfall : null, note: me.supplyNote };
  }, r0);
  console.log(`  the round charged ${money(a2.supply)} — "${a2.note}"`);
  const d2 = Math.abs(a2.supply - p2.supply);
  console.log(`  drift ${money(d2)}`);
  if (d2 > 1) fail(`the page's shortfall settlement disagrees with the round by ${money(d2)}`);
  console.log('  the page and the server agree on the hard branch too');
}

/* ------------------------------------------------------------ renting out */
/* The other direction, on a line with no lease running. It has to shrink the
   production slider, or a player can promise to build with plant they have just
   rented to somebody else. */
console.log('\nRenting plant out:');
{
  for (let i = 0; i < 30; i++) {
    const has = await page.evaluate(() => !!document.querySelector('[data-leaseout]'));
    if (has) break;
    await page.waitForTimeout(1000);
    await page.evaluate(() => refresh());
  }
  const out = await page.$('[data-leaseout]');
  if (!out) fail('no way to rent plant out once the earlier lease had ended');

  const capBefore = await page.$$eval('[data-field="produce"]', (ns) => +ns[0].max);
  const maxOut = await page.$eval('[data-leaseout]', (n) => +n.max);
  const give = Math.max(50, Math.floor(maxOut * 0.4 / 50) * 50);
  await page.fill('[data-leaseout]', String(give));
  await page.dispatchEvent('[data-leaseout]', 'change');
  await page.waitForTimeout(300);

  const st = await page.evaluate(() => ({
    leases: D.leases,
    cap: [...document.querySelectorAll('[data-field="produce"]')].map((n) => +n.max)[0],
    earned: project(S.view).rentEarned,
    shown: /Renting plant out/i.test(document.querySelector('#projection').textContent),
  }));
  console.log(`  renting out ${give} of ${maxOut} spare units`);
  console.log(`  the production slider drops ${capBefore} → ${st.cap}`);
  console.log(`  the projection expects ${money(st.earned)} of rent in: ${st.shown}`);
  if (st.leases[0].kind !== 'out') fail('renting out did not register as renting out');
  if (!(st.cap < capBefore)) {
    fail('plant was rented out and the form still lets the player build with it');
  }
  if (!(st.earned > 0) || !st.shown) fail('the projection does not show rent coming in');

  /* And the two directions cannot be held at once on one line. The server
     refuses that outright, so the form must never be able to build the request —
     which it manages by replacing both inputs with the pending lease and a way
     to change your mind, rather than by validating after the fact. */
  const inputs = await page.evaluate(() => ({
    rentIn: !!document.querySelector('[data-leasein]'),
    rentOut: !!document.querySelector('[data-leaseout]'),
    undo: !!document.querySelector('[data-leaseclear]'),
  }));
  console.log(`  with a lease pending: rent-in input ${inputs.rentIn}, `
    + `rent-out input ${inputs.rentOut}, a way to undo ${inputs.undo}`);
  if (inputs.rentIn || inputs.rentOut) {
    fail('a line still offers the opposite direction while a lease is pending');
  }
  if (!inputs.undo) fail('a pending lease cannot be taken back');

  await page.click('[data-leaseclear]');
  await page.waitForTimeout(250);
  const cleared = await page.evaluate(() => ({
    leases: D.leases.length,
    cap: [...document.querySelectorAll('[data-field="produce"]')].map((n) => +n.max)[0],
  }));
  console.log(`  after changing your mind: ${cleared.leases} leases, `
    + `slider back to ${cleared.cap}`);
  if (cleared.leases !== 0) fail('changing your mind left the lease in place');
  if (cleared.cap !== capBefore) fail('the production slider did not come back');
}

console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
await b.close();
console.log('supply UI OK');
