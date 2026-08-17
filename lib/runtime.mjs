/* Where the functions get their database and their token verifier.

   Both are overridable through globals so the tests can run the real handlers
   against an in-memory database and a fake verifier. It is the same trick the
   blob-backed version used, and it is what makes "the API is tested" mean the
   actual routing and error codes rather than a reimplementation of them. */

import { supabaseDb } from './db.mjs';
import { serviceClient } from './auth.mjs';

let _db = null;

export function getDb() {
  if (globalThis.__CEO_DB__) return globalThis.__CEO_DB__;
  if (!_db) _db = supabaseDb(serviceClient());
  return _db;
}

/* Undefined means "ask Supabase"; tests supply their own. */
export const getVerifier = () => globalThis.__CEO_VERIFY__ || undefined;

/* Whether this server can actually store anything. Reported on /api/config so
   the page can say "not set up yet" instead of letting every button fail with an
   error nobody can act on — the deploy succeeds whether or not the environment
   variables were filled in, so the only place this can surface is here. */
export const serverReady = () => !!(globalThis.__CEO_DB__
  || (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY));

/* Public configuration the browser legitimately needs to sign in. The anon key
   is designed to be published — row-level security is what protects the data,
   not the secrecy of this string. */
export const publicAuthConfig = () => ({
  url: process.env.SUPABASE_URL || null,
  anonKey: process.env.SUPABASE_ANON_KEY || null,
  enabled: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
});
