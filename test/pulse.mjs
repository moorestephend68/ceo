/* "Did anybody play?" — the question that took twenty minutes of inference and
   still came back "I cannot tell you".

   The tests that matter here are about honesty rather than arithmetic. A pulse
   endpoint that flatters is worse than none: it would let a quiet day read as a
   busy one, and the whole reason for building it was that the guessing was
   unreliable. So: an empty day must say so plainly, a table of one human and
   four archetypes must count as one person, and a game opened and abandoned
   must not be reported as a game played. */

import assert from 'node:assert';
import { memoryDb } from '../lib/db.mjs';
import * as G from '../lib/game.mjs';
import * as P from '../lib/public.mjs';
import * as PU from '../lib/pulse.mjs';

const db = memoryDb();
globalThis.__CEO_DB__ = db;
globalThis.__CEO_VERIFY__ = async () => ({ data: null, error: { message: 'no' } });
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon_test';

const { default: api } = await import('../netlify/functions/api.mjs');
const call = async (path) => {
  const res = await api(new Request('https://ceo.test' + path));
  return { status: res.status, body: await res.json() };
};

/* ---- a day when nothing happened --------------------------------------- */
console.log('A day when nothing happened:');
{
  const r = await call('/api/pulse');
  assert.strictEqual(r.status, 200, 'pulse should answer without a login');
  console.log(`  "${r.body.pulse.summary}"`);
  assert.strictEqual(r.body.pulse.games.total, 0, 'invented a game');
  assert(/Nothing at all/.test(r.body.pulse.summary),
         'a silent day must say so rather than printing a row of zeroes');
}

/* ---- somebody opens a table and wanders off ----------------------------- */
console.log('\nSomebody opens a public table and wanders off:');
{
  const now = new Date().toISOString();
  const { game } = P.joinPublic ? await P.joinPublic(db, { name: 'Ketteridge', now })
                                : {};
  await db.putGame(game);
  const r = await call('/api/pulse');
  const p = r.body.pulse;
  console.log(`  "${p.summary}"`);
  assert.strictEqual(p.games.total, 1);
  assert.strictEqual(p.games.public, 1);
  assert.strictEqual(p.startedButEmpty, 1, 'a lobby nobody started counts as played');
  assert.strictEqual(p.rounds, 0, 'rounds were counted for a game that never began');
  assert(/abandoned/.test(p.summary), 'the summary hides the abandonment');
}

/* ---- one person actually plays ----------------------------------------- */
console.log('\nOne person plays a table out against the archetypes:');
{
  const at = (ms) => new Date(ms).toISOString();
  const t0 = Date.now();
  const { game } = G.createGame({ ...P.FORMAT, hostName: 'Ravenscarr', now: at(t0) });
  game.isPublic = true;
  G.startGame(game, game.hostToken, at(t0));
  const seat = game.seats.find((x) => !x.isBot);
  let r = 0;
  while (game.status === 'playing' && r < 4) {
    G.resolveRound(game, at(t0 + (++r) * 300000));
  }

  const before = (await call('/api/pulse')).body.pulse.people;
  await db.putGame(game);
  const body = (await call('/api/pulse')).body.pulse;
  console.log(`  "${body.summary}"`);
  console.log(`  seats at that table: ${game.seats.length}, of which people: ${
    game.seats.filter((s) => !s.isBot).length}`);

  /* The flattering lie this exists to avoid: five seats, one person. Measured as
     what this table added rather than as a total, because the abandoned lobby
     from the previous case is still inside the window. */
  const added = body.people - before;
  console.log(`  and it added ${added} to the count of people, not 5`);
  assert.strictEqual(added, 1,
    `a table with one player and four archetypes added ${added} people`);
  assert(body.rounds >= 4, `lost the rounds played (${body.rounds})`);
  assert.strictEqual(body.status.playing, 1);
}

/* ---- named against anonymous ------------------------------------------- */
/* Until buying a name is switched on, essentially every ranked player is
   anonymous. Those games still produce results with no company attached — which
   the leaderboard and the learning curve both filter out. If the summary did not
   separate the two, a day when twenty strangers played would read identically to
   a day when nobody did. */
console.log('\nNamed players against anonymous ones:');
{
  const games = [{ status: 'over', is_public: true, state: { round: 10, seats: [{}, { isBot: true }] } }];
  const anon = PU.pulse(games, [{ company_id: null }, { company_id: null }], { hours: 24 });
  console.log(`  three anonymous: "${anon.summary.split('. ').pop()}"`);
  assert(/none from a claimed company name/.test(anon.summary),
         'an anonymous-only day does not explain itself');
  assert(/expected while buying one is not switched on/.test(anon.summary),
         'it does not say why that is normal');
  assert.strictEqual(anon.finished.namedCompanies, 0);

  const mixed = PU.pulse(games, [{ company_id: 'a' }, { company_id: null }], { hours: 24 });
  console.log(`  one named, one not: "${mixed.summary.split('. ').pop()}"`);
  assert(/1 claimed company name/.test(mixed.summary), 'the named one is not reported');
  assert(/the rest anonymous/.test(mixed.summary), 'the anonymous ones vanished');
  assert.strictEqual(mixed.finished.namedCompanies, 1);
}

/* ---- the kinds are kept apart ------------------------------------------ */
console.log('\nThe four kinds are counted separately:');
{
  assert.strictEqual(PU.kindOf({ league: 'bot' }), 'league');
  assert.strictEqual(PU.kindOf({ cohort_id: 'abc' }), 'class');
  assert.strictEqual(PU.kindOf({ is_public: true }), 'public');
  assert.strictEqual(PU.kindOf({}), 'private');
  /* Order matters: a league game is also created without a cohort and without
     is_public, and a class game is not public. */
  assert.strictEqual(PU.kindOf({ league: 'bot', is_public: true }), 'league',
    'a league game was miscounted as public');
  console.log('  league, class, public, private — and a league game is not "public"');
}

/* ---- the window ---------------------------------------------------------- */
console.log('\nThe window is a window:');
{
  const wide = (await call('/api/pulse?hours=168')).body.pulse;
  console.log(`  7 days: ${wide.games.total} games · 24 hours: ` +
              `${(await call('/api/pulse')).body.pulse.games.total}`);
  assert.strictEqual(wide.window, '168 hours');
  /* Nobody should be able to ask for a year and make the server read the table. */
  const capped = (await call('/api/pulse?hours=99999')).body.pulse;
  assert.strictEqual(capped.window, '168 hours', 'the window is not capped');
  console.log('  and asking for a year gets you a week');
}

console.log('\npulse OK');
