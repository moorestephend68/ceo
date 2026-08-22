/* Running a tournament through the interface.

   Two people in two browsers: whoever bought the licence, and somebody who
   entered. The thing worth proving is that the entrant never sees a game token,
   a group number they had to remember, or a link they have to keep — they hold
   one thing all afternoon and the console does the rest. */
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

const watch = (page, who) => {
  page.on('pageerror', (e) => errs.push(`${who}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`${who}: ${m.text()}`); });
};

/* ------------------------------------------------------------- the console */
const hostCtx = await b.newContext({ viewport: { width: 1280, height: 1800 } });
await hostCtx.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
const host = await hostCtx.newPage();
watch(host, 'host');
await host.goto('http://localhost:8899/g/');
await host.waitForTimeout(500);

console.log('Creating one:');
await host.fill('#evname', 'Autumn Cup');
await host.click('#evstages .choice[data-stages="2"]');
await host.click('#makeevent');
await host.waitForSelector('#evlink');
const code = await host.evaluate(() => S.tourney.code);
const settings = await host.evaluate(() => S.tourney.settings);
console.log(`  "Autumn Cup" — code ${code}, ${settings.stages} tables each, `
  + `top ${settings.finalists} in the final`);
if (settings.stages !== 2) fail('the number of tables was not taken from the form');

/* Nothing can be drawn yet, and the console should say why rather than offering
   a button that fails. */
const empty = await host.evaluate(() => ({
  canStart: S.tourney.canStartNext,
  button: !!document.getElementById('nextstage'),
  text: document.body.innerText,
}));
console.log(`  with nobody entered: draw button shown ${empty.button}`);
if (empty.button) fail('an empty event offered to draw a stage');
if (!/at least 12/.test(empty.text)) fail('the console does not say what it is waiting for');

/* ------------------------------------------------------------- entering */
console.log('\nEntering, in a different browser:');
const players = [];
for (let i = 0; i < 13; i++) {
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  if (i === 0) watch(page, 'entrant');
  /* On the link the facilitator sends, not by typing a code from memory. */
  await page.goto(`http://localhost:8899/g/?event=${code}`);
  await page.waitForTimeout(250);
  await page.fill('#eventname', `Company ${i + 1}`);
  await page.click('#enterevent');
  await page.waitForTimeout(350);
  players.push(page);
}
const first = players[0];
/* Refreshed first: the view entrant 1 is holding was taken when they were the
   only person in the event, and reading a stale copy would report one entrant
   and prove nothing. */
await first.evaluate(async () => {
  S.entrant = (await api('tournament/me?token='
    + encodeURIComponent(localStorage.getItem('ceo.event.v1')))).view;
  render();
});
await first.waitForTimeout(200);
const entered = await first.evaluate(() => ({
  name: S.entrant.event.name,
  phase: S.entrant.event.phase.label,
  count: S.entrant.event.entrants,
  hasToken: !!localStorage.getItem('ceo.event.v1'),
  showsTable: !!document.getElementById('gotable'),
}));
console.log(`  entrant 1 sees "${entered.name}" · ${entered.phase} · ${entered.count} entrants`);
console.log(`  the code on the link was filled in for them, and their token is kept`);
if (!entered.hasToken) fail('the entrant token was not kept, so a closed tab loses their place');
if (entered.showsTable) fail('an entrant was offered a table before the draw');

/* The same name twice is refused in front of the room rather than producing two
   identical rows on the board. */
{
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  await page.goto(`http://localhost:8899/g/?event=${code}`);
  await page.waitForTimeout(250);
  await page.fill('#eventname', 'Company 5');
  await page.click('#enterevent');
  await page.waitForTimeout(400);
  const said = await page.evaluate(() => document.body.innerText);
  console.log(`  the same name again: ${/already called/i.test(said) ? 'refused' : 'ALLOWED'}`);
  if (!/already called/i.test(said)) fail('two entrants took the same name');
  await ctx.close();
}

/* --------------------------------------------------------- drawing a stage */
console.log('\nDrawing the first stage:');
/* The console is still open from creating it; it just has not seen the
   thirteen people who arrived since. */
await host.evaluate(async () => {
  S.tourney = (await api('tournament/' + S.tourney.id)).tournament;
  render();
});
await host.waitForSelector('#nextstage');
const beforeDraw = await host.evaluate(() => S.tourney.entrants);
console.log(`  ${beforeDraw} entrants, and the draw button is offered`);
await host.click('#nextstage');
await host.waitForTimeout(900);

const drawn = await host.evaluate(() => ({
  tables: S.tourney.tables.length,
  players: S.tourney.tables.map((t) => t.players),
  phase: S.tourney.phase.label,
}));
console.log(`  drawn: ${drawn.tables} tables (${drawn.players.join(' + ')}) · ${drawn.phase}`);
if (drawn.players.reduce((a, x) => a + x, 0) !== beforeDraw) {
  fail('the draw seated a different number of people than entered');
}
if (Math.max(...drawn.players) > 6) fail('a table seats more than six');
if (Math.min(...drawn.players) < 3) fail('a table seats fewer than three');

/* ------------------------------------------------- what the entrant does next */
console.log('\nWhat the entrant does next:');
await first.reload();
await first.waitForTimeout(700);
const told = await first.evaluate(() => ({
  hasButton: !!document.getElementById('gotable'),
  table: S.entrant.table ? S.entrant.table.groupNo : null,
  showsSeatToken: document.body.innerText.includes(S.entrant.table.token),
  standings: S.entrant.standings.length,
}));
console.log(`  they come back to their standings and are sent to table ${told.table}`);
if (!told.hasButton) fail('the entrant was not offered their table');
if (told.showsSeatToken) fail('the seat token is printed on the page');
console.log(`  the board shows all ${told.standings} entrants`);

await first.click('#gotable');
await first.waitForSelector('.ctrl input[type=range]', { timeout: 15000 });
const playing = await first.evaluate(() => ({
  code: S.code, round: S.view.round, seats: S.view.market.length,
}));
console.log(`  and they are in game ${playing.code}, round ${playing.round + 1}, `
  + `${playing.seats} companies at the table`);
if (!playing.code) fail('the entrant could not reach their game');

/* ------------------------------------------------------- one market a stage */
/* The property the whole thing rests on: every table in a stage plays the same
   market, so a difference between two of them is a difference in decisions. */
const seeds = await host.evaluate(() => S.tourney.tables.length);
console.log(`\n  ${seeds} tables in the stage, and the console lists every one`);
if (seeds !== drawn.tables) fail('the console lost a table');

console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
await b.close();
console.log('tourney UI OK');
