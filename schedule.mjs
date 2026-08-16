/* Which games are due, without reading them all.

   The first version of the sweep listed every stored game and loaded each one to
   ask whether its clock had run out. That is fine for a dozen games and fatal for
   a few thousand: measured, it manages roughly 500-2,800 games inside a scheduled
   function's 30-second budget depending on blob latency, and it never gets faster
   because finished games are never removed — a site with 5,000 games played and 10
   running would load all 5,000 every five minutes.

   Instead each running game leaves a tiny marker whose KEY carries its deadline:

       due/2026-09-01T14:35/ABC123

   Listing a prefix returns keys without reading any values, so the sweep does one
   list, compares the timestamps in the key strings, and only loads the handful of
   games that are actually overdue. Ten thousand idle games cost one list call.

   Markers are per-game and independent, so there is no shared index for thousands
   of writers to clobber — which is exactly the trap a single `index/active` blob
   would have been under last-write-wins storage. */

export const DUE = 'due/';
export const DONE = 'done/';

/* Minute resolution: deadlines are never finer than that, and it keeps the key
   short and lexicographically sortable. */
export const markerFor = (code, deadline) =>
  `${DUE}${String(deadline).slice(0, 16)}/${String(code).toUpperCase()}`;

export const doneMarkerFor = (code, when) =>
  `${DONE}${String(when).slice(0, 10)}/${String(code).toUpperCase()}`;

export function parseMarker(key) {
  if (!key.startsWith(DUE)) return null;
  const rest = key.slice(DUE.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  return { at: rest.slice(0, slash), code: rest.slice(slash + 1) };
}

/* Keep a game's marker matching its state. Returns the key now in force, which
   the caller stores on the game so the next move knows what to clean up. */
export async function syncMarker(store, game) {
  const previous = game.marker || null;
  const wanted = game.status === 'playing' && game.deadline
    ? markerFor(game.code, game.deadline)
    : null;
  if (previous === wanted) return wanted;
  if (previous) await store.delete(previous).catch(() => {});
  if (wanted) await store.setJSON(wanted, 1);
  /* A finished game gets dated so it can be cleaned up later without listing
     every game that has ever existed. */
  if (!wanted && game.status === 'over' && !game.doneMarker) {
    game.doneMarker = doneMarkerFor(game.code, game.lastResolvedAt || new Date().toISOString());
    await store.setJSON(game.doneMarker, 1).catch(() => {});
  }
  game.marker = wanted;
  return wanted;
}

/* Every game whose deadline has passed, read from key names alone. */
export async function dueCodes(store, now, limit = 500) {
  const cut = String(now).slice(0, 16);
  const { blobs } = await store.list({ prefix: DUE });
  const out = [];
  for (const b of blobs) {
    const m = parseMarker(b.key);
    if (!m) continue;
    if (m.at <= cut) out.push({ code: m.code, key: b.key });
    if (out.length >= limit) break;
  }
  return out;
}
