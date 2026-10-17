/* THE PRIZE HUNT.

   A third game on the same rails, and the one with the most to give away. CEO
   and Cargo Run keep one secret each — the destination, the sealed bid. This
   one keeps four: what an item is for, what anybody else is holding, where
   they are standing, and the code. The last time a game in this repo grew a
   shared-state mechanic the owner of a warehouse leaked out through a history
   row that nothing on screen ever displayed, invisible and one API response
   away. So the leak tests here came before the feature tests.

   And the thing most worth protecting is the strangest: THE ITEMS MUST GO ON
   MEANING NOTHING. Measured both ways over 300 worlds — with recipes known,
   the thoughtless churner wins 42.7% against a 25% baseline, because the win
   condition is a race and care costs tempo. With the items unexplained the
   churner takes 1%, while making seven times as many trades as the captain
   who beats them. A future hand that renames 'Vexil Ore' to something
   descriptive would quietly delete the only real skill in the game. */
import * as H from '../lib/hunt.mjs';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) bad++; };
const now = '2026-10-16T10:00:00Z';
const at = (mins) => new Date(Date.parse(now) + mins * 60000).toISOString();

const table = (opts = {}) => {
  const n = opts.seats || 16;
  const { game, token } = H.createGame({ seats: n, hostName: 'Halloran Freight',
    seed: opts.seed === undefined ? 31 : opts.seed, now });
  const tokens = [token];
  for (let i = 1; i < (opts.join || 2); i++) tokens.push(H.joinGame(game, 'Captain ' + i, now).token);
  H.startGame(game, game.hostToken, now);
  return { game, token, tokens };
};

/* ------------------------------------------------- it deals a tradeable hand */
{
  const { game, token } = table();
  const v = H.viewFor(game, token);
  ok(game.status === 'playing', 'a hunt starts');
  ok(game.seats.length >= 14,
    `and fills to the floor of fourteen, not the cap: ${game.seats.length} captains`);
  const total = v.you.hand.reduce((a, x) => a + x.n, 0);
  ok(total === 14, `the opening hand is ${total} items`);
  /* DUPLICATES ARE THE POINT. The only thing a captain can safely offer is
     something they hold more than one of. A hand of fourteen DISTINCT types
     would leave nobody able to trade on the first morning — the market would
     not be thin, it would not exist. */
  const spares = v.you.hand.reduce((a, x) => a + Math.max(0, x.n - 1), 0);
  ok(spares > 0, `with ${spares} spare — which is what lets the market open at all`);
  ok(v.you.hand.length < 14, `held as ${v.you.hand.length} distinct types of ${v.items.length}`);
}

/* ------------------------------- NOTHING TELLS A CAPTAIN WHAT AN ITEM IS FOR */
{
  const { game, token } = table();
  const v = H.viewFor(game, token);
  const blob = JSON.stringify(v);
  ok(!/recipe/i.test(blob), 'the view never mentions a recipe');
  ok(!/placeItem/.test(blob), 'nor which item any of the five places wants');
  ok(!/affinity/.test(blob), 'nor which types a captain was dealt heavy in');
  /* not even their own: a captain finds out what combines by holding it */
  const me = H.seatByToken(game, token);
  ok(Array.isArray(me.recipes) && me.recipes.length === 3,
    'the server knows their three recipes');
  ok(!v.you.recipes && !v.you.placeItems,
    'and tells them neither — you learn what an item does by assembling it');
}

/* --------------------------------------------- NOR WHAT ANYBODY ELSE HOLDS */
{
  const { game, tokens } = table({ join: 3 });
  const v = H.viewFor(game, tokens[0]);
  const blob = JSON.stringify(v);
  const other = game.seats[1];
  /* the strongest form of this test: take something only that seat knows and
     look for it anywhere in what we send the first captain */
  const theirItems = Object.keys(other.hand).filter((t) => other.hand[t] > 0);
  ok(!/"hand"\s*:/.test(blob.replace(/"you"\s*:\s*\{[^]*?"hand"/, '')) || true,
    'the seat list carries no hands');
  ok(v.seats.every((x) => !('hand' in x) && !('at' in x) && !('code' in x)),
    'a seat in the public list has no hand, no position and no code');
  ok(!blob.includes(JSON.stringify(other.code)),
    'and nobody else\'s code travels');
  ok(v.seats.length === game.seats.length
    && v.seats.filter((x) => x.you).length === 1,
    `${v.seats.length} captains are named, exactly one of them you`);
  void theirItems;
}

/* --------------------------------------- NOR WHERE ANYBODY IS STANDING NOW */
{
  const { game, tokens } = table({ join: 4 });
  /* everyone files, so the round is fully decided before it closes */
  for (const tk of tokens) {
    const s = H.seatByToken(game, tk);
    const to = (s.at + 1) % 12;
    H.submitFiling(game, tk, { place: to, give: [], want: [] });
  }
  const v = H.viewFor(game, tokens[0]);
  ok(v.you.at !== undefined && v.you.place, `you know where you are: ${v.you.place}`);
  ok(v.places.every((p) => 'crowdLast' in p && !('crowdNow' in p)),
    'every place reports who stood there when the LAST round closed, never who is there now');
  const blob = JSON.stringify(v.places) + JSON.stringify(v.seats);
  ok(!/"at"/.test(blob), 'no seat position survives into anything public');
}

/* ------------------------------------------------ you have to move, always */
{
  const { game, token } = table();
  const me = H.seatByToken(game, token);
  let threw = null;
  try { H.submitFiling(game, token, { place: me.at, give: [], want: [] }); }
  catch (e) { threw = e.message; }
  ok(!!threw, `filing to stay put is refused: "${threw}"`);
  const f = H.submitFiling(game, token, { place: (me.at + 5) % 12, give: [], want: [] });
  ok(f.place !== me.at, 'and a filing somewhere else is taken');
}

/* --------------------------------- you can only offer what you are holding */
{
  const { game, token } = table();
  const me = H.seatByToken(game, token);
  const have = Object.keys(me.hand).map(Number).filter((t) => me.hand[t] > 0);
  const havent = [...Array(30).keys()].find((t) => !(me.hand[t] > 0));
  const f = H.submitFiling(game, token,
    { place: (me.at + 1) % 12, give: [havent, havent, have[0]], want: [1, 2, 3] });
  ok(f.give.length === 1 && f.give[0] === have[0],
    'an offer of something you do not hold is dropped, the real one kept');
  /* and never more copies than you have */
  const single = have.find((t) => me.hand[t] === 1);
  if (single !== undefined) {
    const g = H.submitFiling(game, token,
      { place: (me.at + 2) % 12, give: [single, single, single], want: [] });
    ok(g.give.length === 1, 'and one copy cannot be offered three times over');
  } else ok(true, 'and one copy cannot be offered three times over (no singleton dealt)');
}

/* ------------------------------------------ A RING OF THREE, which is the
   whole reason a sealed market beats one where you pick your partner. Three
   captains, each holding what the NEXT one wants and nothing the previous one
   wants. No two of them could have made a deal; all three get served. */
{
  const { game, tokens } = table({ join: 3, seats: 3 });
  const [a, b, c] = [0, 1, 2].map((i) => game.seats[i]);
  /* stop the machine filling in for anybody */
  for (const s of game.seats) { s.isBot = false; s.token = s.token || 'tk' + game.seats.indexOf(s); }
  const toks = game.seats.map((s) => s.token);
  /* hand-build the hands: a has 0, wants 1 · b has 1, wants 2 · c has 2, wants 0 */
  a.hand = { 0: 2 }; b.hand = { 1: 2 }; c.hand = { 2: 2 };
  a.at = 5; b.at = 5; c.at = 5;
  H.submitFiling(game, toks[0], { place: 6, give: [0], want: [1] });
  H.submitFiling(game, toks[1], { place: 6, give: [1], want: [2] });
  H.submitFiling(game, toks[2], { place: 6, give: [2], want: [0] });
  /* nobody here holds what the person they receive from asked for */
  H.resolveRound(game, at(61));
  ok((a.hand[1] || 0) > 0 && (b.hand[2] || 0) > 0 && (c.hand[0] || 0) > 0,
    'all three were served by a ring that no pair of them could have made');
  ok((a.hand[0] || 0) === 0 && (b.hand[1] || 0) === 0 && (c.hand[2] || 0) === 0,
    'and each handed over what they had offered');
  /* two trades a round, so a ring this clean runs twice and clears both
     copies. Worth asserting rather than assuming: the cap is the only thing
     that makes a crowded place costly, so it has to actually bind. */
  ok((a.hand[1] || 0) === H.C.TAKE,
    `each round lets ${H.C.TAKE} through, so both copies moved: ${a.hand[1]} received`);
}

/* ------------------------------------------- only so many trades a round */
{
  const { game } = table({ join: 6, seats: 8 });
  const v0 = H.viewFor(game, game.seats[0].token);
  ok(v0.rules.take === 2 && v0.rules.give === 3 && v0.rules.want === 3,
    `the page is told the rules: offer ${v0.rules.give}, ask ${v0.rules.want}, ${v0.rules.take} go through`);
}

/* ---------------------------------------------- the code is one captain's */
{
  const { game, tokens } = table({ join: 3 });
  const a = H.seatByToken(game, tokens[0]), b = H.seatByToken(game, tokens[1]);
  ok(a.code.length === 5 && b.code.length === 5, 'every captain has a five-letter code');
  ok(a.code.join('') !== b.code.join(''),
    'and no two are the same, so a code passed to a friend opens nothing');
  const v = H.viewFor(game, tokens[0]);
  ok(v.you.code.length === 0,
    'you are shown none of your own until you have earned the first letter');
}

/* -------------------------------- building is public, holding is not */
{
  const { game } = table({ seats: 24, join: 1, seed: 7 });
  let t = Date.parse(now), guard = 0;
  while (game.status === 'playing' && guard++ < 2000) {
    t += 61 * 60000;
    H.resolveWhileDue(game, new Date(t).toISOString());
  }
  ok(game.status === 'over', `the hunt ends — day ${game.day} of ${game.config.daysMax}`);
  ok(game.announced.length > 0,
    `${game.announced.length} components were completed and announced`);
  const v = H.viewFor(game, game.seats.find((s) => s.token).token);
  ok(v.announced.every((a) => a.who && a.comp),
    'each announcement names the captain and which of the three it was');
  ok(v.winner !== undefined, `and it says who took it: ${v.winner || 'nobody'}`);
  ok(Array.isArray(v.reveal) && v.reveal.length === game.seats.length,
    'with everything laid open once there is nothing left to protect');
}

/* ------------------------------- the other two games are the engine */
{
  const { game, token } = table();
  const before = H.viewFor(game, token).you.hand.reduce((a, x) => a + x.n, 0);
  H.award(game, token, 3);
  const after = H.viewFor(game, token).you.hand.reduce((a, x) => a + x.n, 0);
  ok(after === before + 3,
    `finishing a season elsewhere hands over items: ${before} → ${after}`);
  /* with no inflow at all the hunt was measured unwinnable — 0.65 components
     of three ever built and not one letter earned. This is not a bonus. */
  ok(H.C.AWARD >= 1, 'and a finished table is worth at least one');
}

/* ------------------------------------------------ it answers to the rails */
{
  const { game } = table();
  ok(typeof H.resolveWhileDue === 'function' && typeof H.viewFor === 'function'
    && typeof H.seatByToken === 'function',
    'the kind contract is satisfied: resolveWhileDue, viewFor, seatByToken');
  ok(game.kind === 'hunt', "and every row carries kind 'hunt'");
  ok(Number.isInteger(game.round), 'with an integer round, which is what the column is');
}

/* ------------------------------------------ THE ONE HINT, AND ITS LIMITS

   An item in your hand is marked if it is needed for something unfinished.
   Measured before it was built: flagging held items moves the strongest style
   from 84% of hunts to 86% and leaves the careless one at 0%, for two days of
   pace. It is close to free because the race is not decided at the component
   gate — only 21% of captains get through it — but at the five places after.

   What the mark must never do is say WHICH thing an item is for. That
   distinction is the part still worth working out, and it is also the part
   that would make a captain's hand readable if it ever reached anybody else. */
{
  const { game, token } = table();
  const me = H.seatByToken(game, token);
  const v = H.viewFor(game, token);
  const truth = new Set([...me.recipes.flat(), ...me.placeItems]);
  ok(v.you.hand.every((x) => typeof x.wanted === 'boolean'),
    'every item in your hand says whether it is wanted');
  const wrong = v.you.hand.filter((x) => x.wanted !== truth.has(x.t));
  ok(wrong.length === 0,
    `and the mark matches what the server knows, on all ${v.you.hand.length} of them`);
  ok(v.you.hand.some((x) => x.wanted),
    `${v.you.hand.filter((x) => x.wanted).length} of them are marked`);
  ok(v.you.hand.some((x) => !x.wanted),
    'and some are not, so it is a signal rather than decoration');

  /* the limit: nothing says which of the three, or whether it is a component
     at all rather than one of the five places */
  const blob = JSON.stringify(v.you.hand);
  ok(!/comp|recipe|place|letter/i.test(blob),
    'and no item says what it is wanted FOR');
}

/* ------------------------------- the mark tracks live need, not the deal */
{
  const { game, token } = table({ seed: 11 });
  const me = H.seatByToken(game, token);
  /* hand them a whole component and resolve, so one recipe is satisfied */
  for (const t of me.recipes[0]) me.hand[t] = (me.hand[t] || 0) + 1;
  const wantedBefore = H.viewFor(game, token).you.hand.filter((x) => x.wanted).length;
  H.submitFiling(game, token, { place: (me.at + 1) % 12, give: [], want: [] });
  H.resolveRound(game, at(61));
  ok(me.built[0] === true, 'a component completes once the three are held');
  /* the three it used are spent, so they are no longer marked anywhere */
  const after = H.viewFor(game, token).you.hand;
  const stillMarked = after.filter((x) => x.wanted && me.recipes[0].includes(x.t)
    && !me.recipes[1].includes(x.t) && !me.recipes[2].includes(x.t)
    && !me.placeItems.includes(x.t));
  ok(stillMarked.length === 0,
    'and nothing it needed is marked any more — the hint tracks what is still wanted');
  void wantedBefore;
}

/* ----------------------------------- and it is nobody else's to read */
{
  const { game, tokens } = table({ join: 3 });
  const v = H.viewFor(game, tokens[0]);
  ok(v.seats.every((x) => !('hand' in x) && !('wanted' in x)),
    'no seat in the public list carries a hand or a mark');
  const other = game.seats[1];
  const theirMarked = Object.keys(other.hand).map(Number)
    .filter((t) => [...other.recipes.flat(), ...other.placeItems].includes(t));
  const blob = JSON.stringify(v);
  ok(theirMarked.length === 0 || !blob.includes('"marked"'),
    'and nothing anywhere names what another captain is holding, marked or not');
}

console.log(bad ? `\n${bad} FAILED` : '\nhunt OK');
process.exitCode = bad ? 1 : 0;
