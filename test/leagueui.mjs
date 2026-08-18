/* The bot league, as its author finds it: from the front page, in a browser.

   The API is tested elsewhere. What is tested here is whether somebody who
   could write a bot ever discovers that they are allowed to — and whether the
   one screen that shows a secret handles it like one. */

const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => { console.error('Playwright not found.'); process.exit(2); });
const { chromium } = pw.default || pw;

const BASE = 'http://localhost:8899';
const browser = await chromium.launch();
const errs = [];

async function open(devToken) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
  if (devToken) await ctx.addInitScript((t) => localStorage.setItem('ceo.dev.token', t), devToken);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/40[123]/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + '/g/');
  await p.waitForTimeout(500);
  return p;
}
const text = (p) => p.evaluate(() => document.body.innerText);

/* ---- signed out: is it even findable? ----------------------------------- */
const guest = await open(null);
const home = await text(guest);
console.log('the front page mentions writing a bot:', /Write a bot/.test(home));
if (!/Write a bot/.test(home)) throw new Error('nobody would ever find the league');
if (!(await guest.$('#showleague'))) throw new Error('no way into the league');

await guest.click('#showleague');
await guest.waitForSelector('#closeleague', { timeout: 10000 });
const league = await text(guest);
console.log('\n--- what a bot author reads ---');
console.log(league.split('\n').filter(Boolean).slice(1, 12).join('\n'));

/* The three promises that make this a supported way to play rather than a
   tolerated one. If any of them is missing from the page it is not a promise,
   it is an implementation detail nobody was told about. */
for (const [claim, re] of [
  ['we never run your code', /never run anybody's code/i],
  ['a bot key cannot enter the human tier', /cannot enter a ranked table/i],
  ['the board is an average, not a total', /average money made/i],
  ['there is a documented protocol', /BOTS\.md/],
]) {
  console.log(`  states that ${claim}: ${re.test(league)}`);
  if (!re.test(league)) throw new Error(`the league page does not say: ${claim}`);
}

console.log('signed out, it says how to get a key:', /Sign in on the home page/.test(league));
if (await guest.$('#makekey')) throw new Error('a signed-out visitor was offered a bot key');

/* ---- signed in: making a key -------------------------------------------- */
const author = await open('tok:demo');
await author.waitForSelector('text=Ravensworth', { timeout: 10000 });
await author.click('#showleague');
await author.waitForSelector('#makekey', { timeout: 10000 });
const before = await text(author);
console.log('\nsigned in, the offer names the company:',
            /recorded as Ravensworth & Co/.test(before));
console.log('and warns before you press it:', /shown once/i.test(before));

await author.click('#makekey');
await author.waitForSelector('#botkey', { timeout: 10000 });
const key = await author.inputValue('#botkey');
console.log(`\nkey issued: ${key.slice(0, 12)}… (${key.length} chars)`);
if (!/^ceobot_/.test(key)) throw new Error(`that is not a bot key: ${key}`);

const shown = await text(author);
console.log('the page says it is the only time it is shown:', /only.{0,4} time it is shown/i.test(shown));
if (!/only.{0,4} time it is shown/i.test(shown)) {
  throw new Error('a key shown once, without saying so, is a key somebody loses');
}
console.log('and gives the command to run:', /reference-bot\.mjs/.test(shown));
if (!/reference-bot\.mjs/.test(shown)) throw new Error('no runnable next step');

/* A key that can act on your behalf must not be written anywhere the browser
   keeps things. This is the assertion worth having on this screen. */
const stored = await author.evaluate(() => {
  const all = [];
  for (let i = 0; i < localStorage.length; i++) {
    all.push(localStorage.getItem(localStorage.key(i)) || '');
  }
  for (let i = 0; i < sessionStorage.length; i++) {
    all.push(sessionStorage.getItem(sessionStorage.key(i)) || '');
  }
  return all.join('\n');
});
console.log('the key is not in local or session storage:', !stored.includes(key));
if (stored.includes(key)) throw new Error('the bot key was persisted in the browser');

/* Leaving the screen forgets it, because it cannot be shown again anyway and a
   secret sitting in a variable for the rest of the session is a secret waiting
   to be screenshotted. */
await author.click('#closeleague');
await author.waitForTimeout(300);
await author.click('#showleague');
await author.waitForSelector('#makekey', { timeout: 10000 });
console.log('leaving the screen forgets it:', !(await author.$('#botkey')));
if (await author.$('#botkey')) throw new Error('the key survived leaving the screen');

/* ---- the board ---------------------------------------------------------- */
const board = await text(author);
console.log('\nthe board explains the minimum before it is empty:',
            /minimum 5 games/.test(board));
console.log('and says so plainly when it is:', /yours to take/.test(board));

await browser.close();
console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
console.log('league UI OK');
