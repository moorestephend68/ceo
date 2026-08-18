/* How often does the page actually talk to the server?

   This was the largest cost in the whole system and nobody had counted it. A
   fifty-minute game polled every six seconds — five hundred requests a player, of
   which about twelve found anything new. Ninety-seven per cent of all traffic was
   a page being told what it had been told six seconds earlier.

   The page already knows when the round closes, so it can sleep through the
   middle of a round and be awake for the seconds that matter. What follows counts
   real requests in a real browser, because a claim about traffic that is not
   measured in a browser is a claim about a comment. */

const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => { console.error('Playwright not found.'); process.exit(2); });
const { chromium } = pw.default || pw;

const BASE = 'http://localhost:8899';
const browser = await chromium.launch();
const errs = [];
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

let stateCalls = 0;
p.on('request', (r) => { if (/\/api\/state/.test(r.url())) stateCalls += 1; });

/* ---- a game with a long round, i.e. the middle of one ------------------- */
await ctx.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
await p.goto(BASE + '/g/');
await p.waitForTimeout(500);
await p.click('#cadencechoice .choice[data-cadence="1h"]');
await p.click('#create');
await p.waitForSelector('#start', { timeout: 10000 });
await p.click('#start');
await p.waitForSelector('#file', { timeout: 10000 });

const settled = stateCalls;
const WATCH = 20000;
console.log(`Watching an hour-long round for ${WATCH / 1000} seconds…`);
await p.waitForTimeout(WATCH);
const during = stateCalls - settled;

const oldWay = Math.round(WATCH / 6000);
console.log(`  requests in that window: ${during}`);
console.log(`  the old fixed six-second heartbeat would have made: ${oldWay}`);
if (during > 2) {
  throw new Error(`the page is still chattering mid-round: ${during} requests in ` +
    `${WATCH / 1000}s`);
}
console.log('  mid-round, with nothing able to happen, it stays quiet');

/* ---- what the page thinks it should do in each situation ---------------- */
const schedule = await p.evaluate(() => {
  const real = S.view;
  const out = [];
  const say = (label, patch) => {
    S.view = { ...real, ...patch };
    const d = pollDelay();
    out.push([label, d === null ? 'never again' : (d / 1000) + 's']);
  };
  say('a public lobby, filling', { status: 'lobby', isPublic: true });
  say('a private lobby, waiting for the host', { status: 'lobby', isPublic: false });
  say('mid-round, an hour to go', { deadline: new Date(Date.now() + 3600000).toISOString(), waitingOn: ['A', 'B'] });
  say('two minutes to go', { deadline: new Date(Date.now() + 100000).toISOString(), waitingOn: ['A', 'B'] });
  say('twenty seconds to go', { deadline: new Date(Date.now() + 20000).toISOString(), waitingOn: ['A', 'B'] });
  say('past the deadline', { deadline: new Date(Date.now() - 1000).toISOString(), waitingOn: ['A'] });
  say('everyone has filed', { deadline: new Date(Date.now() + 3600000).toISOString(), waitingOn: [] });
  say('one person left, and it is not you', { deadline: new Date(Date.now() + 3600000).toISOString(), waitingOn: ['A'], you: { ...real.you, filed: true } });
  say('a class with no clock', { deadline: null, waitingOn: ['A', 'B', 'C'] });
  say('the game is over', { status: 'over' });
  S.view = real;
  return out;
});
console.log('\nwhat it does in each situation:');
for (const [label, d] of schedule) console.log(`  ${label.padEnd(36)} ${d}`);

const asObj = Object.fromEntries(schedule);
if (asObj['the game is over'] !== 'never again') {
  throw new Error('a finished game must stop polling entirely');
}
/* Awake for the end of the round: within the endgame it must be checking every
   few seconds, not every minute. */
if (Number.parseFloat(asObj['twenty seconds to go']) > 10) {
  throw new Error('the page must be awake for the end of a round');
}
if (Number.parseFloat(asObj['mid-round, an hour to go']) < 30) {
  throw new Error('the page should be asleep in the middle of a round');
}

/* ---- the property that actually matters --------------------------------- */
/* Sleeping is only safe if the page never sleeps far *past* the moment the round
   closes. So: for every possible time-to-deadline, the wait it chooses must not
   overshoot the deadline by more than a few seconds. If that holds everywhere
   there is no gap it can miss, and no reason to poll "just in case".

   A small overshoot in the last seconds is fine and unavoidable — the page cannot
   wake at a finer grain than its own shortest interval — so the bar is the
   shortest interval it uses, not zero. */
const GRACE = 10;
console.log('\nDoes it ever sleep past the end of a round?');
const sweep = await p.evaluate(() => {
  const real = S.view;
  const rows = [];
  let worst = null;
  for (let left = 1; left <= 3600; left++) {
    S.view = { ...real, status: 'playing', waitingOn: ['A', 'B'],
               deadline: new Date(Date.now() + left * 1000).toISOString() };
    const d = pollDelay() / 1000;
    if (d - left > 10 && (worst === null || d - left > worst.over)) {
      worst = { left, d, over: d - left };
    }
    if ([1, 10, 25, 60, 119, 300, 1200, 3600].includes(left)) rows.push([left, d]);
  }
  S.view = real;
  return { rows, worst };
});
for (const [left, d] of sweep.rows) {
  console.log(`  ${String(left).padStart(4)}s left → waits ${String(d).padStart(5)}s` +
              `   ${d - left <= GRACE ? 'wakes in time' : 'SLEEPS PAST IT'}`);
}
console.log(`  worst case across 3,600 starting points: ` +
            (sweep.worst ? `overshoots by ${sweep.worst.over}s`
              : `never overshoots by more than ${GRACE}s`));
if (sweep.worst) {
  throw new Error(`the page would sleep past a deadline with ${sweep.worst.left}s left`);
}

/* And how much traffic that adds up to over a whole game. */
const total = await p.evaluate(() => {
  const real = S.view;
  let calls = 0;
  const ROUNDS = 10, ROUND_SECONDS = 5 * 60;
  for (let r = 0; r < ROUNDS; r++) {
    let left = ROUND_SECONDS;
    while (left > 0) {
      S.view = { ...real, status: 'playing', waitingOn: ['A', 'B'], cadenceMinutes: 5,
                 deadline: new Date(Date.now() + left * 1000).toISOString() };
      left -= pollDelay() / 1000;
      calls += 1;
    }
  }
  S.view = real;
  return calls;
});
const was = 10 * 5 * 60 / 6;
console.log(`\nOver a ten-round, five-minute game, one player now makes ${total} requests.`);
console.log(`  the fixed six-second heartbeat made ${was}.`);
console.log(`  that is ${(was / total).toFixed(1)}x less traffic, per player, per game.`);
if (total > was / 3) throw new Error('adaptive polling did not actually reduce anything');

await browser.close();
console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
console.log('polling OK');
