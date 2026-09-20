/* TWO CAPTAINS, ONE TABLE, THROUGH THE INTERFACE.

   The engine tests drive lib/cargo.mjs directly; this drives the page the way a
   person does — a private table created in one browser, joined from another by
   its code, and a round played through both windows. Separate contexts, so the
   two identities are genuinely separate the way they would be on two phones. */
const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => {
  console.error('Playwright not found.'); process.exit(2);
});
const { chromium } = pw.default || pw;
const BASE = 'http://localhost:8899';
const errs = [];
const watch = (p, who) => {
  p.on('console', (m) => { if (m.type() === 'error') errs.push(who + ': ' + m.text()); });
  p.on('pageerror', (e) => errs.push(who + ' PAGEERROR: ' + e.message));
};
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) process.exitCode = 1; };

const browser = await chromium.launch();
const hostCtx = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true });
await hostCtx.addInitScript(() => localStorage.setItem('ceo.dev.token', 'tok:demo'));
const mateCtx = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true });
const host = await hostCtx.newPage(), mate = await mateCtx.newPage();
watch(host, 'host'); watch(mate, 'mate');

/* the name is a field on the page rather than a browser dialog — a dialog
   blocks every subsequent event and is miserable on a phone besides */
const named = async (p, name) => { await p.waitForSelector('#name'); await p.fill('#name', name); };

/* Scoped to #app on purpose. document.body.textContent includes the contents
   of <script> tags, so a matcher run against the body happily finds every
   string the page can ever render — including the one it is waiting for — and
   returns true before anything has happened. That mistake has been made twice
   in this repo now. */
const until = async (p, re, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = ((await p.textContent('#app')) || '').replace(/\s+/g, ' ');
    if (re.test(t)) return true;
    await p.waitForTimeout(500);
  }
  return false;
};

await host.goto(BASE + '/cargo.html');
await host.waitForSelector('.opt');
await named(host, 'Halloran Freight');
await host.click('.opt:nth-of-type(2)');           // play with friends
await host.waitForSelector('.big');
const code = (await host.textContent('.big')).trim();
ok(/^[A-Z0-9]{6}$/.test(code), 'a private table gets a code: ' + code);

await mate.goto(BASE + '/cargo.html');
await mate.waitForSelector('#code');
await named(mate, 'Brandt Lines');
await mate.fill('#code', code);
await mate.click('.go');
await mate.waitForTimeout(600);
const seated = await mate.textContent('#app');
ok(/At the table/.test(seated) && /Brandt/.test(seated), 'a friend joins with the code');

await host.click('.go');                            // start now
await host.waitForTimeout(700);
await mate.reload(); await mate.waitForTimeout(700);
const hostBody = await host.textContent('#app');
ok(/failed/.test(hostBody), 'the round opens in the yard with a failed part');
ok((await host.$$('[data-step=block] input')).length === 4, 'four lots, four sliders');
ok((await host.$$('[data-step=pickup] .opt')).length > 0, 'and the loading spots are on the same screen');

/* THE SHED. Every other style in this game is about getting away from the
   crowd; this is the one that wants it to turn up. It has to be reachable
   from the declare screen, priced, and honest about the closing rounds. */
{
  await host.evaluate(() => {
    document.querySelector('[data-step=pickup] .opt').click();
  });
  await host.waitForTimeout(400);
  await host.evaluate(() => document.querySelector('[data-step=cargo] .opt').click());
  await host.waitForTimeout(400);
  const shed = await host.evaluate(() => {
    const st = document.querySelector('[data-step=shed]');
    return st ? { text: st.textContent.replace(/\s+/g, ' '),
                  slider: !!st.querySelector('#store') } : null;
  });
  ok(!!shed, 'the shed is on the declare screen');
  ok(shed && shed.slider, 'with a slider for how much to leave behind');
  ok(shed && /does not use your hold/.test(shed.text),
    'and it says storage does not come out of the hold — the mistake that '
    + 'cost this mechanic $49,000 a season in the harness');
  /* The three things a captain has to be told before they tie money up in a
     shed, and the first two are the ones the first version got wrong: who pays
     them, and what happens to the leftovers. The third is that this is not a
     way to win — saying so is the honest version of a mechanic measured to cost
     $616 a season at the level the bots use it. */
  ok(shed && /pays <b>you<\/b> the going rate|pays you the going rate/.test(shed.text),
    'the card says the carrier pays YOU, not the market');
  ok(shed && /sold back at the posted price/.test(shed.text),
    'and that what nobody comes for is sold back rather than burnt');
  ok(shed && /\$2 a unit a round/.test(shed.text), 'and what the rent is');
  ok(shed && /not a way to get rich/.test(shed.text),
    'and that it is not a way to get rich, which is what the measurement says');
}

/* THE NUMBER HAS TO BE THERE BEFORE THE CHOICE IS MADE.

   The first version of the projection only appeared once a spot and a cargo
   had been picked — which is to say, the number written to help somebody
   choose was invisible until after they had chosen. A captain who opened the
   screen and looked saw nothing and reported the feature missing, correctly. */
ok(/What this run pays/.test(hostBody), 'the run is priced before anything is tapped');
ok(/the best on the board/.test(hostBody), 'as the best run available from where the ship stands');

/* and the page says which build it is, because twice now nobody could tell */
const stampText = await host.evaluate(async () => {
  for (let i = 0; i < 20; i++) {
    const el = document.getElementById('build');
    if (el && el.textContent.trim()) return el.textContent;
    await new Promise((r) => setTimeout(r, 300));
  }
  return '';
});
ok(/page 2026/.test(stampText) && /server /.test(stampText),
  'the page says which build it is, and the server\'s: ' + stampText.slice(0, 70));

/* both captains file a manifest and bids */
for (const [p, who] of [[host, 'host'], [mate, 'mate']]) {
  await p.waitForSelector('[data-step=pickup] .opt');
  await p.evaluate(() => { const s = document.getElementById('bid0');
    s.value = Math.round(Number(s.max) * 0.8); s.dispatchEvent(new Event('input')); });
  await p.click('[data-step=pickup] .opt');
  await p.waitForSelector('[data-step=cargo] .opt');
  await p.click('[data-step=cargo] .opt');
  await p.click('.go');
  await p.waitForTimeout(500);
}
/* The page polls; it does not get pushed to. A captain who filed first sits on
   their own "filed" screen until the next poll comes back with the manifests,
   which is correct behaviour and something a test has to wait for rather than
   assume. */

ok(await until(host, /Manifests filed/), 'the host sees the manifests once both have filed');
const afterDeclare = (await host.textContent('#app')).replace(/\s+/g, ' ');

ok(/Could sell at/.test(afterDeclare), 'showing what each hold carries and where it could land');

/* the destination must not be on the manifest card */
const manifestCard = await host.evaluate(() => {
  const c = [...document.querySelectorAll('.card')].find((x) => /Manifests filed/.test(x.textContent));
  return c ? c.textContent : '';
});
ok((await host.$$('[data-step=port] .opt')).length === 3, 'three stations to choose between');

/* THE YARD, SETTLED BETWEEN THE WINDOWS.

   The sealed bids are opened before a port is chosen, not after the run. Two
   things have to be true on this screen and both matter to the decision being
   made on it: every bid is shown with a name against it, and the holds are
   the ones the ships will actually fly with. */
ok(/envelopes opened/i.test(afterDeclare), 'the envelopes are opened before the route is picked');
const yard = await host.evaluate(() => {
  const c = [...document.querySelectorAll('.card')].find((x) => /envelopes opened/i.test(x.textContent));
  if (!c) return null;
  const rows = [...c.querySelectorAll('table')][1];
  return { text: c.textContent.replace(/\s+/g, ' '),
           captains: rows ? rows.querySelectorAll('tr').length - 1 : 0 };
});
ok(yard && yard.captains === 5, `every captain's bid is on the board (${yard && yard.captains} rows)`);
ok(yard && /Fitted now, not next week/.test(yard.text),
  'and it says the part is carrying cargo on this run');

/* WHAT THE RUN WOULD PAY. Only once a station is picked, because until then
   two of the three legs are guesses. */
await host.click('[data-step=port] .opt');
await host.waitForTimeout(300);
const proj = await host.evaluate(() => {
  const c = [...document.querySelectorAll('.card')].find((x) => /What this run pays/.test(x.textContent));
  return c ? c.textContent.replace(/\s+/g, ' ') : null;
});
ok(!!proj, 'picking a station projects what the run pays');
ok(proj && /Fuel and upkeep/.test(proj) && /(if one of them sells here too|nobody else can land)/.test(proj),
  'with the exact costs, and the squeeze if somebody else lands there');
ok(proj && /nobody can know is who else picks the same station/.test(proj),
  'and it says plainly which half of it is a guess');
/* The buy side is NOT a guess once the manifests are out: a rival loading at
   the same spot squeezes the price whatever they do next, and their hold and
   their cash are both public. The projection has to have counted it. */
ok(proj && /(already counted|Fuel, upkeep and the load are exact)/.test(proj),
  'and a captain loading alongside you is already in the number');
if (process.env.SHOT) await host.screenshot({ path: process.env.SHOT, fullPage: true });

const dismissFilm = async (p) => {
  if (await p.$('#film:not([hidden])')) { await p.click('#skip'); await p.waitForTimeout(300); }
};
for (const p of [host, mate]) {
  await dismissFilm(p);
  await until(p, /Manifests filed/);
  await p.waitForSelector('[data-step=port] .opt', { timeout: 20000 });
  await p.click('[data-step=port] .opt');
  await p.click('.go');
  await p.waitForTimeout(500);
}
/* The round now resolves into the film rather than straight to the table. */
ok(await (async () => {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await host.$('#film:not([hidden])')) return true;
    await host.waitForTimeout(300);
  }
  return false;
})(), 'the resolution plays as a film when the round closes');
{
  const shot = await host.evaluate(() => {
    const c = document.getElementById('reel');
    const g = c.getContext('2d');
    /* something other than the background has been drawn on it */
    const d = g.getImageData(0, 0, c.width, Math.min(400, c.height)).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 140) lit++;
    return lit;
  });
  ok(shot > 500, 'and the reel actually has a picture on it (' + shot + ' lit pixels)');
}
await host.click('#skip');
await host.waitForTimeout(400);
ok(!(await host.$('#film:not([hidden])')), 'Skip puts you straight back to the table');
ok(await until(host, /Last round/), 'which is showing the round that just settled');
const afterRound = (await host.textContent('#app')).replace(/\s+/g, ' ');
ok(/Round\s*2 of 8/.test(afterRound), 'on round two of eight');
ok(/yard|scrap|took a/i.test(afterRound), 'and the yard settled alongside it');

for (const w of [360, 390, 430]) {
  const q = await (await browser.newContext({ viewport: { width: w, height: 900 } })).newPage();
  await q.goto(BASE + '/cargo.html');
  await q.waitForSelector('.opt');
  const over = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(over <= 1, w + 'px: no sideways scroll');
}
await browser.close();
console.log(errs.length ? '\n  console errors:\n    ' + errs.join('\n    ') : '\n  no console errors');
if (errs.length) process.exitCode = 1;
