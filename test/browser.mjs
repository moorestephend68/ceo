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
const friendCtx = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
const host = await hostCtx.newPage();
const friend = await friendCtx.newPage();
watch(host, 'host'); watch(friend, 'friend');

/* ---- host creates ------------------------------------------------------- */
await host.goto(BASE + '/g/');
await host.fill('#hostname', 'Ravensworth & Co');
await host.click('#seatchoice .choice[data-seats="3"]');
await host.click('#roundchoice .choice[data-rounds="8"]');
await host.click('#presetchoice .choice[data-preset="standard"]');
await host.click('#create');
await host.waitForSelector('.code');
const code = (await host.textContent('.code')).trim();
const link = await host.inputValue('#sharelink');
console.log('host created game', code);
{
  const txt = await host.evaluate(() => document.body.innerText);
  console.log('host settings honoured:', /3 companies · 8 rounds/.test(txt) ? 'yes' : 'NO — ' + (txt.match(/\d+ companies · \d+ rounds/) || ['?'])[0]);
  if (!/3 companies · 8 rounds/.test(txt)) throw new Error('the host\'s chosen settings were ignored');
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
await host.waitForSelector('#f_0_price');
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

/* ---- play it out -------------------------------------------------------- */
async function file(page, mult) {
  if (!(await page.$('#f_0_price'))) return false;
  const val = await page.inputValue('#f_0_price');
  await page.fill('#f_0_price', String(Math.round(+val * mult)));
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
