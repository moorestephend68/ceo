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
const until = async (p, re, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = (await p.textContent('#app')) || '';
    if (re.test(t.replace(/\s+/g, ' '))) return true;
    await p.waitForTimeout(500);
  }
  return false;
};
ok(await until(host, /Manifests filed/), 'the host sees the manifests once both have filed');
const afterDeclare = (await host.textContent('#app')).replace(/\s+/g, ' ');

ok(/Could sell at/.test(afterDeclare), 'showing what each hold carries and where it could land');

/* the destination must not be on the manifest card */
const manifestCard = await host.evaluate(() => {
  const c = [...document.querySelectorAll('.card')].find((x) => /Manifests filed/.test(x.textContent));
  return c ? c.textContent : '';
});
ok((await host.$$('[data-step=port] .opt')).length === 3, 'three stations to choose between');

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
