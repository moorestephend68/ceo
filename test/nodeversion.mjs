/* Can this server start on a Node that has no WebSocket?

   It could not, and the way it failed is the reason this test exists. The
   Supabase client opens a realtime connection as it is constructed and wants a
   global WebSocket to do it with; Node had none before 22. On Node 20 the
   constructor threw during module import, so the function died before any
   request handler existed, and every single route — including the ones that
   never touch a database — returned a bare 502 with no body and nothing in it to
   read. The site looked misconfigured for hours when it was one line of a
   config file.

   Nothing here subscribes to realtime. Depending on it to start was never
   intended, and this checks that it no longer does. */

import assert from 'node:assert';

const had = typeof globalThis.WebSocket;
delete globalThis.WebSocket;
assert.equal(typeof globalThis.WebSocket, 'undefined', 'the point is to run without one');
console.log(`this Node is ${process.version} and does have WebSocket: ${had === 'function'}`);
console.log('removed it, which is what Node 20 looks like from here\n');

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_test';

const { serviceClient } = await import('../lib/auth.mjs');

let client;
try {
  client = serviceClient();
} catch (e) {
  assert.fail('the server refused to start without a WebSocket: ' + e.message);
}
console.log('the Supabase client constructs anyway:', typeof client.from === 'function');
assert(typeof client.from === 'function', 'and is usable for queries');
assert(client.auth && typeof client.auth.getUser === 'function', 'and for verifying tokens');

/* Constructed once and reused, so this is not paid per request. */
assert.strictEqual(serviceClient(), client, 'the client should be built once and kept');
console.log('and is built once and kept:', serviceClient() === client);

/* And the whole API surface loads, which is where the original failure actually
   happened — at import, not at call. */
delete globalThis.__CEO_DB__;
const { default: api } = await import('../netlify/functions/api.mjs');
const res = await api(new Request('https://ceo.test/api/config'));
console.log('/api/config answers:', res.status);
assert.equal(res.status, 200, 'the function must load and serve on a WebSocket-less Node');

console.log('\nnodeversion OK');
