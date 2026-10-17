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

/* ---- the host opens the named table ---- */
const host = await fresh(true);
await host.goto(BASE + '/h/testing');
/* a table left over from an earlier run is the normal case on a shared
   server, and the host is allowed to open a fresh one over it */
const empty = await until(host, /No table is open here yet/, 6000);
ok(empty || /already|Join this hunt|Waiting|Send this/.test(await scr(host)),
  'the named door always says where things stand' + (empty ? ' (nothing open)' : ' (one was already running)'));
ok(/Open the testing table|fresh testing table/.test(await scr(host)),
  'and a fresh table can always be laid out from here — a hunt runs for weeks, so a host who could not reopen would get one night and then wait out a season');
await host.click('.dock button.go');   // opens one, or lays out a fresh one
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

console.log(errs.length ? `\nerrors: ${errs.join(' | ')}` : '\nno console errors');
console.log(bad ? `\n${bad} FAILED` : '\ntest night OK');
await br.close();
process.exit(bad ? 1 : 0);
