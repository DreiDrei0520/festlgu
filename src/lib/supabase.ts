// FestivaLGU — Supabase data layer.
//
// Connects to the live Supabase project via the env vars below. The schema,
// RLS policies, seed data, and demo auth users are defined in
// `supabase-schema.sql` (run once in the Supabase SQL editor).

import { createClient } from "@supabase/supabase-js";
import type { Session, User } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing Supabase config. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env"
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// No-op replacements for the old localStorage reset flow. Real data lives in
// Supabase now; the "Reset Data" button is removed from the login page.
export function resetDb() {
  /* data now lives in Supabase — nothing to reset locally */
}

export const DB_STORE = {
  get: () => null,
  reset: resetDb,
};

export type {
  Profile,
  Festival,
  Event,
  MSME,
  Product,
  Reward,
  Transaction,
  RedeemedReward,
  Feedback,
  Announcement,
  GuideItem,
  UserRole,
  LocalUser,
  LocalSession,
} from "./types";
export type { Session, User };
