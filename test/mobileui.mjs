/* The projection panel on a phone.

   The projection is the panel that runs the real engine against the orders being
   typed, and it is only worth anything *while* they are being typed. On a wide
   screen it is a sticky column beside the form and it works. Under 900px the
   grid collapsed to one column and the panel dropped below six order cards with
   `position: static` — so on a phone you had to scroll past every slider to see
   the number, and once you were there you could not see the sliders.

   That is not a cosmetic problem. It is the difference between a tool and a
   list of boxes.

   So on a narrow screen the panel becomes a bar pinned to the bottom of the
   screen carrying the one number, which opens into the whole breakdown. This
   checks both layouts, because the risk in a change like this is fixing the
   phone and quietly breaking the laptop. */
/* Playwright is not a dependency — see test/browser.mjs. */
const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => {
  console.error('Playwright not found. npm i -D playwright && npx playwright install chromium');
  process.exit(2);
});
const { chromium } = pw.default || pw;
const b = await chromium.launch();
const errs = [];
const fail = (m) => { throw new Error(m); };

async function open(width, height, tag) {
  const ctx = await b.newContext({ viewport: { width, height } });
  await ctx.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`${tag}: ${m.text()}`); });
  await page.goto('http://localhost:8899/g/');
  await page.waitForTimeout(400);
  return page;
}
const intoGame = async (page) => {
  await page.click('#seatchoice .choice[data-seats="3"]');
  await page.click('#cadencechoice .choice[data-cadence="5m"]');
  await page.click('#create');
  await page.waitForSelector('.code');
  await page.click('#start');
  await page.waitForSelector('.ctrl input[type=range]');
  await page.waitForTimeout(400);
};

/* ------------------------------------------------------------------ phone */
console.log('On a phone (390 × 780):');
const phone = await open(390, 780, 'phone');

/* Nothing to project on the home screen, so nothing should be pinned there —
   and no dead space reserved for it either. */
const atHome = await phone.evaluate(() => ({
  shown: !document.getElementById('projbar').hidden,
  padded: document.body.classList.contains('hasprojbar'),
}));
console.log(`  before a game starts: bar ${atHome.shown ? 'shown' : 'hidden'}, `
  + `page ${atHome.padded ? 'padded' : 'not padded'}`);
if (atHome.shown || atHome.padded) fail('the bar is pinned to a page with no projection');

await intoGame(phone);
const inGame = await phone.evaluate(() => {
  const bar = document.getElementById('projbar');
  const r = bar.getBoundingClientRect();
  return {
    shown: !bar.hidden && getComputedStyle(bar).display !== 'none',
    atBottom: Math.abs(r.bottom - window.innerHeight) < 2,
    opaque: getComputedStyle(bar).backgroundColor,
    columnHidden: getComputedStyle(document.getElementById('projection')).display === 'none',
    value: document.getElementById('projbarval').textContent,
    fits: r.width <= window.innerWidth,
  };
});
console.log(`  in the game: bar ${inGame.shown ? 'shown' : 'hidden'}, `
  + `pinned to the bottom ${inGame.atBottom}, showing ${inGame.value}`);
if (!inGame.shown) fail('no projection bar on a phone');
if (!inGame.atBottom) fail('the bar is not pinned to the bottom of the screen');
if (!inGame.columnHidden) fail('both copies of the projection are on screen at once');
/* It sits over live content, so it has to be opaque. The first version used a
   variable that does not exist and the numbers underneath read through it. */
if (/transparent|rgba\(0, 0, 0, 0\)/.test(inGame.opaque)) {
  fail(`the bar is transparent (${inGame.opaque}) — the page reads through it`);
}
console.log(`  and it is opaque (${inGame.opaque}), so the page does not read through it`);

/* The point of the whole exercise: still there after scrolling to the bottom. */
await phone.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await phone.waitForTimeout(250);
const scrolled = await phone.evaluate(() => {
  const r = document.getElementById('projbar').getBoundingClientRect();
  return { onScreen: r.top < window.innerHeight && r.bottom > 0,
           value: document.getElementById('projbarval').textContent };
});
console.log(`  scrolled to the bottom of the page: still on screen ${scrolled.onScreen}`);
if (!scrolled.onScreen) fail('the bar scrolls away, which is the bug this fixes');

/* And it opens into the real breakdown — the same markup the column renders,
   not a second version of it that could drift. */
await phone.click('#projbarhead');
await phone.waitForTimeout(300);
const opened = await phone.evaluate(() => {
  const s = document.getElementById('projsheet');
  return {
    shown: getComputedStyle(s).display !== 'none',
    hasProfit: /Expected profit/.test(s.textContent),
    hasBreakdown: /Money out/i.test(s.textContent),
    duplicateHeading: [...s.querySelectorAll('h2')]
      .filter((n) => getComputedStyle(n).display !== 'none').length,
    withinScreen: s.getBoundingClientRect().height < window.innerHeight,
  };
});
console.log(`  opened: full breakdown ${opened.hasBreakdown}, `
  + `expected profit ${opened.hasProfit}`);
if (!opened.shown || !opened.hasProfit || !opened.hasBreakdown) {
  fail('the bar does not open into the projection');
}
if (opened.duplicateHeading) fail('the sheet repeats the heading the bar already shows');
if (!opened.withinScreen) fail('the opened sheet is taller than the screen');

/* The number has to keep up with the sliders — that is the entire reason the
   panel exists. */
const before = await phone.evaluate(() => document.getElementById('projbarval').textContent);
await phone.evaluate(() => {
  const name = Object.keys(D.orders)[0];
  D.orders[name].advertising = 45000;
  renderProjection(S.view);
});
await phone.waitForTimeout(200);
const after = await phone.evaluate(() => document.getElementById('projbarval').textContent);
console.log(`  after spending $45,000 on advertising: ${before} → ${after}`);
if (before === after) fail('the bar does not follow the orders being typed');
console.log('');

/* ----------------------------------------------------------------- laptop */
console.log('On a laptop (1280 × 800):');
const laptop = await open(1280, 800, 'laptop');
await intoGame(laptop);
const wide = await laptop.evaluate(() => {
  const bar = document.getElementById('projbar');
  const col = document.getElementById('projection');
  return {
    barShown: getComputedStyle(bar).display !== 'none',
    columnShown: getComputedStyle(col).display !== 'none',
    sticky: getComputedStyle(col.querySelector('.proj')).position,
  };
});
console.log(`  bar ${wide.barShown ? 'shown' : 'hidden'}, `
  + `side column ${wide.columnShown ? 'shown' : 'hidden'}, position ${wide.sticky}`);
if (wide.barShown) fail('the phone bar is showing on a laptop');
if (!wide.columnShown) fail('the side column disappeared on a laptop');
if (wide.sticky !== 'sticky') fail('the side column stopped following the scroll');
console.log('  unchanged — the column still follows the page down');

/* ------------------------------------------------- the market table, and the page */
console.log('\nThe market table on a phone:');
{
  const page = await open(390, 900, 'market');
  await intoGame(page);
  const m = await page.evaluate(() => {
    const t = document.querySelector('table.market');
    const doc = document.documentElement;
    const row = t.querySelector('tbody tr');
    return {
      tableFits: Math.round(t.getBoundingClientRect().right) <= window.innerWidth + 1,
      /* The whole page, not just the table — the first fix made the table fit
         and the page still scrolled sideways, because the orders column was the
         one pushing it out. */
      pageScrollsSideways: doc.scrollWidth > doc.clientWidth,
      scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth,
      headerHidden: getComputedStyle(t.querySelector('thead')).display === 'none',
      labelled: [...row.querySelectorAll('td[data-l]')].length,
      rowHeight: Math.round(row.getBoundingClientRect().height),
      text: row.innerText.replace(/\s+/g, ' ').trim().slice(0, 60),
    };
  });
  console.log(`  the table fits: ${m.tableFits}`);
  console.log(`  the page scrolls sideways: ${m.pageScrollsSideways} `
    + `(${m.scrollWidth} wide in ${m.clientWidth})`);
  console.log(`  header row hidden, ${m.labelled} cells carrying their own label`);
  console.log(`  one company takes ${m.rowHeight}px: "${m.text}"`);

  if (!m.tableFits) fail('the market table still runs off the right edge');
  if (m.pageScrollsSideways) {
    fail(`the page scrolls sideways — ${m.scrollWidth}px of content in ${m.clientWidth}px`);
  }
  if (!m.headerHidden) fail('the table header is still drawn over the stacked rows');
  if (m.labelled !== 5) fail('a cell lost the label it needs once the header is gone');
  /* Five labelled rows per company is twenty-five rows of scrolling at a full
     table. Paired into two columns it is three. */
  if (m.rowHeight > 160) fail(`a company takes ${m.rowHeight}px — the pairing is not applying`);

  /* The rate grid is the exception: it is genuinely two-dimensional, so it
     scrolls inside its own box. What it must not do is widen the page, which is
     what the check above would catch. */
  const grid = await page.evaluate(() => {
    const box = document.querySelector('.gridscroll');
    if (!box) return null;
    return { boxFits: Math.round(box.getBoundingClientRect().right) <= window.innerWidth + 1,
             scrolls: box.scrollWidth > box.clientWidth };
  });
  if (grid) {
    console.log(`  the supply rate grid scrolls in its own box: ${grid.scrolls}, `
      + `and the box fits: ${grid.boxFits}`);
    if (!grid.boxFits) fail('the rate grid pushes the page wider than the screen');
  }
  await page.context().close();
}

/* And the table is a table again on anything wide enough for one. */
{
  const page = await open(1280, 800, 'market-wide');
  await intoGame(page);
  const wideT = await page.evaluate(() => {
    const t = document.querySelector('table.market');
    return { header: getComputedStyle(t.querySelector('thead')).display,
             row: getComputedStyle(t.querySelector('tbody tr')).display };
  });
  console.log(`\n  on a laptop the header is back (${wideT.header}) `
    + `and rows are rows (${wideT.row})`);
  if (wideT.header === 'none') fail('the market table lost its header on a laptop');
  if (wideT.row !== 'table-row') fail('the market table is still stacked on a laptop');
  await page.context().close();
}

console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
await b.close();
console.log('mobile UI OK');
