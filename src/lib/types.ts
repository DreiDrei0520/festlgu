export type UserRole = "admin" | "organizer" | "msme" | "tourist";

// The three municipalities served by this system (one festival each).
export type Municipality = "bay" | "calauan" | "los-banos";

export interface LocalUser {
  id: string;
  email?: string;
  user_metadata: Record<string, any>;
  created_at?: string;
}

export interface Profile {
  id: string;
  fullname: string;
  email: string;
  role: UserRole;
  profile_photo: string | null;
  birthdate?: string | null;
  municipality?: Municipality | string | null; // assigned to admin/organizer/msme accounts
  created_at: string;
}

export interface Festival {
  id: number;
  title: string;
  slug?: string | null;
  municipality?: Municipality | string | null;
  tagline?: string | null;
  description: string;
  banner: string | null;
  logo: string | null;
  location: string;
  start_date: string;
  end_date: string;
}

export interface Event {
  id: number;
  festival_id: number | null;
  title: string;
  description: string | null;
  venue: string;
  start_time: string;
  end_time: string | null;
  organizer_id: string | null;
  festivals?: { title: string; logo?: string | null };
}

export interface Product {
  id: number;
  msme_id: number;
  product_name: string;
  image: string | null;
  description: string | null;
  price: number;
  stock: number;
  approved?: boolean | null; // LGU-published listing (gates public visibility)
  points?: number; // points a tourist earns per unit bought (set by the MSME)
  msmes?: { business_name: string };
}

export interface Reward {
  id: number;
  reward_name: string;
  required_points: number;
  required_days?: number; // milestone system: days of attendance needed
  festival_id?: number | null;
  msme_id?: number | null; // vendor where the item is redeemed
  product_id?: number | null; // redeemable product at that vendor
  image: string | null;
  description?: string | null;
  stock?: number | null; // null = unlimited
  active?: boolean; // false = hidden from redemption
  products?: { product_name: string; image: string | null } | null;
}

export interface AttendanceQR {
  id: number;
  festival_id: number;
  qr_code_string: string;
  label: string | null;
  generated_by: string | null;
  created_at: string;
  is_active?: boolean;
  municipality_id?: string;
  expires_at?: string;
  events?: { title: string; venue: string };
  festivals?: { title: string };
}

export interface AttendanceLog {
  id: number;
  tourist_id: string;
  qr_id: number;
  festival_id: number;
  scan_date: string; // date (yyyy-mm-dd) — unique per (tourist, qr, date)
  created_at: string;
  profiles?: { fullname: string };
  attendance_qr?: { label: string };
  festivals?: { title: string };
}

export type FeedbackType = "festival" | "msme";

export interface Feedback {
  id: number;
  tourist_id: string;
  rating: number;
  comment: string;
  suggestion: string | null;
  feedback_type?: FeedbackType | string | null;
  municipality?: Municipality | string | null;
  festival_id?: number | null;
  msme_id?: number | null;
  created_at: string;
  profiles?: { fullname: string };
  festivals?: { title: string };
  msmes?: { business_name: string };
}

export interface Announcement {
  id: number;
  title: string;
  description: string;
  image: string | null;
  festival_id?: number | null;
  created_by: string | null;
  created_at?: string;
  link_view?: string | null;
  festivals?: { title: string };
}

export interface GuideItem {
  id?: number;
  section: "maps" | "transportation" | "hotels" | "restaurants" | "emergency";
  title: string;
  subtitle?: string | null;
  body?: string | null;
  meta?: string | null;
  tag?: string | null;
  image?: string | null;
  is_map_image?: boolean;
  sort_order?: number;
}