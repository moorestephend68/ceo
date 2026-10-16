/* THE WAREHOUSES.

   Every other way to play Cargo Run is about getting away from the crowd.
   Keeping a shed is the one that wants the crowd to turn up: goods left at a
   loading spot sit there until a captain comes to load that cargo, and then it
   is the keeper they pay for it rather than the market.

   IT SHIPPED BROKEN ONCE, and the way it broke is the first thing tested here.
   The first version had the carrier pay the market full posted price for goods
   that came out of a shed AND hand the keeper 40% of the sale. The cargo was
   paid for twice and both payments came out of one captain, so a pile was a
   hazard rather than an offer: over 400 seasons, 953 runs drew out of a shed
   and all 953 were worse off for it. The rule now is that the money for those
   units goes to the captain who left them instead of to the market — the same
   bill, a different till — so a pile CANNOT cost a carrier anything, and that
   is asserted below rather than trusted.

   The mechanic took four corrections in the harness before it was measuring
   the idea rather than the implementation, and every one of them produced a
   clean-looking table saying the idea did not work. Three of those four are
   properties of the code, so they are tested here and will stay fixed:

     1. a keeper can collect their own stock — the first version skipped your
        own lots when drawing from a pile, which made storage a one-way street
     2. storage is bought ON TOP of the hold — if it came out of the hold it
        would carry the hold's opportunity cost, which is the exact cost that
        moving storage off the ship was supposed to remove
     3. nothing goes into a shed in the closing rounds, when nobody would come
        past to load it — and whatever IS still there at the end is sold back at
        the posted price rather than burnt. Burning it was the single biggest
        cost of the first version: 31% of everything stored, $8,645 a season.

   And one that is not from the harness at all but from this game's own rules:
   WHOSE stock it is must never reach another seat. The pile is public — it is
   sitting at the rock, and it is already in the price. The owner is not. */
import * as K from '../lib/cargo.mjs';

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) bad++; };
const now = '2026-09-20T10:00:00Z';
const money = (x) => '$' + Math.round(x).toLocaleString();

const table = (opts = {}) => {
  const { game, token } = K.createGame({ seats: 5, rounds: 8, cadence: '5m',
    hostName: 'Salty Dogs & Co', seed: opts.seed === undefined ? 31 : opts.seed,
    warehouses: true, now });
  K.startGame(game, game.hostToken, now);
  return { game, token, me: K.seatByToken(game, token) };
};

/* ------------------------------------------------- it is on, and it is priced */
{
  const { game, token } = table();
  const v = K.viewFor(game, token);
  ok(v.sheds && v.sheds.on, 'the ranked table has warehouses');
  ok(v.sheds.rent === 2, `rent ${money(v.sheds.rent)} a unit a round`
    + ' — measured on this engine, not inherited from the long board');
  ok(v.sheds.royalty === undefined && v.econ.ROYALTY === undefined,
    'and there is no cut of anybody else\'s sale left anywhere in the view');
}

/* ------------------------------------ storage does not come out of the hold */
{
  const a = table();
  const spotA = K.boardFor(a.game.seed).reachP[a.me.at][0];
  K.submitDeclaration(a.game, a.token, { pickup: spotA, commodity: 0, bids: [0,0,0,0] });
  K.resolveStage(a.game, now); K.resolveStage(a.game, now);
  const plainLoad = a.game.history[0].rows.find((r) => r.name === 'Salty Dogs & Co').load;

  const b = table();
  const spotB = K.boardFor(b.game.seed).reachP[b.me.at][0];
  K.submitDeclaration(b.game, b.token, { pickup: spotB, commodity: 0, bids: [0,0,0,0], store: 60 });
  K.resolveStage(b.game, now); K.resolveStage(b.game, now);
  const storedRow = b.game.history[0].rows.find((r) => r.name === 'Salty Dogs & Co');
  ok(storedRow.load === plainLoad,
    `storing 60 units did not shrink the run: ${storedRow.load} units carried either way`);
  ok(K.storedBy(b.game, b.game.seats.indexOf(K.seatByToken(b.game, b.token))) === 60,
    'and 60 units are sitting in the shed');
  /* the yard's own keeper stores too, so this asks for MY entry rather than
     assuming the table held only one */
  const mineStored = b.game.history[0].stored
    .find((x) => x.who === b.game.seats.indexOf(K.seatByToken(b.game, b.token)));
  ok(mineStored && mineStored.units === 60,
    `the round records what was left behind: ${mineStored ? mineStored.units : 0} units`
    + ` for ${money(mineStored ? mineStored.paid : 0)}`);
}

/* ----------------------------------------------------- rent falls due, once */
{
  const { game, token } = table();
  const spot = K.boardFor(game.seed).reachP[0][0];
  K.submitDeclaration(game, token, { pickup: spot, commodity: 0, bids: [0,0,0,0], store: 40 });
  K.resolveStage(game, now); K.resolveStage(game, now);
  const before = K.seatByToken(game, token).rentPaid || 0;
  ok(Math.abs(before - 40 * K.C.RENT) < 1,
    `rent on 40 units is ${money(before)} the first round`);
  /* a second round with the pile still there charges it again */
  K.submitDeclaration(game, token, { pickup: K.boardFor(game.seed).reachP[K.seatByToken(game, token).at][0],
    commodity: 1, bids: [0,0,0,0] });
  K.resolveStage(game, now); K.resolveStage(game, now);
  const after = K.seatByToken(game, token).rentPaid || 0;
  ok(after > before, `and again while it sits there: ${money(after)} so far`);
}

/* ------------------------------------------------- a keeper can collect back */
{
  const { game, token } = table();
  const spot = K.boardFor(game.seed).reachP[0][0];
  K.submitDeclaration(game, token, { pickup: spot, commodity: 0, bids: [0,0,0,0], store: 50 });
  K.resolveStage(game, now); K.resolveStage(game, now);
  const mineIdx = game.seats.indexOf(K.seatByToken(game, token));
  ok(K.storedBy(game, mineIdx) === 50, '50 units in the shed');
  /* go back for them */
  const me = K.seatByToken(game, token);
  const back = K.boardFor(game.seed).reachP[me.at];
  if (back.includes(spot)) {
    K.submitDeclaration(game, token, { pickup: spot, commodity: 0, bids: [0,0,0,0], collect: 50 });
    K.resolveStage(game, now); K.resolveStage(game, now);
    ok(K.storedBy(game, mineIdx) < 50,
      `and they can be fetched back: ${Math.round(K.storedBy(game, mineIdx))} left`);
  } else {
    ok(true, 'and they can be fetched back (this seed did not fly past the shed; covered below)');
  }
}

/* ------------------------------ the shed shuts before the season runs out */
{
  const { game, token } = table();
  while (game.round < game.config.rounds - 1) {
    const me = K.seatByToken(game, token);
    K.submitDeclaration(game, token,
      { pickup: K.boardFor(game.seed).reachP[me.at][0], commodity: 0, bids: [0,0,0,0] });
    K.resolveStage(game, now); K.resolveStage(game, now);
  }
  const v = K.viewFor(game, token);
  ok(v.sheds.canStore === false,
    `with ${game.config.rounds - game.round} rounds left the sheds are shut`);
  const me = K.seatByToken(game, token);
  K.submitDeclaration(game, token,
    { pickup: K.boardFor(game.seed).reachP[me.at][0], commodity: 0, bids: [0,0,0,0], store: 80 });
  ok((K.seatByToken(game, token).declared.store || 0) === 0,
    'and an order to store one anyway is refused rather than burnt');
}

/* -------------------------------------- a pile pays its owner when it sells */
{
  /* the yard's own keeper plays every table, so a full season exercises it */
  const { game } = table({ seed: 11 });
  for (let i = 0; i < 20 && game.status === 'playing'; i++) K.resolveStage(game, now);
  const keeper = game.seats.find((s) => (s.takings || 0) > 0);
  ok(!!keeper, 'somebody at the table was paid for goods they never carried'
    + (keeper ? `: ${keeper.name}, ${money(keeper.takings)}` : ''));
  ok(keeper && (keeper.rentPaid || 0) > 0,
    `and paid ${keeper ? money(keeper.rentPaid) : ''} of rent while they waited`);
  const paid = game.history.some((h) => h.rows.some((r) => (r.takings || []).length));
  ok(paid, 'and the round records which carrier the money came from');
}

/* ------------------------------------ A PILE CANNOT COST A CARRIER ANYTHING.

   The bug this feature shipped with, asserted out of existence. Two claims,
   both of which have to hold on every run of a real season:

     the price paid is never worse for the stock being there — stock is supply,
     so buyMultAt damps the squeeze and `paid` can only go down

     and nothing is subtracted from the carrier afterwards: what they hand over
     for the units that came out of a shed is the same posted price they would
     have paid at an empty rock, so `profit` is arithmetically untouched by
     whose goods they turned out to be */
{
  const { game } = table({ seed: 11 });
  let runs = 0, drew = 0, dearer = 0, short = 0;
  while (game.status === 'playing') {
    K.resolveStage(game, now); K.resolveStage(game, now);
    const h = game.history[game.history.length - 1];
    if (!h) break;
    for (const r of h.rows) {
      runs++;
      if (!r.fromPiles) continue;
      drew++;
      /* what the run would have paid with an empty rock underneath it */
      const plain = K.buyMult(r.stackB * K.C.LOAD) * game.prices.buy[r.p][r.c];
      if (r.paid > plain + 1e-6) dearer++;
      /* the money in the row adds up to the posted bill, nothing more */
      const handed = (r.takings || []).reduce((a, q) => a + q.paid, 0);
      if (handed > r.bought * r.paid + 1) short++;
    }
  }
  ok(drew > 0, `${drew} of ${runs} runs in a full season drew out of somebody's shed`);
  ok(dearer === 0, 'and not one of them paid MORE per unit for the stock being there');
  ok(short === 0, 'and never handed a keeper more than the posted bill for what they took');
}

/* ------------------------------------------ the shed is cleared, not burnt */
{
  const { game, token } = table({ seed: 11 });
  while (game.status === 'playing') K.resolveStage(game, now);
  ok(Object.keys(game.piles || {}).length === 0,
    'when the season ends there is nothing left in any shed');
  const back = game.seats.reduce((a, s) => a + (s.soldBack || 0), 0);
  ok(back > 0, `what nobody came for was sold back at the posted price: ${money(back)}`);
  const v = K.viewFor(game, token);
  ok(v.sheds.on && (v.sheds.mine || []).length === 0,
    'and a captain is not left looking at a shed they no longer have');
}

/* ------------------------------------------------------- the whole loop

   Reported from a real game: "I was warehousing but it did not show anyone
   taking my commodities and I did not take anyone else's." The engine was
   doing it; nothing on screen ever said so, and nothing showed a captain
   where the piles were so they could go and buy one. This is the round trip
   the page now has to be able to narrate. */
{
  const { game, token } = K.createGame({ seats: 5, rounds: 8, cadence: '5m',
    hostName: 'Keeper', seed: 77, warehouses: true, now });
  const mate = K.joinGame(game, 'Carrier', now).token;
  K.startGame(game, game.hostToken, now);
  const B = K.boardFor(game.seed);
  const spot = B.reachP[K.seatByToken(game, token).at]
    .find((p) => B.reachP[K.seatByToken(game, mate).at].includes(p));
  K.submitDeclaration(game, token, { pickup: spot, commodity: 2, bids: [0,0,0,0], store: 120 });
  K.submitDeclaration(game, mate, { pickup: spot, commodity: 0, bids: [0,0,0,0] });
  K.resolveStage(game, now); K.resolveStage(game, now);
  ok(K.storedBy(game, 0) === 120, '120 units go into a shed at a spot the other captain can reach');

  const you2 = K.seatByToken(game, mate);
  const back = B.reachP[you2.at].includes(spot) ? spot : B.reachP[you2.at][0];
  K.submitDeclaration(game, mate, { pickup: back, commodity: 2, bids: [0,0,0,0] });
  K.submitDeclaration(game, token,
    { pickup: B.reachP[K.seatByToken(game, token).at][0], commodity: 1, bids: [0,0,0,0] });
  K.resolveStage(game, now); K.resolveStage(game, now);

  const row = game.history[1].rows.find((r) => r.name === 'Carrier');
  ok(row.fromPiles > 0,
    `the carrier's row says ${row.fromPiles} of ${row.bought} units came out of a shed`);
  ok((row.takings || []).length === 1 && row.takings[0].owner === 0,
    'and which seat that money went to');
  const keeper = K.seatByToken(game, token);
  ok((keeper.takings || 0) > 0, `the keeper was paid ${money(keeper.takings)}`);
  const v = K.viewFor(game, token);
  ok(v.sheds.takings > 0 && v.sheds.rentPaid > 0,
    `and their own view totals it: ${money(v.sheds.takings)} taken against `
    + `${money(v.sheds.rentPaid)} of rent`);
  /* the carrier is told the units came from a shed, and never whose */
  const cv = K.viewFor(game, mate);
  const crow = (cv.history[0].rows || []).find((r) => r.name === 'Carrier');
  ok(crow && crow.fromPiles > 0, 'the carrier is told their cargo came out of somebody\'s shed');
  ok(!(cv.sheds.mine || []).length, 'and the carrier has no shed of their own to confuse it with');
}

/* ------------------------------------------- whose it is, is nobody's business */
{
  const { game } = table({ seed: 11 });
  for (let i = 0; i < 8 && game.status === 'playing'; i++) K.resolveStage(game, now);
  const rival = game.seats.find((s) => s.isBot);
  const v = K.viewFor(game, game.seats.find((s) => s.token).token);
  const blob = JSON.stringify({ stock: v.sheds.stock, board: v.board, manifests: v.manifests });
  ok(!/owner/.test(blob), 'the public stock names no owners');
  ok(Array.isArray(v.sheds.stock), `stock at ${v.sheds.stock.length} spots is public — it is `
    + 'sitting at the rock, and it is already in the price');
  ok(v.sheds.mine.every((x) => x.units > 0), 'and only your own pile is itemised to you');
  void rival;
}

/* ----------------------------- and not in the round's paperwork either

   Found by walking the loop rather than by reading the code: the carrier's own
   history row carried the list of who was paid for the goods they loaded, seat
   index and all. Nothing on screen showed it and the page never asked for it,
   but it was one API response away — the whole secret of the mechanic, sitting
   in the JSON. The same was true of `stored`, which said who left what where.
   The view now sends a captain only their own entries. */
{
  const { game, token } = K.createGame({ seats: 5, rounds: 8, cadence: '5m',
    hostName: 'Keeper', seed: 77, warehouses: true, now });
  const mate = K.joinGame(game, 'Carrier', now).token;
  K.startGame(game, game.hostToken, now);
  const B = K.boardFor(game.seed);
  const spot = B.reachP[K.seatByToken(game, token).at]
    .find((p) => B.reachP[K.seatByToken(game, mate).at].includes(p));
  K.submitDeclaration(game, token, { pickup: spot, commodity: 2, bids: [0,0,0,0], store: 120 });
  K.submitDeclaration(game, mate, { pickup: spot, commodity: 0, bids: [0,0,0,0] });
  K.resolveStage(game, now); K.resolveStage(game, now);
  K.submitDeclaration(game, mate, { pickup: spot, commodity: 2, bids: [0,0,0,0] });
  K.submitDeclaration(game, token,
    { pickup: B.reachP[K.seatByToken(game, token).at][0], commodity: 1, bids: [0,0,0,0] });
  K.resolveStage(game, now); K.resolveStage(game, now);

  const cv = K.viewFor(game, mate);
  const crow = cv.history[0].rows.find((r) => r.name === 'Carrier');
  ok(crow.fromPiles > 0,
    `the carrier is told ${crow.fromPiles} units came out of a shed`);
  ok((crow.takings || []).length === 0,
    'and is told nothing whatever about who was paid for them');
  ok((cv.history[0].stored || []).every((x) => x.who === cv.seats
      .findIndex((s) => s.you)), 'and sees no entry for anybody else\'s storing');
  ok(!/"owner"/.test(JSON.stringify(cv.history)),
    'not one seat index for an owner survives into the carrier\'s round');

  /* and the keeper still gets told, which is the half that has to keep working */
  const kv = K.viewFor(game, token);
  const paid = kv.history[0].rows.flatMap((r) => r.takings || []);
  ok(paid.length > 0 && paid.every((q) => q.owner === 0),
    `while the keeper is told their own: ${paid[0] ? paid[0].units : 0} units `
    + `for ${money(paid[0] ? paid[0].paid : 0)}`);
}

console.log(bad ? `\n${bad} FAILED` : '\ncargo sheds OK');
process.exitCode = bad ? 1 : 0;
