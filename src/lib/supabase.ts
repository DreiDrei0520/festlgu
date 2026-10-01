// FestivaLGU — Supabase data layer.
//
// Connects to the live Supabase project via the env vars below. The schema,
// RLS policies, seed data, and demo auth users are defined in
// `supabase-schema.sql` (run once in the Supabase SQL editor).

import { createClient } from "@supabase/supabase-js";

// Falls back to placeholder values so the app still renders (with its built-in
// fallback data) when the env vars are missing — e.g. a misconfigured deploy.
// Real auth/queries require VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || "https://placeholder.supabase.co";
const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "placeholder-anon-key";

export const supabase = createClient(supabaseUrl, supabaseKey);

export type {
  Profile,
  Municipality,
  Festival,
  Event,
  Product,
  Reward,
  Feedback,
  FeedbackType,
  Announcement,
  GuideItem,
  UserRole,
  LocalUser,
  AttendanceQR,
  AttendanceLog,
} from "./types";
