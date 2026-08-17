/* The facilitator dashboard, and a student arriving on a class link. */
const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => { console.error('Playwright not found.'); process.exit(2); });
const { chromium } = pw.default || pw;

const BASE = 'http://localhost:8899';
const browser = await chromium.launch();
const errs = [];
const watch = (p, who) => {
  p.on('pageerror', (e) => errs.push(`${who} PAGEERROR: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/40[123]/.test(m.text())) errs.push(m.text()); });
};

/* ---- the facilitator ----------------------------------------------------- */
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1600 } });
await ctx.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
const teacher = await ctx.newPage();
watch(teacher, 'teacher');
await teacher.goto(BASE + '/g/');
await teacher.waitForTimeout(500);

console.log('dashboard offered to a facilitator:', !!(await teacher.$('#showclass')));
if (!(await teacher.$('#showclass'))) throw new Error('no facilitator entry point');
await teacher.click('#showclass');
await teacher.waitForSelector('#makeclass');
await teacher.fill('#cname', 'MGT 481 — Autumn');
await teacher.click('#groupsize .choice[data-size="3"]');
await teacher.click('#crounds .choice[data-rounds="8"]');
await teacher.click('#ccadence .choice[data-cadence="5m"]');
await teacher.click('#makeclass');
await teacher.waitForSelector('.code');
const classCode = (await teacher.textContent('.code')).trim();
const shareLink = await teacher.inputValue('#sharelink');
console.log('class created, code', classCode);
console.log('share link:', shareLink);
const head = await teacher.evaluate(() => document.body.innerText);
console.log('states the shared seed:', /same market \(seed \d+\)/.test(head));
if (!/same market \(seed \d+\)/.test(head)) throw new Error('the shared seed is not stated');

/* ---- three students join ------------------------------------------------- */
for (const name of ['Ketteridge', 'Dunmore & Sons', 'Larkfield']) {
  const sctx = await browser.newContext();
  const s = await sctx.newPage();
  watch(s, 'student');
  await s.goto(shareLink);
  await s.waitForSelector('#studentname', { timeout: 10000 });
  await s.fill('#studentname', name);
  await s.click('#joinclass');
  await s.waitForSelector('.code', { timeout: 10000 });
  const t = await s.evaluate(() => document.body.innerText);
  console.log(`  ${name} joined — ${(t.match(/You are in group \d+[^.]*/) || ['?'])[0]}`);
  await sctx.close();
}

/* ---- the board ----------------------------------------------------------- */
/* Back from a class lands on the class list, not the home screen. */
await teacher.click('#closeclass');
await teacher.waitForSelector('[data-openclass]', { timeout: 10000 });
const openBtn = await teacher.$('[data-openclass]');
await openBtn.click();
await teacher.waitForTimeout(500);
let board = await teacher.evaluate(() => document.body.innerText);
console.log('\nboard shows the students:', /Ketteridge/.test(board) && /Larkfield/.test(board));
console.log('board reports the roll:', (board.match(/\d+ groups? · \d+ students?[^\n]*/) || ['—'])[0]);

/* ---- controls ------------------------------------------------------------ */
await teacher.click('#cstart');
await teacher.waitForTimeout(500);
board = await teacher.evaluate(() => document.body.innerText);
console.log('after starting, a round is under way:', /round 1 of 8/.test(board));
if (!/round 1 of 8/.test(board)) throw new Error('the class did not start');

await teacher.click('#cpause');
await teacher.waitForTimeout(400);
board = await teacher.evaluate(() => document.body.innerText);
console.log('pause is stated plainly:', /class is paused/i.test(board));
if (!/class is paused/i.test(board)) throw new Error('pausing was not surfaced');
await teacher.click('#cresume');
await teacher.waitForTimeout(400);

await teacher.click('#cresolve');
await teacher.waitForTimeout(600);
board = await teacher.evaluate(() => document.body.innerText);
console.log('forcing a round moves everyone on:', /round 2 of 8/.test(board));
if (!/round 2 of 8/.test(board)) throw new Error('forcing the round did nothing');

/* ---- export -------------------------------------------------------------- */
const dl = teacher.waitForEvent('download', { timeout: 10000 });
await teacher.click('#cexport');
const file = await dl;
console.log('export downloads as:', file.suggestedFilename());
if (!/\.csv$/.test(file.suggestedFilename())) throw new Error('the export is not a CSV');

await browser.close();
console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
console.log('cohort UI OK');
