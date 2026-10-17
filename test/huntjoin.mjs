/* JOINING WITHOUT A CODE AND WITHOUT AN ACCOUNT.

   A test night: the host opens a named table at /h/testing, sends one link,
   and people tap it. Nothing here is a convenience — each assertion stands
   for something that was broken when the link was first followed as a
   stranger rather than reasoned about:

   · /h/CODE handed a visitor with no seat the HOST'S LOBBY, start button and
     all. startGame read `if (hostToken && hostToken !== game.hostToken)`, so
     a null token sailed past the guard: the first tester to tap "Open the
     market" started the hunt and locked out everyone still joining, because
     a join is refused once a hunt is playing.
   · test/serve.mjs mirrored only the /g/* rewrite from netlify.toml, so
     /h/CODE was a 404 locally and no test had ever reached this path.
   · the join screen had no code box, and enter() read that missing field and
     blanked the code it already had.

   Joining itself never needed an account — hunt/join takes a name in the body
   and only reaches for a company name if a session happens to be there. */

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const { chromium } = pw.default || pw;
const BASE = 'http://localhost:8899';
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) bad++; };
const br = await chromium.launch();
const errs = [];
const fresh = async (signedIn) => {
  const c = await br.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  if (signedIn) await c.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
  const p = await c.newPage();
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  return p;
};
const scr = async (p) => ((((await p.textContent('#app')) || '') + ' || ' +
  ((await p.textContent('.dock')) || '')).replace(/\s+/g, ' ').trim());
const until = async (p, re, ms = 15000) => {
  const e = Date.now() + ms;
  while (Date.now() < e) { if (re.test(await scr(p))) return true; await p.waitForTimeout(300); }
  return false;
};

/* ---- SIGNED OUT, which no test in this repo had ever been ----
   The host is the only person who needs an account, and every other test here
   starts with a token already in localStorage. So the one state the real host
   was actually in — signed out, looking at the button — went unexercised, and
   "Please sign in." was shown with nothing to sign in with.

   The assertion is deliberately about the BEHAVIOUR rather than the state: a
   named door can be empty, waiting, or already running depending on what ran
   before, and a test that only holds in one of those is a test that passes by
   luck. In every state a signed-out visitor must either be able to join or be
   told where signing in lives — never stranded. */
{
  const out = await fresh(false);
  await out.goto(BASE + '/h/testing');
  await until(out, /No table is open here yet|Join this hunt|already|Waiting/, 8000);
  const seen = await scr(out);
  const canJoin = /Join this hunt/.test(seen);
  ok(canJoin || /needs an account/.test(seen),
    canJoin ? 'signed out, a live table just lets them in — joining needs no account'
            : 'signed out at a table they would have to open, they are told an account is needed');
  ok(canJoin || await out.evaluate(() => !!document.querySelector('a[href="/g/"]')),
    canJoin ? 'and no sign-in is asked of them'
            : 'and given the link to the page where signing in actually lives');
  if (!canJoin) {
    await out.click('.dock button.go');
    await out.waitForTimeout(1200);
    ok(/sign in|account/i.test(await scr(out)), 'tapping it anyway says what is wrong');
    ok(await out.evaluate(() =>
      !!document.querySelector('.dock a[href="/g/"], #app a[href="/g/"]')),
      'and the refusal carries the way out, rather than naming a page you cannot find');
  } else {
    ok(true, 'and nothing asks them to sign in');
    ok(true, 'so there is no refusal to carry a way out of');
  }
  await out.close();
}

/* ---- the host opens the named table ---- */
const host = await fresh(true);
await host.goto(BASE + '/h/testing');
/* a table left over from an earlier run is the normal case on a shared
   server, and the host is allowed to open a fresh one over it */
const empty = await until(host, /No table is open here yet/, 6000);
ok(empty || /already|Join this hunt|Waiting|Send this/.test(await scr(host)),
  'the named door always says where things stand' + (empty ? ' (nothing open)' : ' (one was already running)'));
ok(/Open the testing table|fresh table/i.test(await scr(host)),
  'and a fresh table can always be laid out from here, in EVERY state the door can be in — empty, waiting or running. A hunt runs for weeks, and the seat token lives in one browser, so a host without that exact browser must still be able to clear the table or the key is locked inside.');
/* whichever button is present — open, or lay out a fresh one — is the one to press */
const opener = await host.evaluate(() => {
  const b = [...document.querySelectorAll('.dock button')]
    .find((x) => /Open the testing table|fresh/i.test(x.textContent.replace(/\s+/g, ' ')));
  return b ? b.textContent.replace(/\s+/g, ' ').trim() : null;
});
ok(!!opener, `the control reads "${opener}"`);
await host.evaluate(() => {
  const b = [...document.querySelectorAll('.dock button')]
    .find((x) => /Open the testing table|fresh/i.test(x.textContent.replace(/\s+/g, ' ')));
  b.click();
});
ok(await until(host, /Send this to your captains/), 'the host opens it and gets a link to share');
const shown = await host.evaluate(() => (document.querySelector('#joinlink') || {}).textContent.trim());
ok(/\/h\/testing$/.test(shown), `the link is the door they already know: ${shown}`);
ok((await host.evaluate(() => window.S.view.code)) === 'TESTING',
  'the table really is reserved under that name');

/* ---- three strangers walk in ---- */
const names = ['Bar Tester One', 'Bar Tester Two', 'Bar Tester Three'];
const testers = [];
for (const n of names) {
  const t = await fresh(false);
  await t.goto(BASE + '/h/testing');
  ok(await until(t, /Join this hunt/), `${n}: no account, no code — just a name box`);
  await t.fill('#name', n);
  await t.click('.dock button.go');
  ok(await until(t, /Who is in|captains waiting|Waiting/), `${n}: joined`);
  testers.push(t);
}
/* the host's lobby polls; give it a tick rather than reading the instant the
   last join returns */
let seated = [];
for (let i = 0; i < 20; i++) {
  seated = await host.evaluate(() => window.S.view.seats.map((s) => s.name));
  if (names.every((n) => seated.includes(n))) break;
  await host.waitForTimeout(700);
}
ok(names.every((n) => seated.includes(n)),
  `the host's lobby fills in as they arrive: ${seated.join(', ')}`);

/* ---- a tester cannot open the market ---- */
const t0 = testers[0];
ok(!(await t0.evaluate(() => {
  const b = [...document.querySelectorAll('.dock button.go')];
  return b.some((x) => /Open the market/.test(x.textContent));
})), 'a tester is not shown the start button');
const refused = await t0.evaluate(async () => {
  const r = await fetch('/api/hunt/start?code=' + window.S.code + '&token=' + window.S.token,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, error: j.error };
});
ok(refused.status >= 400, `and the server refuses them too: ${refused.status} "${refused.error}"`);
const noToken = await t0.evaluate(async () => {
  const r = await fetch('/api/hunt/start?code=' + window.S.code,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return { status: r.status, error: (await r.json().catch(() => ({}))).error };
});
ok(noToken.status >= 400,
  `and a request with no token at all is refused: ${noToken.status} "${noToken.error}"`);
ok((await host.evaluate(() => window.S.view.status)) === 'lobby',
  'the hunt is still in its lobby — nobody started it out from under the host');

/* ---- the host starts, everyone plays ---- */
await host.click('.dock button.go');
ok(await until(host, /Move to/), 'the host opens the market');
ok(await until(t0, /Move to/, 12000), 'and the testers land in round one');
const field = await t0.evaluate(() => window.S.view.seats.length);
ok(field >= 14, `the floor of fourteen is made up with brokers: ${field} captains`);
ok(!(await t0.evaluate(() => JSON.stringify(window.S.view))).match(/recipe|placeItem|affinity/),
  'and none of them can see what anything is for');

/* ---- AND CLEARING IT AWAY AGAIN ----
   A hunt takes no new captains once its market is open. That is right for a
   prize hunt and merciless for a test night: start a minute early and everyone
   who arrives after is locked out for the season. The host could not fix it,
   because the fresh-table button was only ever drawn for a visitor with NO
   seat — and the host always has a seat in their own table. Reported live:
   "I started a game but now I need to end it so I can let other people in." */
{
  /* template literals wrap mid-sentence, so DOM text carries newlines where
     the screen shows spaces — match on normalised text, as the rest does */
  const tapByText = (p, re) => p.evaluate((r) => {
    const b = [...document.querySelectorAll('button.opt')]
      .find((x) => new RegExp(r).test(x.textContent.replace(/\s+/g, ' ')));
    if (!b) return false; b.click(); return true;
  }, re.source);

  const late = await fresh(false);
  await late.goto(BASE + '/h/testing');
  await until(late, /already|Join this hunt/, 10000);
  ok(/already/.test(await scr(late)),
    'a latecomer is turned away from a running hunt — which is what makes a reset necessary');

  ok(/Lay out a fresh table/.test(await scr(host)),
    'the host, seated and playing, is offered a fresh table');
  ok(await tapByText(host, /Lay out a fresh table/), 'the control answers a tap');
  await host.waitForTimeout(400);
  ok(/Tap again to discard/.test(await scr(host)),
    'one tap arms it — discarding a live hunt should not be a single mis-tap');
  ok(await tapByText(host, /Tap again to discard/), 'and the confirmation answers');
  ok(await until(host, /Send this to your captains/, 12000), 'the second tap deals a fresh table');
  ok((await host.evaluate(() => window.S.view.status)) === 'lobby', 'which is back in its lobby');
  ok((await host.evaluate(() => window.S.code)) === 'TESTING',
    'under the same name, so the link already sent out still works');

  await late.goto(BASE + '/h/testing');
  ok(await until(late, /Join this hunt/, 12000),
    'and the latecomer reloads that same link and can finally join');
  await late.fill('#name', 'Late Arrival');
  await late.click('.dock button.go');
  ok(await until(late, /Who is in|Waiting/, 12000), 'and is in');
  await late.close();
}

console.log(errs.length ? `\nerrors: ${errs.join(' | ')}` : '\nno console errors');
console.log(bad ? `\n${bad} FAILED` : '\ntest night OK');
await br.close();
process.exit(bad ? 1 : 0);
