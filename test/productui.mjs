/* THE PRODUCT SCREEN, THROUGH THE PAGE.

   The screen draws on a canvas, so nothing in the DOM changes shape when it
   goes wrong: a thrown frame leaves an overlay sitting on top of a game
   nobody can get back to. So this drives the real page and checks the things
   that would actually strand or mislead a player — it appears when research
   lands, it closes, it never draws a name the server did not send, and no
   frame on the clock throws. */
const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => {
  console.error('Playwright not found.'); process.exit(2);
});
const { chromium } = pw.default || pw;
const BASE = 'http://localhost:8899';
const errs = [];
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) process.exitCode = 1; };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
await ctx.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

await p.goto(BASE + '/g/');
await p.waitForTimeout(400);
await p.click('#seatchoice .choice[data-seats="3"]');
await p.click('#cadencechoice .choice[data-cadence="5m"]');
await p.click('#create');
await p.waitForSelector('.code');
await p.click('#start');
await p.waitForSelector('.ctrl input[type=range]', { state: 'attached' });
await p.waitForTimeout(700);

const up = () => p.evaluate(() => !document.getElementById('prod').hidden);
/* The screen does NOT take over at the start of a game: a player who has just
   started one is reaching for the orders form. The button is the way in. */
ok(!(await up()), 'a new game is not interrupted by it');
await p.click('#seeproduct');
await p.waitForTimeout(250);
ok(await up(), 'the round card opens what the company makes');
const start = await p.evaluate(() => ({
  kind: PROD.line.kind, label: PROD.line.label, mode: PROD.mode,
  upgrades: PROD.line.upgrades, names: (PROD.line.improvements || []).length,
}));
ok(['hardware', 'commodity', 'software', 'deeptech'].includes(start.kind),
  `it is drawn as its kind: ${start.label} (${start.kind})`);
ok(start.mode === 'look' && start.upgrades === 0, 'nothing has been added to it yet');
ok(start.names === 5, 'and the server sent the five names research would add');

await p.click('#pclose');
ok(!(await up()), 'it closes');

/* Play until research actually lands. Two rounds of delay is the point of the
   whole screen, so this takes three rounds however it is driven. */
let landedAt = 0, items = null;
for (let r = 1; r <= 4 && !landedAt; r++) {
  await p.click('#file');
  await p.waitForTimeout(1000);
  if (await p.evaluate(() => !document.getElementById('film').hidden)) {
    await p.click('#skip'); await p.waitForTimeout(600);
  }
  if (await up()) {
    landedAt = r;
    items = await p.evaluate(() => ({
      mode: PROD.mode, n: PROD.items.length, base: PROD.base,
      upgrades: PROD.line.upgrades,
      gain: PROD.items.filter((i) => i.gain > 0).length,
      funded: PROD.items.filter((i) => i.gain > 0).map((i) => i.funded),
      names: PROD.line.improvements,
    }));
  }
}
ok(landedAt > 0, `research arrived on its own in round ${landedAt}, and the screen came up`);
ok(items && items.mode === 'reveal', 'in reveal mode, not the standing-still one');
ok(items && items.base + items.gain === items.upgrades,
  'the parts on the drawing equal the landings the engine counted');
ok(items && items.names.length === 5 && items.names.every((n) => typeof n === 'string' && n.length > 2),
  'every name it can print came from the server, not the page');

/* The clock is the only state, so walking it is a complete test of the
   drawing — including the frames where a part is mid-arrival. */
const walked = await p.evaluate(() => {
  const errors = [];
  const end = PT.assemble + PROD.items.length * PT.item;
  for (let i = 0; i <= 120; i++) {
    PROD.t = (end * i) / 120;
    try { prodDraw(); } catch (e) { errors.push(i + ': ' + e.message); }
  }
  return errors;
});
ok(walked.length === 0, 'no frame throws across the whole reveal'
  + (walked.length ? ' — ' + walked[0] : ''));

/* Next steps through the landings rather than jumping to the end. */
await p.evaluate(() => { PROD.t = 0; });
await p.click('#pnext');
const after = await p.evaluate(() => PROD.t);
ok(after >= 1 && after < 1 + 1.9 * 3, 'Next moves on one landing at a time: t = ' + after.toFixed(1));
await p.click('#pclose');
ok(!(await up()), 'and it hands the game back');

/* Every kind has to draw. Three of the four will not come up in one game, so
   they are driven directly — a kind that throws would otherwise ship. */
const kindErrs = await p.evaluate(() => {
  const out = [];
  for (const kind of ['hardware', 'commodity', 'software', 'deeptech']) {
    PROD.line = { kind, label: 'test', kindLabel: kind, quality: 128, efficiency: 118,
      capacity: 4200, upgrades: 5, improvements: ['a', 'b', 'c', 'd', 'e'],
      processSteps: ['x'], rdPipeline: 1, procPipeline: 0 };
    PROD.mode = 'look'; PROD.items = []; PROD.base = 5; PROD.t = PT.assemble;
    document.getElementById('prod').hidden = false;
    try { prodLayout(); for (let n = 0; n <= 5; n++) {
      PROD.line.upgrades = n; prodDraw(); } } catch (e) { out.push(kind + ': ' + e.message); }
  }
  prodClose();
  return out;
});
ok(kindErrs.length === 0, 'all four kinds draw, with none to five parts on them'
  + (kindErrs.length ? ' — ' + kindErrs[0] : ''));

ok(errs.length === 0, 'no console or page errors' + (errs.length ? ' — ' + errs[0] : ''));
await b.close();
