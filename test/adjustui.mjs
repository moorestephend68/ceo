/* Filing a round on a phone.

   The six controls per line get about 230px of slider next to their number box
   at 390px wide. Price runs in 50c steps across 1.1× the product's value, so
   that is roughly one pixel per step and nobody can aim it. This checks the
   sheet that replaces them: that it opens, that it is genuinely bigger, that
   dragging it moves the forecast, and — the part most likely to be quietly
   wrong — that it writes back to the same input the desktop control uses
   rather than keeping a second copy of the value. */

const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => { console.error('Playwright not found.'); process.exit(2); });
const { chromium } = pw.default || pw;

const BASE = 'http://localhost:8899';
const browser = await chromium.launch();
const errs = [];

async function seated(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height },
    hasTouch: width < 700, isMobile: width < 700, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/40[123]/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + '/g/');
  await p.waitForTimeout(400);
  await p.click('#seatchoice .choice[data-seats="3"]');
  await p.click('#cadencechoice .choice[data-cadence="5m"]');
  await p.click('#create');
  await p.waitForSelector('.code');
  await p.click('#start');
  /* attached, not visible: on a phone the range inputs are deliberately hidden
     behind the tap rows, so waiting for one to be visible waits for ever. */
  await p.waitForSelector('.ctrl input[type=range]', { state: 'attached' });
  await p.waitForSelector(width < 700 ? '.pick' : '.ctrl .row');
  return p;
}

/* ---- desktop is untouched ------------------------------------------------ */
console.log('On a desktop:');
const d = await seated(1280, 1500);
const deskRow = await d.$eval('.ctrl .row', (e) => getComputedStyle(e).display);
const deskPick = await d.$eval('.pick', (e) => getComputedStyle(e).display);
console.log('  slider row shown:', deskRow !== 'none', '· tap row hidden:', deskPick === 'none');
if (deskRow === 'none' || deskPick !== 'none') {
  throw new Error('the desktop form changed, and it was not supposed to');
}
await d.context().close();

/* ---- the phone ----------------------------------------------------------- */
console.log('\nOn a phone:');
const p = await seated(390, 844);
const phoneRow = await p.$eval('.ctrl .row', (e) => getComputedStyle(e).display);
const picks = await p.$$eval('.pick', (ns) => ns.length);
console.log('  slider rows hidden:', phoneRow === 'none', '·', picks, 'tap rows (6 per line)');
if (phoneRow !== 'none') throw new Error('the cramped sliders are still on screen');
if (picks < 6) throw new Error('the line has fewer than six tap rows');

const tap = await p.$$eval('.pick', (ns) => ns.map((n) => Math.round(n.getBoundingClientRect().height)));
console.log('  tap target heights:', [...new Set(tap)].join(', ') + 'px');
if (Math.min(...tap) < 44) throw new Error('a tap target is under 44px');

/* ---- open the price sheet ------------------------------------------------ */
console.log('\nThe price sheet:');
await p.click('.pick[data-pick="price"]');
await p.waitForTimeout(400);
console.log('  heading :', await p.$eval('#adjname', (e) => e.textContent));
console.log('  value   :', await p.$eval('#adjval', (e) => e.textContent));
console.log('  range   :', await p.$eval('#adjrange', (e) => e.textContent));
const tickShown = await p.$eval('#adjtick', (e) => !e.hidden);
console.log('  market tick shown:', tickShown, '·', await p.$eval('#adjticklab', (e) => e.textContent));
if (!tickShown) throw new Error('price has no marker for what the product is worth');

const geo = await p.evaluate(() => {
  const t = document.querySelector('#adjvs .vtrack').getBoundingClientRect();
  const th = document.querySelector('#adjthumb').getBoundingClientRect();
  const hidden = document.querySelector('.ctrl input[type=range][data-field="price"]');
  const r = hidden.getBoundingClientRect();
  return { track: Math.round(t.height), thumb: Math.round(th.height),
           mid: (th.top + th.bottom) / 2, top: t.top, bottom: t.bottom,
           flatWidth: Math.round(r.width) };
});
console.log('  vertical track:', geo.track + 'px · thumb:', geo.thumb + 'px');
if (geo.track < 300) throw new Error('the vertical track is no bigger than the flat one: ' + geo.track);
if (geo.mid < geo.top - 2 || geo.mid > geo.bottom + 2) throw new Error('the thumb is off the track');
console.log('  thumb sits on the track, and nothing overlaps at rest');

/* ---- dragging moves the forecast ---------------------------------------- */
console.log('\nDragging:');
const before = await p.$eval('#adjprofit', (e) => e.textContent);
const box = await p.$eval('#adjvs .vtrack', (e) => {
  const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, top: r.top, h: r.height };
});
const seen = [];
for (let i = 0; i <= 12; i++) {
  const y = box.top + box.h * (1 - i / 12);
  await p.mouse.move(box.x, y);
  if (i === 0) await p.mouse.down();
  await p.waitForTimeout(20);
  seen.push({ v: await p.$eval('#adjval', (e) => e.textContent),
              pr: await p.$eval('#adjprofit', (e) => e.textContent) });
}
await p.mouse.up();
seen.forEach((s, i) => { if (i % 3 === 0) console.log('   ' + s.v.padEnd(10) + s.pr); });
const values = new Set(seen.map((s) => s.v));
const profits = new Set(seen.map((s) => s.pr));
console.log('  distinct prices touched:', values.size, '· distinct forecasts:', profits.size);
if (values.size < 8) throw new Error('the drag barely moved the value');
if (profits.size < 5) throw new Error('the forecast did not follow the drag');
console.log('  delta reads:', await p.$eval('#adjdelta', (e) => e.textContent));
console.log('  and the forecast at the bottom moved with the thumb');

/* ---- one value, not two -------------------------------------------------- */
console.log('\nOne source of truth:');
const agree = await p.evaluate(() => {
  const r = document.querySelector('.ctrl input[type=range][data-field="price"]');
  const n = r.closest('.ctrl').querySelector('input[type=number]');
  const row = document.querySelector('.pick[data-pick="price"] .pv').textContent.trim();
  const sheet = document.getElementById('adjval').textContent.trim();
  const key = r.dataset.p;
  return { range: r.value, number: n.value, row, sheet,
           order: String(D.orders[key].price) };
});
console.log('  range input :', agree.range);
console.log('  number box  :', agree.number);
console.log('  D.orders    :', agree.order);
console.log('  the row     :', agree.row);
console.log('  the sheet   :', agree.sheet);
if (agree.range !== agree.number || agree.range !== agree.order) {
  throw new Error('the sheet kept its own copy of the value: ' + JSON.stringify(agree));
}
console.log('  the sheet wrote through to the same input the desktop form uses');

/* ---- a redraw while the sheet is open ------------------------------------
   The page polls. If a poll lands while somebody is mid-drag, render() replaces
   every input on the form — including the one the sheet is driving. The sheet
   resolves its input by (product, field) rather than holding the node, so it
   should survive; this is the assertion that keeps that true. */
console.log('\nA poll lands mid-adjust:');
const held = await p.$eval('#adjval', (e) => e.textContent);
await p.evaluate(() => render());
await p.waitForTimeout(250);
const stillOpen = await p.$eval('#adjust', (e) => e.classList.contains('on'));
const after = await p.$eval('#adjval', (e) => e.textContent);
console.log('  sheet still open:', stillOpen, '· value held:', held, '→', after);
if (!stillOpen) throw new Error('a redraw closed the sheet out from under the player');
if (held !== after) throw new Error('a redraw lost the value being adjusted');

/* And it must still be DRIVING the replacement input rather than an orphan.
   Stepping down, not up: the drag above left price at its maximum, where "+"
   cannot move it — and an unchanged value would have let this pass whether the
   sheet was attached to anything at all. */
const beforeStep = await p.$eval('#adjval', (e) => e.textContent);
await p.click('#adjdown');
await p.waitForTimeout(150);
const moved = await p.evaluate(() => {
  const r = document.querySelector('.ctrl input[type=range][data-field="price"]');
  return { sheet: document.getElementById('adjval').textContent.trim(),
           input: r.value, order: String(D.orders[r.dataset.p].price) };
});
console.log('  − after the redraw:', beforeStep, '→', moved.sheet,
            '· input', moved.input, '· D.orders', moved.order);
if (moved.sheet === beforeStep) {
  throw new Error('the sheet did not move the value after a redraw — it is driving an orphan');
}
if (moved.input !== moved.order) {
  throw new Error('after a redraw the sheet and the orders disagree');
}
console.log('  the sheet reattached to the new input rather than an orphan');

/* ---- stepping and moving between controls ------------------------------- */
console.log('\nStepping and Next:');
const was = await p.$eval('#adjval', (e) => e.textContent);
await p.click('#adjdown');
await p.waitForTimeout(120);
console.log('  − moves one step:', was, '→', await p.$eval('#adjval', (e) => e.textContent));

const order = [];
for (let i = 0; i < 5; i++) {
  await p.click('#adjnext');
  await p.waitForTimeout(160);
  order.push(await p.$eval('#adjname', (e) => e.textContent));
}
console.log('  Next walks:', order.join(' → '));
if (order.length !== 5 || new Set(order).size !== 5) {
  throw new Error('Next did not walk all six controls');
}
console.log('  and stops at the last:', await p.$eval('#adjnext', (e) => e.disabled));
if (!(await p.$eval('#adjnext', (e) => e.disabled))) throw new Error('Next ran past the end');

await p.click('#adjdone');
await p.waitForTimeout(250);
console.log('  Done closes it:', !(await p.$eval('#adjust', (e) => e.classList.contains('on'))));

/* ---- the row shows what the sheet set ------------------------------------ */
const rowNow = await p.$eval('.pick[data-pick="price"] .pv', (e) => e.textContent.trim());
console.log('\n  back on the list, price reads:', rowNow);

await browser.close();
console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
console.log('adjust UI OK');
