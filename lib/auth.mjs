/* Who is making this request.

   The browser sends a Supabase access token; the server asks Supabase whether it
   is real. That is a network call per authenticated request, and it is worth it:
   verifying the JWT locally means holding the signing secret in the function and
   getting the validation right by hand, and getting it subtly wrong is the kind
   of mistake that is invisible until it matters.

   Nothing here trusts a user id sent by the client. */

import { createClient } from '@supabase/supabase-js';

let _service = null;
let _anon = null;

/* The Supabase client builds a realtime connection as it is constructed, and
   looks for a global WebSocket to do it with. Node did not have one until 22, so
   on anything older the constructor throws before this server has done anything
   at all — and because that happens during module import, the function dies
   before any handler runs and every route returns a bare 502 with no body. It
   cost an evening to read that backwards.

   We do not use realtime; nothing here subscribes to anything. So the client is
   given a transport that would refuse to dial if it were ever asked, which
   satisfies the constructor and makes this server independent of which Node the
   host happens to give it. netlify.toml also pins 22 — this is the belt to that
   pair of braces, because an environment variable set in a dashboard can quietly
   override a file in a repository. */
class UnusedRealtimeTransport {
  constructor() {
    throw new Error('This server does not use Supabase realtime.');
  }
}

const CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: UnusedRealtimeTransport },
};

export function serviceClient() {
  if (_service) return _service;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase is not configured on the server.');
  _service = createClient(url, key, CLIENT_OPTIONS);
  return _service;
}

function anonClient() {
  if (_anon) return _anon;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase is not configured on the server.');
  _anon = createClient(url, key, CLIENT_OPTIONS);
  return _anon;
}

export const bearer = (req) => {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
};

/* Returns { id, email } or null. Never throws for a merely-absent token: plenty
   of the API is readable signed out, and only the paid paths care. */
export async function userFrom(req, verifier) {
  const token = bearer(req);
  if (!token) return null;
  try {
    const verify = verifier || ((t) => anonClient().auth.getUser(t));
    const { data, error } = await verify(token);
    if (error || !data || !data.user) return null;
    return { id: data.user.id, email: data.user.email || null };
  } catch {
    return null;
  }
}

/* A signed-in user, with their profile row guaranteed to exist. The trigger in
   schema.sql normally creates it; this covers accounts that predate the trigger
   or were made another way. */
export async function requireUser(req, db, verifier) {
  const user = await userFrom(req, verifier);
  if (!user) throw new Error('Please sign in.');
  await db.ensureProfile(user.id, user.email);
  return user;
}
