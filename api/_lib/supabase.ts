// Server-side Supabase helpers (plain fetch, no SDK). The service-role key
// bypasses RLS, so it must never be sent to the browser or given a VITE_ prefix.

const URL_ = () => (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Validate the caller's access token with Supabase Auth; returns the user id.
export async function authUser(req: any): Promise<{ id: string } | null> {
  const token = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const res = await fetch(`${URL_()}/auth/v1/user`, { headers: { authorization: `Bearer ${token}`, apikey: ANON() } });
  if (!res.ok) return null;
  const u = await res.json();
  return u?.id ? { id: u.id } : null;
}

// PostgREST call as service role. `path` e.g. "support_messages?select=*".
export async function db(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  if (!SERVICE()) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  const res = await fetch(`${URL_()}/rest/v1/${path}`, {
    method: init.method || "GET",
    headers: {
      apikey: SERVICE(),
      authorization: `Bearer ${SERVICE()}`,
      "content-type": "application/json",
      prefer: init.prefer || "return=representation",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) throw new Error(`DB ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
