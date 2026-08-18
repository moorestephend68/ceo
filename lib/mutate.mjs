/* Changing a game safely.

   A game is one JSON document, so every change is read-modify-write, and two of
   those overlapping used to mean one of them vanished. Five players filing in the
   same second — which is what happens near every deadline — produced five reads
   of the same state and five writes, of which four were lost. All five were
   answered 200 OK.

   The fix has two halves. The database refuses a write whose version is stale
   (lib/db.mjs), which turns silent loss into a loud error. This is the other
   half: read, apply, write, and if somebody got there first, read again and
   re-apply to the state they left behind.

   Retrying is only correct because the changes are re-appliable — "record this
   seat's orders", "add this player", "resolve the round if it is due". Each is
   expressed against whatever the game currently is rather than against a
   snapshot, so doing it again on newer state is doing it right. Anything that
   is not safe to repeat does not belong in here. */

const ATTEMPTS = 6;

export class Gone extends Error {
  constructor(code) {
    super(`No game with that code (${code}).`);
    this.name = 'Gone';
    this.missing = true;
  }
}

/* Apply `change` to a game and save it, retrying if somebody else was writing.

   `change(game)` may return a value, which is handed back — useful for the token
   a join produces. Returning `false` means "nothing to write", and the game is
   left alone. */
export async function mutateGame(db, code, change, { host } = {}) {
  let last;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const game = await db.getGame(code);
    if (!game) throw new Gone(code);
    const out = await change(game, attempt);
    if (out === false) return { game, result: undefined, written: false };
    try {
      await db.putGame(game, host);
      return { game, result: out, written: true };
    } catch (e) {
      if (!e || !e.conflict) throw e;
      last = e;
      /* Somebody wrote first. Their version is now the truth; go and get it.
         A tiny stagger stops several retries colliding again in lockstep. */
      await new Promise((r) => setTimeout(r, 8 * (attempt + 1)));
    }
  }
  throw last;
}
