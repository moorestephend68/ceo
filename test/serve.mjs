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
