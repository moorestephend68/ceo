/* The HTTP layer, exercised without Netlify.

   @netlify/blobs is replaced with an in-memory store before api.mjs is imported,
   so the real handler runs against real Requests. This catches the things the
   pure-logic test cannot: routing, error codes, what a stranger can read, and
   whether a game survives being serialised between every single call — which in
   production it always is. */

import assert from 'node:assert';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

/* --- stub @netlify/blobs ------------------------------------------------- */
const MEM = new Map();
let writes = 0;
register(pathToFileURL('./test/blob-stub.mjs'), import.meta.url);
globalThis.__CEO_BLOBS__ = {
  get: async (k) => (MEM.has(k) ? JSON.parse(MEM.get(k)) : null),
  setJSON: async (k, v) => { writes += 1; MEM.set(k, JSON.stringify(v)); },
  list: async () => ({ blobs: [...MEM.keys()].map((k) => ({ key: k })) }),
};

const { default: api } = await import('../netlify/functions/api.mjs');

const call = async (method, path, body) => {
  const req = new Request('https://ceo.test' + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await api(req);
  return { status: res.status, body: await res.json() };
};

const ok = (r, what) => { assert(r.status === 200, `${what}: ${r.status} ${JSON.stringify(r.body)}`); return r.body; };

/* --- a real game through the real routes --------------------------------- */
const cfg = ok(await call('GET', '/api/config'), 'config');
console.log('presets:', Object.keys(cfg.presets).join(', '),
            '| seats', cfg.limits.seats.min + '-' + cfg.limits.seats.max,
            '| rounds', cfg.limits.rounds.min + '-' + cfg.limits.rounds.max,
            '(default ' + cfg.limits.rounds.default + ')');

const bad = await call('POST', '/api/create', { hostName: '  ' });
assert.equal(bad.status, 400);
console.log('empty company name rejected:', bad.body.error);

const host = ok(await call('POST', '/api/create', {
  hostName: 'Ravensworth', seats: 4, rounds: 8, preset: 'standard', closeHour: 18,
}), 'create');
console.log('created game', host.code, '— host token issued');

const missing = await call('POST', '/api/join', { code: 'ZZZZZZ', name: 'X' });
assert.equal(missing.status, 404);
console.log('joining a nonexistent code:', missing.status, missing.body.error);

const anna = ok(await call('POST', '/api/join', { code: host.code, name: 'Sableworth Ltd' }), 'join');
const dupe = await call('POST', '/api/join', { code: host.code, name: 'sableworth ltd' });
assert.equal(dupe.status, 400);
console.log('duplicate company name rejected:', dupe.body.error);

/* a player cannot start someone else's game */
const notHost = await call('POST', '/api/start', { code: host.code, token: anna.token });
assert.equal(notHost.status, 400);
console.log('non-host start refused:', notHost.body.error);

const started = ok(await call('POST', '/api/start', { code: host.code, token: host.token }), 'start');
assert.equal(started.view.status, 'playing');
console.log('started:', started.view.market.length, 'seats,',
            started.view.market.map((m) => m.name).join(' | '));

/* a stranger with the code but no token sees the market and nothing personal */
const stranger = ok(await call('GET', `/api/state?code=${host.code}`), 'stranger state');
assert.equal(stranger.view.you, null);
assert(stranger.view.market.every((m) => m.isBot === null), 'stranger sees bot identities');
console.log('stranger sees a market but no seat:', stranger.view.you === null);

/* filing */
function orders(view) {
  const products = {};
  for (const p of view.you.products) {
    products[p.name] = {
      price: Math.round(p.value * 0.97),
      produce: Math.max(0, Math.min((p.lastDemand || 1300) * 1.05, p.effCapacity) - p.inventory),
      rd: 34000, rdProcess: 12000, advertising: 7000,
      targetCapacity: p.capacity, discontinue: false,
    };
  }
  return { products, launch: false };
}

let hv = ok(await call('GET', `/api/state?code=${host.code}&token=${host.token}`), 'host state');
assert.equal(hv.view.you.filed, false);
ok(await call('POST', '/api/submit', { code: host.code, token: host.token, decisions: orders(hv.view) }), 'submit');
hv = ok(await call('GET', `/api/state?code=${host.code}&token=${host.token}`), 'host state 2');
assert.equal(hv.view.you.filed, true);
console.log('after filing, round is', hv.view.round, 'and waiting on:', hv.view.waitingOn.join(', ') || 'nobody');
assert.deepEqual(hv.view.waitingOn, ['Sableworth Ltd']);

/* the borrowing rate is reported, and reads as a rate a lender would quote */
const cr = hv.view.you.credit;
console.log('credit standing:', cr.label, '·', (cr.rate * 100).toFixed(1) + '% a round',
            '· drawn', cr.drawn, 'of', cr.limit);
assert(cr.rate > 0.03 && cr.rate < 0.23, 'borrowing rate outside any sane band');
assert(typeof cr.headroom === 'number', 'no headroom reported');

/* launching is offered, and refused when it would leave no room to survive */
console.log('can launch a new line:', hv.view.you.canLaunch,
            hv.view.you.canLaunch ? `(borrowing ${hv.view.you.launchBorrowing})` : '');

/* an unknown token cannot file */
const impostor = await call('POST', '/api/submit', { code: host.code, token: 'not-a-token', decisions: {} });
assert.equal(impostor.status, 400);
console.log('unknown token cannot file:', impostor.body.error);

/* when the last human files, the round closes immediately */
let av = ok(await call('GET', `/api/state?code=${host.code}&token=${anna.token}`), 'anna state');
const after = ok(await call('POST', '/api/submit',
  { code: host.code, token: anna.token, decisions: orders(av.view) }), 'anna submit');
assert.equal(after.view.round, 1, 'round did not close when the last player filed');
console.log('last player filed -> round closed at once, now round', after.view.round + 1);

/* play the rest out */
let guard = 0;
while (true) {
  const v = ok(await call('GET', `/api/state?code=${host.code}&token=${host.token}`), 'loop state');
  if (v.view.status !== 'playing') break;
  if (guard++ > 40) throw new Error('game never ended');
  for (const tok of [host.token, anna.token]) {
    const s = ok(await call('GET', `/api/state?code=${host.code}&token=${tok}`), 'loop state 2');
    if (s.view.you && s.view.you.products && s.view.you.products.length && !s.view.you.bankrupt) {
      await call('POST', '/api/submit', { code: host.code, token: tok, decisions: orders(s.view) });
    }
  }
}

const done = ok(await call('GET', `/api/state?code=${host.code}&token=${host.token}`), 'final');
assert.equal(done.view.status, 'over');
console.log('\nfinal standings');
done.view.market.slice().sort((a, b) => b.finalValue - a.finalValue).forEach((m, i) => {
  console.log(`  ${i + 1}. ${m.name.padEnd(22)} $${Math.round(m.finalValue).toLocaleString('en-US').padStart(9)}  ` +
              `${m.isBot ? m.strategy : 'a person'}`);
});
assert(done.view.market.every((m) => m.isBot !== null), 'identities not revealed');

/* filing into a finished game is refused, not silently accepted */
const late = await call('POST', '/api/submit', { code: host.code, token: host.token, decisions: {} });
assert.equal(late.status, 409);
console.log('\nfiling after the game ended:', late.status, late.body.error);

console.log('blob writes over the whole game:', writes);
console.log('stored size:', (MEM.get(`game/${host.code}`).length / 1024).toFixed(1) + ' KB');
console.log('\napi OK');
