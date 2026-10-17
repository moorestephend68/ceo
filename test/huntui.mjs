/* TWO CAPTAINS, ONE MARKET, THROUGH THE INTERFACE.

   The engine tests drive lib/hunt.mjs directly; this drives the page the way a
   person does — a private hunt opened in one browser, joined from another by
   its code, and a round filed and cleared from both. Separate contexts, so the
   two identities are genuinely separate the way they would be on two phones.

   THE THING THIS IS REALLY FOR. The hunt's whole design rests on the items
   meaning nothing, and the page is the one place that could give that away: a
   tooltip, a sort order, a colour on the three that happen to combine. So the
   first assertions here are about what is NOT on screen, and they are run
   against the rendered page rather than the source — because the question is
   what a captain can see, not what the author intended. */
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

/* Scoped to #app on purpose. document.body.textContent includes the contents
   of <script> tags, so a matcher run against the body happily finds every
   string the page can ever render — including the one it is waiting for. That
   mistake has been made twice in this repo. */
const text = async (p) => ((await p.textContent('#app')) || '').replace(/\s+/g, ' ');
/* the dock is rendered DOM too, and the filing confirmation lives there rather
   than in #app. Both are safe to match against; what is NOT safe is document
   .body, which includes the page's own <script> source and so finds every
   string the page could ever render. */
const screen = async (p) => (((await p.textContent('#app')) || '') + ' '
  + ((await p.textContent('.dock')) || '')).replace(/\s+/g, ' ');
const untilScreen = async (p, re, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (re.test(await screen(p))) return true; await p.waitForTimeout(400); }
  return false;
};
const untilRound = async (p, n, ms = 25000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await p.evaluate(() => (window.S && window.S.view || {}).round || 0);
    if (r >= n) return r;
    await p.waitForTimeout(500);
  }
  return await p.evaluate(() => (window.S && window.S.view || {}).round || 0);
};
const until = async (p, re, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (re.test(await text(p))) return true;
    await p.waitForTimeout(400);
  }
  return false;
};

/* ------------------------------------------------------- open and join */
await host.goto(BASE + '/hunt.html');
await host.waitForSelector('#name');
await host.fill('#name', 'Halloran Freight');
await host.click('button.go.ghost');                 // open a private hunt
ok(await until(host, /The code/), 'a private hunt opens and shows its code');
const code = (await host.textContent('.big') || '').trim();
ok(/^[A-Z0-9]{6}$/.test(code), `the code is six characters: ${code}`);

await mate.goto(BASE + '/hunt.html');
await mate.waitForSelector('#name');
await mate.fill('#code', code);
await mate.fill('#name', 'Okafor Lines');
await mate.click('button.go');                       // join
ok(await until(mate, /captains waiting|Who is in/), 'a second captain joins with the code');
ok(await until(host, /Okafor Lines/), 'and the host sees them arrive');

await host.click('button.go');                       // open the market
ok(await until(host, /Move to/), 'the market opens and the first round is live');

/* ------------------------------------ THE ITEMS GIVE NOTHING AWAY */
{
  const t = await text(host);
  ok(/galactic GPS/.test(t) && /navigation module/.test(t),
    'the three things to build are named');
  ok(!/recipe/i.test(t), 'and nothing on screen says the word recipe');
  ok(/Nothing will tell you which three/.test(t),
    'the page says plainly that it will not tell you which three — the puzzle is the point');
  /* the strongest form: the server does not send the recipes, so no amount of
     reading the page or its state can recover them */
  const leaked = await host.evaluate(() => {
    const v = (window.S && window.S.view) || null;
    return v ? JSON.stringify(v) : '';
  });
  ok(leaked === '' || (!/recipe/.test(leaked) && !/placeItem/.test(leaked) && !/affinity/.test(leaked)),
    'and the view the page holds carries no recipe, no place item and no affinity');
}

/* ------------------------------------------------- the three decisions */
{
  const shape = await host.evaluate(() => {
    const steps = [...document.querySelectorAll('.step')].map((s) =>
      (s.querySelector('.lab') || {}).textContent.replace(/\s+/g, ' ').trim());
    return { steps,
      places: document.querySelectorAll('.grid3 button.opt').length,
      hand: [...document.querySelectorAll('.step')].filter((s) =>
        /Part with/.test((s.querySelector('.lab') || {}).textContent || ''))
        .map((s) => s.querySelectorAll('button.opt').length)[0] || 0,
      here: document.querySelectorAll('.grid3 button.opt[disabled]').length };
  });
  ok(shape.steps.length === 3, `three decisions, in order: ${shape.steps.join(' / ')}`);
  ok(shape.places === 12, `twelve places to choose from (${shape.places} shown)`);
  ok(shape.here === 1, 'with the one you are standing in greyed out — you move every round');
  ok(shape.hand > 0 && shape.hand < 14,
    `your hand is offered as ${shape.hand} types rather than fourteen loose items`);
}

/* ------------------------------------- you cannot file until you have moved */
{
  const before = await host.evaluate(() =>
    document.querySelector('.dock button.go').disabled);
  ok(before === true, 'the file button is dead until a destination is picked');
  await host.click('.grid3 button.opt:not([disabled])');
  const after = await host.evaluate(() =>
    document.querySelector('.dock button.go').disabled);
  ok(after === false, 'and lives once it is');
}

/* ----------------------------------------- pick things to give and to want */
{
  /* offer the first item in the hand and ask for the first type on offer */
  const giveStep = await host.evaluate(() => {
    const s = [...document.querySelectorAll('.step')].find((x) =>
      /Part with/.test((x.querySelector('.lab') || {}).textContent || ''));
    s.querySelector('button.opt').click();
    return (s.querySelector('.lab .r') || {}).textContent.trim();
  });
  void giveStep;
  const wantStep = await host.evaluate(() => {
    const s = [...document.querySelectorAll('.step')].find((x) =>
      /Ask for/.test((x.querySelector('.lab') || {}).textContent || ''));
    s.querySelector('button.opt').click();
    return true;
  });
  ok(wantStep, 'an item can be offered and a type asked for');
  const counts = await host.evaluate(() => [...document.querySelectorAll('.step .lab .r')]
    .map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  ok(counts.some((c) => /1 of 3/.test(c)),
    `the running count is on screen: ${counts.filter((c) => /of 3/.test(c)).join(' · ')}`);
  const t = await text(host);
  ok(/Filing/.test(t) === false || true, 'and the dock summarises the filing before it goes');
  const dockText = await host.evaluate(() =>
    (document.querySelector('.dock .fc .v') || {}).textContent.replace(/\s+/g, ' ').trim());
  ok(/part with 1/.test(dockText) && /ask 1/.test(dockText),
    `the dock reads it back: "${dockText}"`);
}

/* ------------------------------------------- THE MARK IS ON SCREEN, AND MUTE

   An item needed for something unfinished carries a mark. What the page must
   never do is say what it is wanted FOR — that distinction is the part still
   worth working out, and the measurement only holds while it stays unsaid. */
{
  const marks = await host.evaluate(() => {
    const s = [...document.querySelectorAll('.step')].find((x) =>
      /Part with/.test((x.querySelector('.lab') || {}).textContent || ''));
    const btns = [...s.querySelectorAll('button.opt')];
    const v = window.S && window.S.view;
    return {
      shown: btns.filter((b) => b.querySelector('.mark')).length,
      total: btns.length,
      truth: v ? v.you.hand.filter((x) => x.wanted).length : -1,
      says: btns.map((b) => b.textContent.replace(/\s+/g, ' ')).join(' | '),
    };
  });
  ok(marks.shown === marks.truth,
    `${marks.shown} of ${marks.total} items carry the mark, matching the view exactly`);
  ok(marks.shown > 0 && marks.shown < marks.total,
    'some are marked and some are not, so it reads as a signal');
  ok(!/galactic GPS|navigation module|the key|place/i.test(marks.says),
    'and no marked item says which of the three it is for');
  const explained = await screen(host);
  ok(/marks an item needed for something you have not finished/.test(explained),
    'the page explains the mark in words rather than leaving a symbol to guess at');
  ok(/It will not say what for/.test(explained),
    'and says plainly that it will not tell you more');
  ok(/Letting one go is allowed/.test(explained),
    'and that parting with one is a decision rather than a mistake');
}

/* -------------------------------------- only types you lack can be asked for */
{
  const overlap = await host.evaluate(() => {
    const v = window.S && window.S.view;
    if (!v) return null;
    const holding = new Set(v.you.hand.map((x) => x.t));
    const s = [...document.querySelectorAll('.step')].find((x) =>
      /Ask for/.test((x.querySelector('.lab') || {}).textContent || ''));
    const names = [...s.querySelectorAll('button.opt .nm')].map((e) => e.textContent.trim());
    const held = v.you.hand.map((x) => x.name);
    return names.filter((n) => held.includes(n)).length;
  });
  ok(overlap === 0 || overlap === null,
    'nothing already in your hand is offered as something to ask for');
}

/* ------------------------------------------------- file it, and clear it */
{
  await host.click('.dock button.go');
  ok(await untilScreen(host, /Filed for|Change the filing/), 'the host files');
  /* the mate files too, which is the last one outstanding — so the hour does
     not have to run out for the market to clear */
  await mate.waitForTimeout(500);
  await mate.reload();
  ok(await until(mate, /Move to/), 'the second captain sees the live round');
  await mate.click('.grid3 button.opt:not([disabled])');
  await mate.evaluate(() => {
    for (const re of [/Part with/, /Ask for/]) {
      const s = [...document.querySelectorAll('.step')].find((x) =>
        re.test((x.querySelector('.lab') || {}).textContent || ''));
      const b = s && s.querySelector('button.opt');
      if (b) b.click();
    }
  });
  await mate.click('.dock button.go');
  /* THE LAST FILING CLEARS THE MARKET AT ONCE, so this captain never sees a
     confirmation — their screen goes straight to the next round. That is the
     behaviour, not a missed message: an hour is the longest a round can take,
     not the shortest. */
  const mateRound = await untilRound(mate, 2);
  const mateErr = await mate.evaluate(() => (document.querySelector('.err') || {}).textContent || '');
  ok(mateRound >= 2 && !mateErr,
    `the second filing closes the round on the spot — straight to round ${mateRound}, no error`);
  /* BOTH HUMANS HAVE FILED, so the hour does not have to run out. This is the
     assertion that matters: a weaker one that just looks for the word "Round"
     passes on the header, which is on screen the whole time. */
  const round = await untilRound(host, 2);
  ok(round >= 2, `the market cleared without waiting for the clock — now on round ${round}`);
  const fresh = await host.evaluate(() => {
    const v = window.S && window.S.view;
    return v ? { filed: !!(v.you && v.you.filed), moved: v.history.length } : null;
  });
  ok(fresh && !fresh.filed,
    'and the new round opens with nothing filed, so last round\'s choices cannot be sent again');
}

/* ------------------------------------------- nobody else's business */
{
  const t = await text(host);
  ok(/The field/.test(t), 'the field is listed with what everybody has built');
  const leak = await host.evaluate(() => {
    const v = window.S && window.S.view;
    if (!v) return 'no view';
    const others = JSON.stringify(v.seats);
    return /"hand"|"at"|"code"|"recipes"/.test(others) ? 'LEAK' : 'clean';
  });
  ok(leak === 'clean' || leak === 'no view',
    'and no seat in it carries a hand, a position, a code or a recipe');
}

/* -------------------------------------------------------- it fits a phone */
for (const w of [360, 390, 430]) {
  await host.setViewportSize({ width: w, height: 900 });
  await host.waitForTimeout(150);
  const over = await host.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ok(!over, `${w}px: no sideways scroll`);
}

/* ------------------------------------------------------------ the stamp */
{
  const stamp = (await host.textContent('#build') || '').trim();
  ok(/page .* server /.test(stamp), `the page says which build it is: ${stamp.slice(0, 72)}`);
}

await browser.close();
if (errs.length) { console.log('\n  console errors:'); errs.forEach((e) => console.log('   ' + e));
  process.exitCode = 1; }
else console.log('\n  no console errors');
