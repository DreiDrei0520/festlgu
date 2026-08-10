# FestivaLGU

A festival tourism web app for the FestivaLGU project (original design: Figma `festlgu`). Built with React + Vite + Tailwind CSS v4 + Supabase.

## Getting started

```bash
npm i
npm run dev
```

## Environment variables

Create a `.env` file at the project root:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Both values come from your Supabase project (Settings → API). The app falls back to built-in demo data and shows errors if these are missing, but auth and all live features require them.

## Database setup

Open `supabase-schema.sql` in the Supabase SQL editor and run it once. It creates all tables, RLS policies, seed data, and demo auth users. See the SQL editor output for the demo account passwords, or reset them via Supabase Auth → Users.

Demo accounts seeded in `profiles`:

| Role       | Email                  |
| ---------- | ---------------------- |
| admin      | admin@festivalglu.ph   |
| organizer  | organizer@festivalglu.ph |
| msme       | msme@festivalglu.ph    |
| msme       | msme2@festivalglu.ph   |
| msme       | msme3@festivalglu.ph   |
| tourist    | tourist@festivalglu.ph |
| tourist    | ana@festivalglu.ph     |
| tourist    | jose@festivalglu.ph    |
| tourist    | lina@festivalglu.ph    |

## Deployment (Vercel)

1. Push this repo to GitHub and import it in Vercel.
2. Add the two env vars above in Project → Settings → Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Framework preset: Vite. Build command `npm run build`, output `dist`.
   These are already set in `vercel.json`, and `engines.node` / `.nvmrc` require
   **Node 22+** — make sure Project → Settings → General → Node.js Version is **22.x**.
4. Deploy.

## Scripts

```bash
npm run dev     # start dev server
npm run build   # production build (vite build)
npm run start   # vite (preview)
```
