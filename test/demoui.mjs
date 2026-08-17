/* The demo, driven the way an instructor would drive it.

   Everything here is done in a browser with no stored session and no sign-in —
   because "no login at the door" is a claim about the door, and the only way to
   check a door is to walk through it. */

const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => { console.error('Playwright not found.'); process.exit(2); });
const { chromium } = pw.default || pw;

const BASE = 'http://localhost:8899';
const browser = await chromium.launch();
const errs = [];

/* A brand new browser profile: no account, no token, nothing remembered. */
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1800 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/40[123]/.test(m.text())) errs.push(m.text()); });

const text = () => page.evaluate(() => document.body.innerText);

await page.goto(BASE + '/g/');
await page.waitForTimeout(600);

const signedOut = await text();
console.log('signed out, and the demo is still offered:', !!(await page.$('#trydemo')));
if (!(await page.$('#trydemo'))) throw new Error('no demo entry point for a signed-out visitor');
if (/sign in to (see|open) the demo/i.test(signedOut)) throw new Error('the demo is gated');

/* ---- open it ------------------------------------------------------------ */
const t0 = Date.now();
await page.click('#trydemo');
await page.waitForSelector('#cadv1', { timeout: 20000 });
console.log(`opened in ${Date.now() - t0}ms`);

let board = await text();
const roll = (board.match(/(\d+) groups? · (\d+) students?[^\n]*/) || ['—'])[0];
console.log('the class:', roll);
if (!/6 groups · 30 students/.test(board)) throw new Error('the demo class is not populated');
if (!/round 6 of 12/.test(board)) throw new Error('the demo did not arrive part-played');

console.log('\nwhat it tells the visitor to look at:');
for (const line of board.split('\n').filter((l) => /^(Your seat|Group \d|The student|Why so many|The same market)\./.test(l))) {
  console.log('  ' + line.slice(0, 150) + (line.length > 150 ? '…' : ''));
}
if (!/undercutting each other since round 3/.test(board)) throw new Error('the price war is not surfaced');
if (!/has missed \d+ rounds?/.test(board)) throw new Error('the non-filer is not surfaced');
if (!/same market \(seed 20260415\)/.test(board)) throw new Error('the shared seed is not stated');

/* a class caught mid-round: some have filed, some have not */
const waiting = (board.match(/waiting on (\d+)/) || [])[1];
console.log('\nstudents still to file:', waiting, 'of 30');
if (!waiting || +waiting === 0 || +waiting === 30) {
  throw new Error(`the board should be caught mid-round, not all-or-nothing (waiting on ${waiting})`);
}
if (!/filed/.test(board) || !/not yet/.test(board)) {
  throw new Error('the board should show both filed and outstanding students');
}

/* the group with the price war should visibly be the group in trouble */
const groups = board.split(/\nGroup \d+ [A-Z0-9]{6}\n/).slice(1);
console.log('bottom company in each group:');
groups.forEach((g, i) => {
  const vals = [...g.matchAll(/(-?\$[\d,]+)/g)].map((m) => Number(m[1].replace(/[^0-9-]/g, '')));
  console.log(`  group ${i + 1}: ${vals.length ? '$' + Math.min(...vals).toLocaleString('en-US') : '—'}`);
});

/* ---- push it forward ---------------------------------------------------- */
console.log('\ntime compression:');
await page.click('#cadv3');
await page.waitForTimeout(1200);
board = await text();
console.log('  three rounds in one click:', /round 9 of 12/.test(board));
if (!/round 9 of 12/.test(board)) throw new Error('fast-forward did not move the class');

/* ---- sit in a student's chair ------------------------------------------- */
await page.click('#cseat');
await page.waitForSelector('#file', { timeout: 15000 });
const seat = await text();
console.log('\nin the student\'s chair:');
console.log('  ' + (seat.match(/You are sitting in [^\n]*/) || ['—'])[0]);
console.log('  sliders present:', (await page.$$('input[type=range]')).length);
console.log('  projection present:', !!(await page.$('#projection .proj')));
if (!(await page.$$('input[type=range]')).length) throw new Error('no sliders in the student view');
if (!(await page.$('#projection .proj'))) throw new Error('no projection in the student view');
const proj = await page.textContent('#projection');
console.log('  ' + (proj.match(/Expected profit\s*-?\$[\d,]+/) || ['—'])[0]);

/* a student sees a student's view and no more */
if (/an AI company|a person/.test(seat)) throw new Error('the reveal leaked mid-game');

/* moving a slider must move the projection, or it is a picture rather than a tool */
const beforeProj = await page.textContent('#projection');
await page.fill('input[type=number][data-field="advertising"]', '40000');
await page.waitForTimeout(300);
const afterProj = await page.textContent('#projection');
console.log('  changing a number changes the projection:', beforeProj !== afterProj);
if (beforeProj === afterProj) throw new Error('the projection did not respond');

/* ---- back to the dashboard ---------------------------------------------- */
await page.click('#backtoclass');
await page.waitForSelector('#cadv1', { timeout: 15000 });
console.log('\nback to the dashboard:', /6 groups · 30 students/.test(await text()));

/* ---- reload: the same class, not a new one ------------------------------ */
const codeBefore = await page.textContent('.code');
await page.reload();
await page.waitForSelector('#cadv1', { timeout: 20000 });
const codeAfter = await page.textContent('.code');
console.log('reloading keeps the same class:', codeBefore.trim() === codeAfter.trim(),
            `(${codeAfter.trim()})`);
if (codeBefore.trim() !== codeAfter.trim()) throw new Error('a reload abandoned the demo');
if (!/round 9 of 12/.test(await text())) throw new Error('a reload lost the rounds played');

/* ---- the gradebook ------------------------------------------------------ */
const dl = page.waitForEvent('download', { timeout: 15000 });
await page.click('#cexport');
const file = await dl;
console.log('the gradebook downloads as:', file.suggestedFilename());
if (!/\.csv$/.test(file.suggestedFilename())) throw new Error('the export is not a CSV');

/* ---- leaving ------------------------------------------------------------ */
await page.click('#closedemo');
await page.waitForSelector('#trydemo', { timeout: 10000 });
console.log('leaving the demo lands back on the home screen:', !!(await page.$('#trydemo')));

await browser.close();
console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
console.log('demo UI OK');
