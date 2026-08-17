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
await guest.waitForSelector('.code', { timeout: 10000 });
const lobby = await guest.evaluate(() => document.body.innerText);
console.log('joined a public table:', /Waiting for players/.test(lobby));
console.log('lobby explains itself:', /empty seats become AI/i.test(lobby));
console.log('no host start button on a public table:', !(await guest.$('#start')));
if (await guest.$('#start')) throw new Error('a public table offered a host start button');
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

await browser.close();
console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
console.log('public UI OK');
