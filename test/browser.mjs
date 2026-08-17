/* Two real browsers, one game.

   The host creates a session in one browser context and a friend joins from
   another through the share link — separate localStorage, so the two identities
   are genuinely separate the way they would be on two laptops. Then a full game
   is played through the interface, not the API. */

/* Playwright is not a dependency of this project — install it where you like:
     npm i -D playwright && npx playwright install chromium
   A globally installed copy works too; set PLAYWRIGHT from `npm root -g`. */
const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => {
  console.error('Playwright not found. npm i -D playwright && npx playwright install chromium');
  process.exit(2);
});
const { chromium } = pw.default || pw;

const BASE = 'http://localhost:8899';
const errs = [];
const watch = (page, who) => {
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`${who}: ${m.text()}`); });
  page.on('pageerror', (e) => errs.push(`${who} PAGEERROR: ${e.message}`));
};

const browser = await chromium.launch();
const hostCtx = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
/* hosting is a paid feature now — sign the host in as the seeded local account */
await hostCtx.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
const friendCtx = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
const host = await hostCtx.newPage();
const friend = await friendCtx.newPage();
watch(host, 'host'); watch(friend, 'friend');

/* ---- host creates ------------------------------------------------------- */
await host.goto(BASE + '/g/');
await host.waitForTimeout(400);   // let the account load
await host.click('#seatchoice .choice[data-seats="3"]');
await host.click('#cadencechoice .choice[data-cadence="5m"]');
await host.click('#roundchoice .choice[data-rounds="8"]');
await host.click('#presetchoice .choice[data-preset="standard"]');
/* the fixed-hour box is meaningless at five minutes and should be hidden */
{
  const wrap = await host.$('#closehour-wrap');
  const shown = wrap ? await wrap.isVisible() : false;
  console.log('close-hour box hidden for a fast game:', !shown);
  if (shown) throw new Error('the daily close-hour setting was offered for a 5-minute game');
  await host.click('#cadencechoice .choice[data-cadence="1d"]');
  const shownDaily = await (await host.$('#closehour-wrap')).isVisible();
  console.log('close-hour box shown for a daily game:', shownDaily);
  if (!shownDaily) throw new Error('the daily close-hour setting never appears');
  await host.click('#cadencechoice .choice[data-cadence="5m"]');
}
await host.click('#create');
await host.waitForSelector('.code');
const code = (await host.textContent('.code')).trim();
const link = await host.inputValue('#sharelink');
console.log('host created game', code);
{
  const txt = await host.evaluate(() => document.body.innerText);
  console.log('host settings honoured:', /3 companies · 8 rounds/.test(txt) ? 'yes' : 'NO — ' + (txt.match(/\d+ companies · \d+ rounds/) || ['?'])[0]);
  if (!/3 companies · 8 rounds/.test(txt)) throw new Error('the host\'s chosen settings were ignored');
  console.log('lobby states the pace:', (txt.match(/a round every [^·]+/) || ['NOT SHOWN'])[0].trim());
  if (!/a round every 5 minutes/.test(txt)) throw new Error('the chosen round length was ignored');
}
console.log('share link:', link);

/* ---- friend joins via the link ------------------------------------------ */
await friend.goto(link.replace('http://localhost', 'http://localhost'));
await friend.waitForSelector('#joinname, .code');
/* the link opens the game; a newcomer with no token gets the join form */
if (await friend.$('#joinname')) {
  /* arriving on an invitation, the code is already known — only the name is asked for */
  const codeBox = await friend.$('#joincode');
  if (codeBox && await codeBox.isVisible()) await friend.fill('#joincode', code);
  await friend.fill('#joinname', 'Sableworth Ltd');
  await friend.click('#join');
} else {
  throw new Error('friend did not get a join form');
}
await friend.waitForSelector('.code');
console.log('friend joined; lobby now shows:',
  (await friend.$$eval('table td', (n) => n.map((x) => x.textContent.trim()))).filter(Boolean).slice(0, 8).join(' / '));

/* the friend must not be able to start it */
console.log('friend sees a start button:', !!(await friend.$('#start')));
if (await friend.$('#start')) throw new Error('a non-host was offered the start button');

/* ---- host starts -------------------------------------------------------- */
await host.click('#start');
await host.waitForSelector('.ctrl input[type=range]');
const seats = await host.$$eval('table tbody tr td:first-child', (n) => n.map((x) => x.textContent.trim()));
console.log('game started, seats:', seats.slice(0, 4).join(' | '));

/* the borrowing rate has to be on the page before anyone needs a loan */
{
  const txt = await host.evaluate(() => document.body.innerText);
  const m = txt.match(/(Strong|Sound|Stretched|Strained|Distressed) — ([\d.]+)% a round/);
  console.log('borrowing shown:', m ? m[0] : 'NOT SHOWN');
  if (!m) throw new Error('the borrowing rate is not visible');
  const kinds = await host.$$eval('#kindchoice .choice',
    (ns) => ns.map((n) => n.querySelector('.n').textContent.replace(/\s+/g, ' ').trim()));
  console.log('product kinds offered:', kinds.length ? kinds.join(' | ') : 'none');
  if (!kinds.length) throw new Error('no product kinds offered at launch');
  const physical = await host.evaluate(() => document.body.innerText.includes('in stock'));
  console.log('starting line described as physical:', physical);
}

/* nothing in the page should say which seats are AI */
const midText = await host.evaluate(() => document.body.innerText);
const leaks = ['Discounter', 'Premium —', 'Marketer —', 'Operator —', 'Balanced —', 'a person']
  .filter((s) => midText.includes(s));
console.log('identity leaks mid-game:', leaks.length ? leaks.join(', ') : 'none');
if (leaks.length) throw new Error('identity leaked during play');

/* ---- the interface itself ------------------------------------------------ */
{
  const sliders = await host.$$eval('.ctrl input[type=range]',
    (ns) => ns.map((n) => n.dataset.field));
  console.log('sliders on the order form:', sliders.join(', ') || 'NONE');
  if (sliders.length < 6) throw new Error('the live form is missing its sliders');

  const proj = await host.textContent('#projection');
  console.log('projection panel present:', /Expected profit/.test(proj));
  if (!/Expected profit/.test(proj)) throw new Error('no projection panel');

  /* moving a slider must move the projection, without losing the form */
  const before = (await host.textContent('#projection')).match(/Expected profit\s*(-?\$[\d,]+)/)[1];
  /* a range input is dragged, not typed into — set it the way a drag would.
     The price slider is bounded to half..1.6x of the product's value, so pick a
     target inside its own range rather than an arbitrary number. */
  const target = await host.evaluate(() => {
    const el = document.querySelector('.ctrl input[type=range][data-field="price"]');
    const v = String(Math.round(+el.min) + 5);
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  });
  await host.waitForTimeout(120);
  const after = (await host.textContent('#projection')).match(/Expected profit\s*(-?\$[\d,]+)/)[1];
  console.log('projection reacts to a slider:', before, '->', after);
  if (before === after) throw new Error('the projection did not respond to the price slider');

  /* the number box and the slider are the same value */
  const num = await host.inputValue('.ctrl input[type=number][data-field="price"]');
  console.log('slider and number box agree:', num === target, `(both read ${num})`);
  if (num !== target) throw new Error('slider and number box are out of sync');
}

/* ---- is the projection honest? ------------------------------------------- */
/* It cannot be exact in a shared market — it assumes rivals hold their prices and
   they will not. But the cost side is arithmetic the server repeats verbatim, so a
   large systematic gap would mean the two have drifted apart. */
{
  const projected = Number((await host.textContent('#projection'))
    .match(/Expected profit\s*(-?\$[\d,]+)/)[1].replace(/[^0-9.-]/g, ''))
    * ((await host.textContent('#projection')).match(/Expected profit\s*-/) ? -1 : 1);
  await host.click('#file');
  await host.waitForTimeout(200);
  await friend.reload(); await friend.waitForTimeout(200);
  await friend.click('#file');
  await friend.waitForTimeout(300);
  await host.reload(); await host.waitForTimeout(300);
  const body = await host.evaluate(() => document.body.innerText);
  const m = body.match(/(-?\$[\d,]+)\s*\n?\s*your profit/);
  if (m) {
    const actual = Number(m[1].replace(/[^0-9.-]/g, '')) * (m[1].startsWith('-') ? -1 : 1);
    const gap = Math.abs(actual - projected);
    console.log(`projected ${projected} vs actual ${actual} — gap ${gap}`);
    if (gap > Math.max(60000, Math.abs(projected) * 0.6)) {
      throw new Error(`projection is off by ${gap}; the two engines may have drifted`);
    }
  } else {
    console.log('could not read the actual profit to compare');
  }
}

/* ---- play it out -------------------------------------------------------- */
async function file(page, mult) {
  const box = await page.$('.ctrl input[type=number][data-field="price"]');
  if (!box) return false;
  const val = await box.inputValue();
  await box.fill(String(Math.round(+val * mult)));
  await box.dispatchEvent('input');
  await page.click('#file');
  await page.waitForTimeout(220);
  return true;
}

let round = 0;
for (let i = 0; i < 12; i++) {
  const over = await host.$('#home');
  if (over) break;
  round += 1;
  await file(host, 1.01);
  await friend.reload();
  await friend.waitForTimeout(180);
  await file(friend, 0.96);
  await host.reload();
  await host.waitForTimeout(220);
  const hdr = await host.textContent('.card h2');
  if (i === 0) {
    console.log('after both filed, host sees:', hdr.trim());
  }
}

/* ---- the reveal --------------------------------------------------------- */
await host.reload();
await host.waitForSelector('#home', { timeout: 5000 });
const rows = await host.$$eval('table tbody tr', (ns) => ns.map((n) =>
  [...n.querySelectorAll('td')].map((t) => t.textContent.trim())));
console.log('\nfinal standings as the host sees them:');
for (const r of rows.slice(0, 4)) console.log('  ' + r.join('  ·  '));

const finalText = await host.evaluate(() => document.body.innerText);
console.log('\nreveal names a person:', finalText.includes('a person'));
console.log('reveal names a strategy:', /Discounter|Premium|Marketer|Operator|Balanced/.test(finalText));
if (!finalText.includes('a person')) throw new Error('the reveal never identified the humans');

console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
if (errs.length) process.exit(1);
console.log('browser OK');
