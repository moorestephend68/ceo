/* A server that was deployed but never configured.

   This is not a hypothetical: the site went live with the functions deployed and
   no Supabase environment variables, and every route — including the one the page
   uses to work out what it is talking to — returned a bare 502 with nothing in
   it. A deploy succeeds whether or not the variables were filled in, so the
   interface is the only place anyone would ever find out.

   Run with no __CEO_DB__ and no environment, which is exactly the state that
   failed. */

import assert from 'node:assert';

delete globalThis.__CEO_DB__;
delete globalThis.__CEO_VERIFY__;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { default: api } = await import('../netlify/functions/api.mjs');

const call = async (method, path, body) => {
  const req = new Request('https://ceo.test' + path, {
    method, headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let res;
  try {
    res = await api(req);
  } catch (e) {
    /* The original failure: the handler threw, so the platform returned a 502
       with no body. Anything reaching here is that bug coming back. */
    assert.fail(`${method} ${path} threw instead of answering: ${e.message}`);
  }
  return { status: res.status, body: await res.json() };
};

/* ---------------------------------------------- what still has to answer */
const cfg = await call('GET', '/api/config');
console.log('/api/config on an unconfigured server:', cfg.status);
assert.equal(cfg.status, 200, 'the page must always be able to ask what this server is');
assert.equal(cfg.ready, undefined);
assert.equal(cfg.body.ready, false, 'and the answer must include that it is not ready');
assert(cfg.body.presets && cfg.body.cadences, 'the rules are static and cost nothing');
console.log('  it answers, and reports ready:', cfg.body.ready);

const fmt = await call('GET', '/api/public/format');
console.log('/api/public/format:', fmt.status, '·', fmt.body.describe);
assert.equal(fmt.status, 200);

/* ------------------------------------------- what must say why it cannot */
console.log('\nRoutes that need storage:');
for (const [method, path, body] of [
  ['GET', '/api/name?q=Ravensworth', null],
  ['GET', '/api/account', null],
  ['GET', '/api/leaderboard', null],
  ['GET', '/api/state?code=ABC123', null],
  ['POST', '/api/public/join', { name: 'Ketteridge' }],
  ['POST', '/api/demo', {}],
]) {
  const r = await call(method, path, body);
  console.log(`  ${method} ${path.split('?')[0]} → ${r.status}: ${r.body.error}`);
  assert.equal(r.status, 503, `${path} should report a server that is not ready`);
  assert(/not finished being set up/i.test(r.body.error),
    `${path} must say what is wrong, not merely fail`);
  assert(/SETUP\.md/.test(r.body.error), 'and where the fix is written down');
}

console.log('\nunconfigured OK');
