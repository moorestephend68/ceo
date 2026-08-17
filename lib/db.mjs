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

    async getGame(code) {
      const row = games.get(String(code).toUpperCase());
      return row ? JSON.parse(row.state) : null;
    },

    async putGame(game, host) {
      const prev = games.get(game.code) || {};
      games.set(game.code, {
        code: game.code, status: game.status,
        deadline: (game.status === 'lobby' ? game.lobbyDeadline : game.deadline) || null,
        is_public: !!game.isPublic,
        host: host || prev.host || null,
        state: JSON.stringify(game),
      });
    },

    async dueGames(now, limit = 200) {
      const out = [];
      for (const row of games.values()) {
        if (row.status !== 'playing' || !row.deadline) continue;
        if (Date.parse(row.deadline) <= Date.parse(now)) out.push(JSON.parse(row.state));
        if (out.length >= limit) break;
      }
      return out;
    },

    async openPublicGame() {
      for (const row of games.values()) {
        if (row.is_public && row.status === 'lobby') return JSON.parse(row.state);
      }
      return null;
    },

    async dueLobbies(now, limit = 50) {
      const out = [];
      for (const row of games.values()) {
        if (!row.is_public || row.status !== 'lobby' || !row.deadline) continue;
        if (Date.parse(row.deadline) <= Date.parse(now)) out.push(JSON.parse(row.state));
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
    async saveResults(gameCode, rows) {
      if (scored.has(gameCode)) throw new UniqueViolation(`results for ${gameCode}`);
      scored.add(gameCode);
      for (const r of rows) results.push({ ...r, game_code: gameCode });
      return rows.length;
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
      const row = one(await client.from('games').select('state')
        .eq('code', String(code).toUpperCase()).maybeSingle());
      return row ? row.state : null;
    },

    async putGame(game, host) {
      const patch = {
        code: game.code, status: game.status,
        deadline: (game.status === 'lobby' ? game.lobbyDeadline : game.deadline) || null,
        is_public: !!game.isPublic,
        state: game, updated_at: new Date().toISOString(),
      };
      if (host) patch.host = host;
      const r = await client.from('games').upsert(patch, { onConflict: 'code' });
      if (r.error) throw translate(r.error);
    },

    /* One indexed question, however many games exist. The blob backend needed a
       whole marker scheme to approximate this; here it is a where clause. */
    async dueGames(now, limit = 200) {
      const data = rows(await client.from('games').select('state')
        .eq('status', 'playing').lte('deadline', now).limit(limit));
      return (data || []).map((r) => r.state);
    },

    async openPublicGame() {
      const row = one(await client.from('games').select('state')
        .eq('is_public', true).eq('status', 'lobby')
        .order('created_at', { ascending: true }).limit(1).maybeSingle());
      return row ? row.state : null;
    },

    async dueLobbies(now, limit = 50) {
      const data = rows(await client.from('games').select('state')
        .eq('is_public', true).eq('status', 'lobby').lte('deadline', now).limit(limit));
      return (data || []).map((r) => r.state);
    },

    async ratingsFor(companyIds) {
      if (!companyIds.length) return {};
      const data = rows(await client.from('ratings').select('*').in('company_id', companyIds));
      return Object.fromEntries((data || []).map((r) => [r.company_id, r]));
    },

    async saveResults(gameCode, resultRows) {
      const r = await client.from('results')
        .insert(resultRows.map((x) => ({ ...x, game_code: gameCode })));
      if (r.error) throw translate(r.error);
      return resultRows.length;
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
  };
}
