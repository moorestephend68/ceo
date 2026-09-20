/* THE ROUND, WATCHED — seven seconds, through the page.

   A film is easy to ship broken: it draws on a canvas, so nothing in the DOM
   changes shape when it goes wrong, and a thrown frame just stops the
   animation with the overlay left covering the game. So this drives the real
   page and checks the three things that would actually hurt a player:

     1. it plays when a round closes, and it GOES AWAY on its own
     2. it does not play a round you were not at, and does not replay one
     3. no frame throws, at any point on the clock, at phone width

   It also checks the promise the drawing makes about information: a rival's
   turned-away number is private, and the film must not be the place it leaks. */
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
await p.waitForTimeout(300);

const filmUp = () => p.evaluate(() => !document.getElementById('film').hidden);
ok(!(await filmUp()), 'no film before a round has closed');

/* File, which closes the round: the other two seats are bots and have already
   filed, so this is the last decision the round was waiting for. */
await p.click('#file');
await p.waitForTimeout(500);
ok(await filmUp(), 'filing the last decision starts the reveal');

const shape = await p.evaluate(() => ({
  firms: FILM.data.firms.length,
  dots: FILM.data.dots.length,
  len: FILM.LEN,
  /* only YOUR row may carry a number of people turned away */
  numbered: FILM.data.firms.filter((f) => f.turned > 0).map((f) => f.you),
}));
ok(shape.firms === 3, 'a shopfront per company: ' + shape.firms);
/* the crowd is sized to the screen, not to a constant, so this is a range */
ok(shape.dots > 240 && shape.dots <= 2400, 'a crowd of ' + shape.dots + ' buyers');
ok(Math.abs(shape.len - 7) < 0.01, 'seven seconds: ' + shape.len.toFixed(1));
ok(shape.numbered.every((mine) => mine === true),
  'only your own stockout carries a number — a rival\'s stays private');

/* Every position is a pure function of the clock, so walking the clock is a
   complete test of the drawing. A thrown frame would leave the overlay up. */
const walked = await p.evaluate(() => {
  const errors = [];
  for (let i = 0; i <= 140; i++) {
    FILM.t = (FILM.LEN * i) / 140;
    try { drawFilm(); } catch (e) { errors.push(i + ': ' + e.message); }
  }
  return errors;
});
ok(walked.length === 0, 'no frame throws across the whole clock'
  + (walked.length ? ' — ' + walked[0] : ''));

/* and it takes itself off the screen */
await p.evaluate(() => { FILM.t = FILM.LEN - 0.05; });
await p.waitForTimeout(600);
ok(!(await filmUp()), 'the film ends by itself and hands the page back');
ok(await p.evaluate(() => /Round 1/.test(document.getElementById('app').textContent)),
  'and the round card is underneath it');

/* A reload must not replay a round already watched. */
await p.reload();
await p.waitForTimeout(900);
ok(!(await filmUp()), 'a reload does not replay a round you have seen');

/* But asking for it does. */
await p.click('#rewatch');
await p.waitForTimeout(200);
ok(await filmUp(), 'the round card can play it again on request');
await p.click('#skip');
await p.waitForTimeout(200);
ok(!(await filmUp()), 'and Skip closes it immediately');

/* A seat that arrives to a game with rounds already behind it gets the table,
   not a cutscene about a round it was not at. */
const code = await p.evaluate(() => S.code);
const late = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
await late.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
const q = await late.newPage();
q.on('pageerror', (e) => errs.push('LATE PAGEERROR: ' + e.message));
await q.goto(BASE + '/g/' + code);
await q.waitForTimeout(1200);
ok(!(await q.evaluate(() => !document.getElementById('film').hidden)),
  'a fresh browser opening a game in progress is not shown an old round');

ok(errs.length === 0, 'no console or page errors' + (errs.length ? ' — ' + errs[0] : ''));
await b.close();
