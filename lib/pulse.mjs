/* Did anybody play?

   This exists because the question took twenty minutes of inference to fail to
   answer. Web analytics can say how many people arrived; it cannot say whether
   any of them played, because joining a game changes the URL with pushState and
   never asks the server for a page. Private games are never scored, so they
   leave no result rows either. The only place the answer lives is the games
   table, and nothing was reading it.

   So: one endpoint that counts games. Public and anonymous, the same as
   /api/learning — it names nobody, and a claim about whether anything is
   happening should be checkable by anybody being told it is.

   It reports what it counted rather than a score out of ten, and it writes the
   answer in a sentence, because the point is to glance at it. */

const KINDS = ['public', 'class', 'league', 'private'];

export function kindOf(row) {
  if (row.league) return 'league';
  if (row.cohort_id) return 'class';
  if (row.is_public) return 'public';
  return 'private';
}

const empty = () => Object.fromEntries(KINDS.map((k) => [k, 0]));

/* `rows` are games created inside the window; `results` are result rows written
   inside it. A game and its result can fall on opposite sides of the boundary —
   a table started at 11pm and finished at midnight — which is why both are
   counted rather than one inferred from the other. */
export function pulse(rows, results, { hours = 24, now = new Date().toISOString() } = {}) {
  const created = empty();
  const status = { lobby: 0, playing: 0, over: 0 };
  let humans = 0, seats = 0, rounds = 0, abandoned = 0;

  for (const r of rows) {
    const kind = kindOf(r);
    created[kind] += 1;
    if (status[r.status] !== undefined) status[r.status] += 1;

    /* A game that never left its lobby is not a game that was played. Counted
       separately because it is the most interesting failure: somebody arrived,
       pressed the button, and nothing came of it. */
    if (r.status === 'lobby') abandoned += 1;

    const state = r.state || {};
    const list = Array.isArray(state.seats) ? state.seats : [];
    seats += list.length;
    humans += list.filter((s) => !s.isBot).length;
    if (r.status !== 'lobby') rounds += Number(state.round) || 0;
  }

  const scored = results.length;
  const named = new Set(results.filter((r) => r.company_id).map((r) => r.company_id)).size;

  const total = KINDS.reduce((a, k) => a + created[k], 0);
  const played = total - abandoned;

  return {
    window: `${hours} hours`, since: sinceOf(now, hours), now,
    games: { total, ...created },
    status,
    /* Seats with a person behind them. A five-seat public table with one player
       and four archetypes is one person, not five, and reporting it as five
       would be the most flattering possible lie. */
    people: humans,
    rounds,
    startedButEmpty: abandoned,
    finished: { scored, namedCompanies: named },
    summary: sentence({ total, played, abandoned, humans, rounds, scored, named,
                        created, hours }),
  };
}

/* A named company can appear on several result rows in one game only if it
   played several games; within one game it is one row. So this is a floor on
   how many rows came from named players, not an exact split — which is why the
   sentence says "from N names" rather than claiming a row count. */
const namedResults = (scored, named) => Math.min(scored, named);

const sinceOf = (now, hours) =>
  new Date(Date.parse(now) - hours * 3600000).toISOString();

function sentence({ total, played, abandoned, humans, rounds, scored, named,
                    created, hours }) {
  if (!total) return `Nothing at all in the last ${hours} hours. No game was even opened.`;

  const bits = [];
  const by = KINDS.filter((k) => created[k]).map((k) => `${created[k]} ${k}`).join(', ');
  bits.push(`${total} game${total === 1 ? '' : 's'} opened (${by})`);
  if (played) bits.push(`${played} got past the lobby`);
  bits.push(`${humans} seat${humans === 1 ? '' : 's'} with a person in it`);
  if (rounds) bits.push(`${rounds} round${rounds === 1 ? '' : 's'} played`);

  let out = `In the last ${hours} hours: ${bits.join(', ')}.`;
  if (abandoned === total) {
    out += ' Every one of them was opened and abandoned before it started —'
         + ' which is a person arriving, pressing the button, and leaving.';
  } else if (abandoned) {
    out += ` ${abandoned} ${abandoned === 1 ? 'was' : 'were'} opened and abandoned`
         + ' before starting.';
  }
  if (!scored) {
    out += ' Nothing was scored, which is normal unless somebody finished a ranked'
         + ' or league game — private games and classes are never scored.';
  } else {
    /* Split, because for a long time these will be very different numbers.
       Until buying a name works, essentially everybody plays ranked games
       anonymously — those still produce results, they just have no company
       attached, which is why the leaderboard and the learning curve cannot see
       them. Reporting only the total would make a busy day look empty; reporting
       only the named ones would make it look emptier still. */
    const anon = scored - namedResults(scored, named);
    out += ` ${scored} result${scored === 1 ? '' : 's'} recorded`;
    out += named
      ? `, from ${named} claimed company name${named === 1 ? '' : 's'}`
        + (anon > 0 ? ' and the rest anonymous' : '')
      : ', none from a claimed company name — which is expected while buying'
        + ' one is not switched on';
    out += '.';
  }
  return out;
}
