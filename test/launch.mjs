/* A launch, all the way through: tick it, file it, let the round resolve, and
   check a second line is really there and can be given its own orders. */
/* Playwright is not a dependency — see test/browser.mjs. */
const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => {
  console.error('Playwright not found. npm i -D playwright && npx playwright install chromium');
  process.exit(2);
});
const { chromium } = pw.default || pw;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1800 } });
await ctx.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });

await page.goto('http://localhost:8899/g/');
await page.waitForTimeout(400);
await page.click('#seatchoice .choice[data-seats="3"]');
await page.click('#cadencechoice .choice[data-cadence="5m"]');
await page.click('#roundchoice .choice[data-rounds="12"]');
await page.click('#create');
await page.waitForSelector('.code');
await page.click('#start');
await page.waitForSelector('.ctrl input[type=range]');

/* Counted by the hook on the card, not by the heading text. The headings used
   to read "Line 1" and now read "Cast-iron pans"; a test that matched on prose
   reported a missing line when the only thing missing was the old wording. */
const lines = async () => (await page.$$eval('.card[data-line]', ns =>
  ns.map(n => (n.querySelector('h2') || {}).textContent || '').map(t => t.trim())));

console.log('lines before:', (await lines()).join(', ') || 'none');
await page.click('#kindchoice .choice[data-kind="commodity"]');
await page.check('#f_launch');
const projSaysLaunch = /for the new\s+line/.test(await page.textContent('#projection'));
console.log('projection accounts for the launch cost:', projSaysLaunch);

await page.click('#file');
await page.waitForTimeout(400);
console.log('filed. round now:', (await page.textContent('.card h2')).trim());

/* the other two seats are bots, so the round only closes on the clock —
   drive it by waiting for the deadline the fast cadence gives us */
await page.evaluate(async () => {
  await fetch('/api/state?code=' + S.code + '&token=' + S.token);
});
for (let i = 0; i < 40; i++) {
  const v = await page.evaluate(() => S.view && S.view.round);
  if (v >= 1) break;
  await page.waitForTimeout(1000);
  await page.evaluate(() => refresh());
}
await page.evaluate(() => render());
await page.waitForTimeout(300);

const after = await lines();
console.log('lines after the round:', after.join(', ') || 'none');
const body = await page.evaluate(() => document.body.innerText);
console.log('news mentions the launch:', /opened a new line/i.test(body));
const sliderCount = await page.$$eval('.ctrl input[type=range]', ns => ns.length);
console.log('sliders now on the page:', sliderCount, '(6 per line)');

if (after.length < 2) throw new Error('the second line never appeared');
if (sliderCount < 12) throw new Error('the second line has no controls of its own');
await b.close();
console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no console errors');
console.log('launch OK');
