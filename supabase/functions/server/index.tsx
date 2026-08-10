import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

const app = new Hono();

app.use('*', logger(console.log));
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

app.get("/make-server-3920817d/health", (c) => {
  return c.json({ status: "ok" });
});

const adminClient = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const DEMO_ACCOUNTS = [
  { email: "admin@festivalglu.ph",     password: "Festival@2025", fullname: "Admin Rivera",   role: "admin"     },
  { email: "organizer@festivalglu.ph", password: "Festival@2025", fullname: "Carlos Mendoza", role: "organizer" },
  { email: "msme@festivalglu.ph",      password: "Festival@2025", fullname: "Elena Cruz",     role: "msme"      },
  { email: "tourist@festivalglu.ph",   password: "Festival@2025", fullname: "Maria Santos",   role: "tourist"   },
];

// Create all 4 demo accounts with email pre-confirmed
app.post("/make-server-3920817d/seed-demo-accounts", async (c) => {
  const supabase = adminClient();
  const results = [];

  for (const acc of DEMO_ACCOUNTS) {
    // Try to find existing user first
    const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users?.find(u => u.email === acc.email);

    if (existing) {
      // Ensure email is confirmed even if it existed before
      await supabase.auth.admin.updateUserById(existing.id, { email_confirm: true });
      // Upsert profile
      await supabase.from("profiles").upsert({
        id: existing.id, fullname: acc.fullname, email: acc.email, role: acc.role,
      });
      results.push({ email: acc.email, status: "already_exists" });
      continue;
    }

    // Create new user with email confirmed
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: acc.email,
      password: acc.password,
      email_confirm: true,
      user_metadata: { fullname: acc.fullname, role: acc.role },
    });

    if (error) {
      results.push({ email: acc.email, status: "error", message: error.message });
      continue;
    }

    if (created.user) {
      await supabase.from("profiles").upsert({
        id: created.user.id, fullname: acc.fullname, email: acc.email, role: acc.role,
      });
    }

    results.push({ email: acc.email, role: acc.role, status: "created" });
  }

  return c.json({ success: true, results });
});

// Confirm emails for any already-created but unconfirmed demo accounts
app.post("/make-server-3920817d/confirm-demo-emails", async (c) => {
  const supabase = adminClient();
  const emails = DEMO_ACCOUNTS.map(a => a.email);
  const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const targets = list?.users?.filter(u => emails.includes(u.email ?? "")) ?? [];

  const results = [];
  for (const user of targets) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, { email_confirm: true });
    // Also ensure profile row has correct role
    const acc = DEMO_ACCOUNTS.find(a => a.email === user.email);
    if (acc) {
      await supabase.from("profiles").upsert({
        id: user.id, fullname: acc.fullname, email: acc.email, role: acc.role,
      });
    }
    results.push({ email: user.email, confirmed: !error });
  }

  return c.json({ success: true, confirmed: results.length, results });
});

Deno.serve(app.fetch);
