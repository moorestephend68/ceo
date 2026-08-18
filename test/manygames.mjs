/* One company, several games at once.

   A purchased name is not one game at a time. The question this checks is the one
   a player actually has: can I keep a daily game with friends going, sit in a
   ranked table for three-quarters of an hour, and move between them — without
   editing the URL, which was the only way until this existed. */

const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => { console.error('Playwright not found.'); process.exit(2); });
const { chromium } = pw.default || pw;

const BASE = 'http://localhost:8899';
const browser = await chromium.launch();
const errs = [];
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1400 } });
await ctx.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/40[123]/.test(m.text())) errs.push(m.text()); });
const text = () => p.evaluate(() => document.body.innerText);

/* ---- a long private game with friends ------------------------------------ */
await p.goto(BASE + '/g/');
await p.waitForTimeout(500);
await p.click('#cadencechoice .choice[data-cadence="1d"]');
await p.click('#create');
await p.waitForSelector('#start', { timeout: 10000 });
await p.click('#start');
await p.waitForSelector('#file', { timeout: 10000 });
console.log('a daily game with friends is running:', /round 1 of/i.test(await text()));

/* ---- the way out, which is the whole point ------------------------------- */
if (await p.isHidden('#mygames')) throw new Error('no way back to the front page from inside a game');
await p.click('#mygames');
await p.waitForSelector('#playnow', { timeout: 10000 });
console.log('“My games” returns to the front page:', !!(await p.$('#playnow')));

let home = await text();
console.log('and lists it:', /every a day|private/i.test(home));
console.log('  ' + (home.match(/Your games[\s\S]{0,120}/) || ['—'])[0].split('\n').filter(Boolean).slice(0, 4).join(' | '));

/* ---- a ranked table at the same time ------------------------------------- */
await p.click('#playnow');
/* A ranked table may still be filling, or may already have started if other
   people were waiting — either is a seat, and the test should not care which. */
await p.waitForFunction(
  () => /Finding you a table/.test(document.body.innerText) || !!document.getElementById('file'),
  null, { timeout: 15000 });
console.log('\nseated at a ranked table while the daily game is still on');

await p.click('#mygames');
await p.waitForSelector('#playnow', { timeout: 10000 });
/* The list is fetched after the first paint, so wait for both rows to arrive
   rather than racing the fetch. */
try {
  await p.waitForFunction(() => {
    const t = document.body.innerText;
    return /ranked/.test(t) && /private/.test(t);
  }, null, { timeout: 15000 });
} catch {
  console.log('--- what the page showed ---');
  console.log(await text());
  throw new Error('the two games are not both listed');
}
home = await text();
console.log('both games listed: true');
/* The point of the list is not that it exists but that it says which game is
   waiting for you — read from the whole page rather than a slice of it, because
   what sits between the cards changes as the site grows. */
console.log('the list says which is waiting:', /waiting on you|your move/i.test(home));
if (!/your move|waiting on you/i.test(home)) {
  console.log('--- what the page showed ---');
  console.log(home);
  throw new Error('the list does not say which needs you');
}

/* a reload of the front page must stay on the front page */
await p.reload();
await p.waitForSelector('#playnow', { timeout: 10000 });
console.log('reloading the front page stays there:', !!(await p.$('#playnow')));
if (!(await p.$('#playnow'))) throw new Error('a reload was dragged back into a game');

/* ---- and back into either one --------------------------------------------- */
const openButtons = await p.$$('[data-resume]');
console.log('games openable from the list:', openButtons.length);
if (openButtons.length < 2) throw new Error('both games should be openable');
await openButtons[0].click();
await p.waitForTimeout(900);
console.log('opening one of them lands in a game:', !!(await p.$('#file')) || /Finding you a table/.test(await text()));

await p.screenshot({ path: '/home/claude/my-games.png', fullPage: false });
await browser.close();
console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
console.log('many games OK');
