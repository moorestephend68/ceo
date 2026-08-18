/* A local stand-in for Netlify: serves public/ and routes /api/* into the real
   function handler, with blobs held in memory. Lets the actual client be driven
   in a real browser before anything is deployed. */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

import { memoryDb } from '../lib/db.mjs';
import * as A from '../lib/accounts.mjs';

const db = memoryDb();
globalThis.__CEO_DB__ = db;

/* Local play needs no real Supabase or Stripe. A token is "tok:<id>"; the demo
   account below already owns a company, so hosting works out of the box. */
const USERS = new Map();
globalThis.__CEO_VERIFY__ = async (t) => {
  if (!String(t).startsWith('tok:')) return { data: null, error: { message: 'bad token' } };
  const id = String(t).slice(4);
  if (!USERS.has(id)) USERS.set(id, { id, email: `${id}@local.test` });
  return { data: { user: USERS.get(id) }, error: null };
};

await db.ensureProfile('demo', 'demo@local.test');
const seed = await A.claimName(db, 'demo', 'Ravensworth & Co', new Date().toISOString());
await A.confirmPurchase(db, { owner: 'demo', companyId: seed.id, eventId: 'evt_local' });
await A.confirmPurchase(db, { owner: 'demo', companyId: null, kind: 'facilitator', eventId: 'evt_local_fac' });
console.log('local demo account: token "tok:demo", company "Ravensworth & Co" (host + facilitator)');

/* A played record for the demo account.

   The player profile only exists above a five-game floor, so without this the
   local server can only ever show the "not enough games yet" branch — and the
   browser test would pass without once rendering the thing it is meant to be
   testing. Twelve real ranked games, played by the engine, scored by the real
   scorer. It takes about a second. */
{
  const G = await import('../lib/game.mjs');
  const P = await import('../lib/public.mjs');
  const at = (ms) => new Date(ms).toISOString();
  for (let i = 0; i < 12; i++) {
    const t0 = Date.now() - (12 - i) * 3600000;
    const { game } = G.createGame({ ...P.FORMAT, hostName: seed.name, seed: 61000 + i, now: at(t0) });
    game.isPublic = true;
    G.startGame(game, game.hostToken, at(t0));
    const spot = game.seats.find((x) => !x.isBot);
    spot.companyId = seed.id;
    let r = 0;
    while (game.status === 'playing') {
      const v = G.viewFor(game, spot.token);
      if (v.you && v.you.products.length && !v.you.bankrupt) {
        const products = {};
        for (const p of v.you.products) {
          products[p.name] = {
            price: Math.round(p.value * (i % 3 === 0 ? 1.02 : 0.98)),
            produce: Math.max(0, Math.min(Math.round((p.lastDemand || 1300) * 1.05), p.effCapacity) - p.inventory),
            rd: 28000, rdProcess: 11000,
            advertising: i % 2 ? 9000 : 13000,
            targetCapacity: Math.round(p.capacity), discontinue: false };
        }
        try { G.submitDecisions(game, spot.token, { products, launch: false }); } catch {}
      }
      G.resolveRound(game, at(t0 + (++r) * 5 * 60000));
    }
    game.lastResolvedAt = at(t0 + r * 5 * 60000);
    await P.scoreGame(db, game);
  }
  console.log('seeded 12 ranked games for the demo company, so the record page has a record');
}

const { default: api } = await import('../netlify/functions/api.mjs');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      let body = '';
      for await (const c of req) body += c;
      /* forward the real headers — dropping Authorization here made every
         request look signed out, which is a fine way to "prove" auth is broken */
      const headers = { 'content-type': 'application/json' };
      if (req.headers.authorization) headers.authorization = req.headers.authorization;
      if (req.headers['stripe-signature']) headers['stripe-signature'] = req.headers['stripe-signature'];
      const r = await api(new Request('http://localhost' + req.url, {
        method: req.method, headers,
        body: req.method === 'POST' ? body || '{}' : undefined,
      }));
      /* Pass the real headers back: the CSV export is not JSON, and pretending
         it is would hide a bug the browser would find. */
      const out = {};
      r.headers.forEach((v, k) => { out[k] = v; });
      res.writeHead(r.status, out);
      res.end(await r.text());
      return;
    }
    /* the /g/* rewrite Netlify does */
    let file = url.pathname === '/' ? '/index.html'
      : url.pathname.startsWith('/g/') ? '/live.html' : url.pathname;
    const ext = file.slice(file.lastIndexOf('.'));
    const data = await readFile('public' + file);
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found: ' + e.message);
  }
});

const PORT = +(process.env.PORT || 8899);
server.listen(PORT, () => console.log('serving on http://localhost:' + PORT));
export default server;
