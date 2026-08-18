/* Storage.

   Two implementations behind one interface: Supabase for production, and an
   in-memory one for tests. The in-memory version enforces the SAME unique
   constraint on company names that Postgres does, and raises the same shape of
   error — otherwise the race test below would prove nothing, which is the usual
   way a "we tested it" claim turns out to be worthless. */

export class UniqueViolation extends Error {
  constructor(what) {
    super(`${what} is already taken.`);
    this.code = '23505';                 // the Postgres SQLSTATE, so both agree
    this.name = 'UniqueViolation';
  }
}

/* Somebody else wrote this game between our reading it and our writing it.

   This exists because the alternative was silent. A game is one JSON document,
   so a write is read-modify-write, and five players filing in the same second
   produced five reads of the same state and five writes of which four vanished —
   every one of them answered with 200 OK. Measured: five submissions sent, one
   recorded.

   The README had said, of Netlify Blobs, "no compare-and-swap, so two players
   filing in the same second could overwrite one another; moving to Postgres is
   the fix". Postgres happened and the fix did not. Now every write carries the
   version it was read at, a stale write is refused rather than applied, and
   mutateGame() re-reads and tries again. Losing an order is now impossible;
   the worst case is a retry. */
export class Conflict extends Error {
  constructor(code) {
    super(`That game changed while you were writing to it (${code}).`);
    this.name = 'Conflict';
    this.conflict = true;
  }
}

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

/* ------------------------------------------------------------- in memory */
export function memoryDb() {
  const profiles = new Map();
  const companies = new Map();          // id -> row
  const byName = new Map();             // normalised name -> id   (the index)
  const entitlements = new Map();       // id -> row
  const byOwnerKind = new Map();
  const byEvent = new Map();
  const games = new Map();
  const ratings = new Map();
  const cohorts = new Map();
  const cohortByCode = new Map();
  const botKeys = new Map();            // hashed key -> owner
  const talent = new Map();             // owner -> opt-in row
  const results = [];
  const scored = new Set();
  let seq = 0;
  const id = () => `id_${++seq}`;

  return {
    kind: 'memory',

    async ensureProfile(userId, email) {
      if (!profiles.has(userId)) profiles.set(userId, { id: userId, email, created_at: new Date().toISOString() });
      return profiles.get(userId);
    },

    async companyByName(name) {
      const hit = byName.get(norm(name));
      return hit ? { ...companies.get(hit) } : null;
    },

    async companiesOf(owner) {
      return [...companies.values()].filter((c) => c.owner === owner).map((c) => ({ ...c }));
    },

    /* Insert-or-fail, exactly like the unique index. */
    async holdName(owner, name, expiresAt) {
      const key = norm(name);
      const existing = byName.get(key);
      if (existing) {
        const row = companies.get(existing);
        /* an expired hold is not a hold */
        const dead = row.status === 'pending' && row.expires_at && Date.parse(row.expires_at) < Date.now();
        if (!dead) throw new UniqueViolation(name);
        companies.delete(existing);
        byName.delete(key);
      }
      const row = { id: id(), owner, name, status: 'pending',
                    expires_at: expiresAt, created_at: new Date().toISOString() };
      companies.set(row.id, row);
      byName.set(key, row.id);
      return { ...row };
    },

    async activateCompany(companyId) {
      const row = companies.get(companyId);
      if (!row) return null;
      row.status = 'active';
      row.expires_at = null;
      return { ...row };
    },

    async releaseCompany(companyId) {
      const row = companies.get(companyId);
      if (!row) return;
      companies.delete(companyId);
      byName.delete(norm(row.name));
    },

    async releaseExpiredHolds(now) {
      let freed = 0;
      for (const row of [...companies.values()]) {
        if (row.status === 'pending' && row.expires_at && Date.parse(row.expires_at) < Date.parse(now)) {
          companies.delete(row.id); byName.delete(norm(row.name)); freed += 1;
        }
      }
      return freed;
    },

    async entitlementsOf(owner) {
      return [...entitlements.values()].filter((e) => e.owner === owner).map((e) => ({ ...e }));
    },

    /* Unique on (owner, kind) and on stripe_event: a webhook delivered three
       times grants once, and a customer who pays twice is not double-granted. */
    async grantEntitlement(owner, kind, stripeEvent, stripeRef) {
      if (stripeEvent && byEvent.has(stripeEvent)) return { ...entitlements.get(byEvent.get(stripeEvent)), replayed: true };
      const ok = `${owner}::${kind}`;
      if (byOwnerKind.has(ok)) return { ...entitlements.get(byOwnerKind.get(ok)), already: true };
      const row = { id: id(), owner, kind, stripe_event: stripeEvent || null,
                    stripe_ref: stripeRef || null, created_at: new Date().toISOString() };
      entitlements.set(row.id, row);
      byOwnerKind.set(ok, row.id);
      if (stripeEvent) byEvent.set(stripeEvent, row.id);
      return { ...row };
    },

    /* The version travels with the game rather than inside it, so the document
       and the row can never disagree about which one it is. */
    async getGame(code) {
      const row = games.get(String(code).toUpperCase());
      if (!row) return null;
      const g = JSON.parse(row.state);
      g._rev = row.version;
      return g;
    },

    async putGame(game, host) {
      const prev = games.get(game.code);
      if (prev && game._rev !== undefined && prev.version !== game._rev) {
        throw new Conflict(game.code);
      }
      const version = (prev ? prev.version : 0) + 1;
      /* `_rev` is the row's write-version and is deliberately NOT the game's own
         `version`, which is the document schema number and belongs in the state. */
      const { _rev: _drop, ...doc } = game;
      games.set(game.code, {
        code: game.code, status: game.status, version,
        deadline: (game.status === 'lobby' ? game.lobbyDeadline : game.deadline) || null,
        is_public: !!game.isPublic,
        league: game.league || (prev && prev.league) || null,
        owner: game.leagueOwner || (prev && prev.owner) || null,
        created_at: (prev && prev.created_at) || game.createdAt || new Date().toISOString(),
        cohort_id: game.cohortId || (prev && prev.cohort_id) || null,
        group_no: game.groupNo || (prev && prev.group_no) || null,
        host: host || (prev && prev.host) || null,
        state: JSON.stringify(doc),
      });
      game._rev = version;
      return version;
    },

    async dueGames(now, limit = 200) {
      const out = [];
      for (const row of games.values()) {
        if (row.status !== 'playing' || !row.deadline) continue;
        if (Date.parse(row.deadline) <= Date.parse(now)) {
          out.push(Object.assign(JSON.parse(row.state), { _rev: row.version }));
        }
        if (out.length >= limit) break;
      }
      return out;
    },

    async openPublicGame() {
      for (const row of games.values()) {
        if (row.is_public && row.status === 'lobby') {
          return Object.assign(JSON.parse(row.state), { _rev: row.version });
        }
      }
      return null;
    },

    async dueLobbies(now, limit = 50) {
      const out = [];
      for (const row of games.values()) {
        if (row.status !== 'lobby' || !row.deadline) continue;
        if (Date.parse(row.deadline) <= Date.parse(now)) {
          out.push(Object.assign(JSON.parse(row.state), { _rev: row.version }));
        }
        if (out.length >= limit) break;
      }
      return out;
    },

    async ratingsFor(companyIds) {
      const out = {};
      for (const id of companyIds) if (ratings.has(id)) out[id] = { ...ratings.get(id) };
      return out;
    },

    /* Unique on (game, name) — a finished game cannot be scored twice. */
    async saveResults(gameCode, rows, at) {
      if (scored.has(gameCode)) throw new UniqueViolation(`results for ${gameCode}`);
      scored.add(gameCode);
      const when = at || new Date().toISOString();
      for (const r of rows) results.push({ ...r, game_code: gameCode, created_at: when });
      return rows.length;
    },

    /* Everything finished recently, which is all a decaying board can use. */
    async recentResults(since, limit = 2000) {
      return results
        .filter((r) => r.company_id && !r.league
                       && Date.parse(r.created_at) >= Date.parse(since))
        .slice(-limit)
        .map((r) => ({ ...r }));
    },

    async bumpRating(companyId, { rating, won, value }) {
      const cur = ratings.get(companyId) || { company_id: companyId, rating: 1500, games: 0, wins: 0, best_value: null };
      cur.rating = rating;
      cur.games += 1;
      if (won) cur.wins += 1;
      if (value != null && (cur.best_value == null || value > cur.best_value)) cur.best_value = value;
      ratings.set(companyId, cur);
      return { ...cur };
    },

    async leaderboard(limit = 50) {
      const named = [...ratings.values()].map((r) => ({
        ...r, name: (companies.get(r.company_id) || {}).name || '—',
      }));
      return named.sort((a, b) => b.rating - a.rating || b.games - a.games).slice(0, limit);
    },

    async recordFor(companyId, limit = 10) {
      return results.filter((r) => r.company_id === companyId)
        .slice(-limit).reverse();
    },

    async createCohort(row) {
      const key = norm(row.join_code);
      if (cohortByCode.has(key)) throw new UniqueViolation(row.join_code);
      const full = { id: id(), status: 'open', created_at: new Date().toISOString(), ...row };
      cohorts.set(full.id, full);
      cohortByCode.set(key, full.id);
      return { ...full };
    },

    async cohortByJoinCode(codeIn) {
      const hit = cohortByCode.get(norm(codeIn));
      return hit ? { ...cohorts.get(hit) } : null;
    },

    async cohort(cohortId) {
      return cohorts.has(cohortId) ? { ...cohorts.get(cohortId) } : null;
    },

    async cohortsOf(facilitator) {
      return [...cohorts.values()].filter((c) => c.facilitator === facilitator)
        .map((c) => ({ ...c })).reverse();
    },

    async updateCohort(cohortId, patch) {
      const row = cohorts.get(cohortId);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },

    async gamesOfCohort(cohortId) {
      return [...games.values()].filter((g) => g.cohort_id === cohortId)
        .map((g) => Object.assign(JSON.parse(g.state), { _rev: g.version }));
    },

    /* Seating a class, without forty students racing each other.

       Each student takes a number, atomically, and their group follows from it.
       Before this, every join read the list of groups, saw no room, and opened a
       new one — forty students pressing the button together produced forty groups
       of one, which is the whole product failing at the only moment that matters. */
    async takeCohortSeat(cohortId) {
      const row = cohorts.get(cohortId);
      if (!row) throw new Error('No such class.');
      row.seats_taken = (row.seats_taken || 0) + 1;
      return row.seats_taken;
    },

    /* Create the game for one group exactly once, however many students arrive
       for it at the same instant. */
    async ensureCohortGame(cohortId, groupNo, make) {
      for (const row of games.values()) {
        if (row.cohort_id === cohortId && row.group_no === groupNo) {
          return Object.assign(JSON.parse(row.state), { _rev: row.version });
        }
      }
      const made = make();
      made.groupNo = groupNo;
      await this.putGame(made);
      return made;
    },

    /* One key per account, stored hashed. Replacing a key revokes the old one,
       which is the only revocation anybody actually needs. */
    async putBotKey(owner, hashed) {
      for (const [h, o] of botKeys) if (o === owner) botKeys.delete(h);
      botKeys.set(hashed, owner);
      return true;
    },

    async botKeyOwner(hashed) {
      return botKeys.get(hashed) || null;
    },

    async openLeagueGame() {
      for (const row of games.values()) {
        if (row.league === 'bot' && row.status === 'lobby') {
          return Object.assign(JSON.parse(row.state), { _rev: row.version });
        }
      }
      return null;
    },

    async leagueGamesSince(owner, since) {
      let n = 0;
      for (const row of games.values()) {
        if (row.league !== 'bot' || row.owner !== owner) continue;
        if (Date.parse(row.created_at || 0) >= Date.parse(since)) n += 1;
      }
      return n;
    },

    async leagueResults(limit = 4000) {
      return results.filter((r) => r.league === 'bot').slice(-limit).map((r) => ({ ...r }));
    },

    /* Demo classes are throwaway: a stranger opens one, pushes it around for ten
       minutes and never comes back. Left alone they would accumulate forever, so
       they carry an expiry and the sweeper deletes them and their games. */
    /* Being findable by somebody hiring. A row exists only because the player
       pressed a button; revoking sets a date rather than deleting it, so "did
       they ever consent, and when" stays answerable. */
    async putTalentOptIn(owner, row) {
      talent.set(owner, { owner, ...row });
      return true;
    },

    async revokeTalentOptIn(owner, at) {
      const cur = talent.get(owner);
      if (cur) cur.revoked_at = at;
      return true;
    },

    async talentOptIn(owner) {
      const r = talent.get(owner);
      return r ? { ...r } : null;
    },

    /* Everyone who asked to be listed and is an adult. Whether they have played
       enough to be shown is decided in lib/talent.mjs, from their results. */
    async liveTalentOptIns(limit = 2000) {
      return [...talent.values()]
        .filter((r) => !r.revoked_at && r.adult)
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },

    /* Every result one company has, newest first — the raw material of a
       profile, and of the record the player is shown about themselves. */
    async resultsForCompany(companyId, limit = 200) {
      return results
        .filter((r) => r.company_id === companyId && !r.league)
        .slice(-limit)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .map((r) => ({ ...r }));
    },

    /* Every rated result there has ever been, for the learning measurement.
       Only the four fields it needs — this is the one query that reads the whole
       table, so it should read as little of it as possible. */
    async resultsForLearning(limit = 20000) {
      return results
        .filter((r) => r.company_id && !r.league)
        .slice(-limit)
        .map((r) => ({ company_id: r.company_id, value: r.value,
                       place: r.place, seats: r.seats, created_at: r.created_at }));
    },

    async purgeExpiredDemos(now) {
      let gone = 0;
      for (const c of [...cohorts.values()]) {
        if (!c.is_demo || !c.expires_at) continue;
        if (Date.parse(c.expires_at) >= Date.parse(now)) continue;
        for (const [code, row] of [...games.entries()]) {
          if (row.cohort_id === c.id) games.delete(code);
        }
        cohorts.delete(c.id);
        cohortByCode.delete(norm(c.join_code));
        gone += 1;
      }
      return gone;
    },

    /* test helpers */
    _counts: () => ({ companies: companies.size, entitlements: entitlements.size,
                      games: games.size, results: results.length, ratings: ratings.size }),
  };
}

/* ------------------------------------------------------------- supabase */
/* Uses the service role key, so this must only ever run inside a function. */
export function supabaseDb(client) {
  const rows = (r) => { if (r.error) throw translate(r.error); return r.data; };
  const one = (r) => {
    if (r.error && r.error.code === 'PGRST116') return null;   // no rows
    if (r.error) throw translate(r.error);
    return r.data;
  };
  const translate = (e) => (e.code === '23505' ? new UniqueViolation('That name') : new Error(e.message || 'database error'));

  return {
    kind: 'supabase',

    async ensureProfile(userId, email) {
      return one(await client.from('profiles')
        .upsert({ id: userId, email }, { onConflict: 'id' }).select().maybeSingle());
    },

    async companyByName(name) {
      return one(await client.from('companies').select('*').ilike('name', name).maybeSingle());
    },

    async companiesOf(owner) {
      return rows(await client.from('companies').select('*').eq('owner', owner)) || [];
    },

    async holdName(owner, name, expiresAt) {
      /* Clear our own expired hold first so a user who abandoned checkout can
         retry the same name. Anyone else's live hold still blocks, by the index. */
      await client.from('companies').delete()
        .eq('status', 'pending').ilike('name', name).lt('expires_at', new Date().toISOString());
      return one(await client.from('companies')
        .insert({ owner, name, status: 'pending', expires_at: expiresAt })
        .select().single());
    },

    async activateCompany(companyId) {
      return one(await client.from('companies')
        .update({ status: 'active', expires_at: null }).eq('id', companyId).select().single());
    },

    async releaseCompany(companyId) {
      await client.from('companies').delete().eq('id', companyId);
    },

    async releaseExpiredHolds() {
      const r = await client.rpc('release_expired_holds');
      return r.error ? 0 : r.data;
    },

    async entitlementsOf(owner) {
      return rows(await client.from('entitlements').select('*').eq('owner', owner)) || [];
    },

    async grantEntitlement(owner, kind, stripeEvent, stripeRef) {
      try {
        return one(await client.from('entitlements')
          .insert({ owner, kind, stripe_event: stripeEvent, stripe_ref: stripeRef })
          .select().single());
      } catch (e) {
        /* Either this event was already processed or the account already has it.
           Both mean "nothing to do", which is what idempotent should feel like. */
        if (e instanceof UniqueViolation || e.code === '23505') {
          const have = await this.entitlementsOf(owner);
          return { ...(have.find((x) => x.kind === kind) || {}), already: true };
        }
        throw e;
      }
    },

    async getGame(code) {
      const row = one(await client.from('games').select('state, version')
        .eq('code', String(code).toUpperCase()).maybeSingle());
      if (!row) return null;
      return Object.assign(row.state, { _rev: row.version });
    },

    /* A conditional write. `where version = the version we read` is the whole
       mechanism: if anyone else has written since, no row matches, nothing is
       overwritten, and the caller is told rather than quietly losing the work. */
    async putGame(game, host) {
      const { _rev: rev, ...doc } = game;
      const patch = {
        code: game.code, status: game.status,
        deadline: (game.status === 'lobby' ? game.lobbyDeadline : game.deadline) || null,
        is_public: !!game.isPublic,
        cohort_id: game.cohortId || null,
        group_no: game.groupNo || null,
        league: game.league || null,
        state: doc, updated_at: new Date().toISOString(),
      };
      if (host) patch.host = host;

      if (rev === undefined) {
        patch.version = 1;
        const r = await client.from('games').insert(patch).select('version').single();
        if (r.error) throw translate(r.error);
        game._rev = 1;
        return 1;
      }
      const r = await client.from('games')
        .update({ ...patch, version: rev + 1 })
        .eq('code', game.code).eq('version', rev)
        .select('version');
      if (r.error) throw translate(r.error);
      if (!r.data || !r.data.length) throw new Conflict(game.code);
      game._rev = rev + 1;
      return rev + 1;
    },

    /* One indexed question, however many games exist. The blob backend needed a
       whole marker scheme to approximate this; here it is a where clause. */
    async dueGames(now, limit = 200) {
      const data = rows(await client.from('games').select('state, version')
        .eq('status', 'playing').lte('deadline', now).limit(limit));
      return (data || []).map((r) => Object.assign(r.state, { _rev: r.version }));
    },

    async openPublicGame() {
      const row = one(await client.from('games').select('state, version')
        .eq('is_public', true).eq('status', 'lobby')
        .order('created_at', { ascending: true }).limit(1).maybeSingle());
      return row ? Object.assign(row.state, { _rev: row.version }) : null;
    },

    async dueLobbies(now, limit = 50) {
      const data = rows(await client.from('games').select('state, version')
        .eq('status', 'lobby').lte('deadline', now).limit(limit));
      return (data || []).map((r) => Object.assign(r.state, { _rev: r.version }));
    },

    async ratingsFor(companyIds) {
      if (!companyIds.length) return {};
      const data = rows(await client.from('ratings').select('*').in('company_id', companyIds));
      return Object.fromEntries((data || []).map((r) => [r.company_id, r]));
    },

    async saveResults(gameCode, resultRows, at) {
      const r = await client.from('results')
        .insert(resultRows.map((x) => ({ ...x, game_code: gameCode,
          ...(at ? { created_at: at } : {}) })));
      if (r.error) throw translate(r.error);
      return resultRows.length;
    },

    /* One indexed range scan. The board only ever looks at a couple of days,
       because anything older has decayed to nothing anyway. */
    async recentResults(since, limit = 2000) {
      return rows(await client.from('results')
        .select('company_id, name, value, place, seats, created_at')
        .not('company_id', 'is', null)
        .is('league', null)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(limit)) || [];
    },

    async bumpRating(companyId, { rating, won, value }) {
      const existing = one(await client.from('ratings').select('*')
        .eq('company_id', companyId).maybeSingle());
      const next = {
        company_id: companyId,
        rating,
        games: (existing ? existing.games : 0) + 1,
        wins: (existing ? existing.wins : 0) + (won ? 1 : 0),
        best_value: existing && existing.best_value != null && value != null
          ? Math.max(Number(existing.best_value), value)
          : (value != null ? value : (existing ? existing.best_value : null)),
        updated_at: new Date().toISOString(),
      };
      return one(await client.from('ratings').upsert(next, { onConflict: 'company_id' })
        .select().single());
    },

    async leaderboard(limit = 50) {
      const data = rows(await client.from('ratings')
        .select('*, companies(name)')
        .order('rating', { ascending: false }).order('games', { ascending: false })
        .limit(limit));
      return (data || []).map((r) => ({ ...r, name: (r.companies && r.companies.name) || '—' }));
    },

    async recordFor(companyId, limit = 10) {
      return rows(await client.from('results').select('*')
        .eq('company_id', companyId).order('created_at', { ascending: false })
        .limit(limit)) || [];
    },

    async createCohort(row) {
      return one(await client.from('cohorts').insert(row).select().single());
    },

    async cohortByJoinCode(codeIn) {
      return one(await client.from('cohorts').select('*')
        .ilike('join_code', codeIn).maybeSingle());
    },

    async cohort(cohortId) {
      return one(await client.from('cohorts').select('*').eq('id', cohortId).maybeSingle());
    },

    async cohortsOf(facilitator) {
      return rows(await client.from('cohorts').select('*')
        .eq('facilitator', facilitator).order('created_at', { ascending: false })) || [];
    },

    async updateCohort(cohortId, patch) {
      return one(await client.from('cohorts').update(patch).eq('id', cohortId).select().single());
    },

    async gamesOfCohort(cohortId) {
      const data = rows(await client.from('games').select('state, version')
        .eq('cohort_id', cohortId));
      return (data || []).map((r) => Object.assign(r.state, { _rev: r.version }));
    },

    /* One statement, so forty simultaneous students get forty different numbers.
       The RPC is `update cohorts set seats_taken = seats_taken + 1 ... returning`,
       which Postgres does atomically; doing it as select-then-update in JS is
       exactly the race this replaces. */
    async takeCohortSeat(cohortId) {
      const r = await client.rpc('take_cohort_seat', { c_id: cohortId });
      if (r.error) throw translate(r.error);
      return r.data;
    },

    /* Unique on (cohort_id, group_no), so two students opening group 3 at the
       same moment produce one group 3. The loser reads the winner's row. */
    async ensureCohortGame(cohortId, groupNo, make) {
      const find = async () => one(await client.from('games').select('state, version')
        .eq('cohort_id', cohortId).eq('group_no', groupNo).maybeSingle());
      const existing = await find();
      if (existing) return Object.assign(existing.state, { _rev: existing.version });
      const made = make();
      made.groupNo = groupNo;
      try {
        await this.putGame(made);
        return made;
      } catch (e) {
        if (!(e instanceof UniqueViolation || e.code === '23505')) throw e;
        const won = await find();
        return Object.assign(won.state, { _rev: won.version });
      }
    },

    /* games.cohort_id is `on delete cascade`, so removing the cohort takes its
       games with it — the demo leaves nothing behind. */
    async putBotKey(owner, hashed) {
      await client.from('bot_keys').delete().eq('owner', owner);
      const r = await client.from('bot_keys').insert({ owner, key_hash: hashed });
      if (r.error) throw translate(r.error);
      return true;
    },

    async botKeyOwner(hashed) {
      const row = one(await client.from('bot_keys').select('owner')
        .eq('key_hash', hashed).maybeSingle());
      return row ? row.owner : null;
    },

    async openLeagueGame() {
      const row = one(await client.from('games').select('state, version')
        .eq('league', 'bot').eq('status', 'lobby')
        .order('created_at', { ascending: true }).limit(1).maybeSingle());
      return row ? Object.assign(row.state, { _rev: row.version }) : null;
    },

    async leagueGamesSince(owner, since) {
      const r = await client.from('games')
        .select('code', { count: 'exact', head: true })
        .eq('league', 'bot').eq('host', owner).gte('created_at', since);
      if (r.error) throw translate(r.error);
      return r.count || 0;
    },

    async leagueResults(limit = 4000) {
      return rows(await client.from('results')
        .select('company_id, name, value, place, seats, created_at')
        .eq('league', 'bot')
        .order('created_at', { ascending: false }).limit(limit)) || [];
    },

    async putTalentOptIn(owner, row) {
      const r = await client.from('talent_optin')
        .upsert({ owner, ...row }, { onConflict: 'owner' });
      if (r.error) throw translate(r.error);
      return true;
    },

    async revokeTalentOptIn(owner, at) {
      const r = await client.from('talent_optin')
        .update({ revoked_at: at }).eq('owner', owner);
      if (r.error) throw translate(r.error);
      return true;
    },

    async talentOptIn(owner) {
      return one(await client.from('talent_optin').select('*')
        .eq('owner', owner).maybeSingle());
    },

    async liveTalentOptIns(limit = 2000) {
      return rows(await client.from('talent_optin').select('*')
        .is('revoked_at', null).eq('adult', true)
        .order('opted_at', { ascending: false }).limit(limit)) || [];
    },

    async resultsForCompany(companyId, limit = 200) {
      return rows(await client.from('results')
        .select('company_id, name, value, place, seats, created_at, traits, rating_delta')
        .eq('company_id', companyId).is('league', null)
        .order('created_at', { ascending: false }).limit(limit)) || [];
    },

    async resultsForLearning(limit = 20000) {
      return rows(await client.from('results')
        .select('company_id, value, place, seats, created_at')
        .not('company_id', 'is', null).is('league', null)
        .order('created_at', { ascending: true }).limit(limit)) || [];
    },

    async purgeExpiredDemos(now) {
      const data = rows(await client.from('cohorts').delete()
        .eq('is_demo', true).lt('expires_at', now).select('id'));
      return (data || []).length;
    },
  };
}
