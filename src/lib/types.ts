export type UserRole = "admin" | "organizer" | "msme" | "tourist";

export interface LocalUser {
  id: string;
  email?: string;
  user_metadata: Record<string, any>;
  created_at?: string;
}

export interface LocalSession {
  access_token: string;
  refresh_token: string;
  user: LocalUser;
}

export interface Profile {
  id: string;
  fullname: string;
  email: string;
  role: UserRole;
  profile_photo: string | null;
  birthdate?: string | null;
  created_at: string;
}

export interface Festival {
  id: number;
  title: string;
  description: string;
  banner: string | null;
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
  festivals?: { title: string };
}

export interface MSME {
  id: number;
  owner: string;
  business_name: string;
  logo: string | null;
  description: string | null;
  category?: string | null;
}

export interface Product {
  id: number;
  msme_id: number;
  product_name: string;
  image: string | null;
  description: string | null;
  price: number;
  stock: number;
  msmes?: { business_name: string };
}

export interface Reward {
  id: number;
  reward_name: string;
  required_points: number;
  image: string | null;
  description?: string | null;
}

export interface Transaction {
  id: number;
  tourist_id: string;
  msme_id: number | null;
  qr_id: number | null;
  points: number;
  created_at: string;
  msmes?: { business_name: string };
  reward_qr?: { product_id: number | null; points: number };
}

export interface RedeemedReward {
  id: number;
  tourist_id: string;
  reward_id: number;
  redeemed_date: string;
  rewards?: { reward_name: string; required_points: number; image: string | null };
}

export interface Feedback {
  id: number;
  tourist_id: string;
  rating: number;
  comment: string;
  suggestion: string | null;
  created_at: string;
  profiles?: { fullname: string };
}

export interface Announcement {
  id: number;
  title: string;
  description: string;
  image: string | null;
  created_by: string | null;
  created_at?: string;
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
