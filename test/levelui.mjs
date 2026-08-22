/* Levels, in a real browser.

   The server side is covered by test/levelgate.mjs. This is the other half, and
   it is the half most likely to be wrong: a control that is still drawn in a
   game that does not offer it, or worse, a projection panel that spends money
   the round will not spend and so quietly disagrees with the result.

   Two games, same host, same everything else. One at each level. */
/* Playwright is not a dependency — see test/browser.mjs. */
const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => {
  console.error('Playwright not found. npm i -D playwright && npx playwright install chromium');
  process.exit(2);
});
const { chromium } = pw.default || pw;
const b = await chromium.launch();
const errs = [];

async function openGame(level) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 2000 } });
  await ctx.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`level ${level} PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`level ${level}: ${m.text()}`); });

  await page.goto('http://localhost:8899/g/');
  await page.waitForTimeout(400);
  await page.click('#seatchoice .choice[data-seats="3"]');
  await page.click('#cadencechoice .choice[data-cadence="5m"]');
  await page.click(`#levelchoice .choice[data-level="${level}"]`);
  await page.click('#create');
  await page.waitForSelector('.code');
  await page.click('#start');
  await page.waitForSelector('.ctrl input[type=range]');
  return page;
}

/* The picker has to exist before anything else can be true. */
{
  const ctx = await b.newContext();
  await ctx.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
  const page = await ctx.newPage();
  await page.goto('http://localhost:8899/g/');
  await page.waitForTimeout(400);
  const choices = await page.$$eval('#levelchoice .choice', (ns) =>
    ns.map((n) => n.querySelector('.n').textContent.trim()));
  console.log('The host is offered:', choices.join(' / '));
  if (choices.length !== 2) throw new Error(`the level picker offers ${choices.length} choices`);
  await ctx.close();
}

const survey = async (page) => page.evaluate(() => ({
  level: S.view.level,
  label: S.view.levelLabel,
  /* Read off the page as a person would, not out of the state object. */
  sliders: [...document.querySelectorAll('.ctrl')].map((c) =>
    (c.textContent || '').trim().split('\n')[0].trim().slice(0, 28)),
  hasProcess: /Process R&D/i.test(document.body.innerText),
  hasLaunchCard: /A new product line/i.test(document.body.innerText),
  hasDiscontinue: /Discontinue this line/i.test(document.body.innerText),
  /* By heading, not by body text. Matching free text found the build stamp in
     the footer — which now contains the words "supply contracts" — and reported
     a first game as drawing a card it does not have. */
  hasSupplyCard: !!document.querySelector('#ratecells')
    || [...document.querySelectorAll('h2')].some((n) => /Supply contract/i.test(n.textContent)),
  hasLeaseControls: !!document.querySelector('[data-leasein], [data-leaseout]'),
  launchBox: !!document.querySelector('#f_launch'),
  processInput: !!document.querySelector('[data-field="rdProcess"]'),
}));

console.log('\nOpening one game at each level.\n');
const one = await openGame(1);
const two = await openGame(2);
const a = await survey(one);
const z = await survey(two);

const show = (s) => {
  console.log(`  level ${s.level} — ${s.label}`);
  console.log(`    controls on a line: ${s.sliders.length} — ${s.sliders.join(' · ')}`);
  console.log(`    process R&D on the page: ${s.hasProcess}`);
  console.log(`    a new product line card:  ${s.hasLaunchCard}`);
  console.log(`    discontinue checkbox:     ${s.hasDiscontinue}`);
  console.log(`    supply contract card:     ${s.hasSupplyCard}`);
  console.log(`    leasing controls:         ${s.hasLeaseControls}`);
};
show(a);
console.log('');
show(z);

const fail = (m) => { throw new Error(m); };
if (a.level !== 1 || z.level !== 2) fail('the games did not open at the levels asked for');
if (a.hasProcess) fail('a first game drew the process R&D control');
if (a.processInput) fail('a first game has a process R&D input in the DOM');
if (a.hasLaunchCard || a.launchBox) fail('a first game offered a new product line');
if (a.hasDiscontinue) fail('a first game offered to discontinue its only line');
if (a.hasSupplyCard) fail('a first game drew the supply contract card');
if (a.hasLeaseControls) fail('a first game drew the leasing controls');
if (!z.hasSupplyCard || !z.hasLeaseControls) {
  fail('the full game does not offer the contracts and leases it is supposed to');
}
if (!z.hasProcess || !z.hasLaunchCard || !z.hasDiscontinue) {
  fail('the full game lost a control it used to have');
}
if (a.sliders.length >= z.sliders.length) {
  fail(`a first game has ${a.sliders.length} controls and the full game ${z.sliders.length}`);
}
console.log(`\n  ${z.sliders.length - a.sliders.length} fewer control(s) a line in a first game, `
  + 'and the launch card is gone entirely');

/* The projection is the thing that would fail quietly. It runs the real engine
   in the page against the orders being typed, so if it still budgets for a lever
   the server zeroes, the number a player is shown is not the number they get. */
const proj = await one.evaluate(() => {
  const p = Object.keys(D.orders)[0];
  return { rdProcess: D.orders[p].rdProcess, discontinue: D.orders[p].discontinue };
});
console.log(`\n  the page's own orders for the line: process R&D ${proj.rdProcess}, `
  + `discontinue ${proj.discontinue}`);
if (proj.rdProcess !== 0) {
  fail(`the projection budgets ${proj.rdProcess} for a lever this game does not have`);
}

/* And filing has to work, which is the thing a hidden control could break.

   Not asserted as `you.filed`, which was the first attempt and was wrong: this
   table has one person and two archetypes, so the round closes the instant the
   only human files and the flag is already back to false by the time it is read.
   What proves the filing landed is that the round moved. */
const before = await one.evaluate(() => S.view.round);
await one.click('#file');
await one.waitForTimeout(900);
const after = await one.evaluate(() => ({ round: S.view.round, filed: S.view.you.filed }));
console.log(`  filed the orders: round ${before} → ${after.round}`
  + `${after.filed ? ', still open' : ', and the round closed on it'}`);
if (after.round === before && !after.filed) fail('a first game could not file its orders');

/* Finally: the levers the level does not offer are absent from the view, not
   merely undrawn. The page cannot leak what it was never sent. */
const sent = await one.evaluate(() => ({
  supply: S.view.you.supply, leasing: S.view.you.leasing,
  canLaunch: S.view.you.canLaunch, kinds: S.view.you.kinds.length,
}));
console.log(`  what the server sent: supply ${sent.supply}, leasing ${sent.leasing}, `
  + `canLaunch ${sent.canLaunch}, product kinds ${sent.kinds}`);
if (sent.supply !== null || sent.leasing !== null || sent.canLaunch || sent.kinds) {
  fail('a first game was sent something it must not be able to use');
}

console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
await b.close();
console.log('level UI OK');
