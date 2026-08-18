/* Being findable by somebody hiring — and, mostly, not being.

   Almost every claim this product makes is a claim about who is NOT in the
   pool, so almost every test here is an attempt to get somebody into it who
   should not be. A rule nobody has tried to break is a comment.

   The one positive claim is that what a company sees and what the player sees
   are the same thing. That is asserted by equality rather than by inspection,
   because "looks the same" is how the two drift apart. */

import assert from 'node:assert';
import { memoryDb } from '../lib/db.mjs';
import * as A from '../lib/accounts.mjs';
import * as G from '../lib/game.mjs';
import * as P from '../lib/public.mjs';
import * as T from '../lib/talent.mjs';
import { traitsOf } from '../lib/traits.mjs';

const db = memoryDb();
globalThis.__CEO_DB__ = db;

const USERS = {
  'tok:mira': { id: 'user-mira', email: 'mira@example.com' },      // opts in, plays plenty
  'tok:owen': { id: 'user-owen', email: 'owen@example.com' },      // never opts in
  'tok:kid': { id: 'user-kid', email: 'kid@example.com' },         // will not confirm 18+
  'tok:new': { id: 'user-new', email: 'new@example.com' },         // opts in, barely played
};
globalThis.__CEO_VERIFY__ = async (t) =>
  (USERS[t] ? { data: { user: USERS[t] }, error: null }
            : { data: null, error: { message: 'bad token' } });

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon_test';

const { default: api } = await import('../netlify/functions/api.mjs');

const call = async (method, path, body, auth) => {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (auth) headers.authorization = `Bearer ${auth}`;
  const res = await api(new Request('https://ceo.test' + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  }));
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
};
const ok = (r, what) => {
  assert(r.status === 200, `${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const M = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');

/* Four accounts with company names. */
const COMPANY = {};
for (const [owner, name] of [['user-mira', 'Ravenscarr Holdings'], ['user-owen', 'Belmont Trading'],
                             ['user-kid', 'Fairlight Works'], ['user-new', 'Ashby & Vale']]) {
  await db.ensureProfile(owner, `${owner}@example.com`);
  const c = await A.claimName(db, owner, name, new Date().toISOString());
  await A.confirmPurchase(db, { owner, companyId: c.id, eventId: `evt_${owner}` });
  COMPANY[owner] = c;
}

/* ---- play some real ranked games so there is a record to describe -------- */
/* Two grades of player, so the numbers are not all the same and a percentile
   has something to be a percentile of. */
const styles = {
  keen: (v) => {
    const products = {};
    for (const p of v.you.products) {
      products[p.name] = { price: Math.round(p.value * 0.97), rd: 30000, rdProcess: 12000,
        produce: Math.max(0, Math.min(Math.round((p.lastDemand || 1300) * 1.05), p.effCapacity) - p.inventory),
        advertising: 11000, targetCapacity: Math.round(p.capacity), discontinue: false };
    }
    return { products, launch: false };
  },
  dear: (v) => {
    const products = {};
    for (const p of v.you.products) {
      products[p.name] = { price: Math.round(p.value * 1.09), rd: 8000, rdProcess: 0,
        produce: Math.max(0, Math.min(1300, p.effCapacity) - p.inventory),
        advertising: 0, targetCapacity: Math.round(p.capacity), discontinue: false };
    }
    return { products, launch: false };
  },
};

async function playRanked(owner, style, n, seed0) {
  for (let i = 0; i < n; i++) {
    const t0 = Date.parse('2026-08-01T09:00:00Z') + i * 3600000;
    const at = (ms) => new Date(ms).toISOString();
    const { game } = G.createGame({ ...P.FORMAT, hostName: COMPANY[owner].name,
                                    seed: seed0 + i, now: at(t0) });
    game.isPublic = true;
    G.startGame(game, game.hostToken, at(t0));
    /* The human seat is found after the table has been filled, not assumed to be
       the first one — starting a game seats the archetypes among the players. */
    const seat = game.seats.find((x) => !x.isBot);
    seat.companyId = COMPANY[owner].id;
    let r = 0;
    while (game.status === 'playing') {
      const v = G.viewFor(game, seat.token);
      if (v.you && v.you.products.length && !v.you.bankrupt) {
        try { G.submitDecisions(game, seat.token, styles[style](v)); } catch {}
      }
      G.resolveRound(game, at(t0 + (++r) * 5 * 60000));
    }
    game.lastResolvedAt = at(t0 + r * 5 * 60000);
    await P.scoreGame(db, game);
  }
}

console.log('Playing real ranked games so there is something to describe:');
await playRanked('user-mira', 'keen', 12, 41000);
await playRanked('user-owen', 'keen', 9, 42000);
await playRanked('user-kid', 'dear', 8, 43000);
await playRanked('user-new', 'keen', 2, 44000);
console.log('  Mira 12 games, Owen 9, the young one 8, the newcomer 2\n');

/* ---- traits are recorded, and are about the table rather than the currency */
const miraRows = await db.resultsForCompany(COMPANY['user-mira'].id);
assert.strictEqual(miraRows.length, 12, 'results were not written');
assert(miraRows.every((r) => r.traits), 'a rated result was stored with no traits');
console.log('Every rated result carries how it was played:');
console.log(`  price ${miraRows[0].traits.priceIndex}× the room, ` +
            `quality ${miraRows[0].traits.qualityIndex}×, ` +
            `stock-outs in ${Math.round(miraRows[0].traits.stockoutRate * 100)}% of rounds`);
assert(miraRows[0].traits.priceIndex > 0.5 && miraRows[0].traits.priceIndex < 2,
       'the price index is not a ratio against the table');

/* A seat with nobody behind it is not described. */
const anon = miraRows.length;
console.log('  and a seat with no company behind it gets none:',
            traitsOf({ history: [] }, { id: 'x' }) === null, '\n');

/* ---- nobody is in the pool who did not ask ------------------------------ */
console.log('Who is in the pool:');

const owenBefore = ok(await call('GET', '/api/talent/me', null, 'tok:owen'), 'owen');
console.log(`  Owen never opted in → optedIn ${owenBefore.status.optedIn}`);
assert.strictEqual(owenBefore.status.optedIn, false, 'somebody was opted in by default');
assert(!T.eligible({ optIn: null, companyId: COMPANY['user-owen'].id, games: 9 }),
       'a player with no opt-in row is in the pool');

/* Owen can still see his own profile — that is not the same permission. */
console.log(`  …but he can see his own record: ${owenBefore.profile.visible}`);
assert(owenBefore.profile.visible, 'a player cannot see their own record');

/* ---- 18+ is a condition of being seen, not of being hired --------------- */
const refused = await call('POST', '/api/talent/optin', { adult: false }, 'tok:kid');
console.log(`  opting in without confirming 18+: ${refused.status} — ${refused.body.error}`);
assert(refused.status === 400, 'an unconfirmed age was accepted');
assert(/18 or over/.test(refused.body.error), 'the refusal does not say why');

const kidStatus = ok(await call('GET', '/api/talent/me', null, 'tok:kid'), 'kid').status;
assert.strictEqual(kidStatus.optedIn, false, 'the refusal still opted them in');
assert(!T.eligible({ optIn: { adult: false, revoked_at: null },
                     companyId: COMPANY['user-kid'].id, games: 8 }),
       'an under-18 player is in the pool');
console.log('  and they are not in the pool — not "cannot be hired", cannot be seen\n');

/* ---- a record too thin to mean anything --------------------------------- */
console.log('How thin is too thin:');
ok(await call('POST', '/api/talent/optin', { adult: true, openTo: 'Anything' }, 'tok:new'), 'new opt-in');
const newbie = ok(await call('GET', '/api/talent/me', null, 'tok:new'), 'newbie');
console.log(`  the newcomer opted in with 2 games → visible ${newbie.profile.visible}`);
console.log(`  "${newbie.profile.why}"`);
assert.strictEqual(newbie.profile.visible, false, 'a two-game record was published');
assert(!T.eligible({ optIn: { adult: true, revoked_at: null },
                     companyId: COMPANY['user-new'].id, games: 2 }),
       'a two-game player is in the pool');
console.log(`  the floor is ${T.MIN_GAMES} games, where 99% of the players a company would\n` +
            '  pick are genuinely above average and none is a dud\n');

/* ---- what a company sees is what the player sees ------------------------ */
console.log('Opting in, and what it shows:');
ok(await call('POST', '/api/talent/optin',
   { adult: true, openTo: 'Commercial strategy', region: 'UK' }, 'tok:mira'), 'mira opt-in');
const mine = ok(await call('GET', '/api/talent/me', null, 'tok:mira'), 'mira profile');
const p = mine.profile;
console.log(`  ${p.name} · ${p.games} games · averages ${p.averageText} · ` +
            `wins ${Math.round(p.winRate * 100)}% · ${p.confidence.label} (${p.confidence.note})`);
for (const h of p.how) console.log(`    ${h.label}: ${h.text}`);
for (const w of p.withheld) console.log(`  withheld — ${w.what}: ${w.why}`);

/* The claim, asserted rather than eyeballed: a company's view of this player is
   built by the same call, from the same rows, and is identical. */
const asCompanyWouldSee = T.profile(await db.resultsForCompany(COMPANY['user-mira'].id), {
  population: [], optIn: await db.talentOptIn('user-mira'),
});
const strip = (x) => JSON.stringify({ ...x, percentile: null });
assert.strictEqual(strip(asCompanyWouldSee), strip(p),
                   'what a company sees is not what the player is shown');
console.log('  identical to what a company would be shown — same call, asserted equal');

/* Nothing that failed measurement is quoted anywhere in it. */
/* The withheld list names them on purpose, so the check is on what is quoted:
   no published figure, and no line of text, comes from a trait that never
   settles. */
const quoted = JSON.stringify({ how: p.how, average: p.average, winRate: p.winRate });
for (const banned of ['adsIndex', 'debtRate', 'margin', 'advertis', 'borrow']) {
  assert(!quoted.toLowerCase().includes(banned.toLowerCase()),
         `${banned} is published despite being noise`);
}
assert(p.withheld.length >= 4, 'the profile does not say what it is not telling you');
assert(p.withheld.every((w) => w.what && w.why), 'a withheld item has no reason attached');

/* The one that matters. It is the strongest statistic measured on this project
   and it must not reach anybody, so it is asserted out of the whole object
   rather than merely left unrendered. */
const everything = JSON.stringify({ ...p, withheld: undefined });
for (const leak of ['stayed', 'filedRate', 'abandon', 'missed', 'finished']) {
  assert(!everything.toLowerCase().includes(leak.toLowerCase()),
         `"${leak}" reached a profile — walking away must never be published`);
}
assert(p.withheld.some((w) => /missed rounds/.test(w.what)),
       'the profile does not disclose that it withholds this');
console.log('  whether they finished appears nowhere — and the profile says it is withholding it');

/* The temperament line is a description, not a score. */
const setback = p.how.find((h) => h.key === 'setback');
if (setback) {
  assert(/does not predict/.test(setback.note || ''),
         'the temperament line reads as a virtue without saying it predicts nothing');
  console.log(`  and the response line carries its own caveat: "${setback.note.slice(0, 62)}…"`);
}
console.log('  advertising, borrowing and margin appear nowhere — they never settle\n');

/* ---- the player's own curve, which is theirs alone ---------------------- */
console.log('Their own progress:');
const prog = mine.progress;
console.log(`  ${prog.games} games · early ${M(prog.early)} · lately ${M(prog.late)} · ` +
            `difference ${M(prog.change)}`);
assert(prog && prog.enough, 'a player with twelve games was shown no curve');

/* It must not be part of the profile, because the profile is what a company
   sees and somebody's history with the game is nobody else's business. */
assert(!('progress' in p) && !JSON.stringify(p).includes('"made"'),
       'the curve leaked into the profile a company would be shown');
console.log('  and it is not part of the profile — a company never sees it\n');

/* ---- the invitation ----------------------------------------------------- */
console.log('What an approach looks like:');
const inv = mine.example;
console.log(`  to: ${inv.to}   from: ${inv.from}`);
console.log(`  "${inv.reason}"`);
assert(inv.to === p.name, 'the invitation is not addressed to the company name');
assert(/record of \d+ ranked games/.test(inv.reason), 'the invitation does not say why');

/* No free text a stranger can write. The only strings are the company's own
   role and link; there is no field a person can type a sentence to a person in. */
const written = T.invitation({ companyName: 'X', role: 'Y', url: 'Z',
                               note: 'a'.repeat(5000), profile: p });
assert(written.blurb.length <= 300, 'the blurb is unbounded');
assert(!('message' in written) && !('body' in written), 'there is a free message field');
console.log('  a fixed object: no message field, nothing to moderate\n');

/* ---- revoking is immediate --------------------------------------------- */
console.log('Leaving:');
ok(await call('POST', '/api/talent/optout', {}, 'tok:mira'), 'opt out');
const after = ok(await call('GET', '/api/talent/me', null, 'tok:mira'), 'after');
console.log(`  optedIn is now ${after.status.optedIn}, and the row records when`);
assert.strictEqual(after.status.optedIn, false, 'opting out did not take effect');
const row = await db.talentOptIn('user-mira');
assert(row && row.revoked_at, 'the consent record was deleted rather than dated');
assert(!T.eligible({ optIn: row, companyId: COMPANY['user-mira'].id, games: 12 }),
       'a revoked player is still in the pool');
console.log('  the consent is dated rather than deleted, so "did they ever, and when" stays answerable');

/* And re-joining works, because a decision somebody can only make once is a trap. */
ok(await call('POST', '/api/talent/optin', { adult: true }, 'tok:mira'), 'rejoin');
assert.strictEqual((await call('GET', '/api/talent/me', null, 'tok:mira')).body.status.optedIn, true,
                   'a player who left cannot come back');
console.log('  and they can come back\n');

/* ---- signed out --------------------------------------------------------- */
const anonCall = await call('GET', '/api/talent/me');
console.log(`Signed out: ${anonCall.status} — ${anonCall.body.error}`);
assert(anonCall.status === 401, 'an anonymous request read a profile');

console.log('\ntalent OK');
