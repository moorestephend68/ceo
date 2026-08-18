/* Public play through the interface, signed out and signed in. */
const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => { console.error('Playwright not found.'); process.exit(2); });
const { chromium } = pw.default || pw;

const BASE = 'http://localhost:8899';
const browser = await chromium.launch();
const errs = [];

async function open(devToken) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1300 } });
  if (devToken) await ctx.addInitScript((t) => localStorage.setItem('ceo.dev.token', t), devToken);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/40[12]/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + '/g/');
  await p.waitForTimeout(500);
  return p;
}

/* ---- signed out: free play, unrated ------------------------------------- */
const guest = await open(null);
const text = await guest.evaluate(() => document.body.innerText);
console.log('play-now offered signed out:', /Play now/.test(text));
console.log('format stated:', (text.match(/\d+ companies · \d+ rounds[^\n]*/) || ['—'])[0]);
if (!(await guest.$('#publicname'))) throw new Error('a signed-out player was not asked for a name');

await guest.fill('#publicname', 'Ketteridge');
await guest.click('#playnow');
await guest.waitForSelector('text=Finding you a table', { timeout: 10000 });
const lobby = await guest.evaluate(() => document.body.innerText);
console.log('seated at a public table:', /Finding you a table/.test(lobby));
console.log('lobby explains itself:', /empty seats become AI/i.test(lobby));
console.log('no host start button on a public table:', !(await guest.$('#start')));
if (await guest.$('#start')) throw new Error('a public table offered a host start button');

/* A ranked table with an invite link is not a ranked table: four friends could
   fill it and settle the finishing order between them, and the thing a host pays
   for — choosing who plays — would be free. */
const shareBox = await guest.$('#sharelink');
const copyBtn = await guest.$('#copy');
const takeSeat = await guest.$('#joinname');
console.log('no share link on a public table:', !shareBox && !copyBtn);
console.log('no "take a seat" form either:', !takeSeat);
if (shareBox || copyBtn) throw new Error('a public table offered an invite link');
if (takeSeat) throw new Error('a public table offered a join form');
console.log('and it says why:', /no link to share, on purpose/i.test(lobby));
if (!/no link to share, on purpose/i.test(lobby)) {
  throw new Error('the missing invite link is unexplained, which reads as a bug');
}
console.log('duration reads sensibly:',
            (lobby.match(/about [^\n·]+ end to end/) || ['—'])[0]);

/* The code is not in the address bar either, because that is the one place a page
   cannot un-show it. Which means a refresh has to find the table another way —
   and losing an in-progress ranked game to a reload would be far worse than the
   thing this is protecting against. */
const url = guest.url();
console.log('the address bar:', url, '— carries no code:', !/\/g\/[A-Z0-9]{6}/.test(url));
if (/\/g\/[A-Z0-9]{6}/i.test(url)) throw new Error('the table code is in the URL');
const chip = await guest.textContent('#gamechip');
console.log('the header chip says:', JSON.stringify(chip.trim()));
if (/[A-Z0-9]{6}/.test(chip)) throw new Error('the table code is in the header chip');

await guest.reload();
await guest.waitForSelector('text=Finding you a table', { timeout: 15000 });
const back = await guest.evaluate(() => document.body.innerText);
console.log('after a refresh, still at the same table:', /Ketteridge/.test(back));
if (!/Ketteridge/.test(back)) throw new Error('a refresh lost the ranked table');


const notice = /unrated/.test(lobby);
console.log('told the game is unrated:', notice);
if (!notice) throw new Error('an unnamed player was not told the game is unrated');

/* ---- signed in with a company: rated, no name box ------------------------ */
const member = await open('tok:demo');
const mtext = await member.evaluate(() => document.body.innerText);
console.log('\nsigned in — plays as their company:', /play as/i.test(mtext));
console.log('signed in — no name box:', !(await member.$('#publicname')));
if (await member.$('#publicname')) throw new Error('a member was asked to type a name');

/* ---- the leaderboard ----------------------------------------------------- */
await member.click('#showboard');
await member.waitForTimeout(600);
const board = await member.evaluate(() => document.body.innerText);
console.log('\nleaderboard opens:', /Leaderboard/.test(board));
console.log('explains what counts:', /Only public games count/.test(board));
if (!/Only public games count/.test(board)) throw new Error('the board does not say what counts');
await member.click('#closeboard');
await member.waitForTimeout(300);
console.log('closes again:', /Play now/.test(await member.evaluate(() => document.body.innerText)));

/* ---- which build is running --------------------------------------------- */
/* Page and server are uploaded separately, and having one without the other is
   exactly the confusion this line exists to end. */
const stamp = await member.evaluate(() => document.body.innerText.match(/page .*server .*/)?.[0] || '');
console.log('\nbuild stamp on the page:', stamp || '(none)');
if (!/page \S/.test(stamp)) throw new Error('the page does not say which build it is');
if (!/server \S/.test(stamp)) throw new Error('the page does not say which build the server is');

await browser.close();
console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
console.log('public UI OK');
