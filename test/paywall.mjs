/* The paywall, through the interface.

   Three states matter and all three are easy to get wrong: signed out, signed in
   with nothing bought, and signed in with a charter. The important one is the
   middle — a signed-in account with no purchase must not be able to host, and
   must not merely be hidden from the button. */

const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => {
  console.error('Playwright not found.'); process.exit(2);
});
const { chromium } = pw.default || pw;

const BASE = 'http://localhost:8899';
const browser = await chromium.launch();
const errs = [];

async function page(devToken) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1200 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  p.on('console', (m) => {
    /* the 402 below is deliberately provoked by this test to prove the server
       refuses; counting it as a failure would mean the test fails when it passes */
    if (m.type() === 'error' && !/402/.test(m.text())) errs.push(m.text());
  });
  if (devToken) {
    await p.addInitScript((t) => localStorage.setItem('ceo.dev.token', t), devToken);
  }
  await p.goto(BASE + '/g/');
  await p.waitForTimeout(400);
  return p;
}

/* ---- signed out ---------------------------------------------------------- */
const out = await page(null);
const outText = await out.evaluate(() => document.body.innerText);
console.log('signed out — sign-in offered:', /sign-in link/i.test(outText));
console.log('signed out — hosting gated:', /Hosting needs a company charter/i.test(outText));
const createDisabled = await out.$eval('#create', (el) => el.disabled).catch(() => null);
console.log('signed out — create button disabled:', createDisabled);
if (createDisabled !== true) throw new Error('the create button was not disabled when signed out');
/* joining must still be open to anyone */
console.log('signed out — can still join:', !!(await out.$('#joincode')));
if (!(await out.$('#joincode'))) throw new Error('joining should never need an account');

/* ---- signed in, nothing bought ------------------------------------------- */
const poor = await page('tok:skint');
const poorText = await poor.evaluate(() => document.body.innerText);
console.log('\nsigned in, no charter — claim form shown:', /Claim your company/i.test(poorText));
const poorDisabled = await poor.$eval('#create', (el) => el.disabled).catch(() => null);
console.log('signed in, no charter — create disabled:', poorDisabled);
if (poorDisabled !== true) throw new Error('an account with no charter could reach the create button');

/* and the server refuses even if the button is forced */
const forced = await poor.evaluate(async () => {
  const r = await fetch('/api/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok:skint' },
    body: JSON.stringify({ seats: 3, rounds: 8 }),
  });
  return { status: r.status, body: await r.json() };
});
console.log('forcing the request anyway:', forced.status, forced.body.error);
if (forced.status !== 402) throw new Error('the server let an unpaid account create a game');

/* the live name check */
await poor.fill('#claimname', 'Ravensworth & Co');
await poor.waitForTimeout(700);
console.log('typing a taken name says:', (await poor.textContent('#namestate')).trim());
await poor.fill('#claimname', 'Quarry Lane Holdings');
await poor.waitForTimeout(700);
console.log('typing a free name says: ', (await poor.textContent('#namestate')).trim());
const free = (await poor.textContent('#namestate')).trim();
if (!/available/i.test(free)) throw new Error('a free name did not read as available');

/* ---- signed in with a charter -------------------------------------------- */
const rich = await page('tok:demo');
const richText = await rich.evaluate(() => document.body.innerText);
console.log('\nwith a charter — company shown:', /Ravensworth & Co/.test(richText));
const richDisabled = await rich.$eval('#create', (el) => el.disabled);
console.log('with a charter — create enabled:', !richDisabled);
if (richDisabled) throw new Error('a paid account could not host');
console.log('with a charter — no name box:', !(await rich.$('#hostname')));

await rich.click('#seatchoice .choice[data-seats="3"]');
await rich.click('#cadencechoice .choice[data-cadence="5m"]');
await rich.click('#create');
await rich.waitForSelector('.code');
const lobby = await rich.evaluate(() => document.body.innerText);
console.log('game created, host seat is named:', /Ravensworth & Co/.test(lobby));
if (!/Ravensworth & Co/.test(lobby)) throw new Error('the game did not use the account company name');

await browser.close();
console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
console.log('paywall OK');
