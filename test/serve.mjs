/* A local stand-in for Netlify: serves public/ and routes /api/* into the real
   function handler, with blobs held in memory. Lets the actual client be driven
   in a real browser before anything is deployed. */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const MEM = new Map();
register(pathToFileURL('./test/blob-stub.mjs'), import.meta.url);
globalThis.__CEO_BLOBS__ = {
  get: async (k) => (MEM.has(k) ? JSON.parse(MEM.get(k)) : null),
  setJSON: async (k, v) => MEM.set(k, JSON.stringify(v)),
  list: async () => ({ blobs: [...MEM.keys()].map((k) => ({ key: k })) }),
};

const { default: api } = await import('../netlify/functions/api.mjs');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      let body = '';
      for await (const c of req) body += c;
      const r = await api(new Request('http://localhost' + req.url, {
        method: req.method,
        headers: { 'content-type': 'application/json' },
        body: req.method === 'POST' ? body || '{}' : undefined,
      }));
      res.writeHead(r.status, { 'content-type': 'application/json' });
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
