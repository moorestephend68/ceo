/* Being findable, as the player meets it.

   The whole product rests on somebody understanding what they are agreeing to
   before they agree to it. That is a property of a screen, not of a function,
   so it is tested here: the consent cannot be given by accident, the page says
   what a company would see, and what it says matches what the API would
   actually hand over. */

const pwPath = process.env.PLAYWRIGHT || 'playwright';
const pw = await import(pwPath).catch(() => { console.error('Playwright not found.'); process.exit(2); });
const { chromium } = pw.default || pw;

const BASE = 'http://localhost:8899';
const browser = await chromium.launch();
const errs = [];

async function open(devToken) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1500 } });
  if (devToken) await ctx.addInitScript((t) => localStorage.setItem('ceo.dev.token', t), devToken);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/40[123]/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + '/g/');
  await p.waitForTimeout(500);
  return p;
}
const text = (p) => p.evaluate(() => document.body.innerText);

/* ---- signed out: it is not offered at all ------------------------------- */
const guest = await open(null);
console.log('signed out, no listing is offered:', !(await guest.$('#showtalent')));
if (await guest.$('#showtalent')) throw new Error('a signed-out visitor was offered a listing');

/* ---- the owner ---------------------------------------------------------- */
const p = await open('tok:demo');
await p.waitForSelector('text=Ravensworth', { timeout: 10000 });
if (!(await p.$('#showtalent'))) throw new Error('an owner is never told their record exists');
await p.click('#showtalent');
await p.waitForSelector('#closetalent', { timeout: 10000 });

/* The local server keeps its state for as long as it is running, so a second
   run of this test would start from wherever the first one left off. Begin
   from not-listed whatever happened last time. */
if (await p.$('#talentoff')) {
  await p.click('#talentoff');
  await p.waitForSelector('#adult', { timeout: 10000 });
}

const screen = await text(p);
console.log('\n--- what the player reads before deciding ---');
console.log(screen.split('\n').filter(Boolean).slice(1, 14).join('\n'));

/* The four promises. If the page does not make them, they are not promises. */
for (const [claim, re] of [
  ['it is off unless you turn it on', /Off unless you turn it on/i],
  ['a company sees the company name and nothing else', /company name and your record, and nothing else/i],
  ['they cannot message you', /cannot message you/i],
  ['nobody under 18 appears at all', /Nobody under 18 appears at all/i],
]) {
  console.log(`  says ${claim}: ${re.test(screen)}`);
  if (!re.test(screen)) throw new Error(`the page does not say: ${claim}`);
}

/* ---- consent cannot be given by accident -------------------------------- */
console.log('\nAgreeing:');
if (!(await p.$('#adult'))) throw new Error('nobody is asked to confirm their age');
console.log('  starts unlisted, with the box unticked:', !(await p.isChecked('#adult')));
if (await p.isChecked('#adult')) throw new Error('the age box was pre-ticked');

await p.click('#talenton');                       /* press it without ticking */
await p.waitForTimeout(400);
const refused = await text(p);
console.log('  pressing List me without ticking:',
            /18 or over before you can be listed/.test(refused) ? 'refused, with the reason' : 'ACCEPTED');
if (!/18 or over before you can be listed/.test(refused)) {
  throw new Error('a listing was created without the age confirmation');
}
const stillOff = await p.evaluate(async () => (await (await fetch('/api/talent/me', {
  headers: { authorization: 'Bearer ' + localStorage.getItem('ceo.dev.token') } })).json()).status);
console.log('  and the server agrees nothing happened:', stillOff.optedIn === false);
if (stillOff.optedIn) throw new Error('the refusal still listed them');

await p.fill('#opento', 'Commercial strategy');
await p.fill('#region', 'UK');
await p.check('#adult');
await p.click('#talenton');
await p.waitForSelector('#talentoff', { timeout: 10000 });
const listed = await text(p);
console.log('  ticked and pressed → listed:', /You are listed/.test(listed));
console.log('  and it repeats back what was said:', /Commercial strategy/.test(listed));

/* ---- the page matches what the API would hand a company ----------------- */
const api = await p.evaluate(async () => (await (await fetch('/api/talent/me', {
  headers: { authorization: 'Bearer ' + localStorage.getItem('ceo.dev.token') } })).json()));
if (api.profile.visible) {
  console.log(`\nthe record shown: ${api.profile.games} games, average ` +
              `${api.profile.averageText}`);
  const shown = await text(p);
  if (!shown.includes(String(api.profile.games))) {
    throw new Error('the page and the API disagree about the game count');
  }
  /* The heading is upper-cased by CSS, and innerText reports what is rendered
     rather than what is in the source — so the split has to be case-blind. */
  const quoted = shown.split(/what is deliberately not shown/i)[0];
  for (const banned of ['advertising spend', 'margin of', 'borrowed', 'missed']) {
    if (new RegExp(banned, 'i').test(quoted)) {
      throw new Error(`the page quotes ${banned}, which is withheld`);
    }
  }
  console.log('the page quotes nothing the measurement rejected');
  if (!/what is deliberately not shown/i.test(shown)) {
    throw new Error('the page does not say what it is leaving out');
  }
  if (!/uninterrupted time/.test(shown)) {
    throw new Error('the page does not disclose that it withholds missed rounds, or why');
  }
  console.log('and it lists what it withholds, with the reason for each');

  /* Their own curve, and the honesty that has to travel with it. */
  if (!/Your first games against your last/i.test(shown)) {
    throw new Error('a player with a dozen games is shown no history of their own');
  }
  if (!/not something \d+ games can answer/.test(shown)) {
    throw new Error('the curve is presented as if it proved something');
  }
  console.log('the curve is shown, and says plainly what it does not prove');

  /* And it must not have travelled into what a company sees. */
  const api2 = await p.evaluate(async () => (await (await fetch('/api/talent/me', {
    headers: { authorization: 'Bearer ' + localStorage.getItem('ceo.dev.token') } })).json()));
  if (JSON.stringify(api2.profile).includes('made')) {
    throw new Error('the curve reached the profile a company would be shown');
  }
  console.log('and it is not in the profile a company would be handed');
} else {
  console.log(`\nthe demo account has ${api.profile.games} ranked games, under the ` +
              `${api.minGames}-game floor`);
  if (!/A profile appears after/.test(await text(p))) {
    throw new Error('a thin record does not explain itself');
  }
  console.log('and the page says so rather than showing an empty profile');
}

/* ---- leaving ------------------------------------------------------------ */
console.log('\nLeaving:');
await p.click('#talentoff');
await p.waitForSelector('#adult', { timeout: 10000 });
const after = await p.evaluate(async () => (await (await fetch('/api/talent/me', {
  headers: { authorization: 'Bearer ' + localStorage.getItem('ceo.dev.token') } })).json()).status);
console.log('  one press, and the server agrees:', after.optedIn === false);
if (after.optedIn) throw new Error('taking yourself off the list did nothing');

await browser.close();
console.log('\nconsole errors:', errs.length ? errs.join(' | ') : 'none');
if (errs.length) process.exit(1);
console.log('talent UI OK');
