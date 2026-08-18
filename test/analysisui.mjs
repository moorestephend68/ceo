/* The analysis, as an instructor reaches it: through the demo, with no account. */

const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => { console.error('Playwright not found.'); process.exit(2); });
const { chromium } = pw.default || pw;

const BASE = 'http://localhost:8899';
const browser = await chromium.launch();
const errs = [];
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1800 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/40[123]/.test(m.text())) errs.push(m.text()); });
const text = () => p.evaluate(() => document.body.innerText);

await p.goto(BASE + '/g/');
await p.waitForTimeout(500);
await p.click('#trydemo');
await p.waitForSelector('#cadv1', { timeout: 20000 });

/* play it out, the way an instructor would by the end of a session */
for (let i = 0; i < 3; i++) {
  const more = await p.$('#cadv5');
  if (!more) break;
  await more.click();
  await p.waitForTimeout(1500);
}

console.log('analysis is offered on the dashboard:', !!(await p.$('#showanalysis')));
if (!(await p.$('#showanalysis'))) throw new Error('no way into the analysis');
await p.click('#showanalysis');
await p.waitForSelector('#closeanalysis', { timeout: 15000 });
await p.waitForTimeout(400);

const t = await text();
console.log('\n--- what the instructor sees ---');
console.log(t.split('\n').filter(Boolean).slice(1, 26).join('\n'));

if (!/identical market \(seed \d+\)/.test(t)) {
  throw new Error('the analysis does not say the market was identical, which is the whole claim');
}
if (!/The groups, ranked/.test(t)) throw new Error('no group comparison');
if (!/Things worth discussing/.test(t)) throw new Error('no findings');
if (!/undercut each other/.test(t)) throw new Error('the price war is not surfaced');
if (!/Who filed, and who was carried/.test(t)) throw new Error('no participation');

/* every finding must carry a question to ask, or it is trivia */
const asks = (t.match(/Ask (them|the group|at which|whether)/g) || []).length;
console.log(`\nfindings that come with a question to ask: ${asks}`);
if (asks < 2) throw new Error('the findings do not tell the instructor what to do with them');

/* ---- the two downloads ---------------------------------------------------- */
for (const [id, ext] of [['areport', '.html'], ['arounds', '.csv'], ['cexport', '.csv']]) {
  const dl = p.waitForEvent('download', { timeout: 15000 });
  await p.click('#' + id);
  const file = await dl;
  console.log(`  ${id} downloads as ${file.suggestedFilename()}`);
  if (!file.suggestedFilename().endsWith(ext)) {
    throw new Error(`${id} produced ${file.suggestedFilename()}, expected ${ext}`);
  }
}

/* the debrief must be a whole page that opens on its own */
const dl = p.waitForEvent('download', { timeout: 15000 });
await p.click('#areport');
const report = await dl;
const stream = await report.createReadStream();
let html = '';
for await (const chunk of stream) html += chunk;
console.log(`\nthe debrief is ${(html.length / 1024).toFixed(1)} KB of self-contained HTML`);
if (!/<!doctype html>/i.test(html)) throw new Error('the debrief is not a document');
if (/<script/i.test(html)) throw new Error('the debrief should not need scripts to open');
if (!/Things worth discussing/.test(html)) throw new Error('the debrief has no findings');
if (!/identical market/.test(html)) throw new Error('the debrief omits the shared market');

/* back to the groups */
await p.click('#closeanalysis');
await p.waitForSelector('.code', { timeout: 10000 });
console.log('back to the group boards:', /Group 1/.test(await text()));
if (!/Group 1/.test(await text())) throw new Error('could not get back to the groups');

await browser.close();
console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
console.log('analysis UI OK');
