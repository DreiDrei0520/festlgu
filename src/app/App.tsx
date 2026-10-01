import { useState, useEffect, useRef, useMemo, createContext, useContext, useCallback, lazy, Suspense } from "react";
import {
  Sun, Moon, Menu, X, LogOut, Bell, Search, ChevronDown,
  MapPin, Calendar, Star, QrCode, Gift, Users, Building2,
  ShoppingBag, TrendingUp, BarChart2, FileText, Settings,
  PlusCircle, Edit2, Trash2, CheckCircle, Clock, AlertCircle,
  Camera, Upload, Eye, ArrowRight, Phone, Mail, Globe,
  Ticket, Award, Heart, MessageSquare, Filter, Download,
  Home, Info, Map as MapIcon, ChevronRight, Megaphone, Package,
  DollarSign, Layers, Activity, Shield, UserCheck, Zap, Loader2, ExternalLink,
  Bus, Utensils, Bike, Car, Footprints, KeyRound,
  Umbrella, Stamp, Receipt, Landmark, Store, Wallet, CreditCard,
  CalendarDays, ScanLine, ArrowLeft, Printer, Sparkles, ChevronLeft, IdCard, Link2,
  Inbox, Save,
  Facebook, Instagram, Youtube,
  Lock as LockIcon,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { supabase } from "../lib/supabase";

// Heavy libraries (leaflet, recharts, qrcode) are code-split into their own
// chunks below and loaded lazily to keep the initial bundle small.
const FestivalMap = lazy(() => import("../components/FestivalMap"));
const WeeklySalesChart = lazy(() => import("../components/charts").then(m => ({ default: m.WeeklySalesChart })));
const DailySalesChart = lazy(() => import("../components/charts").then(m => ({ default: m.DailySalesChart })));
const AttendanceChart = lazy(() => import("../components/charts").then(m => ({ default: m.AttendanceChart })));
import type { MapVenue } from "../components/FestivalMap";
import type {
  Profile, Festival, Event, MSME, Product, Reward,
  Transaction, Feedback, Announcement, GuideItem, UserRole, LocalUser,
  Municipality, AttendanceQR, AttendanceLog, RegistrationPayment, FeedbackType,
} from "../lib/supabase";
// ─── Types ─────────────────────────────────────────────────────────────────

type View =
  | "home" | "about" | "events" | "msmes" | "guide" | "contact"
  | "login" | "register" | "forgot-password" | "claim"
  | "admin" | "organizer" | "msme-dash" | "tourist-dash";

// Public views reachable via URL hash (e.g. #login, #forgot-password)
const HASH_VIEWS: Record<string, View> = {
  home: "home", about: "about", events: "events", msmes: "msmes", guide: "guide", contact: "contact",
  login: "login", register: "register", "forgot-password": "forgot-password", claim: "claim",
};

function viewFromHash(): View {
  const h = window.location.hash.replace(/^#\/?/, "");
  // Receipt QR: #claim=CODE — remember the code, then show the claim page.
  if (/^claim[=/]/i.test(h)) {
    const code = extractClaimCode(h);
    if (code) setPendingClaim(code);
    return "claim";
  }
  return (HASH_VIEWS[h] as View) || "home";
}

// ─── Context ────────────────────────────────────────────────────────────────

interface AppCtx {
  dark: boolean;
  toggleDark: () => void;
  authUser: LocalUser | null;
  profile: Profile | null;
  setProfile: (p: Profile | null) => void;
  authLoading: boolean;
  logout: () => void;
  view: View;
  setView: (v: View) => void;
}

const Ctx = createContext<AppCtx>({} as AppCtx);
const useApp = () => useContext(Ctx);

// ─── Static Fallback Data (shown before DB load / as placeholders) ────────────

// The three municipalities + their festivals
const MUNICIPALITIES: { id: Municipality; name: string; province: string; gradient: string }[] = [
  { id: "bay",       name: "Bay",       province: "Laguna", gradient: "from-emerald-500 to-green-600" },
  { id: "calauan",   name: "Calauan",   province: "Laguna", gradient: "from-amber-500 to-orange-600" },
  { id: "los-banos", name: "Los Baños", province: "Laguna", gradient: "from-indigo-500 to-violet-600" },
];

const MUNI_NAME: Record<string, string> = { bay: "Bay", calauan: "Calauan", "los-banos": "Los Baños" };

function muniOf(id?: Municipality | string | null): Municipality | null {
  return MUNICIPALITIES.some(m => m.id === id) ? (id as Municipality) : null;
}

// "yyyy-mm-dd" for today in the visitor's local timezone
const todayStr = () => new Date().toLocaleDateString("en-CA");

// ── date/time helpers ────────────────────────────────────────────────────────
// <input type="datetime-local"> produces LOCAL wall-clock strings, while the
// DB stores timestamptz (UTC). These convert in/out so the UI always shows the
// same wall-clock time the LGU organizer entered.
function localInputToISO(local?: string | null): string | null {
  if (!local) return null;
  const d = new Date(local);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function isoToLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Local wall-clock display (e.g. "9:00 AM") for a stored timestamptz.
function localTimeLabel(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

// Local calendar date (e.g. "Sep 11, 2026") for a stored timestamptz.
function localDateLabel(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

// Renders a QR code PNG from text, loading the `qrcode` lib on demand so it
// stays out of the initial bundle.
async function qrDataURL(text: string, opts?: { width?: number; margin?: number; color?: { dark: string; light: string } }): Promise<string> {
  const { toDataURL } = await import("qrcode");
  return toDataURL(text, opts);
}

// ── Attendance QR canonical format ───────────────────────────────────────────
// FLGU-{FestivalName}-{UniqueCode}  ·  e.g. FLGU-BAYENOS-ENTRANCE / FLGU-PINYA-XK2M7QA
// Codes are stored/printed UPPERCASE ASCII (no accents, no numbers between the
// festival name and the unique code) so they type and scan identically on every
// device; the scanner maps the ñ spelling (Bañamos/Bayeños) onto these tokens.
const QR_FEST_NAME: Record<string, string> = { bay: "BAYENOS", "los-banos": "BANAMOS", calauan: "PINYA" };

// Unambiguous alphabet (no 0/O, 1/I) so printed codes scan cleanly.
const QR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomQRCode(len = 8): string {
  const out: string[] = [];
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    for (let i = 0; i < len; i++) out.push(QR_ALPHABET[bytes[i] % QR_ALPHABET.length]);
  } else {
    for (let i = 0; i < len; i++) out.push(QR_ALPHABET[Math.floor(Math.random() * QR_ALPHABET.length)]);
  }
  return out.join("");
}
// Accepted scanned form — canonical UPPERCASE ASCII tokens, 4–12 unambiguous
// alphanumeric characters. Input is normalized (uppercase, Ñ→N) before testing.
const QR_CODE_RE = /^FLGU-(BANAMOS|BAYENOS|PINYA)-([A-Z2-9]{4,12})$/;

// Tolerate how phones/keyboards mangle a code before matching: lowercase,
// ñ → N, smart-punctuation dashes → '-', and stray spaces/autocorrect joins.
function cleanCode(s: string): string {
  return s.trim().toUpperCase().replace(/Ñ/g, "N").replace(/[–—―‒−]/g, "-").replace(/\s+/g, "");
}

// Skeleton shown while the lazily-loaded chart chunk is fetched.
function ChartFallback({ height }: { height: number }) {
  return (
    <div style={{ height }} className="w-full flex items-center justify-center rounded-xl bg-muted/40">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );
}

type TownAnalytics = {
  months: { month: string; visitors: number; revenue: number }[];
  venuePie: { name: string; value: number }[];
  salesByBusiness: { id: number; name: string; total: number; count: number; items: number }[];
  counts: {
    users: number; events: number; msmes: number; unpaid: number; pending: number; approved: number;
    scans: number; revenue: number; rewards: number; avgRating: number; feedbackCount: number;
    sales: number; salesCount: number; itemsSold: number; salesToday: number;
  };
};

// Live town-scoped analytics fed by real data (scans, paid registrations, feedback).
async function loadTownAnalytics(town: string): Promise<TownAnalytics> {
  const fest = await townFestivalId(town);
  const now = new Date();
  const monthKeys = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }).reverse();
  const monthLabel = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString("en-PH", { month: "short" });

  const [msmesRes, payRes, qrRes, fbRes, usersRes, evRes, rewRes, salesRes] = await Promise.all([
    supabase.from("msmes").select("id,business_name,status,registration_fee").eq("municipality", town),
    supabase.from("registration_payments").select("amount, created_at, msmes!inner(municipality)").eq("status", "paid").eq("msmes.municipality", town),
    fest ? supabase.from("attendance_qr").select("id").eq("festival_id", fest) : Promise.resolve({ data: [] as any[] }),
    supabase.from("feedback").select("rating").eq("municipality", town),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("municipality", town),
    fest ? supabase.from("events").select("id, title").eq("festival_id", fest) : Promise.resolve({ data: [] as any[] }),
    fest ? supabase.from("redeemed_rewards").select("id, rewards!inner(festival_id)").eq("rewards.festival_id", fest) : Promise.resolve({ data: [] as any[] }),
    fetchAll((from, to) => supabase.from("sales").select("msme_id, total, item_count, created_at").eq("municipality", town).order("id").range(from, to)).catch(() => [] as any[]),
  ]);

  const msmes = (msmesRes.data as any[]) || [];
  const events = (evRes.data as any[]) || [];
  const qrIds = ((qrRes.data as any[]) || []).map(r => r.id);
  let logs: any[] = [];
  if (qrIds.length) {
    const lg = await supabase.from("attendance_logs").select("scan_date, venue_id").in("qr_id", qrIds);
    logs = (lg.data as any[]) || [];
  }
  const eventOf = (vid: number) => events.find(ev => ev.id === vid);
  const visitors: Record<string, number> = {};
  const venueCount: Record<string, number> = {};
  for (const l of logs) {
    const key = String(l.scan_date).slice(0, 7);
    if (monthKeys.includes(key)) visitors[key] = (visitors[key] || 0) + 1;
    const vk = l.venue_id ? String(l.venue_id) : "general";
    venueCount[vk] = (venueCount[vk] || 0) + 1;
  }
  const revenue: Record<string, number> = {};
  for (const p of (payRes.data as any[]) || []) {
    const dt = new Date(p.created_at);
    const key = Number.isNaN(dt.getTime()) ? "" : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    if (key && monthKeys.includes(key)) revenue[key] = (revenue[key] || 0) + Number(p.amount || 0);
  }
  const months = monthKeys.map(mk => ({
    month: monthLabel(mk),
    visitors: visitors[mk] || 0,
    revenue: revenue[mk] || 0,
  }));
  const venuePie = Object.entries(venueCount).map(([k, v]) => {
    if (k === "general") return { name: "General Gate", value: v };
    const ev = eventOf(Number(k));
    return { name: ev?.title || `Event #${k}`, value: v };
  }).sort((a, b) => b.value - a.value).slice(0, 6);

  // MSME point-of-sale totals (sales only — individual orders stay private to the MSME)
  const sales = salesRes as any[];
  const today = todayStr();
  const byBiz: Record<number, { total: number; count: number; items: number }> = {};
  for (const s of sales) {
    const b = (byBiz[s.msme_id] ||= { total: 0, count: 0, items: 0 });
    b.total += Number(s.total || 0); b.count += 1; b.items += Number(s.item_count || 0);
  }
  const salesByBusiness = msmes
    .filter(m => m.status === "approved" || byBiz[m.id])
    .map(m => ({ id: m.id, name: m.business_name, ...(byBiz[m.id] || { total: 0, count: 0, items: 0 }) }))
    .sort((a, b) => b.total - a.total);

  const feedback = (fbRes.data as any[]) || [];
  const ratings = feedback.map(r => Number(r.rating));
  const avgRating = ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : 0;

  return {
    months,
    venuePie,
    salesByBusiness,
    counts: {
      users: usersRes.count || 0,
      events: events.length,
      msmes: msmes.length,
      unpaid: msmes.filter(m => m.status === "unpaid").length,
      pending: msmes.filter(m => m.status === "pending").length,
      approved: msmes.filter(m => m.status === "approved").length,
      scans: logs.length,
      revenue: (payRes.data as any[] || []).reduce((s, p) => s + Number(p.amount || 0), 0),
      rewards: (rewRes.data as any[] || []).length,
      avgRating,
      feedbackCount: feedback.length,
      sales: sales.reduce((sum, s) => sum + Number(s.total || 0), 0),
      salesCount: sales.length,
      itemsSold: sales.reduce((sum, s) => sum + Number(s.item_count || 0), 0),
      salesToday: sales.filter(s => localDateKey(s.created_at) === today).reduce((sum, s) => sum + Number(s.total || 0), 0),
    },
  };
}

// Enumeration of festival dates (inclusive) as "yyyy-mm-dd" strings
function festivalDays(f: { start_date: string; end_date: string }): string[] {
  const start = new Date(f.start_date);
  const end = new Date(f.end_date);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return [];
  const days: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    days.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

const DAYS_ABB: Record<string, string> = {
  Sun: "S", Mon: "M", Tue: "T", Wed: "W", Thu: "T", Fri: "F", Sat: "S",
};

// Rotating hero backgrounds (one per festival)
const FESTIVAL_BG = [
  "https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=1600&h=900&fit=crop&auto=format",
  "https://images.unsplash.com/photo-1481349518771-20055b2a7b24?w=1600&h=900&fit=crop&auto=format",
  "https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=1600&h=900&fit=crop&auto=format",
];

// Curated festival photos for the public gallery section.
const GALLERY_ITEMS = [
  { src: "https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=900&h=800&fit=crop", caption: "Bayeños street dancing · Bay" },
  { src: "https://images.unsplash.com/photo-1481349518771-20055b2a7b24?w=900&h=700&fit=crop", caption: "Bañamos harvest floats · Los Baños" },
  { src: "https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=900&h=700&fit=crop", caption: "Pinya agro-fair · Calauan" },
  { src: "https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=900&h=900&fit=crop", caption: "Fresh produce straight from the province" },
  { src: "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=900&h=900&fit=crop", caption: "Grand night programs & fireworks" },
  { src: "https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=900&h=700&fit=crop", caption: "MSME artisan booths across the three towns" },
  { src: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=900&h=700&fit=crop", caption: "Tourists celebrating together" },
];

// Slugs are machine-readable; display titles must remain exactly as entered.
function slugify(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function csvDownload(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const csv = [headers, ...rows].map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Supabase caps a select at 1000 rows — page through larger tables so totals
// (sales, receipts) are always complete.
async function fetchAll<T = any>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < size) return out;
  }
}

async function recordActivity(action: string, recordType: string, recordId: string | number | null, description: string, municipality?: string | null) {
  await supabase.from("activity_logs").insert({
    action_type: action, record_type: recordType, record_id: recordId == null ? null : String(recordId),
    description, municipality: municipality || null,
  });
}

// ── money / dates ────────────────────────────────────────────────────────────
function peso(n: number | string | null | undefined): string {
  return `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Local calendar day ("yyyy-mm-dd") of a stored timestamptz — groups sales by
// the day they happened in the stall's (visitor's) timezone.
function localDateKey(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA");
}

function ageFrom(birthdate: string): number | null {
  if (!birthdate) return null;
  const b = new Date(`${birthdate}T00:00:00`);
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--;
  return age;
}

// ── MSME registration vocabulary ─────────────────────────────────────────────
const BUSINESS_TYPES = ["Sole Proprietorship", "Partnership", "Corporation", "Cooperative", "Other"];

const BUSINESS_SIZES: { id: "micro" | "small" | "medium" | "large"; label: string; hint: string }[] = [
  { id: "micro", label: "Micro", hint: "Assets up to ₱3M · 1–9 employees" },
  { id: "small", label: "Small", hint: "₱3M–₱15M · 10–99 employees" },
  { id: "medium", label: "Medium", hint: "₱15M–₱100M · 100–199 employees" },
  { id: "large", label: "Large", hint: "Above ₱100M · 200+ employees" },
];
const SIZE_LABEL: Record<string, string> = { micro: "Micro", small: "Small", medium: "Medium", large: "Large" };

// Common Philippine MSME industries (searchable in the sign-up form).
const BUSINESS_CATEGORIES = [
  "Food & Beverages", "Restaurant / Carinderia", "Bakery & Pastry", "Street Food & Snacks",
  "Coffee Shop / Café", "Milk Tea & Refreshments", "Catering Services", "Pasalubong & Delicacies",
  "Fruits, Vegetables & Farm Produce", "Meat, Poultry & Seafood", "Sari-Sari Store / Convenience Store",
  "Grocery & General Merchandise", "Agriculture & Farming", "Fisheries & Aquaculture",
  "Livestock & Poultry Raising", "Handicrafts & Souvenirs", "Furniture & Woodcraft",
  "Weaving & Textiles", "Clothing & Apparel", "Footwear & Leather Goods", "Bags & Accessories",
  "Jewelry & Fashion Accessories", "Beauty & Personal Care Products", "Salon & Barbershop",
  "Spa & Wellness", "Health, Pharmacy & Medical Supplies", "Home & Kitchen Supplies",
  "Hardware & Construction Supplies", "Electronics & Gadgets", "Cellphone, Load & E-Loading",
  "Computer, Printing & Internet Services", "Photography & Videography", "Events & Party Supplies",
  "Toys, Games & Hobbies", "Books & School Supplies", "Arts & Crafts Supplies", "Plants & Gardening",
  "Pet Supplies & Services", "Transportation & Delivery", "Tourism & Travel Services",
  "Accommodation / Homestay", "Laundry Services", "Repair & Maintenance Services",
  "Automotive Parts & Services", "Manufacturing & Food Processing", "Water Refilling Station",
  "Printing & Signage", "Education & Tutorial Services", "Professional & Consulting Services", "Other",
];

// Requirements the owner completes after sign-up (uploaded as image/PDF).
const DOC_TYPES: { id: string; label: string; required: boolean }[] = [
  { id: "valid_id", label: "Valid Government ID", required: true },
  { id: "proof_of_ownership", label: "Proof of Ownership / Right to Use Business Location", required: true },
  { id: "business_permit", label: "Business Permit / Mayor's Permit", required: true },
  { id: "fire_safety", label: "Fire Safety Inspection Certificate (if applicable)", required: false },
  { id: "sanitary_permit", label: "Sanitary Permit (if applicable)", required: false },
  { id: "occupancy_permit", label: "Occupancy Permit (if applicable)", required: false },
  { id: "environmental_clearance", label: "Environmental Clearance (if applicable)", required: false },
];

// ── purchase points (mirrors public.purchase_points / submit_sale_feedback) ──
const PESOS_PER_POINT = 10;
const FEEDBACK_BONUS = 10;
const pointsFor = (total: number) => Math.floor((Number(total) || 0) / PESOS_PER_POINT);

// ── uploads ──────────────────────────────────────────────────────────────────
const MAX_UPLOAD_MB = 4;

// Reads an image or PDF for storage as a data URL. Photos are downscaled so a
// phone snapshot of a permit or receipt stays small enough to store and view.
async function readUploadFile(file: File): Promise<{ dataUrl: string; name: string }> {
  const isImage = file.type.startsWith("image/");
  if (!isImage && file.type !== "application/pdf") throw new Error("Upload a photo (JPG/PNG) or a PDF file.");
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
  if (isImage) {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("unsupported image"));
        el.src = raw;
      });
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return { dataUrl: canvas.toDataURL("image/jpeg", 0.82), name: file.name };
      }
    } catch { /* fall through to the original file (e.g. HEIC) */ }
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`File is too large — maximum ${MAX_UPLOAD_MB} MB.`);
  return { dataUrl: raw, name: file.name };
}

// Opens a stored data URL (image or PDF) in a new tab. Browsers block
// navigating to data: URLs directly, so it is converted to a blob URL first —
// synchronously, so the popup is not blocked.
function openDataUrl(dataUrl?: string | null) {
  if (!dataUrl) return;
  const [head, body] = dataUrl.split(",");
  const mime = head.match(/data:([^;]+)/)?.[1] || "application/octet-stream";
  const bytes = atob(body || "");
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([buf], { type: mime }));
  const w = window.open(url, "_blank");
  if (!w) toast.error("Allow pop-ups to view the file.");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── receipt claim links ──────────────────────────────────────────────────────
// Receipts carry a QR of `<site>/#claim=<CODE>`. Opening it (logged in or not)
// lands on the claim page; the code survives a sign-in / sign-up detour.
const CLAIM_KEY = "fglu_pending_claim";
const CLAIM_CODE_RE = /^[A-Z2-9]{10}$/;

function claimUrl(code: string): string {
  return `${window.location.origin}${window.location.pathname}#claim=${code}`;
}

function extractClaimCode(text: string): string | null {
  const m = text.match(/claim[=/]([A-Za-z0-9]{10})/);
  const code = (m ? m[1] : text.trim()).toUpperCase();
  return CLAIM_CODE_RE.test(code) ? code : null;
}

function getPendingClaim(): string | null {
  try {
    const raw = localStorage.getItem(CLAIM_KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw);
    if (Date.now() - at > 3 * 24 * 3600 * 1000) { localStorage.removeItem(CLAIM_KEY); return null; }
    return code;
  } catch { return null; }
}

function setPendingClaim(code: string) {
  try { localStorage.setItem(CLAIM_KEY, JSON.stringify({ code, at: Date.now() })); } catch { /* storage off */ }
}

function clearPendingClaim() {
  try { localStorage.removeItem(CLAIM_KEY); } catch { /* storage off */ }
}

// Tab a dashboard should open on next mount (e.g. MSME → Business Profile
// right after sign-up, tourist → Rewards after collecting points).
let nextDashTab: string | null = null;

// ── printable sales receipt ──────────────────────────────────────────────────
type ReceiptSale = {
  receipt_no: string; claim_code: string; created_at: string; total: number; item_count: number;
  payment_method: string; ewallet_provider?: string | null; ewallet_ref?: string | null;
  amount_tendered?: number | null; change_due?: number | null; points_earned: number;
};
type ReceiptItem = { product_name: string; quantity: number; unit_price: number; line_total: number };

const escapeHtml = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function printSaleReceipt(sale: ReceiptSale, items: ReceiptItem[], business: { business_name: string; address?: string | null; municipality?: string | null; owner_name?: string | null }) {
  const w = window.open("", "_blank", "width=420,height=720");
  if (!w) { toast.error("Allow pop-ups to print the receipt."); return; }
  const qr = await qrDataURL(claimUrl(sale.claim_code), { width: 360, margin: 1 });
  const rows = items.map(i => `<tr><td>${escapeHtml(i.product_name)}<br><small>${i.quantity} × ${peso(i.unit_price)}</small></td><td class="r">${peso(i.line_total)}</td></tr>`).join("");
  const payment = sale.payment_method === "cash"
    ? `<tr><td>Cash</td><td class="r">${peso(sale.amount_tendered)}</td></tr><tr><td>Change</td><td class="r">${peso(sale.change_due)}</td></tr>`
    : `<tr><td>E-Wallet${sale.ewallet_provider ? ` (${escapeHtml(sale.ewallet_provider)})` : ""}</td><td class="r">${peso(sale.total)}</td></tr><tr><td>Ref. No.</td><td class="r">${escapeHtml(sale.ewallet_ref)}</td></tr>`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(sale.receipt_no)}</title>
    <style>body{font-family:ui-monospace,Menlo,Consolas,monospace;width:300px;margin:12px auto;color:#000;font-size:12px}
    h1{font-size:15px;text-align:center;margin:0}p{margin:2px 0;text-align:center}table{width:100%;border-collapse:collapse;margin:6px 0}
    td{padding:3px 0;vertical-align:top}.r{text-align:right}.t td{border-top:1px dashed #000;font-weight:700;font-size:14px;padding-top:6px}
    hr{border:0;border-top:1px dashed #000;margin:8px 0}small{color:#444}.qr{text-align:center;margin-top:8px}.qr img{width:170px;height:170px}
    @media print{button{display:none}}</style></head><body>
    <h1>${escapeHtml(business.business_name)}</h1>
    ${business.address ? `<p>${escapeHtml(business.address)}</p>` : ""}
    <p>${escapeHtml(business.municipality ? `${MUNI_NAME[business.municipality] || business.municipality}, Laguna` : "Laguna")} · FestivaLGU</p>
    <hr><p>SALES INVOICE</p><p>${escapeHtml(sale.receipt_no)}</p>
    <p>${escapeHtml(localDateLabel(sale.created_at))} ${escapeHtml(localTimeLabel(sale.created_at))}</p>
    ${business.owner_name ? `<p>Cashier: ${escapeHtml(business.owner_name)}</p>` : ""}
    <hr><table>${rows}<tr class="t"><td>TOTAL (${sale.item_count} item${sale.item_count === 1 ? "" : "s"})</td><td class="r">${peso(sale.total)}</td></tr>${payment}</table>
    <hr><p><b>Scan to earn ${sale.points_earned} point${sale.points_earned === 1 ? "" : "s"}</b></p>
    <p><small>+${FEEDBACK_BONUS} bonus points when you rate your purchase (optional)</small></p>
    <div class="qr"><img src="${qr}" alt="Claim QR"></div>
    <p><small>Code: ${escapeHtml(sale.claim_code)}</small></p>
    <hr><p>Thank you! Salamat po!</p>
    <p style="margin-top:10px"><button onclick="window.print()">Print</button></p>
    <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>
    </body></html>`);
  w.document.close();
}

const FALLBACK_FESTIVALS: Festival[] = [
  { id: 1, slug: "bayenos", municipality: "bay", title: "Bayeños Festival", tagline: "Bay's thanksgiving for a bountiful harvest from the lake and fields.", description: "A vibrant five-day celebration of agro-fairs, street dancing, and harvest floats in the lakeside town of Bay. Native dishes, fresh catch, and handcrafted goodness fill the town plaza.", banner: "https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=800&h=400&fit=crop", logo: "https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=400&h=400&fit=crop", location: "Bay, Laguna", start_date: "2026-09-11", end_date: "2026-09-15" },
  { id: 2, slug: "banamos", municipality: "los-banos", title: "Bañamos Festival", tagline: "A sweeter-than-honey celebration of Los Baños' banana and rice harvest.", description: "Los Baños marks the banana harvest with the Bañamos Festival — the sweetest feast in Laguna. Banana-leaf costumes, fruit-shaped floats, and the sweetest lakatan and saba trade fair you'll ever taste.", banner: "https://images.unsplash.com/photo-1481349518771-20055b2a7b24?w=800&h=400&fit=crop", logo: "https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&h=400&fit=crop", location: "Los Baños, Laguna", start_date: "2026-10-11", end_date: "2026-10-15" },
  { id: 3, slug: "pinya", municipality: "calauan", title: "Pinya Festival", tagline: "Calauan crowns the king of tropical fruits with the sweetest harvest festival.", description: "Calauan is famous for its sweet, golden pineapples, and the Pinya Festival proudly celebrates it. Fruit-shaped floats, dance competitions, farming exhibits, and the freshest tropical fruits in the province.", banner: "https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=800&h=400&fit=crop", logo: "https://images.unsplash.com/photo-1558945529-0e4c8ec6b5c2?w=400&h=400&fit=crop", location: "Calauan, Laguna", start_date: "2026-11-19", end_date: "2026-11-23" },
];

const FALLBACK_EVENTS = [
  { id: 1, festival_id: 1, title: "Opening & Street Dance Parade", description: null, venue: "Bay Municipal Plaza", start_time: "2026-09-11T08:00:00", end_time: "2026-09-11T12:00:00", organizer_id: null, festivals: { title: "Bayeños Festival" } },
  { id: 2, festival_id: 1, title: "Agro-Fair & Food Village Day", description: null, venue: "Bay Public Market", start_time: "2026-09-12T09:00:00", end_time: "2026-09-12T17:00:00", organizer_id: null, festivals: { title: "Bayeños Festival" } },
  { id: 3, festival_id: 1, title: "Float & Costume Competition", description: null, venue: "National Highway, Bay", start_time: "2026-09-13T16:00:00", end_time: "2026-09-13T19:00:00", organizer_id: null, festivals: { title: "Bayeños Festival" } },
  { id: 4, festival_id: 1, title: "Rural & Folk Dance Night", description: null, venue: "Bay Municipal Grounds", start_time: "2026-09-14T18:00:00", end_time: "2026-09-14T21:00:00", organizer_id: null, festivals: { title: "Bayeños Festival" } },
  { id: 5, festival_id: 1, title: "Grand Bayeños Thanksgiving", description: null, venue: "Bay Municipal Plaza", start_time: "2026-09-15T09:00:00", end_time: "2026-09-15T13:00:00", organizer_id: null, festivals: { title: "Bayeños Festival" } },
  { id: 6, festival_id: 2, title: "Bañamos Kick-off Parade", description: null, venue: "Los Baños Municipal Plaza", start_time: "2026-10-11T08:00:00", end_time: "2026-10-11T12:00:00", organizer_id: null, festivals: { title: "Bañamos Festival" } },
  { id: 7, festival_id: 2, title: "Banana Trade Fair & Tasting", description: null, venue: "Los Baños Public Market", start_time: "2026-10-12T09:00:00", end_time: "2026-10-12T17:00:00", organizer_id: null, festivals: { title: "Bañamos Festival" } },
  { id: 8, festival_id: 2, title: "Bañamos Street Dance Fest", description: null, venue: "Roads of Los Baños", start_time: "2026-10-13T15:00:00", end_time: "2026-10-13T18:00:00", organizer_id: null, festivals: { title: "Bañamos Festival" } },
  { id: 9, festival_id: 2, title: "Harvest Night Concert", description: null, venue: "Los Baños Covered Court", start_time: "2026-10-14T18:00:00", end_time: "2026-10-14T22:00:00", organizer_id: null, festivals: { title: "Bañamos Festival" } },
  { id: 10, festival_id: 2, title: "Bañamos Grand Finals", description: null, venue: "Los Baños Municipal Plaza", start_time: "2026-10-15T18:00:00", end_time: "2026-10-15T21:00:00", organizer_id: null, festivals: { title: "Bañamos Festival" } },
  { id: 11, festival_id: 3, title: "Pinya Parade & Agro Exhibits", description: null, venue: "Calauan Municipal Plaza", start_time: "2026-11-19T08:00:00", end_time: "2026-11-19T12:00:00", organizer_id: null, festivals: { title: "Pinya Festival" } },
  { id: 12, festival_id: 3, title: "Fruit Harvest Fair", description: null, venue: "Calauan Public Market", start_time: "2026-11-20T09:00:00", end_time: "2026-11-20T17:00:00", organizer_id: null, festivals: { title: "Pinya Festival" } },
  { id: 13, festival_id: 3, title: "Pinya Street Dance Showdown", description: null, venue: "Roads of Calauan", start_time: "2026-11-21T15:00:00", end_time: "2026-11-21T18:00:00", organizer_id: null, festivals: { title: "Pinya Festival" } },
  { id: 14, festival_id: 3, title: "Pinya Fiesta Night", description: null, venue: "Calauan Municipal Grounds", start_time: "2026-11-22T18:00:00", end_time: "2026-11-22T22:00:00", organizer_id: null, festivals: { title: "Pinya Festival" } },
  { id: 15, festival_id: 3, title: "Pinya Grand Closing", description: null, venue: "Calauan Municipal Plaza", start_time: "2026-11-23T18:00:00", end_time: "2026-11-23T21:00:00", organizer_id: null, festivals: { title: "Pinya Festival" } },
];

const FALLBACK_REWARDS: Reward[] = [
  { id: 1, reward_name: "Festival T-Shirt", required_points: 0, required_days: 5, image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=200&h=200&fit=crop", description: "Official festival commemorative shirt — visit all 5 festival days." },
  { id: 2, reward_name: "Free Umbrella", required_points: 0, required_days: 3, image: "https://images.unsplash.com/photo-1519058082700-08a0b56da9b4?w=200&h=200&fit=crop", description: "Beat the heat or the rain after 3 days of attendance." },
  { id: 3, reward_name: "Pasalubong Basket", required_points: 0, required_days: 4, image: "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=200&h=200&fit=crop", description: "A basket of local treats after 4 festival days." },
];

const FALLBACK_GUIDE: GuideItem[] = [
  { id: 1, section: "maps", title: "Festival Venue Map", subtitle: "Town Plaza", body: "Download the official festival map at the LGU Tourism Office or visit any info booth on site.", is_map_image: true, sort_order: 0, image: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=700&fit=crop" },
  { id: 2, section: "maps", title: "Town Plaza & Main Stage", subtitle: "Main venue", body: "Grand parades, nightly shows, and the festival opening.", sort_order: 1 },
  { id: 3, section: "maps", title: "Parade Route", subtitle: "2 km route", body: "Follows the national road through the town center.", sort_order: 2 },
  { id: 4, section: "maps", title: "MSME Trade Fair", subtitle: "Open daily", body: "Local products, crafts, and pasalubong stalls.", sort_order: 3 },
  { id: 5, section: "maps", title: "Food Village", subtitle: "All weekend", body: "Authentic local dishes and festival food.", sort_order: 4 },
  { id: 6, section: "maps", title: "Info Booth", subtitle: "Help desk", body: "Tourist assistance, maps, and free bag counters.", sort_order: 5 },
  { id: 7, section: "transportation", title: "Jeepney", body: "Main public transport around town and nearby barangays.", meta: "₱13 – ₱25", tag: "Every 10 min", sort_order: 0 },
  { id: 8, section: "transportation", title: "Tricycle", body: "Best for short hops and getting to festival venues quickly.", meta: "₱20 – ₱50", tag: "On demand", sort_order: 1 },
  { id: 9, section: "transportation", title: "Vans / UV Express", body: "Comfortable shuttle between the city and festival grounds.", meta: "₱35 – ₱90", tag: "Every 30 min", sort_order: 2 },
  { id: 10, section: "transportation", title: "Pedicab", body: "Eco-friendly rides perfect for the parade route.", meta: "₱15 – ₱40", tag: "Daytime", sort_order: 3 },
  { id: 11, section: "hotels", title: "Rizal Heritage Hotel", subtitle: "Boutique Hotel", body: "Historic boutique hotel near the plaza.", meta: "₱2,400/night", tag: "4.6 ★ • 0.3 km from plaza", image: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=400&fit=crop", sort_order: 0 },
  { id: 12, section: "hotels", title: "Town Plaza Lodge", subtitle: "Budget Inn", body: "Simple, clean rooms in the heart of town.", meta: "₱950/night", tag: "4.1 ★ • 0.1 km from plaza", image: "https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=600&h=400&fit=crop", sort_order: 1 },
  { id: 13, section: "hotels", title: "Casa Luna Suites", subtitle: "Hotel & Spa", body: "Comfortable suites with spa services.", meta: "₱3,200/night", tag: "4.8 ★ • 1.2 km from plaza", image: "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=600&h=400&fit=crop", sort_order: 2 },
  { id: 14, section: "hotels", title: "Villa Isabel Resort", subtitle: "Resort", body: "Relaxing resort with pool and gardens.", meta: "₱2,800/night", tag: "4.4 ★ • 3.5 km from plaza", image: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&h=400&fit=crop", sort_order: 3 },
  { id: 15, section: "hotels", title: "Traveler's Haven", subtitle: "Hostel", body: "Affordable shared and private rooms.", meta: "₱550/bed", tag: "4.0 ★ • 0.8 km from plaza", image: "https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=600&h=400&fit=crop", sort_order: 4 },
  { id: 16, section: "hotels", title: "Sampaguita Inn", subtitle: "Inn", body: "Cozy family-run inn with home-style meals.", meta: "₱1,200/night", tag: "4.2 ★ • 1.8 km from plaza", image: "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=600&h=400&fit=crop", sort_order: 5 },
  { id: 17, section: "restaurants", title: "Kusina ng Bayan", subtitle: "Filipino Favorites", meta: "₱₱", tag: "Best: Kare-Kare & Adobo", image: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&h=400&fit=crop", sort_order: 0 },
  { id: 18, section: "restaurants", title: "Sari-Sari Eatery", subtitle: "Home-style Dishes", meta: "₱", tag: "Best: Boodle Fight Sets", image: "https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?w=600&h=400&fit=crop", sort_order: 1 },
  { id: 19, section: "restaurants", title: "The Harvest Table", subtitle: "Organic & Farm-to-Table", meta: "₱₱₱", tag: "Best: Fresh Salads & Grills", image: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&h=400&fit=crop", sort_order: 2 },
  { id: 20, section: "restaurants", title: "Lutong Bahay", subtitle: "Local Delicacies", meta: "₱₱", tag: "Best: Fresh kakanin & halo-halo", image: "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=600&h=400&fit=crop", sort_order: 3 },
  { id: 21, section: "restaurants", title: "Kapihan sa Plaza", subtitle: "Coffee & Pastries", meta: "₱", tag: "Best: Barako Coffee & Ensaymada", image: "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=600&h=400&fit=crop", sort_order: 4 },
  { id: 22, section: "restaurants", title: "Garden Bistro", subtitle: "International", meta: "₱₱₱", tag: "Best: Wood-fired Pizza", image: "https://images.unsplash.com/photo-1552566626-52f8b828add9?w=600&h=400&fit=crop", sort_order: 5 },
  { id: 23, section: "emergency", title: "Police Station", subtitle: "Report incidents, lost & found", meta: "0916-123-4567", sort_order: 0 },
  { id: 24, section: "emergency", title: "Fire Station", subtitle: "Fire emergencies & hotline 160", meta: "0917-234-5678", sort_order: 1 },
  { id: 25, section: "emergency", title: "Medical / Hospital", subtitle: "24/7 emergency care", meta: "0918-345-6789", sort_order: 2 },
  { id: 26, section: "emergency", title: "LGU Tourism Office", subtitle: "Information & assistance", meta: "0919-456-7890", sort_order: 3 },
  { id: 27, section: "emergency", title: "Tourist Assistance", subtitle: "Tourist helpline", meta: "1-800-FESTIVAL", sort_order: 4 },
  { id: 28, section: "emergency", title: "Emergency Hotline", subtitle: "National emergency line", meta: "911", sort_order: 5 },
];

const VISITORS_DATA = [
  { month: "Jan", visitors: 4200, revenue: 186000 },
  { month: "Feb", visitors: 3800, revenue: 165000 },
  { month: "Mar", visitors: 5100, revenue: 210000 },
  { month: "Apr", visitors: 4700, revenue: 195000 },
  { month: "May", visitors: 9800, revenue: 420000 },
  { month: "Jun", visitors: 6200, revenue: 270000 },
  { month: "Jul", visitors: 7400, revenue: 315000 },
  { month: "Aug", visitors: 11200, revenue: 485000 },
];

const PIE_DATA = [
  { name: "Festivals", value: 38 },
  { name: "Beaches", value: 27 },
  { name: "Heritage", value: 21 },
  { name: "Nature", value: 14 },
];

const PIE_COLORS = ["#22c55e", "#0ea5e9", "#f59e0b", "#a78bfa"];

// ─── Utility Components ───────────────────────────────────────────────────────

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const { dark } = useApp();
  return (
    <div className={`rounded-2xl border border-border backdrop-blur-md ${dark ? "bg-white/5" : "bg-white/80"} shadow-lg ${className}`}>
      {children}
    </div>
  );
}

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "success" | "warning" | "danger" | "info" }) {
  const colors = {
    default: "bg-muted text-muted-foreground",
    success: "bg-green-500/20 text-green-600 dark:text-green-400",
    warning: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
    danger: "bg-red-500/20 text-red-600 dark:text-red-400",
    info: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  };
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium font-mono ${colors[variant]}`}>{children}</span>;
}

function StatCard({ label, value, icon: Icon, color, change }: { label: string; value: string | number; icon: React.ElementType; color: string; change?: string }) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2.5 rounded-xl ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {change && <Badge variant="success">{change}</Badge>}
      </div>
      <p className="text-2xl font-bold font-[Outfit] text-foreground">{value}</p>
      <p className="text-sm text-muted-foreground mt-1">{label}</p>
    </GlassCard>
  );
}

function AvatarIcon({ name, photo, size = "sm" }: { name: string; photo?: string | null; size?: "sm" | "md" | "lg" }) {
  const colors = ["bg-emerald-500", "bg-sky-500", "bg-amber-500", "bg-violet-500", "bg-rose-500"];
  const color = colors[(name.charCodeAt(0) || 0) % colors.length];
  const sizes = { sm: "w-8 h-8 text-xs", md: "w-10 h-10 text-sm", lg: "w-12 h-12 text-base" };
  if (photo) {
    return (
      <img src={photo} alt={name} referrerPolicy="no-referrer"
        className={`${sizes[size]} rounded-full object-cover flex-shrink-0`} />
    );
  }
  return (
    <div className={`${color} ${sizes[size]} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}>
      {name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", size = "md", className = "", icon: Icon, disabled }: {
  children?: React.ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg"; className?: string; icon?: React.ElementType; disabled?: boolean;
}) {
  const base = "inline-flex items-center gap-2 rounded-xl font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2 text-sm", lg: "px-6 py-3 text-base" };
  const variants = {
    primary: "bg-primary text-primary-foreground hover:opacity-90 shadow-sm",
    secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
    ghost: "hover:bg-muted text-foreground",
    danger: "bg-destructive text-destructive-foreground hover:opacity-90",
    outline: "border border-border text-foreground hover:bg-muted",
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
}

function Input({ label, type = "text", placeholder, value, onChange, icon: Icon }: {
  label?: string; type?: string; placeholder?: string; value?: string; onChange?: (v: string) => void; icon?: React.ElementType;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium text-foreground">{label}</label>}
      <div className="relative">
        {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange?.(e.target.value)}
          className={`w-full bg-input-background border border-border rounded-xl py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${Icon ? "pl-9 pr-4" : "px-4"}`}
        />
      </div>
    </div>
  );
}

function Spinner() {
  return <Loader2 className="w-5 h-5 animate-spin text-primary" />;
}

// ─── Public Navbar ────────────────────────────────────────────────────────────

function PublicNav() {
  const { dark, toggleDark, profile, logout, view, setView } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);

  const links: { label: string; v: View }[] = [
    { label: "Home", v: "home" },
    { label: "Festivals", v: "about" },
    { label: "Events", v: "events" },
    { label: "Register", v: "register" },
    { label: "Business Directory", v: "msmes" },
    { label: "Plan Your Visit", v: "guide" },
    { label: "Contact", v: "contact" },
  ];

  const dashView: Record<UserRole, View> = {
    admin: "admin", organizer: "organizer", msme: "msme-dash", tourist: "tourist-dash",
  };

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 border-b border-border backdrop-blur-xl ${dark ? "bg-black/60" : "bg-white/80"}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <button onClick={() => setView("home")} className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center">
            <Ticket className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg font-[Outfit] text-foreground">FestivaLGU</span>
        </button>

        <div className="hidden md:flex items-center gap-1">
          {links.map(l => (
            <button key={l.v} onClick={() => setView(l.v)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${view === l.v ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
              {l.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={toggleDark} className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground">
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          {profile ? (
            <div className="flex items-center gap-2">
              <Btn onClick={() => setView(dashView[profile.role])} size="sm">Dashboard</Btn>
              <button onClick={logout} className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground"><LogOut className="w-4 h-4" /></button>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-2">
              <Btn variant="ghost" size="sm" onClick={() => setView("login")}>Login</Btn>
            </div>
          )}
          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden p-2 rounded-xl hover:bg-muted">
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className={`md:hidden border-t border-border ${dark ? "bg-black/90" : "bg-white/95"} backdrop-blur-xl`}>
            <div className="px-4 py-3 flex flex-col gap-1">
              {links.map(l => (
                <button key={l.v} onClick={() => { setView(l.v); setMenuOpen(false); }}
                  className="text-left px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-muted">
                  {l.label}
                </button>
              ))}
              {!profile && <Btn variant="ghost" size="sm" onClick={() => { setView("login"); setMenuOpen(false); }}>Login</Btn>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

// ─── Public Footer ────────────────────────────────────────────────────────────

const FOOTER_LGU_CONTACTS = [
  { town: "Bay", address: "Bay Municipal Hall, Poblacion, Bay, Laguna", phone: "", email: "", office_name: "Bay Tourism Office", contact_person: "" },
  { town: "Los Baños", address: "Los Baños Municipal Hall, Brgy. Batong Malake, Laguna", phone: "", email: "", office_name: "Los Baños Tourism Office", contact_person: "" },
  { town: "Calauan", address: "Calauan Municipal Hall, Poblacion, Calauan, Laguna", phone: "", email: "", office_name: "Calauan Tourism Office", contact_person: "" },
];

function PublicFooter() {
  const { setView } = useApp();
  const [contacts, setContacts] = useState<any[]>(FOOTER_LGU_CONTACTS);
  const year = new Date().getFullYear();
  useEffect(() => {
    supabase.from("municipalities").select("*").then(({ data }) => { if (data?.length) setContacts(data); });
  }, []);
  const links: { label: string; v: View }[] = [
    { label: "Home", v: "home" }, { label: "Festivals", v: "about" }, { label: "Events", v: "events" },
    { label: "Register", v: "register" }, { label: "Business Directory", v: "msmes" }, { label: "Plan Your Visit", v: "guide" }, { label: "Contact", v: "contact" },
  ];

  return (
    <footer className="border-t border-border bg-muted/40">
      <div className="max-w-6xl mx-auto px-6 py-14 grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center">
              <Ticket className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg font-[Outfit] text-foreground">FestivaLGU</span>
          </div>
          <p className="text-sm text-muted-foreground mb-5">A joint festival-tourism platform by the LGUs of Bay, Calauan, and Los Baños — promoting the Bayeños, Bañamos, and Pinya festivals, supporting local MSMEs, and rewarding every tourist.</p>
          <div className="flex gap-2">
            {[Facebook, Instagram, Youtube].map((Icon, i) => (
              <a key={i} href="#" onClick={e => e.preventDefault()} aria-label="social link"
                className="w-9 h-9 rounded-xl bg-muted border border-border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors">
                <Icon className="w-4 h-4" />
              </a>
            ))}
          </div>
        </div>

        <div>
          <h5 className="font-bold font-[Outfit] text-foreground mb-4">Explore</h5>
          <ul className="space-y-2.5">
            {links.map(l => (
              <li key={l.v}>
                <button onClick={() => setView(l.v)} className="text-sm text-muted-foreground hover:text-primary transition-colors">{l.label}</button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h5 className="font-bold font-[Outfit] text-foreground mb-4">Festival Towns</h5>
          <div className="space-y-3">
            {MUNICIPALITIES.map(m => (
              <div key={m.id}>
                <button onClick={() => setView("guide")} className="text-sm font-semibold text-foreground hover:text-primary transition-colors">{m.name}</button>
                <p className="text-xs text-muted-foreground mt-0.5">{FALLBACK_FESTIVALS.find(f => f.municipality === m.id)?.title}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h5 className="font-bold font-[Outfit] text-foreground mb-4">LGU Tourism Offices</h5>
          <div className="space-y-4">
            {contacts.map(c => (
              <div key={c.id || c.town || c.name}>
                <p className="text-sm font-semibold text-foreground">{c.name || c.town}</p>
                {c.office_name && <p className="text-xs text-muted-foreground mt-1">{c.office_name}{c.contact_person ? ` · ${c.contact_person}` : ""}</p>}
                <p className="text-xs text-muted-foreground flex items-start gap-1.5 mt-1"><MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" /> {c.address}</p>
                {c.phone && <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5"><Phone className="w-3 h-3 flex-shrink-0" /> {c.phone}</p>}
                {c.email && <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5"><Mail className="w-3 h-3 flex-shrink-0" /> {c.email}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="border-t border-border py-5 text-center text-xs text-muted-foreground px-6">
        © {year} FestivaLGU · All rights reserved · A joint project of the LGUs of Bay, Calauan &amp; Los Baños, Laguna
      </div>
    </footer>
  );
}

// ─── Countdown Timer ─────────────────────────────────────────────────────────

function Countdown({ target, label }: { target?: string | null; label?: string }) {
  const [time, setTime] = useState({ days: 0, hours: 0, mins: 0, secs: 0 });

  useEffect(() => {
    if (!target) return;
    const tick = () => {
      const diff = new Date(target).getTime() - Date.now();
      setTime({
        days: Math.max(0, Math.floor(diff / 86400000)),
        hours: Math.max(0, Math.floor((diff % 86400000) / 3600000)),
        mins: Math.max(0, Math.floor((diff % 3600000) / 60000)),
        secs: Math.max(0, Math.floor((diff % 60000) / 1000)),
      });
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [target]);

  const Unit = ({ v, label }: { v: number; label: string }) => (
    <div className="text-center">
      <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl w-16 h-16 flex items-center justify-center mb-1">
        <span className="text-2xl font-bold font-[Outfit] text-white">{String(v).padStart(2, "0")}</span>
      </div>
      <span className="text-xs text-white/70 uppercase tracking-widest">{label}</span>
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-4">
      {label && <p className="text-white/60 text-sm uppercase tracking-widest">{label}</p>}
      <div className="flex items-center gap-3">
        <Unit v={time.days} label="Days" />
        <span className="text-white/50 text-2xl font-bold mb-5">:</span>
        <Unit v={time.hours} label="Hours" />
        <span className="text-white/50 text-2xl font-bold mb-5">:</span>
        <Unit v={time.mins} label="Mins" />
        <span className="text-white/50 text-2xl font-bold mb-5">:</span>
        <Unit v={time.secs} label="Secs" />
      </div>
    </div>
  );
}

// ─── Home Page ────────────────────────────────────────────────────────────────

function HomePage() {
  const { setView } = useApp();
  const [festivals, setFestivals] = useState<Festival[]>(FALLBACK_FESTIVALS);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [spotlightIdx, setSpotlightIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    supabase.from("festivals").select("*").order("start_date").then(({ data }) => {
      if (data && data.length) setFestivals(data);
    });
    supabase.from("announcements").select("*").order("created_at", { ascending: false }).limit(3).then(({ data }) => {
      if (data) setAnnouncements(data);
    });
  }, []);

  useEffect(() => {
    if (paused || festivals.length < 2) return;
    const t = setInterval(() => setSpotlightIdx(i => (i + 1) % festivals.length), 5000);
    return () => clearInterval(t);
  }, [paused, festivals.length]);

  const heroFestival = festivals[spotlightIdx % Math.max(festivals.length, 1)];

  const nextFestival = (() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const upcoming = festivals
      .filter(f => f.start_date && new Date(`${f.start_date}T00:00:00`) >= todayStart)
      .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());
    // If all festivals have already run, fall back to the earliest upcoming
    // season so the countdown never points at a past date.
    return upcoming[0] || [...festivals].sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())[0];
  })();

  const fallbackAnn = [
    { id: 1, title: "Registration Now Open for the 2026 Laguna Festival Season", description: "Tourists, organizers, MSMEs, and LGU staff can register now.", image: null, created_by: null, created_at: "2026-08-01", tag: "Registration" },
    { id: 2, title: "Festival QR Stamp Cards Are Here", description: "Scan in on each festival day to unlock milestone rewards.", image: null, created_by: null, created_at: "2026-07-28", tag: "Feature" },
    { id: 3, title: "Three Towns, Three Harvest Festivals", description: "Bayeños · Bañamos · Pinya — celebrate with us this year.", image: null, created_by: null, created_at: "2026-07-20", tag: "Call for Entry" },
  ];

  const displayAnn = announcements.length ? announcements.map((a, i) => ({ ...a, tag: ["Registration", "Feature", "Call for Entry"][i % 3] })) : fallbackAnn;

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <AnimatePresence mode="wait">
            <motion.img key={spotlightIdx} src={FESTIVAL_BG[spotlightIdx % FESTIVAL_BG.length]} alt="Festival"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }}
              className="w-full h-full object-cover" />
          </AnimatePresence>
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80" />
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/40 via-transparent to-sky-900/40" />
        </div>

        {/* Clickable festival logos */}
        <div className="absolute top-20 left-0 right-0 z-20 flex items-center justify-center flex-wrap gap-2 px-4 pt-3">
          {festivals.map((f, i) => (
            <button key={f.id} onClick={() => { setSpotlightIdx(i); setPaused(true); }}
              title={`View ${f.title}`}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold backdrop-blur-sm transition-all border ${
                i === spotlightIdx ? "bg-white/25 text-white border-white/50 shadow-lg" : "bg-black/30 text-white/70 border-white/15 hover:bg-black/50 hover:text-white"}`}>
              <img src={f.logo || ""} alt="" loading="lazy" className="w-5 h-5 rounded-full object-cover" />
              <span className="hidden sm:inline">{f.title}</span>
              <span className="sm:hidden">{f.location}</span>
            </button>
          ))}
        </div>

        <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
            <Badge variant="success"><Zap className="w-3 h-3 mr-1 inline" /> 2026 Laguna Festival Season</Badge>
            <h1 className="text-5xl md:text-7xl font-bold font-[Outfit] text-white mt-6 mb-4 leading-tight">
              {heroFestival ? <>{heroFestival.title}</> : <>Celebrate the Spirit of the Philippines</>}
            </h1>
            <p className="text-lg text-white/85 max-w-2xl mx-auto mb-4">
              {heroFestival?.tagline || "Discover vibrant festivals, authentic local products, and unforgettable cultural experiences through our centralized tourism management platform."}
            </p>
            {heroFestival && (
              <div className="flex items-center justify-center gap-2 flex-wrap mb-8">
                <span className="flex items-center gap-1.5 text-xs text-white/70"><MapPin className="w-3.5 h-3.5" /> {heroFestival.location}</span>
                {heroFestival.start_date && (
                  <span className="text-xs text-white/50 font-mono">
                    {new Date(heroFestival.start_date).toLocaleDateString("en-PH", { month: "short", day: "numeric" })} – {new Date(heroFestival.end_date || heroFestival.start_date).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-3 mb-12">
              <Btn size="lg" onClick={() => setView("events")} icon={Calendar}>Explore Events</Btn>
              <Btn variant="outline" size="lg" onClick={() => setView("register")} className="border-white/30 text-white hover:bg-white/10">Register Now</Btn>
            </div>
            <div className="mb-4">
              {(() => {
                // Only show a live timer for a genuinely upcoming festival; a
                // stale/past date would render "00:00:00:00" and mislead visitors.
                const start = nextFestival ? new Date(`${nextFestival.start_date}T00:00:00`).getTime() : -1;
                const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
                return nextFestival && start >= todayMidnight.getTime() ? (
                  <Countdown target={`${nextFestival.start_date}T00:00:00`} label={`Next: ${nextFestival.title} — ${nextFestival.location}`} />
                ) : (
                  <p className="text-white/70 text-sm uppercase tracking-widest">2026 Laguna Festival Season — dates to be announced soon.</p>
                );
              })()}
            </div>
          </motion.div>
        </div>
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <ChevronDown className="w-6 h-6 text-white/50" />
        </div>
      </section>

      {/* Stats */}
      <section className="bg-gradient-to-r from-primary to-secondary py-6 px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-center text-white">
          {[["3", "Laguna Municipalities"], ["1,200+", "MSMEs Supported"], ["15,000+", "Annual Tourists"], ["48+", "Festival Events"]].map(([v, l]) => (
            <div key={l}><p className="text-3xl font-bold font-[Outfit]">{v}</p><p className="text-white/80 text-sm">{l}</p></div>
          ))}
        </div>
      </section>

      {/* Festival Spotlight — click the logo to reveal details */}
      <section className="py-20 px-6 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <div className="mb-10">
            <p className="text-primary text-sm font-semibold uppercase tracking-widest mb-2">Logo Spotlight</p>
            <h2 className="text-4xl font-bold font-[Outfit] text-foreground">Tap a festival logo to explore</h2>
          </div>
          <div className="grid lg:grid-cols-[280px_1fr] gap-6">
            <div className="flex lg:flex-col gap-3 overflow-x-auto lg:overflow-visible">
              {festivals.map((f, i) => (
                <button key={f.id} onClick={() => { setSpotlightIdx(i); setPaused(true); }}
                  className={`flex-shrink-0 flex items-center gap-3 rounded-2xl border p-3 text-left transition-all ${i === spotlightIdx ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}>
                  <img src={f.logo || ""} alt={f.title} className="w-12 h-12 rounded-xl object-cover" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">{f.title}</p>
                    <p className="text-xs text-muted-foreground">{f.location}</p>
                  </div>
                </button>
              ))}
            </div>
            {heroFestival && (
              <motion.div key={heroFestival.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                <GlassCard className="p-7 h-full">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-5">
                    <img src={heroFestival.logo || ""} alt={heroFestival.title} className="w-28 h-28 rounded-3xl object-cover shadow-lg" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-3">
                        <Badge variant="success">{heroFestival.title}</Badge>
                        <Badge variant="info">{MUNI_NAME[heroFestival.municipality || ""] || "Laguna"}</Badge>
                      </div>
                      {heroFestival.tagline && <h3 className="text-xl font-bold font-[Outfit] text-foreground mb-2">{heroFestival.tagline}</h3>}
                      <p className="text-sm text-muted-foreground mb-4">{heroFestival.description}</p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {heroFestival.start_date && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-muted-foreground"><CalendarDays className="w-3.5 h-3.5" /> {new Date(heroFestival.start_date).toLocaleDateString("en-PH", { month: "long", day: "numeric" })} – {new Date(heroFestival.end_date || heroFestival.start_date).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}</span>
                        )}
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-muted-foreground"><MapPin className="w-3.5 h-3.5" /> {heroFestival.location}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2.5 mt-6">
                    <Btn size="sm" onClick={() => setView("register")}>Register Now</Btn>
                    <Btn variant="outline" size="sm" onClick={() => setView("events")}>View Events</Btn>
                  </div>
                </GlassCard>
              </motion.div>
            )}
          </div>
        </div>
      </section>

      {/* Featured Festivals */}
      <section className="py-20 px-6 bg-background">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-end justify-between mb-10">
            <div>
              <p className="text-primary text-sm font-semibold uppercase tracking-widest mb-2">Discover</p>
              <h2 className="text-4xl font-bold font-[Outfit] text-foreground">Featured Festivals</h2>
            </div>
            <Btn variant="outline" icon={ArrowRight} onClick={() => setView("events")}>View All</Btn>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {festivals.slice(0, 3).map((f, i) => (
              <motion.div key={f.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} viewport={{ once: true }}>
                <button onClick={() => { setSpotlightIdx(i); setPaused(true); }} className="w-full text-left">
                  <GlassCard className="overflow-hidden group cursor-pointer hover:scale-[1.02] transition-transform duration-300 h-full">
                    <div className="relative h-48 overflow-hidden bg-muted">
                      <img src={f.banner || `https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&h=400&fit=crop`} alt={f.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      {f.logo && <img src={f.logo} alt={`${f.title} logo`} className="absolute left-3 top-3 w-12 h-12 rounded-xl object-cover ring-2 ring-white/40 shadow" />}
                      <div className="absolute bottom-3 left-3">
                        <Badge variant="success">{f.start_date ? `${new Date(f.start_date).toLocaleDateString("en-PH", { month: "short", day: "numeric" })} – ${new Date(f.end_date || f.start_date).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}` : ""}</Badge>
                      </div>
                    </div>
                    <div className="p-5">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-bold font-[Outfit] text-foreground">{f.title}</h3>
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground text-sm mb-2">
                        <MapPin className="w-3.5 h-3.5" /> {f.location}
                      </div>
                      <p className="text-sm text-foreground/80 mb-3">{f.tagline}</p>
                      <p className="text-sm text-muted-foreground line-clamp-2">{f.description}</p>
                    </div>
                  </GlassCard>
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Festival Gallery */}
      <section className="py-20 px-6 bg-background">
        <div className="max-w-6xl mx-auto">
          <div className="mb-10 text-center">
            <p className="text-primary text-sm font-semibold uppercase tracking-widest mb-2">Gallery</p>
            <h2 className="text-4xl font-bold font-[Outfit] text-foreground">Moments from the Festivals</h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">Street parades, harvest floats, trade fairs, and fireworks across Bay, Los Baños, and Calauan.</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {GALLERY_ITEMS.map((g, i) => (
              <motion.div key={g.src} initial={{ opacity: 0, scale: 0.96 }} whileInView={{ opacity: 1, scale: 1 }} transition={{ delay: (i % 4) * 0.06 }} viewport={{ once: true }}
                className={`relative rounded-2xl overflow-hidden group ${i === 0 ? "md:col-span-2 md:row-span-2" : ""}`}>
                <img src={g.src} alt={g.caption} loading="lazy" className={`${i === 0 ? "h-full min-h-[380px]" : "h-44 md:h-52"} w-full object-cover group-hover:scale-105 transition-transform duration-500`} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                <p className="absolute bottom-3 left-4 right-4 text-white text-sm font-semibold">{g.caption}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Announcements */}
      <section className="py-20 px-6 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <div className="mb-10">
            <p className="text-secondary text-sm font-semibold uppercase tracking-widest mb-2">Latest</p>
            <h2 className="text-4xl font-bold font-[Outfit] text-foreground">Announcements</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {displayAnn.map((a, i) => (
              <motion.div key={a.id} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }} viewport={{ once: true }}>
                <GlassCard className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <Badge variant="info">{a.tag}</Badge>
                    <span className="text-xs text-muted-foreground font-mono">{a.created_at?.slice(0, 10)}</span>
                  </div>
                  <h4 className="font-bold font-[Outfit] text-foreground mb-2">{a.title}</h4>
                  <p className="text-sm text-muted-foreground">{a.description}</p>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/90 via-emerald-600/90 to-secondary/90" />
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
        <div className="relative z-10 max-w-3xl mx-auto text-center text-white">
          <h2 className="text-4xl font-bold font-[Outfit] mb-4">Join the FestivaLGU Community</h2>
          <p className="text-white/80 mb-8">Register as a tourist to earn rewards, discover events, and connect with local MSMEs.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Btn size="lg" className="bg-white text-primary hover:bg-white/90" onClick={() => setView("register")}>Create Free Account</Btn>
            <Btn variant="outline" size="lg" className="border-white/40 text-white hover:bg-white/10" onClick={() => setView("login")}>Sign In</Btn>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── About Page ───────────────────────────────────────────────────────────────

function AboutPage() {
  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <Badge variant="success">About Us</Badge>
          <h1 className="text-5xl font-bold font-[Outfit] text-foreground mt-4 mb-4">FestivaLGU — Laguna Festival Tourism</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">A centralized digital platform by the LGUs of Bay, Calauan, and Los Baños to promote their harvest festivals, support local MSMEs, and reward every tourist who joins the celebration.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {[
            { title: "Our Mission", icon: Zap, text: "To digitize and promote Laguna's festivals through an accessible, inclusive platform that connects tourists, MSMEs, and the LGU.", color: "bg-primary" },
            { title: "Our Vision", icon: Globe, text: "To be the model festival-tourism platform in the Philippines — three towns, three festivals, one unforgettable province.", color: "bg-secondary" },
            { title: "Core Values", icon: Heart, text: "Cultural pride, community empowerment, sustainable tourism, and innovation.", color: "bg-accent" },
          ].map(item => (
            <GlassCard key={item.title} className="p-6">
              <div className={`${item.color} w-10 h-10 rounded-xl flex items-center justify-center mb-4`}><item.icon className="w-5 h-5 text-white" /></div>
              <h3 className="font-bold font-[Outfit] text-foreground mb-2">{item.title}</h3>
              <p className="text-sm text-muted-foreground">{item.text}</p>
            </GlassCard>
          ))}
        </div>
        <GlassCard className="p-8">
          <h3 className="text-2xl font-bold font-[Outfit] text-foreground mb-6 text-center">Our Festival Towns</h3>
          <div className="grid sm:grid-cols-3 gap-4 mb-8">
            {MUNICIPALITIES.map((m, i) => (
              <div key={m.id} className="rounded-2xl overflow-hidden relative h-40 group">
                <img src={FESTIVAL_BG[i]} alt={m.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                <div className="absolute bottom-3 left-4 right-4">
                  <p className="text-white font-bold font-[Outfit]">{m.name}, {m.province}</p>
                  <p className="text-white/70 text-xs">{FALLBACK_FESTIVALS.find(f => f.municipality === m.id)?.title}</p>
                </div>
              </div>
            ))}
          </div>
          <h3 className="text-xl font-bold font-[Outfit] text-foreground mb-6 text-center">Festival Tourism at a Glance</h3>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { v: "3", l: "Festivals Managed", Icon: Ticket },
              { v: "3", l: "Member Municipalities", Icon: Landmark },
              { v: "1,200+", l: "MSMEs Supported", Icon: Building2 },
              { v: "15K+", l: "Tourist Visits", Icon: Users },
            ].map(({ v, l, Icon }) => (
              <div key={String(l)} className="text-center p-4 rounded-xl bg-muted/50">
                <Icon className="w-6 h-6 mx-auto mb-2 text-primary" />
                <p className="text-2xl font-bold font-[Outfit] text-foreground">{v}</p>
                <p className="text-sm text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

// ─── Events Page ──────────────────────────────────────────────────────────────

function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "upcoming" | "past">("all");
  const [festFilter, setFestFilter] = useState("all");

  useEffect(() => {
    supabase.from("events").select("*, festivals(title)").order("start_time").then(({ data, error }) => {
      setEvents(error || !data?.length ? FALLBACK_EVENTS as Event[] : data);
      setLoading(false);
    });
  }, []);

  const festivals = Array.from(new Map(events.map(e => [e.festivals?.title, e.festivals?.title])).values()).filter(Boolean) as string[];
  const logoOf = (title: string) => FALLBACK_FESTIVALS.find(f => f.title === title)?.logo || "";

  const filtered = events.filter(e => {
    const matchSearch =
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      (e.festivals?.title || "").toLowerCase().includes(search.toLowerCase()) ||
      (e.venue || "").toLowerCase().includes(search.toLowerCase());
    const matchFest = festFilter === "all" || e.festivals?.title === festFilter;
    const upcoming = new Date(e.start_time) > new Date();
    const matchStatus = status === "all" || (status === "upcoming" ? upcoming : !upcoming);
    return matchSearch && matchFest && matchStatus;
  });

  const fmt = (dt: string) => new Date(dt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const fmtTime = (dt: string) => new Date(dt).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
  const isUpcoming = (dt: string) => new Date(dt) > new Date();

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-10">
          <Badge variant="info">Events</Badge>
          <h1 className="text-5xl font-bold font-[Outfit] text-foreground mt-3 mb-2">Festival Events</h1>
          <p className="text-muted-foreground">Tap a festival logo to filter the program lineup.</p>
        </div>
        <div className="flex flex-wrap gap-2 mb-6">
          <button onClick={() => setFestFilter("all")}
            className={`flex items-center gap-2 rounded-full pl-1.5 pr-4 py-1.5 text-sm font-medium border transition-all ${festFilter === "all" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
            <span className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-secondary text-white text-[10px] font-bold flex items-center justify-center">All</span>
            All Festivals
          </button>
          {festivals.map(f => (
            <button key={f} onClick={() => setFestFilter(f)}
              className={`flex items-center gap-2 rounded-full pl-1.5 pr-4 py-1.5 text-sm font-medium border transition-all ${festFilter === f ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
              {logoOf(f) ? <img src={logoOf(f)} alt="" className="w-6 h-6 rounded-full object-cover" /> : <Calendar className="w-4 h-4" />}
              {f}
            </button>
          ))}
        </div>
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <div className="flex-1"><Input placeholder="Search by title, venue, or festival…" value={search} onChange={setSearch} icon={Search} /></div>
          <select value={festFilter} onChange={e => setFestFilter(e.target.value)}
            className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm">
            <option value="all">All Festivals</option>
            {festivals.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value as any)}
            className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm">
            <option value="all">All Status</option>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
          </select>
        </div>
        {loading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : (
          <div className="space-y-4">
            {filtered.map((e, i) => (
              <motion.div key={e.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <GlassCard className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="bg-primary/10 rounded-2xl p-3 w-fit"><Calendar className="w-6 h-6 text-primary" /></div>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h3 className="font-bold font-[Outfit] text-foreground">{e.title}</h3>
                        <Badge variant={isUpcoming(e.start_time) ? "success" : "default"}>{isUpcoming(e.start_time) ? "Upcoming" : "Past"}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">{e.festivals?.title}</p>
                      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                        {e.venue && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{e.venue}</span>}
                        <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{fmt(e.start_time)}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{fmtTime(e.start_time)}</span>
                      </div>
                    </div>
                    <Btn variant="outline" size="sm" icon={Heart} onClick={() => toast.info("Sign in as a tourist to save events.")}>Save</Btn>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
            {!filtered.length && <p className="text-center text-muted-foreground py-16">No events found.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MSMEs Page ───────────────────────────────────────────────────────────────

function MSMEsPage() {
  const [msmes, setMSMEs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [town, setTown] = useState("all");
  const [selected, setSelected] = useState<any>(null);
  const [page, setPage] = useState(1);
  const pageSize = 6;

  useEffect(() => {
    // Public directory shows only fully-registered (approved + paid) businesses
    // and, per business, only the LGU-published products.
    supabase.from("msmes").select("*, products(id, product_name, price, image, description, approved)").eq("status", "approved").then(({ data }) => {
      setMSMEs((data as any) || []);
      setLoading(false);
    });
  }, []);

  const photos = [
    "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=400&h=300&fit=crop",
    "https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=400&h=300&fit=crop",
  ];

  const categories = Array.from(new Set(msmes.map(m => m.category).filter(Boolean))) as string[];

  const filtered = msmes.filter(m => {
    const matchSearch = m.business_name.toLowerCase().includes(search.toLowerCase()) || (m.description || "").toLowerCase().includes(search.toLowerCase());
    const matchCat = category === "all" || m.category === category;
    const matchTown = town === "all" || m.municipality === town;
    return matchSearch && matchCat && matchTown;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-10">
          <Badge variant="warning">MSMEs</Badge>
          <h1 className="text-5xl font-bold font-[Outfit] text-foreground mt-3 mb-2">Local Business Directory</h1>
          <p className="text-muted-foreground text-sm">Approved Lagunense businesses selling their products and pasalubong across our three festival towns.</p>
        </div>
        <div className="flex flex-col gap-3 mb-6">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setTown("all")} className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition-all ${town === "all" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>All Towns</button>
            {MUNICIPALITIES.map(m => (
              <button key={m.id} onClick={() => setTown(m.id)} className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition-all ${town === m.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
                {m.name}
              </button>
            ))}
          </div>
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1"><Input placeholder="Search businesses…" value={search} onChange={setSearch} icon={Search} /></div>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm">
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {loading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <GlassCard className="p-12 text-center">
            <Building2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No approved MSMEs in this town yet — check back after the next LGU approval cycle!</p>
          </GlassCard>
        ) : (
          <div className="grid sm:grid-cols-2 gap-6">
            {visible.map((m, i) => {
              const liveCount = (m.products || []).filter((p: any) => p.approved).length;
              return (
                <button key={m.id} onClick={() => setSelected(m)}
                  className="text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-2xl cursor-pointer">
                  <GlassCard className="overflow-hidden h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-xl group-hover:border-primary/40">
                    <div className="h-48 overflow-hidden bg-muted relative">
                      <img src={m.logo || photos[i % photos.length]} alt={m.business_name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      {m.municipality && (
                        <div className="absolute top-3 left-3"><Badge variant="info"><Landmark className="w-3 h-3 mr-1 inline" />{MUNI_NAME[m.municipality] || "Laguna"}</Badge></div>
                      )}
                    </div>
                    <div className="p-5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h3 className="font-bold font-[Outfit] text-foreground text-lg">{m.business_name}</h3>
                        {m.category && <Badge variant="info">{m.category}</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{m.description || "Local MSME partner"}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <p className="text-xs text-muted-foreground font-mono">{liveCount} product{liveCount === 1 ? "" : "s"} on sale</p>
                        {m.contact_number && <p className="text-xs text-muted-foreground font-mono flex items-center gap-1"><Phone className="w-3 h-3" />{m.contact_number}</p>}
                      </div>
                      <p className="inline-flex items-center gap-1 text-sm font-semibold text-primary mt-3">View Business <ArrowRight className="w-4 h-4" /></p>
                    </div>
                  </GlassCard>
                </button>
              );
            })}
            {pageCount > 1 && <div className="col-span-full flex items-center justify-center gap-3 mt-2"><Btn size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)} icon={ChevronLeft}>Previous</Btn><span className="text-sm text-muted-foreground">Page {page} of {pageCount}</span><Btn size="sm" variant="outline" disabled={page === pageCount} onClick={() => setPage(p => p + 1)} icon={ChevronRight}>Next</Btn></div>}
          </div>
        )}
      </div>
      <AnimatePresence>
        {selected && <MSMEProfileModal m={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
}

// ─── MSME Detail Modal (shared by public directory + tourist dashboard) ───────

function MSMEProfileModal({ m, onClose }: { m: any; onClose: () => void }) {
  const { dark } = useApp();
  const approvedProducts = (m.products || []).filter((p: any) => p.approved);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 12 }} transition={{ duration: 0.2 }}
        className={`relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border shadow-2xl ${dark ? "bg-[#121212]" : "bg-white"}`}>
        <div className="relative h-44 bg-muted">
          <img src={m.logo || "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&h=400&fit=crop"} alt={m.business_name} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
          <button onClick={onClose} className="absolute top-3 right-3 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors">
            <X className="w-4 h-4" />
          </button>
          <div className="absolute bottom-3 left-4 right-4">
            <div className="flex items-center gap-2 flex-wrap">
              {m.municipality && <Badge variant="info"><Landmark className="w-3 h-3 mr-1 inline" />{MUNI_NAME[m.municipality] || "Laguna"}</Badge>}
              {m.category && <Badge variant="warning">{m.category}</Badge>}
            </div>
            <h3 className="text-white font-bold font-[Outfit] text-xl mt-1">{m.business_name}</h3>
          </div>
        </div>
        <div className="p-5">
          <p className="text-sm text-muted-foreground">{m.description || "Local MSME partner."}</p>
          <div className="grid sm:grid-cols-2 gap-3 mt-4 text-sm">
            {m.address && (
              <div className="flex items-start gap-2 text-foreground">
                <MapPin className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <span>{m.address}</span>
              </div>
            )}
            {m.contact_number && (
              <div className="flex items-center gap-2 text-foreground">
                <Phone className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="font-mono">{m.contact_number}</span>
              </div>
            )}
          </div>
          <h4 className="font-bold font-[Outfit] text-foreground mt-5 mb-3">Products on Sale</h4>
          {approvedProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products listed yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {approvedProducts.map((p: any) => (
                <div key={p.id} className="rounded-xl border border-border overflow-hidden bg-muted/40 group cursor-default">
                  {p.image && <img src={p.image} alt={p.product_name} className="w-full h-20 object-cover" />}
                  <div className="p-2.5">
                    <p className="text-xs font-semibold text-foreground leading-tight">{p.product_name}</p>
                    <p className="text-xs font-mono text-accent mt-1">₱{Number(p.price).toLocaleString()}</p>
                    {p.description && <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{p.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Guide Page ───────────────────────────────────────────────────────────────

function GuidePage() {
  const [activeSection, setActiveSection] = useState("maps");
  const [items, setItems] = useState<GuideItem[] | null>(null);
  const [venues, setVenues] = useState<MapVenue[]>([]);
  const [town, setTown] = useState("all");

  useEffect(() => {
    supabase.from("guide_items").select("*").order("sort_order").then(({ data, error }) => {
      setItems(!error && data?.length ? (data as GuideItem[]) : FALLBACK_GUIDE);
    });
    supabase.from("map_venues").select("*").order("sort_order").then(({ data }) => {
      if (data?.length) setVenues(data as MapVenue[]);
    });
  }, []);

  const sections = [
    { id: "maps", label: "Festival Maps", icon: MapIcon },
    { id: "transportation", label: "Transportation", icon: Bus },
    { id: "hotels", label: "Hotels & Stays", icon: Building2 },
    { id: "restaurants", label: "Restaurants", icon: Utensils },
    { id: "emergency", label: "Emergency Contacts", icon: Phone },
  ];

  const list = items || FALLBACK_GUIDE;
  const sectionItems = (s: string) => list.filter(i => i.section === s);

  const transportIcon = (t: string) => {
    const n = t.toLowerCase();
    if (n.includes("tricycle") || n.includes("bike")) return Bike;
    if (n.includes("van") || n.includes("uv") || n.includes("car") || n.includes("shuttle") || n.includes("taxi")) return Car;
    if (n.includes("pedicab") || n.includes("walk") || n.includes("foot")) return Footprints;
    return Bus;
  };

  const emergencyStyle = (t: string) => {
    const n = t.toLowerCase();
    if (n.includes("police")) return { icon: Shield, color: "bg-blue-500" };
    if (n.includes("fire")) return { icon: AlertCircle, color: "bg-red-500" };
    if (n.includes("hospital") || n.includes("medical") || n.includes("clinic")) return { icon: Activity, color: "bg-green-500" };
    if (n.includes("tourism")) return { icon: Info, color: "bg-amber-500" };
    if (n.includes("assistance") || n.includes("help")) return { icon: Users, color: "bg-purple-500" };
    return { icon: Phone, color: "bg-rose-500" };
  };

  const mapsItems = sectionItems("maps");
  const mapImg = mapsItems.find(i => i.is_map_image && i.image) || mapsItems.find(i => i.image);
  const mapSpots = mapsItems.filter(i => !(i.is_map_image && i.image));

  const imgFallback = (section: string) => section === "hotels"
    ? "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=400&fit=crop"
    : "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&h=400&fit=crop";

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-10">
          <Badge variant="info">Tourist Guide</Badge>
          <h1 className="text-5xl font-bold font-[Outfit] text-foreground mt-3 mb-2">Plan Your Visit</h1>
          <p className="text-muted-foreground max-w-2xl">Everything you need for a smooth, safe, and unforgettable festival trip.</p>
        </div>

        <div className="flex flex-wrap gap-2 mb-8">
          {sections.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all capitalize ${activeSection === s.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              <s.icon className="w-4 h-4" />
              {s.label}
            </button>
          ))}
        </div>

        {activeSection === "maps" && (() => {
          const shown = town === "all" ? venues : venues.filter(v => v.municipality === town);
          return (
            <div className="grid lg:grid-cols-5 gap-6">
              <GlassCard className="lg:col-span-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h3 className="font-bold font-[Outfit] text-foreground text-lg flex items-center gap-2"><MapIcon className="w-5 h-5 text-primary" /> {mapImg?.title || "Festival Venue Map"}</h3>
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => setTown("all")} className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${town === "all" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>All Towns</button>
                    {MUNICIPALITIES.map(m => (
                      <button key={m.id} onClick={() => setTown(m.id)} className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${town === m.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
                        {m.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative rounded-2xl overflow-hidden bg-muted h-[380px]">
                  {shown.length > 0 ? (
                    <Suspense fallback={<div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading map…</div>}>
                      <FestivalMap venues={shown} />
                    </Suspense>
                  ) : (
                    <>
                      <img src={mapImg?.image || "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=700&fit=crop"} alt="Town map" className="w-full h-full object-cover opacity-90" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
                      <div className="absolute inset-0 p-4 flex flex-col justify-end">
                        <div className="flex flex-wrap gap-2">
                          {mapSpots.map((spot, i) => (
                            <span key={spot.id || i} className="px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm border border-white/20 text-white text-xs">{i + 1}. {spot.title}</span>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {shown.length > 0
                  ? <p className="text-xs text-muted-foreground mt-3">Interactive map — tap a marker to open walking/driving directions in Google Maps.</p>
                  : <p className="text-xs text-muted-foreground mt-3">{mapImg?.body || "Download the official festival map at the LGU Tourism Office or visit any info booth on site."}</p>}
              </GlassCard>
              <div className="lg:col-span-2 space-y-4">
                {shown.length === 0 && <GlassCard className="p-4 text-sm text-muted-foreground">No map venues added yet.</GlassCard>}
                {shown.map(spot => (
                  <GlassCard key={spot.id} className="p-4">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="font-semibold text-foreground">{spot.name}</h4>
                      {spot.area && <Badge variant="info">{spot.area}</Badge>}
                    </div>
                    {spot.address && <p className="text-sm text-muted-foreground">{spot.address}</p>}
                    {typeof spot.lat === "number" && typeof spot.lng === "number" && (
                      <a className="inline-flex items-center gap-1 text-xs text-primary font-semibold mt-2" target="_blank" rel="noreferrer"
                        href={`https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}`}>
                        <ExternalLink className="w-3 h-3" /> Get Directions
                      </a>
                    )}
                  </GlassCard>
                ))}
              </div>
            </div>
          );
        })()}

        {activeSection === "transportation" && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {sectionItems("transportation").map(t => {
              const Icon = transportIcon(t.title);
              return (
                <GlassCard key={t.id} className="p-5">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3"><Icon className="w-5 h-5 text-primary" /></div>
                  <h4 className="font-bold font-[Outfit] text-foreground">{t.title}</h4>
                  {t.body && <p className="text-sm text-muted-foreground mt-1 mb-3">{t.body}</p>}
                  {(t.meta || t.tag) && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-mono font-semibold text-accent">{t.meta}</span>
                      <span className="text-xs text-muted-foreground">{t.tag}</span>
                    </div>
                  )}
                </GlassCard>
              );
            })}
            {sectionItems("transportation").length === 0 && <GlassCard className="p-4 text-sm text-muted-foreground">No transportation options added yet.</GlassCard>}
          </div>
        )}

        {activeSection === "hotels" && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {sectionItems("hotels").map(h => (
              <GlassCard key={h.id} className="overflow-hidden">
                <div className="h-40"><img src={h.image || imgFallback("hotels")} alt={h.title} className="w-full h-full object-cover" /></div>
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold font-[Outfit] text-foreground">{h.title}</h4>
                    {h.tag && <span className="flex items-center gap-1 text-xs font-semibold"><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />{h.tag.split("★")[0]}★</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{[h.subtitle, h.tag?.replace(/^\d+\.\d+\s★\s?/, "")].filter(Boolean).join(" • ")}</p>
                  {h.body && <p className="text-xs text-muted-foreground mt-1">{h.body}</p>}
                  {h.meta && <p className="text-accent font-mono font-semibold text-sm mt-2">{h.meta}</p>}
                </div>
              </GlassCard>
            ))}
            {sectionItems("hotels").length === 0 && <GlassCard className="p-4 text-sm text-muted-foreground">No hotels added yet.</GlassCard>}
          </div>
        )}

        {activeSection === "restaurants" && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {sectionItems("restaurants").map(r => (
              <GlassCard key={r.id} className="overflow-hidden">
                <div className="h-36"><img src={r.image || imgFallback("restaurants")} alt={r.title} className="w-full h-full object-cover" /></div>
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold font-[Outfit] text-foreground">{r.title}</h4>
                    {r.meta && <span className="text-xs font-mono text-muted-foreground">{r.meta}</span>}
                  </div>
                  {r.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{r.subtitle}</p>}
                  {r.tag && <p className="text-xs text-accent mt-2">{r.tag}</p>}
                </div>
              </GlassCard>
            ))}
            {sectionItems("restaurants").length === 0 && <GlassCard className="p-4 text-sm text-muted-foreground">No restaurants added yet.</GlassCard>}
          </div>
        )}

        {activeSection === "emergency" && (
          <div className="space-y-6">
            <div className="grid sm:grid-cols-2 gap-4">
              {sectionItems("emergency").map(c => {
                const { icon: Icon, color } = emergencyStyle(c.title);
                return (
                  <GlassCard key={c.id} className="p-4 flex items-center gap-4">
                    <div className={`${color} w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0`}><Icon className="w-5 h-5 text-white" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground">{c.title}</p>
                      <p className="text-sm text-muted-foreground font-mono">{c.meta}</p>
                    </div>
                    {c.subtitle && <Badge variant="info">{c.subtitle}</Badge>}
                  </GlassCard>
                );
              })}
              {sectionItems("emergency").length === 0 && <GlassCard className="p-4 text-sm text-muted-foreground">No emergency contacts added yet.</GlassCard>}
            </div>
            <GlassCard className="p-5 border-primary/30">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold font-[Outfit] text-foreground mb-1">Festival Safety Tips</h4>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
                    <li>Keep your phone charged and carry a power bank.</li>
                    <li>Note the nearest exit and first aid station at every venue.</li>
                    <li>Stay hydrated and wear light, comfortable clothing.</li>
                    <li>Keep valuables secure — use the free bag counters at info booths.</li>
                  </ul>
                </div>
              </div>
            </GlassCard>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Contact Page ─────────────────────────────────────────────────────────────

function ContactPage() {
  const { profile } = useApp();
  const [munis, setMunis] = useState<any[]>([]);
  const [town, setTown] = useState("all");
  const [form, setForm] = useState({ name: profile?.fullname || "", email: profile?.email || "", subject: "", message: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from("municipalities").select("*").then(({ data }) => {
      if (data?.length) setMunis(data);
    });
  }, []);

  const selected = munis.find(m => m.id === town);

  const submit = async () => {
    if (!form.name || !form.email || !form.message) { toast.error("Please fill in your name, email, and message."); return; }
    if (town === "all") { toast.error("Please choose a municipality first."); return; }
    setLoading(true);
    const { error } = await supabase.from("contact_messages").insert({
      municipality: town, name: form.name, email: form.email, subject: form.subject || "General Inquiry", message: form.message,
    });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    toast.success(`Message sent to ${MUNI_NAME[town] || "the LGU"}! We'll get back to you within 24 hours.`);
    setForm(p => ({ ...p, message: "", subject: "" }));
    setLoading(false);
  };

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <Badge variant="info">Get in Touch</Badge>
          <h1 className="text-5xl font-bold font-[Outfit] text-foreground mt-3 mb-2">Contact Us</h1>
          <p className="text-muted-foreground">Choose a municipality to see its LGU contact details and route your message to the right office.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {MUNICIPALITIES.map(m => (
            <button key={m.id} onClick={() => setTown(m.id)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${town === m.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
              {m.name}, {m.province}
            </button>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-8">
          <GlassCard className="p-6">
            <h3 className="font-bold font-[Outfit] text-foreground text-xl mb-5">Send a Message {selected ? `to ${selected.name}` : ""}</h3>
            <div className="space-y-4">
              <Input label="Full Name" placeholder="Juan dela Cruz" value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} icon={Users} />
              <Input label="Email" type="email" placeholder="juan@email.com" value={form.email} onChange={v => setForm(p => ({ ...p, email: v }))} icon={Mail} />
              <Input label="Subject" placeholder="General Inquiry" value={form.subject} onChange={v => setForm(p => ({ ...p, subject: v }))} icon={FileText} />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Message</label>
                <textarea value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))} rows={4}
                  className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
              </div>
              <Btn onClick={submit} disabled={loading} className="w-full justify-center">{loading ? "Sending…" : "Send Message"}</Btn>
              <p className="text-xs text-muted-foreground text-center">Messages are routed to the selected municipality's admin panel.</p>
            </div>
          </GlassCard>
          <div className="space-y-6">
            {selected ? (
              <GlassCard className="p-6">
                <h4 className="font-bold font-[Outfit] text-foreground mb-4">{selected.name} — Tourism Office</h4>
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center mb-4"><Landmark className="w-5 h-5 text-white" /></div>
                {[
                  { icon: MapPin, text: `${selected.address} · Laguna` },
                  { icon: Phone, text: selected.phone },
                  { icon: Mail, text: selected.email },
                  { icon: Clock, text: selected.hours },
                  ...(selected.facebook ? [{ icon: Globe, text: selected.facebook }] : []),
                ].map(c => (
                  <div key={`${c.icon}-${c.text}`} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
                    <c.icon className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="text-sm text-foreground">{c.text}</span>
                  </div>
                ))}
              </GlassCard>
            ) : (
              <GlassCard className="p-6">
                <h4 className="font-bold font-[Outfit] text-foreground mb-4">LGU Tourism Offices — Laguna</h4>
                {[
                  { icon: MapPin, text: "Bay Municipal Hall · Los Baños Municipal Hall · Calauan Municipal Hall, Laguna" },
                  { icon: Phone, text: "+63 919-456-7890" },
                  { icon: Mail, text: "tourism@festivallgu.gov.ph" },
                  { icon: Globe, text: "www.festivallgu.gov.ph" },
                ].map(c => (
                  <div key={c.text} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
                    <c.icon className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="text-sm text-foreground">{c.text}</span>
                  </div>
                ))}
              </GlassCard>
            )}
            <GlassCard className="p-6">
              <p className="text-xs text-muted-foreground mb-3 font-semibold uppercase tracking-wider">Municipality Tourism Officers</p>
              {MUNICIPALITIES.map(m => (
                <div key={m.id} className="flex items-center gap-2.5 py-2">
                  <div className={`w-2 h-2 rounded-full bg-gradient-to-br ${m.gradient}`} />
                  <span className="text-sm text-foreground">{m.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto font-mono">{m.id}@festivallgu.gov.ph</span>
                </div>
              ))}
            </GlassCard>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Auth Pages ───────────────────────────────────────────────────────────────

// ─── Demo accounts config ───────────────────────────────────────────────────

const DEMO_ACCOUNTS = [
  { role: "admin"     as UserRole, label: "Bay Admin · Bayeños",        email: "admin@festivalglu.ph",             color: "bg-emerald-500", name: "Admin Rivera"       },
  { role: "admin"     as UserRole, label: "Los Baños Admin · Bañamos",   email: "losbanos.admin@festivalglu.ph",    color: "bg-indigo-500",  name: "Ka Mario Cruz"      },
  { role: "admin"     as UserRole, label: "Calauan Admin · Pinya",       email: "calauan.admin@festivalglu.ph",     color: "bg-amber-500",   name: "Aling Nena Reyes"   },
  { role: "organizer" as UserRole, label: "Bay Organizer",              email: "organizer@festivalglu.ph",         color: "bg-sky-500",     name: "Carlos Mendoza"     },
  { role: "organizer" as UserRole, label: "Calauan Organizer",          email: "calauan.organizer@festivalglu.ph", color: "bg-cyan-500",    name: "Rosa Villanueva"    },
  { role: "organizer" as UserRole, label: "Los Baños Organizer",        email: "losbanos.organizer@festivalglu.ph",color: "bg-teal-500",    name: "Lito Salvador"      },
  { role: "msme"      as UserRole, label: "MSME · Elena's Delicacies",  email: "msme@festivalglu.ph",              color: "bg-pink-500",    name: "Elena Cruz"         },
  { role: "msme"      as UserRole, label: "MSME · Kultura Crafts",      email: "msme2@festivalglu.ph",             color: "bg-orange-500",  name: "Rico Dalisay"       },
  { role: "msme"      as UserRole, label: "MSME · Makiling Coffee",     email: "msme3@festivalglu.ph",             color: "bg-lime-500",    name: "Diana Lopez"        },
  { role: "msme"      as UserRole, label: "Unpaid MSME · Fee Due",      email: "msme4@festivalglu.ph",             color: "bg-rose-500",    name: "Nilda Torres"       },
  { role: "tourist"   as UserRole, label: "Tourist",                    email: "tourist@festivalglu.ph",           color: "bg-violet-500",  name: "Maria Santos"       },
  { role: "tourist"   as UserRole, label: "Tourist (3-day)",            email: "ana@festivalglu.ph",               color: "bg-fuchsia-500", name: "Ana Reyes"          },
  { role: "tourist"   as UserRole, label: "Tourist",                    email: "jose@festivalglu.ph",              color: "bg-purple-500",  name: "Jose Tan"           },
  { role: "tourist"   as UserRole, label: "Tourist",                    email: "lina@festivalglu.ph",              color: "bg-blue-500",    name: "Lina Bautista"      },
];

const DEMO_PASSWORD = "Festival@2025";

// When true, the forgot-password flow is mid-way (OTP verify signs the user
// in) — suppress the automatic dashboard redirect until the flow completes.
let resetFlowActive = false;

// Demo accounts are seeded locally — no Supabase setup required.

function ForgotPasswordPage() {
  const { setView } = useApp();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const stepTitles = ["Verify Email", "Enter Code", "New Password"];
  const stepIcons = [Mail, KeyRound, Shield];

  const handleRequestCode = async () => {
    if (!email) { toast.error("Please enter your email address."); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    toast.success("Reset code sent! Check your email.");
    setStep(2);
    setLoading(false);
  };

  const handleVerifyCode = async () => {
    if (!code) { toast.error("Please enter the verification code."); return; }
    setLoading(true);
    // The OTP verify signs the user in — suppress the auto-redirect while the
    // reset flow is in progress so we can set the new password first.
    resetFlowActive = true;
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "email" });
    if (error) {
      resetFlowActive = false;
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setStep(3);
    setLoading(false);
  };

  const handleReset = async () => {
    if (!password || !confirm) { toast.error("Please fill all fields."); return; }
    if (password.length < 6) { toast.error("Password must be at least 6 characters."); return; }
    if (password !== confirm) { toast.error("Passwords do not match."); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    resetFlowActive = false;
    await supabase.auth.signOut();
    toast.success("Password updated! You can now sign in.");
    setView("login");
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 pt-16 pb-10">
      <motion.div className="w-full max-w-md" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <GlassCard className="p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center mx-auto mb-4">
              <KeyRound className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold font-[Outfit] text-foreground">Reset Password</h1>
            <div className="flex justify-center gap-2 mt-3">
              {[1, 2, 3].map(s => <div key={s} className={`h-1.5 w-12 rounded-full transition-colors ${step >= s ? "bg-primary" : "bg-muted"}`} />)}
            </div>
            <p className="text-sm text-muted-foreground mt-3">{stepTitles[step - 1]}</p>
          </div>

          {step === 1 && (
            <div>
              <div className="mb-6">
                <Input label="Email Address" type="email" placeholder="juan@email.com" value={email} onChange={setEmail} icon={Mail} />
                <p className="text-xs text-muted-foreground mt-2">
                  We'll email you a 6-digit code to verify it's you. It expires in 10 minutes.
                </p>
              </div>
              <Btn onClick={handleRequestCode} disabled={loading} className="w-full justify-center" size="lg">
                {loading ? <><Spinner /> Sending…</> : "Send Code"}
              </Btn>
              <p className="text-center text-sm text-muted-foreground mt-4">
                Remembered it?{" "}
                <button onClick={() => setView("login")} className="text-primary font-medium hover:underline">Sign in</button>
              </p>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="mb-6">
                <Input label="Verification Code" placeholder="000000" value={code} onChange={setCode} icon={KeyRound} />
                <div className="flex items-center gap-1.5 mt-2">
                  <p className="text-xs text-muted-foreground">Didn't get it? </p>
                  <button onClick={handleRequestCode} disabled={loading} className="text-xs text-primary font-medium hover:underline">
                    Resend code
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <Btn variant="outline" onClick={() => setStep(1)} className="flex-1 justify-center">Back</Btn>
                <Btn onClick={handleVerifyCode} disabled={loading} className="flex-1 justify-center">
                  {loading ? <><Spinner /> Verifying…</> : "Verify Code"}
                </Btn>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="space-y-4 mb-6">
                <Input label="New Password" type="password" placeholder="Min. 6 characters" value={password} onChange={setPassword} icon={Shield} />
                <Input label="Confirm Password" type="password" placeholder="Re-enter new password" value={confirm} onChange={setConfirm} icon={Shield} />
              </div>
              <div className="flex gap-2">
                <Btn variant="outline" onClick={() => setStep(2)} className="flex-1 justify-center">Back</Btn>
                <Btn onClick={handleReset} disabled={loading} className="flex-1 justify-center">
                  {loading ? <><Spinner /> Updating…</> : "Update Password"}
                </Btn>
              </div>
            </div>
          )}
        </GlassCard>
      </motion.div>
    </div>
  );
}

function LoginPage() {
  const { setView } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // ── Login ────────────────────────────────────────────────────────────────
const handleLogin = async () => {
    if (!email || !password) { toast.error("Enter your email and password."); return; }
    setLoginLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) toast.error(error.message);
    else if (data.user) await recordActivity("login", "user", data.user.id, `Successful sign-in for ${email}.`);
    setLoginLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 pt-16 pb-10">
      <div className="absolute inset-0 overflow-hidden">
        <img src="https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1600&h=900&fit=crop" alt="bg" className="w-full h-full object-cover opacity-20" />
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background/95 to-background/90" />
      </div>

      <motion.div className="relative w-full max-w-md" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <GlassCard className="p-7">

          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Ticket className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold font-[Outfit] text-foreground">FestivaLGU</h1>
            <p className="text-muted-foreground text-sm mt-1">Sign in to your account</p>
          </div>

          <form onSubmit={e => { e.preventDefault(); void handleLogin(); }}>
          <div className="space-y-3 mb-4">
            <Input type="email" placeholder="Email address" value={email} onChange={setEmail} icon={Mail} />
            <Input type="password" placeholder="Password" value={password} onChange={setPassword} icon={Shield} />
          </div>
          <div className="flex justify-end -mt-2 mb-3">
            <button onClick={() => setView("forgot-password")} className="text-xs text-primary font-medium hover:underline">
              Forgot password?
            </button>
          </div>
          <Btn disabled={loginLoading} className="w-full justify-center mb-2" size="lg">
            {loginLoading ? <><Spinner /> Signing In…</> : "Sign In"}
          </Btn>
          </form>
          <p className="text-center text-xs text-muted-foreground mb-5">
            No account?{" "}
            <button onClick={() => setView("register")} className="text-primary font-medium hover:underline">Register</button>
          </p>
        </GlassCard>
      </motion.div>
    </div>
  );
}

// Labelled native <select> styled like <Input>.
function SelectField({ label, value, onChange, options, placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; placeholder?: string; required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// Dropdown with a search box — for long lists like business categories.
function SearchSelect({ label, value, onChange, options, placeholder = "Search…", required }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; placeholder?: string; required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const matches = options.filter(o => o.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-1.5 relative" ref={ref}>
      <label className="text-sm font-medium text-foreground">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <button type="button" onClick={() => { setOpen(o => !o); setQuery(""); }}
        className="w-full flex items-center justify-between gap-2 bg-input-background border border-border rounded-xl px-4 py-2.5 text-left focus:outline-none focus:ring-2 focus:ring-primary/50">
        <span className={value ? "text-foreground truncate" : "text-muted-foreground"}>{value || "Select…"}</span>
        <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-border bg-popover shadow-xl overflow-hidden">
          <div className="p-2 border-b border-border relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={placeholder}
              className="w-full bg-input-background rounded-lg pl-7 pr-3 py-2 text-sm text-foreground focus:outline-none" />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {matches.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">No match — choose "Other" and specify.</p>
            ) : matches.map(o => (
              <button key={o} type="button" onClick={() => { onChange(o); setOpen(false); }}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-muted/60 ${o === value ? "text-primary font-semibold" : "text-foreground"}`}>
                {o}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// LGU default registration fee per business size for a town.
function useFeeRates(town: string | null | undefined) {
  const [rates, setRates] = useState<Record<string, number>>({});
  const load = useCallback(async () => {
    if (!town) { setRates({}); return; }
    const { data } = await supabase.from("registration_fee_rates").select("business_size, amount").eq("municipality", town);
    const map: Record<string, number> = {};
    for (const r of (data as any[]) || []) map[r.business_size] = Number(r.amount);
    setRates(map);
  }, [town]);
  useEffect(() => { load(); }, [load]);
  return { rates, reload: load };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PH_MOBILE_RE = /^(09\d{9}|\+639\d{9})$/;

function RegisterPage() {
  const { setView } = useApp();
  const [role, setRole] = useState<UserRole>("tourist");
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    // personal
    name: "", birthdate: "", sex: "", contact: "", email: "", address: "", city: "", province: "Laguna",
    // business
    business_name: "", business_type: "", business_type_other: "", category: "", category_other: "",
    business_address: "", years: "", employees: "", size: "", reg_no: "", municipality: "bay",
    // account
    password: "", confirm: "",
  });
  const set = (k: keyof typeof form) => (v: string) => setForm(p => ({ ...p, [k]: v }));
  const { rates } = useFeeRates(role === "msme" ? form.municipality : null);

  const isMSME = role === "msme";
  const steps = isMSME ? ["Role", "Personal", "Business", "Account"] : ["Role", "Account"];
  const age = ageFrom(form.birthdate);

  const roles: { value: UserRole; label: string; icon: React.ElementType; desc: string }[] = [
    { value: "tourist", label: "Tourist / Visitor", icon: Users, desc: "Browse festivals, scan QR stamps, earn points and rewards" },
    { value: "msme", label: "MSME / Local Business", icon: ShoppingBag, desc: "Register your business, pay the fee, get approved, sell festival products" },
  ];

  const validatePersonal = () => {
    if (!form.name.trim()) return "Enter your full name.";
    if (!form.birthdate) return "Enter your date of birth.";
    if (age === null || age < 18) return "Business owners must be at least 18 years old.";
    if (!PH_MOBILE_RE.test(form.contact.replace(/[\s-]/g, ""))) return "Enter a valid mobile number (e.g. 09171234567).";
    if (!EMAIL_RE.test(form.email.trim())) return "Enter a valid email address.";
    if (!form.address.trim() || !form.city.trim() || !form.province.trim()) return "Complete your residential address, city/municipality, and province.";
    return null;
  };

  const validateBusiness = () => {
    if (!form.business_name.trim()) return "Enter your business name.";
    if (!form.business_type) return "Select a business type.";
    if (form.business_type === "Other" && !form.business_type_other.trim()) return "Specify your business type.";
    if (!form.category) return "Select a business category / industry.";
    if (form.category === "Other" && !form.category_other.trim()) return "Specify your business category.";
    if (!form.business_address.trim()) return "Enter your business address.";
    if (form.years === "" || !/^\d+$/.test(form.years)) return "Enter years in operation (0 if new).";
    if (form.employees !== "" && !/^\d+$/.test(form.employees)) return "Number of employees must be a whole number.";
    if (!form.size) return "Select your business size.";
    return null;
  };

  const next = () => {
    const err = step === 2 && isMSME ? validatePersonal() : step === 3 && isMSME ? validateBusiness() : null;
    if (err) { toast.error(err); return; }
    setStep(s => s + 1);
  };

  const handleRegister = async () => {
    if (role !== "tourist" && role !== "msme") {
      toast.error("Admin and organizer accounts are created by LGU staff.");
      return;
    }
    if (isMSME) {
      const err = validatePersonal() || validateBusiness();
      if (err) { toast.error(err); return; }
    } else if (!form.name.trim()) { toast.error("Enter your full name."); return; }
    if (!EMAIL_RE.test(form.email.trim())) { toast.error("Enter a valid email address."); return; }
    if (form.password.length < 6) { toast.error("Password must be at least 6 characters."); return; }
    if (form.password !== form.confirm) { toast.error("Passwords do not match."); return; }
    setLoading(true);
    const meta: Record<string, any> = { fullname: form.name.trim(), role, municipality: isMSME ? form.municipality : null };
    if (isMSME) {
      Object.assign(meta, {
        birthdate: form.birthdate, sex: form.sex, contact_number: form.contact.replace(/[\s-]/g, ""),
        personal_email: form.email.trim(), residential_address: form.address.trim(), city: form.city.trim(), province: form.province.trim(),
        business_name: form.business_name.trim(),
        business_type: form.business_type === "Other" ? form.business_type_other.trim() : form.business_type,
        category: form.category === "Other" ? form.category_other.trim() : form.category,
        business_address: form.business_address.trim(), years_in_operation: form.years, employee_count: form.employees,
        business_size: form.size, business_reg_no: form.reg_no.trim(),
      });
    }
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: { data: meta },
    });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    if (isMSME) nextDashTab = "business";
    if (data.session) {
      // Email confirmation is off — already signed in.
      toast.success(isMSME ? "Account created! Complete your business requirements and registration fee next." : "Account created! Welcome aboard!");
    } else {
      // Email confirmation required — tell the user to check their inbox.
      toast.success("Account created! Check your email to confirm your account, then sign in.");
      setView("login");
    }
    setLoading(false);
  };

  const fee = form.size ? rates[form.size] : undefined;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 pt-16 pb-10">
      <motion.div className={`w-full ${isMSME && step > 1 ? "max-w-2xl" : "max-w-lg"}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <GlassCard className="p-6 sm:p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center mx-auto mb-4">
              <UserCheck className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold font-[Outfit] text-foreground">Create Account</h1>
            <div className="flex justify-center gap-2 mt-3">
              {steps.map((s, i) => <div key={s} title={s} className={`h-1.5 w-12 rounded-full transition-colors ${step >= i + 1 ? "bg-primary" : "bg-muted"}`} />)}
            </div>
            {step > 1 && <p className="text-xs text-muted-foreground mt-2">Step {step} of {steps.length} · {steps[step - 1]}</p>}
          </div>
          {step === 1 && (
            <div>
              <p className="text-sm font-medium text-foreground mb-4">Choose your role:</p>
              <div className="space-y-2 mb-6">
                {roles.map(r => (
                  <button key={r.value} onClick={() => setRole(r.value)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-center gap-3 ${role === r.value ? "border-primary bg-primary/8" : "border-border hover:bg-muted/50"}`}>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${role === r.value ? "bg-primary" : "bg-muted"}`}>
                      <r.icon className={`w-4 h-4 ${role === r.value ? "text-white" : "text-muted-foreground"}`} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{r.label}</p>
                      <p className="text-xs text-muted-foreground">{r.desc}</p>
                    </div>
                    {role === r.value && <CheckCircle className="w-4 h-4 text-primary ml-auto" />}
                  </button>
                ))}
              </div>
              <Btn onClick={() => setStep(2)} className="w-full justify-center" size="lg">Continue</Btn>
              <p className="text-center text-xs text-muted-foreground mt-3">Event organizer and LGU staff accounts are created by the municipality — choose Tourist or MSME to register.</p>
            </div>
          )}
          {isMSME && step === 2 && (
            <div>
              <h3 className="font-bold font-[Outfit] text-foreground mb-4">1. Personal Information</h3>
              <div className="grid sm:grid-cols-2 gap-4 mb-6">
                <div className="sm:col-span-2"><Input label="Full Name *" placeholder="Juan dela Cruz" value={form.name} onChange={set("name")} icon={Users} /></div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">Date of Birth / Age<span className="text-red-500 ml-0.5">*</span></label>
                  <div className="flex items-center gap-2">
                    <input type="date" value={form.birthdate} max={todayStr()} onChange={e => set("birthdate")(e.target.value)}
                      className="flex-1 min-w-0 bg-input-background border border-border rounded-xl py-2.5 px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                    <span className="text-sm font-mono text-muted-foreground w-16 text-right">{age !== null && age >= 0 ? `${age} yrs` : "—"}</span>
                  </div>
                </div>
                <SelectField label="Sex / Gender (optional)" value={form.sex} onChange={set("sex")} placeholder="Prefer not to say"
                  options={["Male", "Female", "Other"].map(v => ({ value: v, label: v }))} />
                <Input label="Contact Number *" placeholder="09171234567" value={form.contact} onChange={set("contact")} icon={Phone} />
                <Input label="Email Address *" type="email" placeholder="juan@email.com" value={form.email} onChange={set("email")} icon={Mail} />
                <div className="sm:col-span-2"><Input label="Residential Address *" placeholder="House no., street, barangay" value={form.address} onChange={set("address")} icon={Home} /></div>
                <Input label="City / Municipality *" placeholder="Bay" value={form.city} onChange={set("city")} icon={MapPin} />
                <Input label="Province *" placeholder="Laguna" value={form.province} onChange={set("province")} icon={Landmark} />
              </div>
              <div className="flex gap-2">
                <Btn variant="outline" onClick={() => setStep(1)} className="flex-1 justify-center">Back</Btn>
                <Btn onClick={next} className="flex-1 justify-center">Next: Business Info</Btn>
              </div>
            </div>
          )}
          {isMSME && step === 3 && (
            <div>
              <h3 className="font-bold font-[Outfit] text-foreground mb-4">2. Business Information</h3>
              <div className="grid sm:grid-cols-2 gap-4 mb-6">
                <div className="sm:col-span-2"><Input label="Business Name *" placeholder="Kenneth Pandesal" value={form.business_name} onChange={set("business_name")} icon={Building2} /></div>
                <SelectField label="Business Type" required value={form.business_type} onChange={set("business_type")} placeholder="Select type…"
                  options={BUSINESS_TYPES.map(v => ({ value: v, label: v }))} />
                <SearchSelect label="Business Category / Industry" required value={form.category} onChange={set("category")} options={BUSINESS_CATEGORIES} placeholder="Search categories…" />
                {form.business_type === "Other" && <Input label="Specify Business Type *" placeholder="e.g. Social Enterprise" value={form.business_type_other} onChange={set("business_type_other")} />}
                {form.category === "Other" && <Input label="Specify Category *" placeholder="e.g. Bamboo Crafts" value={form.category_other} onChange={set("category_other")} />}
                <div className="sm:col-span-2"><Input label="Business Address *" placeholder="Stall no. / street, barangay, town" value={form.business_address} onChange={set("business_address")} icon={MapPin} /></div>
                <Input label="Years in Operation *" type="number" placeholder="0" value={form.years} onChange={set("years")} icon={CalendarDays} />
                <Input label="Number of Employees (optional)" type="number" placeholder="3" value={form.employees} onChange={set("employees")} icon={Users} />
                <SelectField label="Business Size" required value={form.size} onChange={set("size")} placeholder="Select size…"
                  options={BUSINESS_SIZES.map(s => ({ value: s.id, label: `${s.label} — ${s.hint}` }))} />
                <Input label="Business Registration No. (if required)" placeholder="DTI / SEC / CDA no." value={form.reg_no} onChange={set("reg_no")} icon={FileText} />
                <div className="sm:col-span-2 flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">Festival Municipality<span className="text-red-500 ml-0.5">*</span></label>
                  <div className="grid grid-cols-3 gap-2">
                    {MUNICIPALITIES.map(m => (
                      <button key={m.id} type="button" onClick={() => set("municipality")(m.id)}
                        className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${form.municipality === m.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
                        {m.name}, Laguna
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Your business is registered with this LGU — you'll sell at its festival market.</p>
                </div>
              </div>
              {form.size && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 mb-6 flex items-center gap-3">
                  <Wallet className="w-5 h-5 text-primary flex-shrink-0" />
                  <p className="text-sm text-foreground">
                    Registration fee for a <b>{SIZE_LABEL[form.size]}</b> business in {MUNI_NAME[form.municipality]}:{" "}
                    <b className="font-mono">{fee !== undefined ? peso(fee) : "set by the LGU"}</b>
                    <span className="block text-xs text-muted-foreground">You'll pay this after creating your account and uploading your requirements.</span>
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <Btn variant="outline" onClick={() => setStep(2)} className="flex-1 justify-center">Back</Btn>
                <Btn onClick={next} className="flex-1 justify-center">Next: Account</Btn>
              </div>
            </div>
          )}
          {step === steps.length && step > 1 && (
            <form onSubmit={e => { e.preventDefault(); void handleRegister(); }}>
              {isMSME && <h3 className="font-bold font-[Outfit] text-foreground mb-4">3. Account Information</h3>}
              <div className="space-y-4 mb-6">
                {!isMSME && <Input label="Full Name" placeholder="Juan dela Cruz" value={form.name} onChange={set("name")} icon={Users} />}
                <Input label="Email Address" type="email" placeholder="juan@email.com" value={form.email} onChange={set("email")} icon={Mail} />
                <Input label="Password" type="password" placeholder="Min. 6 characters" value={form.password} onChange={set("password")} icon={Shield} />
                <Input label="Confirm Password" type="password" placeholder="Re-enter password" value={form.confirm} onChange={set("confirm")} icon={KeyRound} />
                {form.confirm && form.confirm !== form.password && <p className="text-xs text-red-500 -mt-2">Passwords do not match.</p>}
              </div>
              <div className="flex gap-2">
                <Btn variant="outline" onClick={() => setStep(s => s - 1)} className="flex-1 justify-center">Back</Btn>
                <Btn disabled={loading} className="flex-1 justify-center">
                  {loading ? <><Spinner /> Creating…</> : "Create Account"}
                </Btn>
              </div>
            </form>
          )}
          {step > 1 && (
            <p className="text-center text-sm text-muted-foreground mt-4">
              Already have an account?{" "}
              <button onClick={() => setView("login")} className="text-primary font-medium hover:underline">Sign in</button>
            </p>
          )}
        </GlassCard>
      </motion.div>
    </div>
  );
}

// ─── Profile Settings ──────────────────────────────────────────────────────────

function ProfileSettings() {
  const { profile, authUser, setProfile } = useApp();
  const [fullname, setFullname] = useState(profile?.fullname || "");
  const [birthdate, setBirthdate] = useState(authUser?.user_metadata?.birthdate || profile?.birthdate || "");
  const [email, setEmail] = useState(profile?.email || "");
  const [photo, setPhoto] = useState<string | null>(profile?.profile_photo || null);
  const [savingInfo, setSavingInfo] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFullname(profile.fullname);
    setBirthdate(authUser?.user_metadata?.birthdate || profile?.birthdate || "");
    setEmail(profile.email);
    setPhoto(profile.profile_photo);
  }, [profile]);

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file."); return; }
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  };

  const saveInfo = async () => {
    if (!authUser || !profile) return;
    if (!fullname.trim()) { toast.error("Name cannot be empty."); return; }
    setSavingInfo(true);
    const { error } = await supabase.from("profiles")
      .update({ fullname: fullname.trim(), profile_photo: photo })
      .eq("id", authUser.id);
    if (error) {
      toast.error(error.message);
      setSavingInfo(false);
      return;
    }
    const birthdateValue = birthdate || null;
    await supabase.auth.updateUser({ data: { birthdate: birthdateValue } });
    setProfile({ ...profile, fullname: fullname.trim(), birthdate: birthdateValue, profile_photo: photo });
    toast.success("Profile updated!");
    setSavingInfo(false);
  };

  const verifyCurrent = async () => {
    if (!authUser?.email) return null;
    const { error } = await supabase.auth.signInWithPassword({ email: authUser.email, password: currentPw });
    return error ? "Current password is incorrect." : null;
  };

  const changeEmail = async () => {
    if (!authUser || !profile) return;
    if (!email.trim()) { toast.error("Email cannot be empty."); return; }
    if (email.trim() === authUser.email) { toast.info("That's already your email."); return; }
    if (!currentPw) { toast.error("Enter your current password to change email."); return; }
    setChangingEmail(true);
    const bad = await verifyCurrent();
    if (bad) { toast.error(bad); setChangingEmail(false); return; }
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    if (error) { toast.error(error.message); setChangingEmail(false); return; }
    await supabase.from("profiles").update({ email: email.trim() }).eq("id", authUser.id);
    setProfile({ ...profile, email: email.trim() });
    setCurrentPw("");
    setChangingEmail(false);
    toast.success("Confirmation link sent to your new email.");
  };

  const changePassword = async () => {
    if (!authUser) return;
    if (!currentPw) { toast.error("Enter your current password."); return; }
    if (newPw.length < 6) { toast.error("New password must be at least 6 characters."); return; }
    if (newPw !== confirmPw) { toast.error("New passwords do not match."); return; }
    setSavingPw(true);
    const bad = await verifyCurrent();
    if (bad) { toast.error(bad); setSavingPw(false); return; }
    const { error } = await supabase.auth.updateUser({ password: newPw });
    if (error) { toast.error(error.message); setSavingPw(false); return; }
    setCurrentPw(""); setNewPw(""); setConfirmPw("");
    setSavingPw(false);
    toast.success("Password updated!");
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <GlassCard className="p-6">
        <h3 className="font-bold font-[Outfit] text-foreground text-lg mb-4">Profile</h3>
        <div className="flex items-center gap-5 mb-6">
          <div className="relative">
            <AvatarIcon name={fullname || "User"} photo={photo} size="lg" />
            <label className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center cursor-pointer shadow-md">
              <Camera className="w-3.5 h-3.5" />
              <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            </label>
          </div>
          <div>
            <p className="font-semibold text-foreground">{profile?.fullname}</p>
            <p className="text-xs text-muted-foreground capitalize">{profile?.role}</p>
          </div>
        </div>

        <div className="space-y-4">
          <Input label="Full Name" placeholder="Your full name" value={fullname} onChange={setFullname} icon={UserCheck} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Birthdate</label>
            <input type="date" value={birthdate} onChange={e => setBirthdate(e.target.value)}
              className="w-full bg-input-background border border-border rounded-xl py-2.5 px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all" />
          </div>
          <Btn onClick={saveInfo} disabled={savingInfo} icon={CheckCircle}>
            {savingInfo ? <><Spinner /> Saving…</> : "Save Changes"}
          </Btn>
        </div>
      </GlassCard>

      <GlassCard className="p-6">
        <h3 className="font-bold font-[Outfit] text-foreground text-lg mb-4">Email Address</h3>
        <div className="space-y-4">
          <Input label="Email" type="email" placeholder="you@email.com" value={email} onChange={setEmail} icon={Mail} />
          <Input label="Current Password" type="password" placeholder="Required to change email" value={currentPw} onChange={setCurrentPw} icon={Shield} />
          <Btn onClick={changeEmail} disabled={changingEmail} icon={CheckCircle}>
            {changingEmail ? <><Spinner /> Sending…</> : "Update Email"}
          </Btn>
          <p className="text-xs text-muted-foreground">We'll email a confirmation link to your new address before it takes effect.</p>
        </div>
      </GlassCard>

      <GlassCard className="p-6">
        <h3 className="font-bold font-[Outfit] text-foreground text-lg mb-4">Password</h3>
        <div className="space-y-4">
          <Input label="Current Password" type="password" placeholder="Enter current password" value={currentPw} onChange={setCurrentPw} icon={Shield} />
          <Input label="New Password" type="password" placeholder="Min. 6 characters" value={newPw} onChange={setNewPw} icon={KeyRound} />
          <Input label="Confirm New Password" type="password" placeholder="Re-enter new password" value={confirmPw} onChange={setConfirmPw} icon={KeyRound} />
          <Btn onClick={changePassword} disabled={savingPw} icon={CheckCircle}>
            {savingPw ? <><Spinner /> Updating…</> : "Change Password"}
          </Btn>
        </div>
      </GlassCard>
    </div>
  );
}

// ─── Notification Bell ─────────────────────────────────────────────────────────

// Rewards a tourist can redeem right now (enough attendance days or points).
async function loadRedeemableRewards(uid: string): Promise<{ rewards: any[]; points: number }> {
  const [rw, rd, pts, logs] = await Promise.all([
    supabase.from("rewards").select("id, reward_name, required_days, required_points, festivals(title)"),
    supabase.from("redeemed_rewards").select("reward_id").eq("tourist_id", uid),
    supabase.from("tourist_points").select("points").eq("tourist_id", uid).maybeSingle(),
    supabase.from("attendance_logs").select("scan_date").eq("tourist_id", uid),
  ]);
  const redeemed = new Set(((rd.data as any[]) || []).map(r => r.reward_id));
  const points = Number((pts.data as any)?.points || 0);
  const days = new Set(((logs.data as any[]) || []).map(l => l.scan_date)).size;
  const rewards = ((rw.data as any[]) || []).filter(r => !redeemed.has(r.id) && (
    days >= (r.required_days ?? 1) || (Number(r.required_points) > 0 && points >= Number(r.required_points))
  ));
  return { rewards, points };
}

type NotifItem = { key: string; title: string; description: string; date: string; tag?: string; unread: boolean; open: () => void };

function NotificationBell({ goTab }: { goTab?: (id: string) => void }) {
  const { authUser, profile, setView } = useApp();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const seenKey = `fglu_notif_seen_${authUser?.id || "guest"}`;
  const rewardSeenKey = `fglu_reward_seen_${authUser?.id || "guest"}`;
  const rewardToastKey = `fglu_reward_toasted_${authUser?.id || "guest"}`;
  const rewardIdsRef = useRef<string[]>([]);
  const role = profile?.role;
  const town = muniOf(profile?.municipality);
  const townScoped = role === "admin" || role === "organizer" || role === "msme";

  const readSet = (key: string) => { try { return new Set<string>(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set<string>(); } };

  const fetchItems = useCallback(async () => {
    let q = supabase
      .from("announcements")
      .select("id, title, description, image, created_at, link_view, festivals(title)")
      .order("created_at", { ascending: false })
      .limit(8);
    if (townScoped && town) {
      const fest = await townFestivalId(town);
      if (fest) q = q.eq("festival_id", fest);
    }
    const { data, error } = await q;
    if (error) return;
    const lastSeen = Number(localStorage.getItem(seenKey) || 0);
    const list: NotifItem[] = (((data || []) as any[]) as Announcement[]).map(a => ({
      key: `a-${a.id}`, title: a.title, description: a.description, date: a.created_at || "",
      tag: [a.festivals?.title, a.link_view ? `Open ${a.link_view}` : ""].filter(Boolean).join(" • "),
      unread: new Date(a.created_at || 0).getTime() > lastSeen,
      open: () => { if (a.link_view) setView(a.link_view as View); },
    }));
    let unreadCount = list.filter(n => n.unread).length;

    // Tourists: rewards that became redeemable, and recently earned points.
    if (role === "tourist" && authUser) {
      const [{ rewards, points }, tx] = await Promise.all([
        loadRedeemableRewards(authUser.id),
        supabase.from("transactions").select("id, points, transaction_type, description, created_at")
          .eq("tourist_id", authUser.id).in("transaction_type", ["purchase_points", "feedback_bonus"])
          .order("created_at", { ascending: false }).limit(5),
      ]);
      const seenRewards = readSet(rewardSeenKey);
      const toasted = readSet(rewardToastKey);
      const fresh = rewards.filter(r => !toasted.has(String(r.id)));
      if (fresh.length) toast.success(`🎁 ${fresh.length === 1 ? `"${fresh[0].reward_name}" is` : `${fresh.length} rewards are`} ready to redeem!`, { id: "reward-ready" });
      unreadCount += rewards.filter(r => !seenRewards.has(String(r.id))).length;
      rewardIdsRef.current = rewards.map(r => String(r.id));
      const rewardItems: NotifItem[] = rewards.map(r => ({
        key: `r-${r.id}`, title: `Reward ready: ${r.reward_name}`,
        description: Number(r.required_points) > 0 && points >= Number(r.required_points)
          ? `You have ${points} points — enough to redeem this now.`
          : "Your festival attendance unlocked this reward. Redeem it now!",
        date: new Date().toISOString(), tag: r.festivals?.title || "Rewards",
        unread: !seenRewards.has(String(r.id)),
        open: () => goTab?.("rewards"),
      }));
      const txItems: NotifItem[] = ((tx.data as any[]) || []).map(t => ({
        key: `t-${t.id}`, title: `+${t.points} points earned`, description: t.description || "Purchase points",
        date: t.created_at, tag: t.transaction_type === "feedback_bonus" ? "Feedback bonus" : "Purchase",
        unread: new Date(t.created_at).getTime() > lastSeen,
        open: () => goTab?.("rewards"),
      }));
      unreadCount += txItems.filter(n => n.unread).length;
      list.unshift(...rewardItems, ...txItems);
      // Each newly redeemable reward toasts only once.
      try { localStorage.setItem(rewardToastKey, JSON.stringify([...new Set([...toasted, ...rewardIdsRef.current])])); } catch { /* storage off */ }
    }
    setItems(list);
    setUnread(unreadCount);
  }, [seenKey, rewardSeenKey, rewardToastKey, townScoped, town, role, authUser, setView, goTab]);

  useEffect(() => { fetchItems(); const t = setInterval(fetchItems, 20000); return () => clearInterval(t); }, [fetchItems]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const markAllRead = () => {
    try {
      localStorage.setItem(seenKey, String(Date.now()));
      const seen = readSet(rewardSeenKey);
      localStorage.setItem(rewardSeenKey, JSON.stringify([...new Set([...seen, ...rewardIdsRef.current])]));
    } catch { /* storage off */ }
    setItems(prev => prev.map(i => ({ ...i, unread: false })));
    setUnread(0);
  };

  const openItem = (n: NotifItem) => {
    setOpen(false);
    markAllRead();
    n.open();
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => { setOpen(o => !o); if (!open) markAllRead(); }} className="p-2 rounded-xl hover:bg-muted relative">
        <Bell className="w-4 h-4 text-muted-foreground" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-primary text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="fixed top-14 right-4 z-[9999] w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-popover shadow-xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h4 className="font-bold font-[Outfit] text-sm text-foreground">Notifications</h4>
              <button onClick={markAllRead} className="text-xs text-primary hover:underline">Mark all read</button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  <Bell className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  No notifications yet.
                </div>
              ) : items.map(n => (
                <button key={n.key} onClick={() => openItem(n)} className="w-full text-left px-4 py-3 border-b border-border/60 last:border-0 hover:bg-muted/40 transition-colors">
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${n.unread ? "bg-primary" : "bg-border"}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{n.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.description}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-1 flex items-center gap-2">
                        <span>{new Date(n.date || "").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                        {n.tag && <span className="text-primary/80">• {n.tag}</span>}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Dashboard Layout ─────────────────────────────────────────────────────────

function DashboardLayout({ title, navItems, children, initialTab }: {
  title: string;
  navItems: { label: string; icon: React.ElementType; id: string }[];
  children: (active: string, setActive: (id: string) => void) => React.ReactNode;
  initialTab?: string;
}) {
  const { profile, logout, setView, dark, toggleDark } = useApp();
  const [active, setActive] = useState(() => {
    const wanted = nextDashTab || initialTab;
    nextDashTab = null;
    return wanted && navItems.some(i => i.id === wanted) ? wanted : navItems[0].id;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed md:relative z-30 w-64 h-full flex flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="p-5 border-b border-sidebar-border">
          <button onClick={() => setView("home")} className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center">
              <Ticket className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-bold text-sm font-[Outfit] text-sidebar-foreground">FestivaLGU</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{title}</p>
            </div>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map(item => (
            <button key={item.id} onClick={() => { setActive(item.id); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${active === item.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:text-sidebar-foreground hover:bg-muted/50"}`}>
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 p-2 rounded-xl mb-1">
            <AvatarIcon name={profile?.fullname || "User"} photo={profile?.profile_photo} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-sidebar-foreground truncate">{profile?.fullname}</p>
              <p className="text-xs text-muted-foreground capitalize">{profile?.role}</p>
            </div>
          </div>
          <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all">
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className={`h-14 border-b border-border px-4 flex items-center justify-between flex-shrink-0 relative z-[60] ${dark ? "bg-black/40" : "bg-white/80"} backdrop-blur-md`}>
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="md:hidden p-2 rounded-xl hover:bg-muted"><Menu className="w-4 h-4" /></button>
            <h2 className="font-bold font-[Outfit] text-foreground text-sm capitalize">{active.replace(/-/g, " ")}</h2>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell goTab={setActive} />
            <button onClick={toggleDark} className="p-2 rounded-xl hover:bg-muted">
              {dark ? <Sun className="w-4 h-4 text-muted-foreground" /> : <Moon className="w-4 h-4 text-muted-foreground" />}
            </button>
            <AvatarIcon name={profile?.fullname || "User"} photo={profile?.profile_photo} />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-5 md:p-6">
          <AnimatePresence mode="wait">
            <motion.div key={active} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              {children(active, setActive)}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function AdminSettings() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const [form, setForm] = useState({ name: MUNI_NAME[town], office_name: "", contact_person: "", phone: "", email: "", address: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("municipalities").select("*").eq("id", town).maybeSingle().then(({ data }) => {
      if (data) setForm({ name: data.name || MUNI_NAME[town], office_name: data.office_name || "", contact_person: data.contact_person || "", phone: data.phone || "", email: data.email || "", address: data.address || "" });
      setLoading(false);
    });
  }, [town]);

  const save = async () => {
    if (!form.office_name || !form.phone || !form.email || !form.address) { toast.error("Complete all tourism office fields."); return; }
    setSaving(true);
    const { error } = await supabase.from("municipalities").upsert({ id: town, name: form.name, office_name: form.office_name, contact_person: form.contact_person, phone: form.phone, email: form.email, address: form.address }, { onConflict: "id" });
    if (error) toast.error(error.message);
    else { await recordActivity("update", "municipality", town, `Updated ${form.name} tourism office contact details.`, town); toast.success("Tourism office details updated."); }
    setSaving(false);
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  return (
    <div className="space-y-5 max-w-2xl">
      <div><h3 className="font-bold font-[Outfit] text-xl text-foreground">Municipality Settings — {form.name}</h3><p className="text-sm text-muted-foreground">Only your assigned municipality can be edited.</p></div>
      <GlassCard className="p-6"><div className="grid sm:grid-cols-2 gap-4">
        <Input label="Office Name" value={form.office_name} onChange={v => setForm(p => ({ ...p, office_name: v }))} icon={Landmark} />
        <Input label="Contact Person" value={form.contact_person} onChange={v => setForm(p => ({ ...p, contact_person: v }))} icon={UserCheck} />
        <Input label="Phone Number" value={form.phone} onChange={v => setForm(p => ({ ...p, phone: v }))} icon={Phone} />
        <Input label="Email" type="email" value={form.email} onChange={v => setForm(p => ({ ...p, email: v }))} icon={Mail} />
        <div className="sm:col-span-2"><Input label="Physical Address" value={form.address} onChange={v => setForm(p => ({ ...p, address: v }))} icon={MapPin} /></div>
      </div><Btn className="mt-5" onClick={save} disabled={saving} icon={Save}>{saving ? "Saving…" : "Save Tourism Office"}</Btn></GlassCard>
    </div>
  );
}

function AdminActivity() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("all");

  useEffect(() => {
    supabase.from("activity_logs").select("*").eq("municipality", town).order("created_at", { ascending: false }).limit(500).then(({ data }) => { setItems(data || []); setLoading(false); });
  }, [town]);

  const filtered = items.filter(item => action === "all" || item.action_type === action);
  const exportLog = () => csvDownload(`${town}-activity-log-${todayStr()}.csv`, ["Date & Time", "User", "Email", "Municipality", "Action", "Record", "Record ID", "Description"], filtered.map(item => [item.created_at, item.user_name, item.user_email, item.municipality, item.action_type, item.record_type, item.record_id, item.description]));
  return <div className="space-y-5"><div className="flex items-center justify-between gap-3 flex-wrap"><div><h3 className="font-bold font-[Outfit] text-xl text-foreground">System Activity Log — {MUNI_NAME[town]}</h3><p className="text-sm text-muted-foreground">Immutable changes and participation records for this municipality.</p></div><div className="flex gap-2"><select value={action} onChange={e => setAction(e.target.value)} className="bg-input-background border border-border rounded-xl px-3 py-2 text-sm text-foreground"><option value="all">All actions</option><option value="create">Create</option><option value="update">Update</option><option value="approve">Approve</option><option value="scan">Scan</option><option value="payment">Payment</option></select><Btn size="sm" variant="outline" icon={Download} onClick={exportLog}>Export CSV</Btn></div></div>{loading ? <div className="flex justify-center py-20"><Spinner /></div> : <GlassCard className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b border-border">{["Date", "User", "Action", "Record", "Details"].map(h => <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase px-4 py-3">{h}</th>)}</tr></thead><tbody>{filtered.map(item => <tr key={item.id} className="border-b border-border last:border-0"><td className="px-4 py-3 text-xs font-mono text-muted-foreground">{localDateLabel(item.created_at)} {localTimeLabel(item.created_at)}</td><td className="px-4 py-3 text-sm text-foreground">{item.user_name || item.user_email || "System"}</td><td className="px-4 py-3"><Badge variant={item.action_type === "scan" ? "info" : item.action_type === "payment" ? "success" : "default"}>{item.action_type}</Badge></td><td className="px-4 py-3 text-sm text-muted-foreground">{item.record_type} #{item.record_id || "—"}</td><td className="px-4 py-3 text-sm text-foreground">{item.description}</td></tr>)}{!filtered.length && <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">No activity recorded yet.</td></tr>}</tbody></table></div></GlassCard>}</div>;
}

// ─── Admin Dashboard ──────────────────────────────────────────────────────────

function AdminDashboard() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality);
  const townName = town ? MUNI_NAME[town] : "";

  const navItems = [
    { label: "Overview", icon: BarChart2, id: "overview" },
    { label: "Users", icon: Users, id: "users" },
    { label: "Festivals", icon: Ticket, id: "festivals" },
    { label: "Events", icon: Calendar, id: "events" },
    { label: "MSMEs", icon: Building2, id: "msmes" },
    { label: "QR Generator", icon: QrCode, id: "qr" },
    { label: "Map Venues", icon: MapPin, id: "map-venues" },
    { label: "Analytics", icon: TrendingUp, id: "analytics" },
    { label: "Feedback", icon: MessageSquare, id: "feedback" },
    { label: "Inquiries", icon: Inbox, id: "inquiries" },
    { label: "Rewards", icon: Gift, id: "rewards" },
    { label: "Announcements", icon: Megaphone, id: "announcements" },
    { label: "Settings", icon: Settings, id: "settings" },
  ];

  return (
    <DashboardLayout title={townName ? `${townName} (Laguna) — Admin Panel` : "Admin Panel"} navItems={navItems}>
      {(active) => {
        if (active === "overview") return <AdminOverview />;
        if (active === "users") return <AdminUsers />;
        if (active === "festivals") return <AdminFestivals />;
        if (active === "events") return <AdminEvents />;
        if (active === "msmes") return <AdminMSMEs />;
        if (active === "qr") return <AdminQR />;
        if (active === "map-venues") return <AdminMapVenues />;
        if (active === "analytics") return <AdminAnalytics />;
        if (active === "feedback") return <AdminFeedback />;
        if (active === "inquiries") return <AdminInquiries />;
        if (active === "rewards") return <AdminRewards />;
        if (active === "announcements") return <AdminAnnouncements />;
        if (active === "settings") return <ProfileSettings />;
        return <PlaceholderView title={active} />;
      }}
    </DashboardLayout>
  );
}

// Resolve the festival id for a municipality, plus a cached helper map of
// town → festival id so every admin/organizer query can be scoped safely.
const _townFestCache: Record<string, number | null> = {};
async function townFestivalId(municipality: Municipality | string | null | undefined): Promise<number | null> {
  const m = muniOf(municipality);
  if (!m) return null;
  if (m in _townFestCache) return _townFestCache[m];
  const { data } = await supabase.from("festivals").select("id").eq("municipality", m).limit(1);
  const id = data?.[0]?.id ?? null;
  if (id) _townFestCache[m] = id;
  return id;
}

// Re-runs `reload` whenever an MSME records a sale in the town (Supabase
// realtime), with a polling fallback if realtime is unavailable.
function useSalesLive(town: string | null | undefined, reload: () => void, everyMs = 30000) {
  useEffect(() => {
    if (!town) return;
    const ch = supabase
      .channel(`sales-${town}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "sales", filter: `municipality=eq.${town}` }, () => reload())
      .subscribe();
    const t = setInterval(reload, everyMs);
    return () => { clearInterval(t); supabase.removeChannel(ch); };
  }, [town, reload, everyMs]);
}

// Donut + legend of attendance scans per venue.
function VenueDonut({ data, size = "w-36 h-36" }: { data: { name: string; value: number }[]; size?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <div className={`relative ${size} flex-shrink-0`}>
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          {data.map((d, i) => {
            const dash = (d.value / total) * 100;
            const el = (
              <circle key={`donut-${d.name}`} cx="18" cy="18" r="15.9" fill="none"
                stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth="3.8"
                strokeDasharray={`${dash} ${100 - dash}`} strokeDashoffset={-offset} pathLength={100} />
            );
            offset += dash;
            return el;
          })}
        </svg>
      </div>
      <div className="space-y-2.5 flex-1 min-w-0">
        {data.map((d, i) => (
          <div key={`legend-${d.name}`} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
              <span className="text-xs text-foreground truncate">{d.name}</span>
            </div>
            <span className="text-xs font-mono text-muted-foreground flex-shrink-0">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminOverview() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];
  const [ana, setAna] = useState<TownAnalytics | null>(null);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  const reload = useCallback(async () => {
    const [a, act] = await Promise.all([
      loadTownAnalytics(town),
      supabase.from("activity_logs").select("*").eq("municipality", town).order("created_at", { ascending: false }).limit(8),
    ]);
    setAna(a);
    setRecentActivity(act.data || []);
  }, [town]);

  useEffect(() => { reload(); }, [reload]);
  // every MSME sale updates the dashboard automatically
  useSalesLive(town, reload);

  const counts = ana?.counts;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="font-bold font-[Outfit] text-lg text-foreground">Overview — Users from:</h3>
        <Badge variant="info"><Landmark className="w-3 h-3 mr-1 inline" /> {townName}, Laguna</Badge>
        <span className="text-xs text-muted-foreground">Data shown is scoped to {townName} only.</span>
      </div>
      <GlassCard className="p-5"><div className="flex items-center justify-between mb-3"><h3 className="font-bold font-[Outfit] text-foreground">Recent Activity</h3><Badge variant="info">Live</Badge></div><div className="space-y-2">{recentActivity.length ? recentActivity.map(item => <div key={item.id} className="flex items-start gap-3 rounded-xl bg-muted/30 p-3"><Activity className="w-4 h-4 text-primary mt-0.5" /><div className="min-w-0 flex-1"><p className="text-sm text-foreground">{item.description}</p><p className="text-xs text-muted-foreground">{item.user_name || item.user_email || "System"} · {localDateLabel(item.created_at)} {localTimeLabel(item.created_at)}</p></div></div>) : <p className="text-sm text-muted-foreground">No activity recorded yet.</p>}</div></GlassCard>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={`Users from ${townName}`} value={counts?.users ?? "—"} icon={Users} color="bg-primary" />
        <StatCard label="Active Events" value={counts?.events ?? "—"} icon={Calendar} color="bg-secondary" />
        <StatCard label="Active MSMEs" value={counts?.approved ?? "—"} icon={Building2} color="bg-accent" />
        <StatCard label="Attendance Scans" value={counts?.scans ?? "—"} icon={ScanLine} color="bg-violet-500" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="MSMEs Awaiting Approval" value={counts?.pending ?? "—"} icon={Clock} color="bg-amber-500" />
        <StatCard label="Fee Due MSMEs" value={counts?.unpaid ?? "—"} icon={Wallet} color="bg-orange-500" />
        <StatCard label="Registration Fee Total" value={counts?.revenue ? `₱${counts.revenue.toLocaleString()}` : "₱0"} icon={TrendingUp} color="bg-emerald-500" />
        <StatCard label="Rewards Redeemed" value={counts?.rewards ?? "—"} icon={Gift} color="bg-rose-500" />
      </div>

      {/* MSME sales — totals only, read-only (no drill-down on the overview) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total MSME Sales" value={counts ? peso(counts.sales) : "—"} icon={DollarSign} color="bg-green-600" />
        <StatCard label="Sales Today" value={counts ? peso(counts.salesToday) : "—"} icon={Receipt} color="bg-sky-500" />
        <StatCard label="Items Sold" value={counts?.itemsSold ?? "—"} icon={ShoppingBag} color="bg-indigo-500" />
        <StatCard label="Sales Transactions" value={counts?.salesCount ?? "—"} icon={Activity} color="bg-teal-500" />
      </div>
      <GlassCard className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold font-[Outfit] text-foreground">Total Sales by Business Owner</h3>
          <Badge variant="info">Live</Badge>
        </div>
        {!ana?.salesByBusiness.length ? (
          <p className="text-sm text-muted-foreground">No active MSMEs in {townName} yet.</p>
        ) : (
          <div className="space-y-2">
            {ana.salesByBusiness.map(b => {
              const max = Math.max(...ana.salesByBusiness.map(x => x.total), 1);
              return (
                <div key={b.id} className="rounded-xl bg-muted/30 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground truncate">{b.name}</p>
                    <p className="text-sm font-mono font-semibold text-foreground flex-shrink-0">{peso(b.total)}</p>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${(b.total / max) * 100}%` }} />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{b.count} transaction{b.count === 1 ? "" : "s"} · {b.items} item{b.items === 1 ? "" : "s"} sold</p>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      <div className="grid md:grid-cols-2 gap-6">
        <GlassCard className="p-5">
          <h3 className="font-bold font-[Outfit] text-foreground mb-4">Attendance (Monthly)</h3>
          <div className="flex items-end gap-2 h-44">
            {(ana?.months ?? []).map(d => {
              const max = Math.max(...(ana?.months ?? []).map(x => x.visitors), 1);
              const pct = Math.round((d.visitors / max) * 100);
              return (
                <div key={d.month} className="flex-1 flex flex-col items-center gap-1 group">
                  <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity font-mono">
                    {d.visitors}
                  </span>
                  <div className="w-full rounded-t-md bg-primary/20 relative overflow-hidden" style={{ height: `${Math.max(pct, 4)}%` }}>
                    <div className="absolute inset-0 bg-primary opacity-70 hover:opacity-100 transition-opacity" />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{d.month}</span>
                </div>
              );
            })}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <h3 className="font-bold font-[Outfit] text-foreground mb-4">Scans by Venue</h3>
          {!ana?.venuePie.length ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No scans recorded yet.</p>
          ) : (
            <div className="flex items-center gap-5 h-44">
              <div className="relative w-36 h-36 flex-shrink-0">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  {(() => {
                    const total = ana.venuePie.reduce((s, d) => s + d.value, 0);
                    let offset = 0;
                    return ana.venuePie.map((d, i) => {
                      const pct = d.value / total;
                      const dash = pct * 100;
                      const el = (
                        <circle key={`donut-${d.name}`} cx="18" cy="18" r="15.9"
                          fill="none" stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth="3.8"
                          strokeDasharray={`${dash} ${100 - dash}`}
                          strokeDashoffset={-offset}
                          pathLength={100} />
                      );
                      offset += dash;
                      return el;
                    });
                  })()}
                </svg>
              </div>
              <div className="space-y-2.5 flex-1 min-w-0">
                {ana.venuePie.map((d, i) => (
                  <div key={`legend-${d.name}`} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-xs text-foreground truncate">{d.name}</span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground flex-shrink-0">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

function AdminUsers() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<Profile | null>(null);
  const [stats, setStats] = useState<{ scans: number; feedback: number; rewards: number }>({ scans: 0, feedback: 0, rewards: 0 });

  useEffect(() => {
    supabase.from("profiles").select("*").eq("municipality", town).order("created_at", { ascending: false }).then(({ data }) => {
      setUsers(data || []);
      setLoading(false);
    });
  }, [town]);

  const filtered = users.filter(u =>
    u.fullname.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const roleVariant: Record<string, "success" | "warning" | "info" | "default"> = {
    admin: "success", organizer: "info", msme: "warning", tourist: "default",
  };

  const exportCSV = () => {
    const headers = ["Full Name", "Email", "Role", "Town", "Joined"];
    const rows = filtered.map(u => [u.fullname, u.email, u.role, MUNI_NAME[u.municipality as string] || town, u.created_at?.slice(0, 10) || ""]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `festivalgu-users-${town}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success("Users exported as CSV.");
  };

  const openView = async (u: Profile) => {
    setViewing(u);
    setStats({ scans: 0, feedback: 0, rewards: 0 });
    const [att, fb, rd] = await Promise.all([
      supabase.from("attendance_logs").select("id", { count: "exact", head: true }).eq("tourist_id", u.id),
      supabase.from("feedback").select("id", { count: "exact", head: true }).eq("tourist_id", u.id),
      supabase.from("redeemed_rewards").select("id", { count: "exact", head: true }).eq("tourist_id", u.id),
    ]);
    setStats({ scans: att.count || 0, feedback: fb.count || 0, rewards: rd.count || 0 });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("profiles").delete().eq("id", id);
    if (!error) { setUsers(prev => prev.filter(p => p.id !== id)); toast.success("User removed."); }
    else toast.error("Could not delete user.");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-bold font-[Outfit] text-xl text-foreground">User Management</h3>
        <Btn variant="outline" icon={Download} size="sm" onClick={exportCSV}>Export CSV</Btn>
      </div>
      <div className="flex gap-3">
        <div className="flex-1"><Input placeholder="Search users…" value={search} onChange={setSearch} icon={Search} /></div>
      </div>
      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : (
        <GlassCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {["Name", "Email", "Role", "Joined", "Actions"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <AvatarIcon name={u.fullname} photo={u.profile_photo} />
                        <span className="text-sm font-medium text-foreground">{u.fullname}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground font-mono">{u.email}</td>
                    <td className="px-4 py-3"><Badge variant={roleVariant[u.role] || "default"}>{u.role}</Badge></td>
                    <td className="px-4 py-3 text-sm text-muted-foreground font-mono">{u.created_at?.slice(0, 10)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openView(u)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"><Eye className="w-3.5 h-3.5" /></button>
                        <button className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500" onClick={() => remove(u.id)}><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">No users found.</td></tr>}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {/* User detail modal */}
      <AnimatePresence>
        {viewing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setViewing(null)}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()} className="w-full max-w-md">
              <GlassCard className="p-6">
                <div className="flex items-start justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <AvatarIcon name={viewing.fullname} photo={viewing.profile_photo} size="lg" />
                    <div>
                      <h4 className="font-bold font-[Outfit] text-foreground">{viewing.fullname}</h4>
                      <p className="text-sm text-muted-foreground font-mono">{viewing.email}</p>
                    </div>
                  </div>
                  <button onClick={() => setViewing(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex flex-wrap gap-2 mb-5">
                  <Badge variant={roleVariant[viewing.role] || "default"}>{viewing.role}</Badge>
                  <Badge variant="info"><Landmark className="w-3 h-3 mr-1 inline" /> {MUNI_NAME[viewing.municipality as string] || town}</Badge>
                  <Badge variant="info">Member since {viewing.created_at?.slice(0, 10) || "—"}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 rounded-xl bg-muted/50">
                    <QrCode className="w-4 h-4 mx-auto mb-1 text-primary" />
                    <p className="text-xl font-bold font-[Outfit] text-foreground">{stats.scans}</p>
                    <p className="text-[11px] text-muted-foreground">Attendance Days</p>
                  </div>
                  <div className="text-center p-3 rounded-xl bg-muted/50">
                    <MessageSquare className="w-4 h-4 mx-auto mb-1 text-secondary" />
                    <p className="text-xl font-bold font-[Outfit] text-foreground">{stats.feedback}</p>
                    <p className="text-[11px] text-muted-foreground">Feedback</p>
                  </div>
                  <div className="text-center p-3 rounded-xl bg-muted/50">
                    <Gift className="w-4 h-4 mx-auto mb-1 text-amber-500" />
                    <p className="text-xl font-bold font-[Outfit] text-foreground">{stats.rewards}</p>
                    <p className="text-[11px] text-muted-foreground">Rewards</p>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const EMPTY_FEST_FORM = { title: "", description: "", location: "", start_date: "", end_date: "", banner: "", slug: "", tagline: "", logo: "" };

function FestivalForm({
  initial, onSave, onCancel, saving,
}: {
  initial: typeof EMPTY_FEST_FORM;
  onSave: (form: typeof EMPTY_FEST_FORM) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(initial);
  const [previewUrl, setPreviewUrl] = useState(initial.banner);
  const [previewLogo, setPreviewLogo] = useState(initial.logo);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof typeof EMPTY_FEST_FORM) => (v: string) => {
    setForm(p => ({ ...p, [k]: v }));
    if (k === "banner") setPreviewUrl(v);
    if (k === "logo") setPreviewLogo(v);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("Image must be under 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const url = ev.target?.result as string;
      setForm(p => ({ ...p, banner: url }));
      setPreviewUrl(url);
    };
    reader.readAsDataURL(file);
  };

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("Image must be under 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const url = ev.target?.result as string;
      setForm(p => ({ ...p, logo: url }));
      setPreviewLogo(url);
    };
    reader.readAsDataURL(file);
  };

  return (
    <GlassCard className="p-5">
      <h4 className="font-bold font-[Outfit] text-foreground mb-4">{initial.title ? "Edit Festival" : "New Festival"}</h4>

      {/* Banner photo */}
      <div className="mb-4">
        <label className="text-sm font-medium text-foreground block mb-1.5">Banner Photo</label>
        <div className="flex gap-3 items-start">
          <div
            onClick={() => fileRef.current?.click()}
            className="w-28 h-20 rounded-xl border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center cursor-pointer overflow-hidden bg-input-background flex-shrink-0 transition-colors relative group">
            {previewUrl
              ? <img src={previewUrl} alt="preview" className="w-full h-full object-cover" onError={() => setPreviewUrl("")} />
              : <><Camera className="w-5 h-5 text-muted-foreground mb-1" /><span className="text-[10px] text-muted-foreground">Click to upload</span></>}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Upload className="w-5 h-5 text-white" />
            </div>
          </div>
          <div className="flex-1">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            <input
              type="url"
              placeholder="Or paste image URL…"
              value={form.banner.startsWith("data:") ? "" : form.banner}
              onChange={e => set("banner")(e.target.value)}
              className="w-full bg-input-background border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-[11px] text-muted-foreground mt-1">Upload a file (max 2 MB) or paste a URL</p>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Input label="Festival Title *" placeholder="Bayeños Festival" value={form.title} onChange={v => setForm(p => ({ ...p, title: v }))} />
        <p className="text-[11px] text-muted-foreground">Display title preserves spaces, accents, and capitalization exactly as entered.</p>
        <Input label="Slug" placeholder="bayenos" value={form.slug} onChange={set("slug")} icon={Link2} />
        <Input label="Location *" placeholder="Bay, Laguna" value={form.location} onChange={set("location")} icon={MapPin} />
        <Input label="Tagline" placeholder="Thanksgiving from the lake and fields" value={form.tagline} onChange={set("tagline")} icon={Sparkles} />
        <Input label="Start Date" type="date" value={form.start_date} onChange={set("start_date")} />
        <Input label="End Date" type="date" value={form.end_date} onChange={set("end_date")} />
        <div className="sm:col-span-2 flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Description</label>
          <textarea
            value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            rows={3}
            placeholder="Describe the festival — its history, highlights, and what visitors can expect…"
            className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          />
        </div>
      </div>

      {/* Festival logo */}
      <div className="mt-4">
        <label className="text-sm font-medium text-foreground block mb-1.5">Festival Logo <span className="text-muted-foreground font-normal">(shown on the home page &amp; stamp card)</span></label>
        <div className="flex gap-3 items-center">
          <div
            onClick={() => logoRef.current?.click()}
            className="w-16 h-16 rounded-2xl border-2 border-dashed border-border hover:border-primary/50 flex items-center justify-center cursor-pointer overflow-hidden bg-input-background flex-shrink-0 transition-colors relative group">
            {previewLogo
              ? <img src={previewLogo} alt="logo preview" className="w-full h-full object-cover" onError={() => setPreviewLogo("")} />
              : <><Camera className="w-5 h-5 text-muted-foreground" /></>}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Upload className="w-4 h-4 text-white" />
            </div>
          </div>
          <div className="flex-1">
            <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />
            <input
              type="url"
              placeholder="Or paste logo URL…"
              value={form.logo.startsWith("data:") ? "" : form.logo}
              onChange={e => set("logo")(e.target.value)}
              className="w-full bg-input-background border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <Btn size="sm" onClick={() => onSave(form)} disabled={saving} icon={saving ? Loader2 : undefined}>
          {saving ? "Saving…" : "Save Festival"}
        </Btn>
        <Btn variant="outline" size="sm" onClick={onCancel}>Cancel</Btn>
      </div>
    </GlassCard>
  );
}

function AdminFestivals() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];
  const [festivals, setFestivals] = useState<Festival[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Festival | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const fest = await townFestivalId(town);
      const res = fest
        ? await supabase.from("festivals").select("*").eq("id", fest)
        : await supabase.from("festivals").select("*").eq("municipality", town);
      setFestivals(res.data?.length ? res.data : []);
      setLoading(false);
    })();
  }, [town]);

  const saveNew = async (form: typeof EMPTY_FEST_FORM) => {
    const title = form.title.trim();
    if (!title || !form.location) { toast.error("Title and location are required."); return; }
    if (form.start_date && form.end_date && new Date(form.end_date) < new Date(form.start_date)) { toast.error("End date must be on or after the start date."); return; }
    const dup = festivals.find(f => f.title.toLowerCase() === title.toLowerCase());
    if (dup) { toast.error(`A festival named "${dup.title}" already exists in ${townName} — use a different name.`); return; }
    setSaving(true);
    const payload = { ...form, title, banner: form.banner || null, logo: form.logo || null, slug: form.slug || slugify(title), municipality: town };
    const { data, error } = await supabase.from("festivals").insert([payload]).select().single();
    if (error) { toast.error(error.message); }
    else { setFestivals(prev => [...prev, data]); setShowAdd(false); await recordActivity("create", "festival", data.id, `Created festival ${title}.`, town); toast.success("Festival added!"); }
    setSaving(false);
  };

  const saveEdit = async (form: typeof EMPTY_FEST_FORM) => {
    if (!editing) return;
    const title = form.title.trim();
    if (!title || !form.location) { toast.error("Title and location are required."); return; }
    if (form.start_date && form.end_date && new Date(form.end_date) < new Date(form.start_date)) { toast.error("End date must be on or after the start date."); return; }
    const dup = festivals.find(f => f.id !== editing.id && f.title.toLowerCase() === title.toLowerCase());
    if (dup) { toast.error(`A festival named "${dup.title}" already exists in ${townName} — use a different name.`); return; }
    setSaving(true);
    const payload = { ...form, title, banner: form.banner || null, logo: form.logo || null, slug: form.slug || editing.slug || slugify(title), municipality: editing.municipality || town };
    const { data, error } = await supabase.from("festivals").update(payload).eq("id", editing.id).select().maybeSingle();
    if (error) { toast.error(error.message); }
    else if (!data) { toast.error("Festival no longer exists — refresh the list."); }
    else { setFestivals(prev => prev.map(f => f.id === editing.id ? data : f)); setEditing(null); await recordActivity("update", "festival", editing.id, `Updated festival ${title}.`, town); toast.success("Festival updated!"); }
    setSaving(false);
  };

  const remove = async (id: number) => {
    const { error } = await supabase.from("festivals").delete().eq("id", id);
    if (!error) { setFestivals(prev => prev.filter(f => f.id !== id)); toast.success("Festival deleted."); }
    else toast.error("Could not delete.");
  };

  const DEFAULT_BANNER = "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=600&h=300&fit=crop";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold font-[Outfit] text-xl text-foreground">Festival Management — {townName}</h3>
          <p className="text-xs text-muted-foreground">You manage the {townName} festival. Other towns' festivals are off-limits.</p>
        </div>
        <Btn icon={PlusCircle} size="sm" onClick={() => { setShowAdd(!showAdd); setEditing(null); }}>Add Festival</Btn>
      </div>

      {showAdd && !editing && (
        <FestivalForm
          initial={EMPTY_FEST_FORM}
          onSave={saveNew}
          onCancel={() => setShowAdd(false)}
          saving={saving}
        />
      )}

      {editing && (
        <FestivalForm
          key={`edit-${editing.id}`}
          initial={{ title: editing.title, description: editing.description ?? "", location: editing.location ?? "", start_date: editing.start_date ?? "", end_date: editing.end_date ?? "", banner: editing.banner ?? "", slug: editing.slug ?? "", tagline: editing.tagline ?? "", logo: editing.logo ?? "" }}
          onSave={saveEdit}
          onCancel={() => setEditing(null)}
          saving={saving}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : festivals.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <Calendar className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">No festivals yet. Click "Add Festival" to create one.</p>
        </GlassCard>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {festivals.map(f => (
            <GlassCard key={`fest-${f.id}`} className="overflow-hidden group">
              <div className="relative h-40">
                <img
                  src={f.banner || DEFAULT_BANNER}
                  alt={f.title}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={e => { (e.target as HTMLImageElement).src = DEFAULT_BANNER; }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                {f.logo && <img src={f.logo} alt={`${f.title} logo`} className="absolute top-2 left-2 w-9 h-9 rounded-lg object-cover ring-2 ring-white/40 shadow" />}
                <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => { setEditing(f); setShowAdd(false); }}
                    className="p-1.5 rounded-lg bg-white/20 backdrop-blur-sm text-white hover:bg-primary/70 transition-colors">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => remove(f.id)}
                    className="p-1.5 rounded-lg bg-white/20 backdrop-blur-sm text-white hover:bg-red-500/70 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="absolute bottom-3 left-3 right-3">
                  <h4 className="font-bold font-[Outfit] text-white text-sm leading-tight">{f.title}</h4>
                </div>
              </div>
              <div className="p-4 space-y-1.5">
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-primary" />{f.location}
                </p>
                {(f.start_date || f.end_date) && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 font-mono">
                    <Calendar className="w-3 h-3 flex-shrink-0" />{f.start_date}{f.end_date ? ` → ${f.end_date}` : ""}
                  </p>
                )}
                {f.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 pt-1">{f.description}</p>
                )}
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminEvents() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];
  const [events, setEvents] = useState<Event[]>([]);
  const [festivals, setFestivals] = useState<Festival[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Event | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ festival_id: "", title: "", venue: "", start_time: "", end_time: "", description: "" });

  useEffect(() => {
    (async () => {
      const fid = await townFestivalId(town);
      const [e, f, p] = await Promise.all([
        fid ? supabase.from("events").select("*, festivals(title)").eq("festival_id", fid).order("start_time") : Promise.resolve({ data: [] as any[] }),
        supabase.from("festivals").select("*").eq("id", fid ?? 0),
        supabase.from("profiles").select("id,fullname").eq("role", "organizer").eq("municipality", town),
      ]);
      setEvents((e.data as any[]) || []);
      setFestivals((f.data as any[]) || []);
      setOrganizers((p.data as any[]) || []);
      setLoading(false);
    })();
  }, [town]);

  const [organizers, setOrganizers] = useState<any[]>([]);

  const startEdit = (e: Event) => {
    setEditing(e);
    setForm({
      festival_id: e.festival_id ? String(e.festival_id) : "",
      title: e.title,
      venue: e.venue,
      start_time: isoToLocalInput(e.start_time),
      end_time: isoToLocalInput(e.end_time),
      description: e.description || "",
    });
    setShowForm(true);
  };

  const save = async () => {
    const startISO = localInputToISO(form.start_time);
    const endISO = localInputToISO(form.end_time);
    if (!form.title || !form.venue || !startISO) { toast.error("Fill required fields (including the start date/time)."); return; }
    if (endISO && new Date(endISO) <= new Date(startISO)) { toast.error("End time must be after the start time."); return; }
    setSaving(true);
    const payload = {
      festival_id: form.festival_id ? Number(form.festival_id) : null,
      title: form.title,
      venue: form.venue,
      start_time: startISO,
      end_time: endISO,
      description: form.description || null,
    };
    if (editing) {
      const { data, error } = await supabase.from("events").update(payload).eq("id", editing.id).select("*, festivals(title)").maybeSingle();
      if (error) toast.error(error.message);
      else if (!data) toast.error("This event no longer exists in the database — refresh the list.");
      else { setEvents(prev => prev.map(ev => ev.id === editing.id ? data : ev)); setShowForm(false); setEditing(null); toast.success("Event updated!"); }
    } else {
      const { data, error } = await supabase.from("events").insert([payload]).select("*, festivals(title)").single();
      if (!error && data) { setEvents(prev => [data, ...prev]); setShowForm(false); toast.success("Event added!"); }
      else toast.error(error?.message || "Could not save event.");
    }
    setSaving(false);
  };

  const remove = async (id: number) => {
    const { error } = await supabase.from("events").delete().eq("id", id);
    if (!error) { setEvents(prev => prev.filter(e => e.id !== id)); toast.success("Event deleted."); }
    else toast.error("Could not delete event.");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-bold font-[Outfit] text-xl text-foreground">Event Management — {townName}</h3>
        <Btn icon={PlusCircle} size="sm" onClick={() => { setShowForm(!showForm); setEditing(null); }}>Add Event</Btn>
      </div>

      {showForm && (
        <GlassCard className="p-5">
          <h4 className="font-bold font-[Outfit] text-foreground mb-4">{editing ? "Edit Event" : "New Event"}</h4>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Festival</label>
              <select value={form.festival_id} onChange={e => setForm(p => ({ ...p, festival_id: e.target.value }))}
                className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">Select festival…</option>
                {festivals.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
              </select>
            </div>
            <Input label="Event Title *" placeholder="Grand Parade" value={form.title} onChange={v => setForm(p => ({ ...p, title: v }))} />
            <Input label="Venue *" placeholder="Town Plaza" value={form.venue} onChange={v => setForm(p => ({ ...p, venue: v }))} icon={MapPin} />
            <Input label="Start Date/Time *" type="datetime-local" value={form.start_time} onChange={v => setForm(p => ({ ...p, start_time: v }))} />
            <Input label="End Date/Time" type="datetime-local" value={form.end_time} onChange={v => setForm(p => ({ ...p, end_time: v }))} />
            <div className="sm:col-span-2 flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Description</label>
              <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2}
                className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Update Event" : "Save Event"}</Btn>
            <Btn variant="outline" size="sm" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Btn>
          </div>
        </GlassCard>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : (
        <GlassCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {["Event", "Festival", "Venue", "Schedule", "Status", "Actions"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map(e => {
                  const upcoming = new Date(e.start_time) > new Date();
                  return (
                    <tr key={`evt-${e.id}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-foreground">{e.title}</p>
                        {e.description && <p className="text-xs text-muted-foreground line-clamp-1">{e.description}</p>}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{e.festivals?.title || "—"}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{e.venue}</td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                        <span className="block">{localTimeLabel(e.start_time)}</span>
                        {e.end_time && <span className="block opacity-70">→ {localTimeLabel(e.end_time)}</span>}
                      </td>
                      <td className="px-4 py-3"><Badge variant={upcoming ? "success" : "default"}>{upcoming ? "Upcoming" : "Past"}</Badge></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => startEdit(e)} className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary"><Edit2 className="w-3.5 h-3.5" /></button>
                          <button onClick={() => remove(e.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!events.length && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No events yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </div>
  );
}

// LGU default registration fees per business size — applied automatically to
// every registration (and to unpaid applications when changed).
function AdminFeeRates({ town, onSaved }: { town: string; onSaved?: () => void }) {
  const { rates, reload } = useFeeRates(town);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(Object.fromEntries(BUSINESS_SIZES.map(s => [s.id, rates[s.id] !== undefined ? String(rates[s.id]) : ""])));
  }, [rates]);

  const save = async () => {
    const rows = BUSINESS_SIZES.map(s => ({ municipality: town, business_size: s.id, amount: Number(draft[s.id]), updated_at: new Date().toISOString() }));
    if (rows.some(r => draft[r.business_size] === "" || !Number.isFinite(r.amount) || r.amount < 0)) {
      toast.error("Enter a fee (₱0 or more) for every business size.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("registration_fee_rates").upsert(rows, { onConflict: "municipality,business_size" });
    if (error) { toast.error(error.message); setSaving(false); return; }
    await recordActivity("update", "registration_fee_rates", town,
      `Default registration fees set — ${rows.map(r => `${SIZE_LABEL[r.business_size]} ₱${r.amount.toLocaleString()}`).join(", ")}.`, town);
    await reload();
    setSaving(false);
    toast.success("Registration fees saved — applied to all unpaid applications.");
    onSaved?.();
  };

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h4 className="font-bold font-[Outfit] text-foreground flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" /> Default Registration Fees</h4>
          <p className="text-xs text-muted-foreground mt-0.5">Charged automatically by business size — no need to set a fee per MSME.</p>
        </div>
        <Btn size="sm" icon={Save} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Fees"}</Btn>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {BUSINESS_SIZES.map(s => (
          <div key={s.id} className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground">{s.label} Business</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₱</span>
              <input type="number" min={0} value={draft[s.id] ?? ""} onChange={e => setDraft(p => ({ ...p, [s.id]: e.target.value }))}
                className="w-full bg-input-background border border-border rounded-xl pl-7 pr-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

const PAY_BADGE: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" | "default" }> = {
  paid: { label: "Paid · Verified", variant: "success" },
  submitted: { label: "Proof Submitted", variant: "info" },
  rejected: { label: "Proof Rejected", variant: "danger" },
  unpaid: { label: "Unpaid", variant: "danger" },
};

function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/50 py-1.5 text-sm">
      <span className="text-muted-foreground flex-shrink-0">{label}</span>
      <span className="text-foreground text-right break-words min-w-0">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

// Full application review for one MSME: owner + business info, requirements,
// uploaded documents, and the proof of payment.
function MSMEReviewPanel({ m, pay, busy, onAction }: {
  m: any; pay: any; busy: boolean;
  onAction: (action: "approve" | "reject_payment" | "reject", note: string) => void;
}) {
  const [docs, setDocs] = useState<any[] | null>(null);
  const [proof, setProof] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [d, p] = await Promise.all([
        supabase.from("msme_documents").select("doc_type, file_name, file_data, uploaded_at").eq("msme_id", m.id),
        pay?.id ? supabase.from("registration_payments").select("proof_file").eq("id", pay.id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      setDocs((d.data as any[]) || []);
      setProof((p.data as any)?.proof_file || null);
    })();
    return () => { cancelled = true; };
  }, [m.id, pay?.id]);

  const docOf = (id: string) => docs?.find(d => d.doc_type === id);
  const age = m.owner_birthdate ? ageFrom(String(m.owner_birthdate)) : null;
  const canApprove = pay && (pay.status === "paid" || (pay.status === "submitted" && pay.proof_file_name));

  return (
    <div className="mt-4 pt-4 border-t border-border space-y-5">
      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <h5 className="text-sm font-bold font-[Outfit] text-foreground mb-2">Personal Information</h5>
          <InfoRow label="Full Name" value={m.owner_name || m.profiles?.fullname} />
          <InfoRow label="Date of Birth / Age" value={m.owner_birthdate ? `${localDateLabel(`${m.owner_birthdate}T12:00:00`)}${age !== null ? ` · ${age} yrs` : ""}` : null} />
          <InfoRow label="Sex / Gender" value={m.owner_sex} />
          <InfoRow label="Contact Number" value={m.owner_contact || m.contact_number} />
          <InfoRow label="Email Address" value={m.owner_email || m.profiles?.email} />
          <InfoRow label="Residential Address" value={m.owner_address} />
          <InfoRow label="City / Municipality" value={m.owner_city} />
          <InfoRow label="Province" value={m.owner_province} />
        </div>
        <div>
          <h5 className="text-sm font-bold font-[Outfit] text-foreground mb-2">Business Information</h5>
          <InfoRow label="Business Name" value={m.business_name} />
          <InfoRow label="Business Type" value={m.business_type} />
          <InfoRow label="Category / Industry" value={m.category} />
          <InfoRow label="Business Address" value={m.address} />
          <InfoRow label="Years in Operation" value={m.years_in_operation} />
          <InfoRow label="No. of Employees" value={m.employee_count} />
          <InfoRow label="Business Size" value={m.business_size ? SIZE_LABEL[m.business_size] : null} />
          <InfoRow label="Registration No." value={m.business_reg_no} />
        </div>
      </div>

      <div>
        <h5 className="text-sm font-bold font-[Outfit] text-foreground mb-2">Business Requirements</h5>
        <div className="grid md:grid-cols-3 gap-x-5">
          <InfoRow label="DTI / SEC / CDA No." value={m.dti_sec_cda_no} />
          <InfoRow label="TIN" value={m.tin} />
          <InfoRow label="Capitalization" value={m.capitalization != null ? peso(m.capitalization) : null} />
        </div>
        {docs === null ? <div className="py-4 flex justify-center"><Spinner /></div> : (
          <div className="grid sm:grid-cols-2 gap-2 mt-3">
            {DOC_TYPES.map(dt => {
              const d = docOf(dt.id);
              return (
                <div key={dt.id} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${d ? "bg-muted/30" : dt.required ? "bg-red-500/5 border border-red-500/30" : "bg-muted/20"}`}>
                  <FileText className={`w-4 h-4 flex-shrink-0 ${d ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground">{dt.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{d ? `${d.file_name || "Uploaded"} · ${localDateLabel(d.uploaded_at)}` : dt.required ? "Missing (required)" : "Not submitted"}</p>
                  </div>
                  {d && <button onClick={() => openDataUrl(d.file_data)} className="text-xs font-semibold text-primary hover:underline flex-shrink-0">View</button>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h5 className="text-sm font-bold font-[Outfit] text-foreground mb-2">Registration Fee Payment</h5>
        {!pay ? <p className="text-sm text-muted-foreground">No payment submitted yet.</p> : (
          <div className="grid md:grid-cols-[1fr_auto] gap-4 items-start">
            <div>
              <InfoRow label="Amount" value={<span className="font-mono">{peso(pay.amount)}</span>} />
              <InfoRow label="Method" value={pay.method} />
              <InfoRow label="Reference No." value={<span className="font-mono">{pay.reference}</span>} />
              <InfoRow label="Submitted" value={pay.submitted_at ? `${localDateLabel(pay.submitted_at)} ${localTimeLabel(pay.submitted_at)}` : null} />
              <InfoRow label="Status" value={<Badge variant={(PAY_BADGE[pay.status] || PAY_BADGE.unpaid).variant}>{(PAY_BADGE[pay.status] || PAY_BADGE.unpaid).label}</Badge>} />
              {pay.receipt_no && <InfoRow label="Official Receipt" value={<span className="font-mono">{pay.receipt_no}</span>} />}
              {pay.review_note && pay.status === "rejected" && <InfoRow label="Rejection note" value={pay.review_note} />}
            </div>
            {proof ? (
              <button onClick={() => openDataUrl(proof)} className="block rounded-xl border border-border overflow-hidden hover:border-primary transition-colors">
                {proof.startsWith("data:image")
                  ? <img src={proof} alt="Proof of payment" className="w-40 h-40 object-cover" />
                  : <div className="w-40 h-40 flex flex-col items-center justify-center gap-2 bg-muted/30"><FileText className="w-8 h-8 text-primary" /><span className="text-xs text-foreground">View PDF</span></div>}
                <span className="block text-[11px] text-center py-1 text-primary font-semibold">Proof of payment — open</span>
              </button>
            ) : pay.status !== "paid" && <p className="text-xs text-red-500">No proof of payment uploaded.</p>}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border p-4 space-y-3">
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
          placeholder="Note to the business owner (required when rejecting) — e.g. reference number doesn't match, blurry permit…"
          className="w-full bg-input-background border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" icon={CheckCircle} disabled={busy || !canApprove} onClick={() => onAction("approve", note)}>
            {m.status === "approved" ? "Verify Payment" : "Verify Payment & Approve"}
          </Btn>
          {pay && pay.status === "submitted" && (
            <Btn size="sm" variant="outline" disabled={busy} onClick={() => note.trim() ? onAction("reject_payment", note) : toast.error("Write a note explaining why the proof was rejected.")}>
              Reject Proof of Payment
            </Btn>
          )}
          {m.status !== "rejected" && (
            <Btn size="sm" variant="ghost" disabled={busy} onClick={() => note.trim() ? onAction("reject", note) : toast.error("Write a note explaining why the application was rejected.")}>
              Reject Application
            </Btn>
          )}
        </div>
        {!canApprove && <p className="text-xs text-muted-foreground">Approval unlocks once the business uploads a proof of payment.</p>}
      </div>
    </div>
  );
}

function AdminMSMEs() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];
  const [msmes, setMSMEs] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "pending" | "approved" | "unpaid" | "rejected">("all");
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, p] = await Promise.all([
      supabase.from("msmes").select("*, profiles!owner(fullname, email), products(*)").eq("municipality", town).order("id"),
      // proof files are large — they load only when an application is opened
      supabase.from("registration_payments")
        .select("id, msme_id, amount, method, status, reference, receipt_no, paid_at, created_at, submitted_at, verified_at, review_note, proof_file_name, msmes!inner(municipality)")
        .eq("msmes.municipality", town).order("id"),
    ]);
    setMSMEs((m.data as any[]) || []);
    setPayments((p.data as any[]) || []);
    setLoading(false);
  }, [town]);

  useEffect(() => { load(); }, [load]);

  // latest payment row per business
  const payOf = (id: number) => { const rows = payments.filter(p => p.msme_id === id); return rows[rows.length - 1]; };

  const review = async (m: any, action: "approve" | "reject_payment" | "reject", note: string) => {
    setSaving(String(m.id));
    const { data, error } = await supabase.rpc("lgu_review_registration", { p_msme_id: m.id, p_action: action, p_note: note || null });
    if (error) { toast.error(error.message); setSaving(null); return; }
    const msg = action === "approve"
      ? `${m.business_name} approved — payment verified (OR ${(data as any)?.receipt_no || ""}).`
      : action === "reject_payment" ? `Proof of payment rejected — ${m.business_name} was asked to re-upload.`
      : `${m.business_name}'s application was rejected.`;
    await recordActivity(action === "approve" ? "approve" : "update", "msme", m.id, msg, town);
    await load();
    setSaving(null);
    if (action !== "reject_payment") setReviewing(null);
    toast.success(msg);
  };

  const setProduct = async (p: any, approved: boolean) => {
    setSaving(`p${p.id}`);
    const { error } = await supabase.from("products").update({ approved }).eq("id", p.id);
    if (error) { toast.error(error.message); setSaving(null); return; }
    setMSMEs(prev => prev.map(m => ({ ...m, products: (m.products || []).map((x: any) => x.id === p.id ? { ...x, approved } : x) })));
    setSaving(null);
    toast.success(approved ? "Product published." : "Product hidden.");
  };

  const filtered = msmes.filter(m => tab === "all" || m.status === tab);
  const count = (s: string) => msmes.filter(m => m.status === s).length;

  const tabs: { id: typeof tab; label: string }[] = [
    { id: "all", label: `All (${msmes.length})` },
    { id: "unpaid", label: `Fee Due (${count("unpaid")})` },
    { id: "pending", label: `For Verification (${count("pending")})` },
    { id: "approved", label: `Active (${count("approved")})` },
    { id: "rejected", label: `Rejected (${count("rejected")})` },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-bold font-[Outfit] text-xl text-foreground">MSME Management — {townName}</h3>
        <Badge variant="info"><Landmark className="w-3 h-3 mr-1 inline" /> {townName}, Laguna</Badge>
      </div>

      <AdminFeeRates town={town} onSaved={load} />

      <div className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition-all ${tab === t.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <GlassCard className="p-12 text-center"><Building2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">No MSMEs here.</p></GlassCard>
      ) : (
        <div className="space-y-4">
          {filtered.map((m: any) => {
            const pay = payOf(m.id);
            const payBadge = PAY_BADGE[pay?.status] || PAY_BADGE.unpaid;
            const busy = saving === String(m.id);
            return (
              <GlassCard key={`msme-${m.id}`} className="p-5">
                <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                  {m.logo
                    ? <img src={m.logo} alt="" className="w-14 h-14 rounded-2xl object-cover flex-shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    : <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0"><Building2 className="w-6 h-6 text-primary" /></div>}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold font-[Outfit] text-foreground">{m.business_name}</h4>
                      <Badge variant={m.status === "approved" ? "success" : m.status === "rejected" ? "danger" : "warning"}>
                        {m.status === "unpaid" ? "Fee Due" : m.status === "approved" ? "Active" : m.status === "pending" ? "For Verification" : m.status}
                      </Badge>
                      <Badge variant={payBadge.variant}>{payBadge.label}</Badge>
                      {m.category && <Badge variant="info">{m.category}</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">Owner: {m.owner_name || m.profiles?.fullname || "—"}{(m.owner_contact || m.contact_number) ? ` · ${m.owner_contact || m.contact_number}` : ""}</p>
                    {m.address && <p className="text-xs text-muted-foreground">{m.address}</p>}
                    {m.rejection_reason && m.status !== "approved" && <p className="text-xs text-red-500 mt-1">Note to owner: {m.rejection_reason}</p>}
                    <div className="flex flex-wrap gap-2 mt-3 text-xs">
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted">
                        <Wallet className="w-3.5 h-3.5" /> {m.business_size ? `${SIZE_LABEL[m.business_size]} · ` : "Size not set · "}{peso(m.registration_fee)}
                      </span>
                      {pay?.receipt_no && <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted"><Receipt className="w-3.5 h-3.5" /> {pay.receipt_no}</span>}
                      {m.registration_code && <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted font-mono">{m.registration_code}</span>}
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted">{m.products?.length || 0} product(s)</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:flex-col lg:w-44 flex-shrink-0">
                    <Btn size="sm" variant={reviewing === m.id ? "outline" : "primary"} icon={Eye} onClick={() => setReviewing(reviewing === m.id ? null : m.id)}>
                      {reviewing === m.id ? "Close Review" : m.status === "pending" ? "Review & Verify" : "View Application"}
                    </Btn>
                    <button onClick={() => setExpanded(expanded === m.id ? null : m.id)} className="text-xs font-semibold text-primary hover:underline lg:text-right">
                      {expanded === m.id ? "Hide products" : "Manage products"} ({m.products?.length || 0})
                    </button>
                  </div>
                </div>

                {reviewing === m.id && <MSMEReviewPanel m={m} pay={pay} busy={busy} onAction={(a, note) => review(m, a, note)} />}

                {expanded === m.id && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <h5 className="text-sm font-bold font-[Outfit] text-foreground mb-3">Product Listings</h5>
                    {m.products?.length ? (
                      <div className="space-y-2">
                        {m.products.map((p: any) => (
                          <div key={p.id} className="flex items-center gap-3 rounded-xl bg-muted/30 px-3 py-2">
                            {p.image
                              ? <img src={p.image} alt="" className="w-10 h-10 rounded-lg object-cover" />
                              : <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><ShoppingBag className="w-4 h-4 text-primary" /></div>}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-foreground">{p.product_name}</p>
                              <p className="text-xs text-muted-foreground">₱{Number(p.price).toLocaleString()} · stock {p.stock}</p>
                            </div>
                            {p.approved ? <Badge variant="success">Published</Badge> : <Badge variant="warning">Pending</Badge>}
                            <button onClick={() => setProduct(p, !p.approved)} disabled={saving === `p${p.id}`}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:bg-primary/10 hover:text-primary transition-all">
                              {p.approved ? "Unpublish" : "Publish"}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No products yet.</p>
                    )}
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Market analysis: MSME sales per business and per festival day, plus the
// registration-fee collection report. Updates live as MSMEs record sales.
function AdminAnalytics() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];
  const [report, setReport] = useState<"sales" | "fees">("sales");
  const [bizId, setBizId] = useState("all");
  const [day, setDay] = useState("all");
  const [festival, setFestival] = useState<Festival | null>(null);
  const [msmes, setMSMEs] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const fid = await townFestivalId(town);
    const [f, m, s, p] = await Promise.all([
      fid ? supabase.from("festivals").select("*").eq("id", fid).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("msmes").select("id, business_name, status, business_size, registration_fee").eq("municipality", town).order("business_name"),
      fetchAll(( from, to) => supabase.from("sales")
        .select("id, msme_id, total, item_count, created_at, sale_items(product_name, quantity, line_total)")
        .eq("municipality", town).order("id").range(from, to)),
      supabase.from("registration_payments")
        .select("id, msme_id, amount, method, status, reference, receipt_no, verified_at, paid_at, submitted_at, created_at, msmes!inner(municipality)")
        .eq("msmes.municipality", town).order("id"),
    ]);
    setFestival((f.data as Festival) || null);
    setMSMEs((m.data as any[]) || []);
    setSales(s);
    setPayments((p.data as any[]) || []);
    setLoading(false);
  }, [town]);

  useEffect(() => { load(); }, [load]);
  useSalesLive(town, load);

  const bizName = (id: number) => msmes.find(m => m.id === id)?.business_name || `Business #${id}`;
  const today = todayStr();

  // ── sales report ──
  const bizSales = sales.filter(s => bizId === "all" || String(s.msme_id) === bizId);
  const festDays = festival ? festivalDays(festival) : [];
  const saleDates = [...new Set(bizSales.map(s => localDateKey(s.created_at)))];
  const otherDates = saleDates.filter(d => !festDays.includes(d)).sort();
  const dayLabel = (d: string) => {
    const i = festDays.indexOf(d);
    const nice = new Date(`${d}T12:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
    return i >= 0 ? `Day ${i + 1} · ${nice}` : nice;
  };
  const inDay = (s: any) => day === "all" || localDateKey(s.created_at) === (day === "today" ? today : day);
  const daySales = bizSales.filter(inDay);
  const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);

  const dayRows = [...festDays, ...otherDates].map(d => {
    const rows = bizSales.filter(s => localDateKey(s.created_at) === d);
    return { date: d, label: dayLabel(d), festival: festDays.includes(d), count: rows.length, items: sum(rows, "item_count"), total: sum(rows, "total") };
  });

  const itemMap: Record<string, { name: string; qty: number; total: number }> = {};
  for (const s of daySales) for (const it of s.sale_items || []) {
    const k = `${bizId === "all" ? `${s.msme_id}:` : ""}${it.product_name}`;
    const row = (itemMap[k] ||= { name: bizId === "all" ? `${it.product_name} (${bizName(s.msme_id)})` : it.product_name, qty: 0, total: 0 });
    row.qty += Number(it.quantity || 0);
    row.total += Number(it.line_total || 0);
  }
  const itemRows = Object.values(itemMap).sort((a, b) => b.qty - a.qty);

  const businessRows = msmes
    .map(m => { const rows = daySales.filter(s => s.msme_id === m.id); return { id: m.id, name: m.business_name, count: rows.length, items: sum(rows, "item_count"), total: sum(rows, "total") }; })
    .filter(r => r.count > 0 || msmes.find(m => m.id === r.id)?.status === "approved")
    .sort((a, b) => b.total - a.total);

  const dayText = day === "all" ? "all days" : day === "today" ? "today" : dayLabel(day);

  // ── registration fee report ──
  const latestPay = (id: number) => { const rows = payments.filter(p => p.msme_id === id); return rows[rows.length - 1]; };
  const paid = payments.filter(p => p.status === "paid");
  const awaiting = payments.filter(p => p.status === "submitted");
  const feeRows = msmes.map(m => ({ m, pay: latestPay(m.id) }));
  const bySize = BUSINESS_SIZES.map(sz => {
    const rows = paid.filter(p => msmes.find(m => m.id === p.msme_id)?.business_size === sz.id);
    return { size: sz.label, count: rows.length, total: sum(rows, "amount") };
  });
  const unsized = paid.filter(p => !msmes.find(m => m.id === p.msme_id)?.business_size);

  const exportReport = () => {
    if (report === "sales") {
      csvDownload(`${town}-sales-${bizId === "all" ? "all-businesses" : slugify(bizName(Number(bizId)))}-${today}.csv`,
        ["Day", "Date", "Transactions", "Items Sold", "Sales (PHP)"],
        [...dayRows.map(r => [r.festival ? r.label.split(" · ")[0] : "Outside festival", r.date, r.count, r.items, r.total.toFixed(2)]),
         ["All days", "", bizSales.length, sum(bizSales, "item_count"), sum(bizSales, "total").toFixed(2)]]);
    } else {
      csvDownload(`${town}-registration-fees-${today}.csv`,
        ["Business", "Size", "Fee (PHP)", "Payment Status", "Method", "Reference", "Official Receipt", "Verified"],
        feeRows.map(({ m, pay }) => [m.business_name, SIZE_LABEL[m.business_size] || "", Number(m.registration_fee || 0).toFixed(2),
          pay?.status || "unpaid", pay?.method || "", pay?.reference || "", pay?.receipt_no || "", pay?.verified_at ? localDateLabel(pay.verified_at) : ""]));
    }
  };

  const selectCls = "bg-input-background border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold font-[Outfit] text-xl text-foreground">Market Analysis — {townName}</h3>
          <p className="text-xs text-muted-foreground">Live MSME sales and registration fees for {townName} (Laguna). Updates automatically with every sale.</p>
        </div>
        <Btn size="sm" variant="outline" icon={Download} onClick={exportReport} disabled={loading}>Export Report</Btn>
      </div>

      <GlassCard className="p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground">Report</label>
          <select value={report} onChange={e => setReport(e.target.value as any)} className={selectCls}>
            <option value="sales">Business Sales</option>
            <option value="fees">Registration Fee Total</option>
          </select>
        </div>
        {report === "sales" && (
          <>
            <div className="flex flex-col gap-1 min-w-[200px] flex-1 sm:flex-none">
              <label className="text-xs font-semibold text-muted-foreground">Business</label>
              <select value={bizId} onChange={e => setBizId(e.target.value)} className={selectCls}>
                <option value="all">All registered businesses ({msmes.length})</option>
                {msmes.map(m => <option key={m.id} value={m.id}>{m.business_name}{m.status !== "approved" ? ` (${m.status === "unpaid" ? "fee due" : m.status})` : ""}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted-foreground">Day</label>
              <select value={day} onChange={e => setDay(e.target.value)} className={selectCls}>
                <option value="all">All days (whole festival)</option>
                <option value="today">Today</option>
                {festDays.map(d => <option key={d} value={d}>{dayLabel(d)}</option>)}
                {otherDates.length > 0 && <optgroup label="Outside festival days">{otherDates.map(d => <option key={d} value={d}>{dayLabel(d)}</option>)}</optgroup>}
              </select>
            </div>
          </>
        )}
      </GlassCard>

      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : report === "sales" ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label={`Total Sales — ${dayText}`} value={peso(sum(daySales, "total"))} icon={DollarSign} color="bg-green-500" />
            <StatCard label="Items / Food / Drinks Sold" value={sum(daySales, "item_count").toLocaleString()} icon={ShoppingBag} color="bg-blue-500" />
            <StatCard label="Transactions" value={daySales.length.toLocaleString()} icon={Receipt} color="bg-amber-500" />
            <StatCard label="Average Sale" value={peso(daySales.length ? sum(daySales, "total") / daySales.length : 0)} icon={TrendingUp} color="bg-violet-500" />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <GlassCard className="p-5">
              <h3 className="font-bold font-[Outfit] text-foreground mb-4">Sales per Day{bizId !== "all" ? ` — ${bizName(Number(bizId))}` : ""}</h3>
              {dayRows.length === 0 ? <p className="text-sm text-muted-foreground py-16 text-center">No festival dates or sales yet.</p> : (
                <Suspense fallback={<ChartFallback height={260} />}>
                  <DailySalesChart rows={dayRows.map(r => ({ label: r.festival ? r.label.split(" · ")[0] : r.label, sales: r.total }))} />
                </Suspense>
              )}
            </GlassCard>
            <GlassCard className="overflow-hidden">
              <div className="p-5 pb-3"><h3 className="font-bold font-[Outfit] text-foreground">Sales by Day</h3><p className="text-xs text-muted-foreground">Click a day to filter the whole report.</p></div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-border">{["Day", "Transactions", "Items", "Sales"].map(h => <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase px-4 py-2">{h}</th>)}</tr></thead>
                  <tbody>
                    {dayRows.map(r => (
                      <tr key={r.date} onClick={() => setDay(r.date === day ? "all" : r.date)}
                        className={`border-b border-border cursor-pointer hover:bg-muted/30 ${day === r.date ? "bg-primary/10" : ""}`}>
                        <td className="px-4 py-2 text-sm text-foreground">{r.label}{r.date === today && <span className="ml-2"><Badge variant="info">Today</Badge></span>}{!r.festival && <span className="block text-[11px] text-muted-foreground">Outside festival</span>}</td>
                        <td className="px-4 py-2 text-sm font-mono text-muted-foreground">{r.count}</td>
                        <td className="px-4 py-2 text-sm font-mono text-muted-foreground">{r.items}</td>
                        <td className="px-4 py-2 text-sm font-mono text-foreground">{peso(r.total)}</td>
                      </tr>
                    ))}
                    <tr className="bg-muted/30 font-semibold">
                      <td className="px-4 py-2.5 text-sm text-foreground">All days</td>
                      <td className="px-4 py-2.5 text-sm font-mono text-foreground">{bizSales.length}</td>
                      <td className="px-4 py-2.5 text-sm font-mono text-foreground">{sum(bizSales, "item_count")}</td>
                      <td className="px-4 py-2.5 text-sm font-mono text-foreground">{peso(sum(bizSales, "total"))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </div>

          <div className={`grid gap-6 ${bizId === "all" ? "lg:grid-cols-2" : ""}`}>
            {bizId === "all" && (
              <GlassCard className="overflow-hidden">
                <div className="p-5 pb-3"><h3 className="font-bold font-[Outfit] text-foreground">Sales by Business — {dayText}</h3></div>
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full">
                    <thead><tr className="border-b border-border">{["Business", "Transactions", "Items", "Sales"].map(h => <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase px-4 py-2">{h}</th>)}</tr></thead>
                    <tbody>
                      {businessRows.map(r => (
                        <tr key={r.id} onClick={() => setBizId(String(r.id))} className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/30">
                          <td className="px-4 py-2 text-sm text-foreground">{r.name}</td>
                          <td className="px-4 py-2 text-sm font-mono text-muted-foreground">{r.count}</td>
                          <td className="px-4 py-2 text-sm font-mono text-muted-foreground">{r.items}</td>
                          <td className="px-4 py-2 text-sm font-mono text-foreground">{peso(r.total)}</td>
                        </tr>
                      ))}
                      {!businessRows.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">No active businesses yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </GlassCard>
            )}
            <GlassCard className="overflow-hidden">
              <div className="p-5 pb-3"><h3 className="font-bold font-[Outfit] text-foreground">Items / Food / Drinks Sold — {dayText}</h3></div>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full">
                  <thead><tr className="border-b border-border">{["Item", "Qty Sold", "Sales"].map(h => <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase px-4 py-2">{h}</th>)}</tr></thead>
                  <tbody>
                    {itemRows.map(r => (
                      <tr key={r.name} className="border-b border-border last:border-0">
                        <td className="px-4 py-2 text-sm text-foreground">{r.name}</td>
                        <td className="px-4 py-2 text-sm font-mono text-muted-foreground">{r.qty}</td>
                        <td className="px-4 py-2 text-sm font-mono text-foreground">{peso(r.total)}</td>
                      </tr>
                    ))}
                    {!itemRows.length && <tr><td colSpan={3} className="px-4 py-10 text-center text-sm text-muted-foreground">No items sold {dayText === "all days" ? "yet" : dayText}.</td></tr>}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Registration Fee Total" value={peso(sum(paid, "amount"))} icon={DollarSign} color="bg-green-500" />
            <StatCard label="Paid Registrations" value={paid.length} icon={CheckCircle} color="bg-blue-500" />
            <StatCard label={`Awaiting Verification (${peso(sum(awaiting, "amount"))})`} value={awaiting.length} icon={Clock} color="bg-amber-500" />
            <StatCard label="Fee Due MSMEs" value={msmes.filter(m => m.status === "unpaid").length} icon={Wallet} color="bg-rose-500" />
          </div>
          <div className="grid lg:grid-cols-[1fr_2fr] gap-6">
            <GlassCard className="p-5">
              <h3 className="font-bold font-[Outfit] text-foreground mb-3">Collected by Business Size</h3>
              {bySize.map(r => <InfoRow key={r.size} label={`${r.size} (${r.count})`} value={<span className="font-mono">{peso(r.total)}</span>} />)}
              {unsized.length > 0 && <InfoRow label={`Size not set (${unsized.length})`} value={<span className="font-mono">{peso(sum(unsized, "amount"))}</span>} />}
              <div className="flex justify-between pt-2 text-sm font-semibold"><span className="text-foreground">Total</span><span className="font-mono text-foreground">{peso(sum(paid, "amount"))}</span></div>
            </GlassCard>
            <GlassCard className="overflow-hidden">
              <div className="p-5 pb-3"><h3 className="font-bold font-[Outfit] text-foreground">Registration Fees per Business</h3></div>
              <div className="overflow-x-auto max-h-[28rem]">
                <table className="w-full">
                  <thead><tr className="border-b border-border">{["Business", "Size", "Fee", "Status", "Reference / OR", "Verified"].map(h => <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase px-4 py-2">{h}</th>)}</tr></thead>
                  <tbody>
                    {feeRows.map(({ m, pay }) => {
                      const b = PAY_BADGE[pay?.status] || PAY_BADGE.unpaid;
                      return (
                        <tr key={m.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-2 text-sm text-foreground">{m.business_name}</td>
                          <td className="px-4 py-2 text-sm text-muted-foreground">{SIZE_LABEL[m.business_size] || "—"}</td>
                          <td className="px-4 py-2 text-sm font-mono text-foreground">{peso(pay?.status === "paid" ? pay.amount : m.registration_fee)}</td>
                          <td className="px-4 py-2"><Badge variant={b.variant}>{b.label}</Badge></td>
                          <td className="px-4 py-2 text-xs font-mono text-muted-foreground">{pay?.receipt_no || pay?.reference || "—"}</td>
                          <td className="px-4 py-2 text-xs font-mono text-muted-foreground">{pay?.verified_at ? localDateLabel(pay.verified_at) : pay?.status === "paid" ? localDateLabel(pay.paid_at || pay.created_at) : "—"}</td>
                        </tr>
                      );
                    })}
                    {!feeRows.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">No registered businesses yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}

function AdminFeedback() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<"all" | "festival" | "msme">("all");

  useEffect(() => {
    supabase.from("feedback").select("*, profiles(fullname), festivals(title), msmes(business_name)").eq("municipality", town).order("created_at", { ascending: false }).then(({ data }) => {
      setFeedback(data || []);
      setLoading(false);
    });
  }, [town]);

  const filtered = feedback.filter(f => type === "all" || String(f.feedback_type) === type);
  const avg = (rows: Feedback[]) => rows.length ? rows.reduce((s, f) => s + Number(f.rating || 0), 0) / rows.length : 0;
  const ofType = (t: string) => feedback.filter(f => String(f.feedback_type) === t);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Avg. Feedback Rating" value={feedback.length ? `${avg(feedback).toFixed(1)} ★` : "—"} icon={Star} color="bg-amber-500" />
        <StatCard label="Feedback Count" value={feedback.length} icon={MessageSquare} color="bg-rose-500" />
        <StatCard label="Festival Rating" value={ofType("festival").length ? `${avg(ofType("festival")).toFixed(1)} ★` : "—"} icon={Ticket} color="bg-blue-500" />
        <StatCard label="MSME Rating" value={ofType("msme").length ? `${avg(ofType("msme")).toFixed(1)} ★` : "—"} icon={Store} color="bg-green-500" />
      </div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-bold font-[Outfit] text-xl text-foreground">Feedback — {townName}</h3>
        <div className="flex gap-2">
          {(["all", "festival", "msme"] as const).map(t => (
            <button key={t} onClick={() => setType(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all capitalize ${type === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : filtered.length === 0 ? (
        <GlassCard className="p-12 text-center"><MessageSquare className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">No {type !== "all" ? type : ""} feedback yet.</p></GlassCard>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {filtered.map(f => (
            <GlassCard key={f.id} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <AvatarIcon name={f.profiles?.fullname || "Tourist"} />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{f.profiles?.fullname || "Tourist"}</p>
                    <Badge variant={String(f.feedback_type) === "msme" ? "warning" : "info"}>{String(f.feedback_type) === "msme" ? (f.msmes?.business_name || "MSME") : (f.festivals?.title || "Festival")}</Badge>
                  </div>
                </div>
                <div className="flex">
                  {Array.from({ length: f.rating }).map((_, i) => <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />)}
                </div>
              </div>
              <p className="text-sm text-muted-foreground italic">"{f.comment}"</p>
              {f.suggestion && <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">Suggestion: {f.suggestion}</p>}
              <p className="text-xs text-muted-foreground font-mono mt-2">{f.created_at?.slice(0, 10)}</p>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminRewards() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [msmes, setMSMEs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Reward | null>(null);
  const [form, setForm] = useState({ reward_name: "", required_days: "3", required_points: "", image: "", description: "", msme_id: "", product_id: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const fest = await townFestivalId(town);
      const [r, m] = await Promise.all([
        fest ? supabase.from("rewards").select("*, msmes(business_name), products(product_name,image)").eq("festival_id", fest) : Promise.resolve({ data: [] as any[] }),
        supabase.from("msmes").select("*, products(*)").eq("municipality", town).eq("status", "approved"),
      ]);
      setRewards((r.data as any[]) || []);
      setMSMEs((m.data as any[]) || []);
      setLoading(false);
    })();
  }, [town]);

  const startEdit = (r: any) => {
    setEditing(r);
    setForm({
      reward_name: r.reward_name,
      required_days: String(r.required_days || 3),
      required_points: r.required_points ? String(r.required_points) : "",
      image: r.image || "",
      description: r.description || "",
      msme_id: r.msme_id ? String(r.msme_id) : "",
      product_id: r.product_id ? String(r.product_id) : "",
    });
    setShowForm(true);
  };

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file."); return; }
    const reader = new FileReader();
    reader.onload = () => setForm(p => ({ ...p, image: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!form.reward_name) { toast.error("Reward name required."); return; }
    if (form.required_points !== "" && !(Number(form.required_points) >= 0)) { toast.error("Points must be 0 or more."); return; }
    setSaving(true);
    const fest = await townFestivalId(town);
    const payload: any = {
      reward_name: form.reward_name,
      required_days: Number(form.required_days) || 3,
      required_points: Math.floor(Number(form.required_points) || 0),
      image: form.image || null,
      description: form.description.trim() || null,
      festival_id: fest,
      msme_id: form.msme_id ? Number(form.msme_id) : null,
      product_id: form.product_id ? Number(form.product_id) : null,
    };
    if (editing) {
      const { data, error } = await supabase.from("rewards").update(payload).eq("id", editing.id).select("*, msmes(business_name), products(product_name,image)").single();
      if (!error && data) { setRewards(prev => prev.map(r => r.id === editing.id ? { ...data, required_points: data.required_points ?? 0 } : r)); setShowForm(false); setEditing(null); setSaving(false); toast.success("Reward updated!"); }
      else { setSaving(false); toast.error(error?.message || "Could not update reward."); }
    } else {
      const { data, error } = await supabase.from("rewards").insert([payload]).select("*, msmes(business_name), products(product_name,image)").single();
      if (!error && data) { setRewards(prev => [{ ...data, required_points: data.required_points ?? 0 }, ...prev]); setShowForm(false); setSaving(false); toast.success("Reward added!"); }
      else { setSaving(false); toast.error(error?.message || "Could not save reward."); }
    }
  };

  const remove = async (id: number) => {
    const { error } = await supabase.from("rewards").delete().eq("id", id);
    if (!error) { setRewards(prev => prev.filter(r => r.id !== id)); toast.success("Reward deleted."); }
    else toast.error(error.message);
  };

  const imgs = ["https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=300&fit=crop", "https://images.unsplash.com/photo-1531058020387-3be344556be6?w=400&h=300&fit=crop", "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=400&h=300&fit=crop"];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold font-[Outfit] text-xl text-foreground">Rewards Management — {townName}</h3>
          <p className="text-xs text-muted-foreground">Rewards unlock after N days of festival attendance — or can be redeemed with purchase points (1 point per ₱{PESOS_PER_POINT} spent at MSMEs).</p>
        </div>
        <Btn icon={PlusCircle} size="sm" onClick={() => { setShowForm(!showForm); setEditing(null); setForm({ reward_name: "", required_days: "3", required_points: "", image: "", description: "", msme_id: "", product_id: "" }); }}>Add Reward</Btn>
      </div>
      {showForm && (
        <GlassCard className="p-5">
          <h4 className="font-bold font-[Outfit] text-foreground mb-4">{editing ? "Edit Reward" : "New Reward"}</h4>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input label="Reward Name" placeholder="Festival T-Shirt" value={form.reward_name} onChange={v => setForm(p => ({ ...p, reward_name: v }))} />
            <Input label="Attendance Days Required" type="number" placeholder="3" value={form.required_days} onChange={v => setForm(p => ({ ...p, required_days: v }))} />
            <div className="sm:col-span-2">
              <Input label="OR Redeem with Points (optional)" type="number" placeholder="e.g. 500 — leave blank for days only" value={form.required_points} onChange={v => setForm(p => ({ ...p, required_points: v }))} icon={Award} />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Vendor / MSME (optional)</label>
              <select value={form.msme_id} onChange={e => { setForm(p => ({ ...p, msme_id: e.target.value, product_id: "" })); }}
                className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">— No vendor —</option>
                {msmes.map((m: any) => <option key={m.id} value={m.id}>{m.business_name}</option>)}
              </select>
            </div>
            {form.msme_id && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Product to redeem</label>
                <select value={form.product_id} onChange={e => setForm(p => ({ ...p, product_id: e.target.value }))}
                  className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                  <option value="">— Pick a product —</option>
                  {(msmes.find((m: any) => String(m.id) === form.msme_id)?.products || []).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.product_name} ({p.approved ? "published" : "pending"})</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5 mt-4">
            <label className="text-sm font-medium text-foreground">Details / Description</label>
            <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={2} placeholder="What does this reward include?"
              className="w-full bg-input-background border border-border rounded-xl py-2.5 px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all" />
          </div>
          <div className="mt-4 flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border text-sm hover:bg-muted transition-colors">
                <Upload className="w-4 h-4" /> {form.image ? "Change Picture" : "Upload Picture"}
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={handleImage} />
            </label>
            {form.image && (
              <div className="relative">
                <img src={form.image} alt="Reward preview" className="h-16 w-24 object-cover rounded-xl" />
                <button onClick={() => setForm(p => ({ ...p, image: "" }))} className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-red-500 text-white"><X className="w-3 h-3" /></button>
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Update Reward" : "Save Reward"}</Btn>
            <Btn variant="outline" size="sm" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Btn>
          </div>
        </GlassCard>
      )}
      {loading ? <div className="flex justify-center py-10"><Spinner /></div> : rewards.length === 0 ? (
        <GlassCard className="p-12 text-center"><Gift className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">No rewards for {townName} yet.</p></GlassCard>
      ) : (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-5">
          {rewards.map((r, i) => (
            <GlassCard key={r.id} className="overflow-hidden">
              <div className="h-32"><img src={r.image || imgs[i % imgs.length]} alt={r.reward_name} className="w-full h-full object-cover" /></div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-semibold text-foreground font-[Outfit]">{r.reward_name}</h4>
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      <Badge variant="warning"><CalendarDays className="w-3 h-3 mr-1 inline" /> {(r as any).required_days || 3} days</Badge>
                      {Number(r.required_points) > 0 && <Badge variant="success"><Award className="w-3 h-3 mr-1 inline" /> {r.required_points} pts</Badge>}
                      {(r as any).msmes?.business_name && <Badge variant="info"><Store className="w-3 h-3 mr-1 inline" /> {(r as any).msmes.business_name}</Badge>}
                    </div>
                    {r.description && <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{r.description}</p>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => startEdit(r)} className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => remove(r.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminQR() {
  const { profile, authUser } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];

  const [festival, setFestival] = useState<Festival | null>(null);
  const [qrs, setQRs] = useState<AttendanceQR[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [scanCounts, setScanCounts] = useState<Record<number, number>>({});
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [selectEvent, setSelectEvent] = useState("");
  const [selectDay, setSelectDay] = useState("all");
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<{ qr: AttendanceQR; dataUrl: string } | null>(null);
  const [ana, setAna] = useState<TownAnalytics | null>(null);

  useEffect(() => { loadTownAnalytics(town).then(setAna); }, [town]);

  const load = useCallback(async () => {
    const fid = await townFestivalId(town);
    if (!fid) { setLoading(false); return; }
    const [f, q, ev] = await Promise.all([
      supabase.from("festivals").select("*").eq("id", fid).single(),
      supabase.from("attendance_qr").select("*, events(title, venue)").eq("festival_id", fid).order("created_at", { ascending: false }),
      supabase.from("events").select("*").eq("festival_id", fid).order("start_time"),
    ]);
    setFestival((f.data as Festival) || null);
    setEvents((ev.data as any[]) || []);
    const list = (q.data as AttendanceQR[]) || [];
    setQRs(list);
    const qrIds = list.map(r => r.id);
    if (qrIds.length) {
      const [logsRes, logRes] = await Promise.all([
        supabase.from("attendance_logs").select("*, profiles(fullname), attendance_qr!qr_id(label, events!venue_id(title))").in("qr_id", qrIds).order("created_at", { ascending: false }).limit(200),
        supabase.from("attendance_logs").select("qr_id,id", { count: "exact" }).in("qr_id", qrIds),
      ]);
      setLogs((logsRes.data as any[]) || []);
      const counts: Record<number, number> = {};
      (logRes.data as any[] || []).forEach(r => { counts[r.qr_id] = (counts[r.qr_id] || 0) + 1; });
      setScanCounts(counts);
    } else {
      setLogs([]);
      setScanCounts({});
    }
    setLoading(false);
  }, [town]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (!festival) { toast.error("No festival found for your town yet."); return; }
    setGenerating(true);
    const event = events.find(ev => ev.id === Number(selectEvent));
    const fname = QR_FEST_NAME[town];
    const expires = festival?.end_date ? new Date(`${festival.end_date}T23:59:59`).toISOString() : null;
    let code = "";
    let data: AttendanceQR | null = null;
    let insertError: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      code = `FLGU-${fname}-${randomQRCode(8)}`;
      const res = await supabase.from("attendance_qr").insert([
        {
          festival_id: festival.id,
          venue_id: event?.id ?? null,
          municipality_id: town,
          is_active: true,
          expires_at: expires,
          qr_code_string: code,
          label: label.trim() || (event ? `${event.title} · ${event.venue || "Venue"}` : `${townName} Gate / Station`),
          generated_by: authUser?.id || null,
        },
      ]).select().single();
      if (!res.error && res.data) { data = res.data as AttendanceQR; insertError = null; break; }
      insertError = res.error;
      if (!(String(res.error.code) === "23505" || /duplicate/i.test(res.error.message))) break; // unique-violation → regenerate
    }
    if (insertError || !data) {
      toast.error(insertError?.message || "Could not create QR code.");
      setGenerating(false);
      return;
    }
    const svgOrUrl = await qrDataURL(code, { width: 480, margin: 2 });
    setPreview({ qr: data, dataUrl: svgOrUrl });
    setLabel("");
    setSelectEvent("");
    setGenerating(false);
    await load();
  };

  const printQR = () => {
    if (!preview) return;
    const w = window.open("", "_blank", "width=500,height=600");
    if (!w) return;
    w.document.write(`<html><head><title>${preview.qr.label}</title></head><body style="text-align:center;font-family:system-ui;padding:24px">
      <p style="font-size:18px;font-weight:700;margin-bottom:4px">${preview.qr.label}</p>
      <p style="font-size:12px;color:#666;margin-bottom:16px">${festival?.title || ""} · ${townName}, Laguna</p>
      <img src="${preview.dataUrl}" style="width:340px;height:340px" />
      <p style="font-size:11px;color:#666;margin-top:12px;word-break:break-all">${preview.qr.qr_code_string}</p>
    </body></html>`);
    w.document.close();
    w.print();
  };

  const downloadQR = () => {
    if (!preview) return;
    const a = document.createElement("a");
    a.href = preview.dataUrl;
    a.download = `${preview.qr.qr_code_string}.png`;
    a.click();
    toast.success("QR downloaded as PNG.");
  };

  const toggleActive = async (q: AttendanceQR) => {
    const { error } = await supabase.from("attendance_qr").update({ is_active: !q.is_active }).eq("id", q.id);
    if (error) toast.error("Could not toggle QR status.");
    else { toast.success(q.is_active ? "QR deactivated." : "QR activated."); await load(); }
  };

  const festivalDays = useMemo(() => {
    if (!festival?.start_date) return [];
    const days: string[] = [];
    const start = new Date(`${festival.start_date}T00:00:00`);
    const end = new Date(`${festival.end_date || festival.start_date}T00:00:00`);
    let cur = new Date(start);
    while (cur <= end) { days.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); }
    return days;
  }, [festival]);

  const filteredLogs = selectDay === "all" ? logs : logs.filter(l => String(l.scan_date) === selectDay);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-bold font-[Outfit] text-xl text-foreground">QR Generator — {townName}</h3>
          <p className="text-sm text-muted-foreground">Generate entrance/station QR codes tourists scan to earn their daily attendance stamp. One stamp per tourist per QR per day (duplicates rejected).</p>
        </div>
        <Badge variant="info"><Landmark className="w-3 h-3 mr-1 inline" /> {festival?.title || townName}</Badge>
      </div>

      {/* Attendance analytics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Attendance Scans" value={ana?.counts.scans ?? "—"} icon={ScanLine} color="bg-blue-500" />
        <StatCard label="Station QR Codes" value={qrs.length} icon={QrCode} color="bg-violet-500" />
        <StatCard label="Active Stations" value={qrs.filter(q => q.is_active).length} icon={CheckCircle} color="bg-green-500" />
        <StatCard label="Scans Today" value={logs.filter(l => String(l.scan_date) === todayStr()).length} icon={CalendarDays} color="bg-amber-500" />
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <GlassCard className="p-5">
          <h4 className="font-bold font-[Outfit] text-foreground mb-4">Attendance (Monthly)</h4>
          <Suspense fallback={<ChartFallback height={240} />}>
            <AttendanceChart months={ana?.months ?? []} />
          </Suspense>
        </GlassCard>
        <GlassCard className="p-5">
          <h4 className="font-bold font-[Outfit] text-foreground mb-4">Attendance by Venue</h4>
          {!ana?.venuePie.length
            ? <p className="text-sm text-muted-foreground py-16 text-center">No scans recorded yet. QRs linked to venues will appear here.</p>
            : <div className="min-h-[240px] flex items-center"><VenueDonut data={ana.venuePie} size="w-40 h-40" /></div>}
        </GlassCard>
      </div>

      {/* Generate + list */}
      <div className="grid lg:grid-cols-2 gap-5">
        <GlassCard className="p-5">
          <h4 className="font-bold font-[Outfit] text-foreground mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> New Attendance QR</h4>
          <div className="space-y-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Event / Venue</label>
              <select value={selectEvent} onChange={e => setSelectEvent(e.target.value)}
                className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">— General Gate / Poster-free (any venue) —</option>
                {events.map(ev => <option key={`ev-${ev.id}`} value={ev.id}>{ev.title} · {ev.venue || "Venue"}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Scans are counted per event venue, so tourists can only stamp once per venue per day.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Station / Gate Label</label>
              <Input placeholder="Main Gate · Day 1" value={label} onChange={setLabel} icon={MapPin} />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" />
              Festival run: {festivalDays[0] || "—"} → {festivalDays[festivalDays.length - 1] || "—"} · QR valid until {festival?.end_date ? new Date(`${festival.end_date}T23:59:59`).toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : "festival end"}
            </div>
            <Btn onClick={generate} disabled={generating || !festival} icon={QrCode}>
              {generating ? <><Spinner /> Creating…</> : "Generate QR Code"}
            </Btn>
            {!festival && <p className="text-xs text-amber-500">Set up your festival in the Festivals tab first.</p>}
          </div>
          {qrs.length > 0 && (
            <div className="mt-5 pt-4 border-t border-border">
              <h5 className="text-sm font-bold font-[Outfit] text-foreground mb-2">Your Station Codes ({qrs.length})</h5>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {qrs.map(q => (
                  <button key={q.id} onClick={async () => {
                    const url = await qrDataURL(q.qr_code_string, { width: 480, margin: 2 });
                    setPreview({ qr: q, dataUrl: url });
                  }}
                    className="w-full flex items-center gap-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 p-2.5 text-left transition-all">
                    <QrCode className="w-4 h-4 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{q.label}</p>
                      <p className="text-xs font-mono text-muted-foreground truncate">{q.qr_code_string}</p>
                      {q.events?.title && <p className="text-xs text-primary truncate">{q.events.title} · {q.events.venue || "Venue"}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-xs font-mono text-muted-foreground">{scanCounts[q.id] || 0} scans</span>
                      <button onClick={e => { e.stopPropagation(); toggleActive(q); }}
                        title={q.is_active ? "Click to deactivate" : "Click to activate"}
                        className="hover:opacity-80">
                        <Badge variant={q.is_active ? "success" : "danger"}>{q.is_active ? "Active" : "Inactive"}</Badge>
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </GlassCard>

        {/* Scan logs */}
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h4 className="font-bold font-[Outfit] text-foreground flex items-center gap-2"><ScanLine className="w-4 h-4 text-primary" /> Attendance Scan Log</h4>
            {festivalDays.length > 0 && (
              <select value={selectDay} onChange={e => setSelectDay(e.target.value)}
                className="bg-input-background border border-border rounded-xl px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="all">All days</option>
                {festivalDays.map(d => <option key={d} value={d}>{new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</option>)}
              </select>
            )}
          </div>
          {loading ? <div className="flex justify-center py-10"><Spinner /></div> : filteredLogs.length === 0 ? (
            <p className="text-center text-muted-foreground py-10 text-sm">No scans recorded yet. Tourists scan your printed QR codes at the entrances.</p>
          ) : (
            <div className="overflow-auto max-h-80">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {["Tourist", "Station", "Venue", "Day", "Time"].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map(l => (
                    <tr key={l.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 text-sm text-foreground">{l.profiles?.fullname || "—"}</td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">{l.attendance_qr?.label || `QR #${l.qr_id}`}</td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">{l.attendance_qr?.events?.title || "—"}</td>
                      <td className="px-3 py-2 text-sm font-mono text-muted-foreground">{localDateLabel(l.created_at)}</td>
                      <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{localTimeLabel(l.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </div>

      {/* QR preview modal */}
      <AnimatePresence>
        {preview && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPreview(null)}>
            <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
              onClick={e => e.stopPropagation()} className="w-full max-w-sm">
              <GlassCard className="p-6 text-center">
                <h4 className="font-bold font-[Outfit] text-foreground">{preview.qr.label}</h4>
                <p className="text-xs text-muted-foreground mb-4">{festival?.title || townName} · {townName}, Laguna</p>
                <img src={preview.dataUrl} alt="Attendance QR" className="w-64 h-64 mx-auto rounded-2xl bg-white p-2 mb-3" />
                <p className="text-[11px] font-mono text-muted-foreground break-all mb-4">{preview.qr.qr_code_string}</p>
                <div className="flex gap-2 justify-center">
                  <Btn size="sm" onClick={printQR} icon={Printer}>Print</Btn>
                  <Btn variant="outline" size="sm" onClick={downloadQR} icon={Download}>Download PNG</Btn>
                </div>
                <p className="text-xs text-muted-foreground mt-3">Print these at your entrances. Tourists scan with their app to get a daily stamp.</p>
              </GlassCard>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AdminAnnouncements() {
  const { authUser, profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [form, setForm] = useState({ title: "", description: "", link_view: "" });

  useEffect(() => {
    (async () => {
      const fest = await townFestivalId(town);
      const res = fest
        ? await supabase.from("announcements").select("*, festivals(title)").eq("festival_id", fest).order("created_at", { ascending: false })
        : await supabase.from("announcements").select("*, festivals(title)").order("created_at", { ascending: false });
      setItems(res.data || []);
      setLoading(false);
    })();
  }, [town]);

  const startEdit = (a: Announcement) => {
    setEditing(a);
    setForm({ title: a.title, description: a.description, link_view: (a as any).link_view || "" });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.title || !form.description) { toast.error("Fill all fields."); return; }
    const fest = await townFestivalId(town);
    const payload: any = { title: form.title, description: form.description, link_view: form.link_view || null };
    if (editing) {
      const { data, error } = await supabase.from("announcements").update(payload).eq("id", editing.id).select("*, festivals(title)").single();
      if (!error && data) { setItems(prev => prev.map(a => a.id === editing.id ? data : a)); setShowForm(false); setEditing(null); toast.success("Announcement updated!"); }
      else toast.error("Could not update.");
    } else {
      const { data, error } = await supabase.from("announcements").insert([{ ...payload, festival_id: fest, created_by: authUser?.id || null }]).select("*, festivals(title)").single();
      if (!error && data) { setItems(prev => [data, ...prev]); setShowForm(false); setForm({ title: "", description: "", link_view: "" }); toast.success("Announcement published!"); }
      else toast.error("Could not publish.");
    }
  };

  const remove = async (id: number) => {
    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setItems(prev => prev.filter(a => a.id !== id));
    toast.success("Removed.");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-bold font-[Outfit] text-xl text-foreground">Announcements</h3>
        <Btn icon={PlusCircle} size="sm" onClick={() => { setShowForm(!showForm); setEditing(null); }}>New Announcement</Btn>
      </div>
      {showForm && (
        <GlassCard className="p-5">
          <h4 className="font-bold font-[Outfit] text-foreground mb-4">{editing ? "Edit Announcement" : "New Announcement"}</h4>
          <div className="space-y-3">
            <Input label="Title" placeholder="Registration Now Open" value={form.title} onChange={v => setForm(p => ({ ...p, title: v }))} />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Description</label>
              <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3}
                className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Notification opens page (optional)</label>
              <select value={form.link_view} onChange={e => setForm(p => ({ ...p, link_view: e.target.value }))}
                className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">— None (no redirect) —</option>
                {[{ v: "home", l: "Home" }, { v: "events", l: "Events" }, { v: "msmes", l: "MSME Partners" }, { v: "guide", l: "Tourist Guide" }, { v: "contact", l: "Contact Us" }].map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Btn size="sm" onClick={save}>{editing ? "Update" : "Publish"}</Btn>
            <Btn variant="outline" size="sm" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Btn>
          </div>
        </GlassCard>
      )}
      {loading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <div className="space-y-3">
          {items.map(a => (
            <GlassCard key={a.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-bold font-[Outfit] text-foreground">{a.title}</h4>
                  <p className="text-sm text-muted-foreground mt-1">{a.description}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-2">{a.created_at?.slice(0, 10)}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(a)} className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary"><Edit2 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => remove(a.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </GlassCard>
          ))}
          {!items.length && <p className="text-center text-muted-foreground py-10">No announcements yet.</p>}
        </div>
      )}
    </div>
  );
}

// Manage the town's tourist map venues (shown on the public Guide map).
function AdminMapVenues() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];
  const [venues, setVenues] = useState<MapVenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MapVenue | null>(null);
  const [form, setForm] = useState({ name: "", address: "", lat: "", lng: "", area: "" });
  const [saving, setSaving] = useState(false);

  const loadVenues = useCallback(async () => {
    const fest = await townFestivalId(town);
    const res = await supabase.from("map_venues").select("*").order("sort_order", { ascending: true });
    const list = (res.data as MapVenue[]) || [];
    setVenues(fest ? list.filter(v => !v.festival_id || v.festival_id === fest) : list);
    setLoading(false);
  }, [town]);

  useEffect(() => { loadVenues(); }, [loadVenues]);

  const startEdit = (v: MapVenue) => {
    setEditing(v);
    setForm({ name: v.name, address: v.address || "", lat: String(v.lat ?? ""), lng: String(v.lng ?? ""), area: v.area || "" });
    setShowForm(true);
  };

  const save = async () => {
    const lat = Number(form.lat), lng = Number(form.lng);
    if (!form.name.trim()) { toast.error("Venue name is required."); return; }
    if ((form.lat.trim() || form.lng.trim()) && (isNaN(lat) || isNaN(lng))) { toast.error("Coordinates must be numbers (e.g. 14.1819 for lat, 121.2854 for lng)."); return; }
    setSaving(true);
    const payload: any = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      lat: form.lat.trim() ? lat : null,
      lng: form.lng.trim() ? lng : null,
      area: form.area.trim() || null,
    };
    if (editing) {
      const { error } = await supabase.from("map_venues").update(payload).eq("id", editing.id);
      if (error) toast.error(error.message);
      else { setEditing(null); setShowForm(false); toast.success("Venue updated."); loadVenues(); }
    } else {
      const fest = await townFestivalId(town);
      const { error } = await supabase.from("map_venues").insert([{ ...payload, festival_id: fest, municipality: town, sort_order: venues.length + 1 }]);
      if (error) toast.error(error.message);
      else { setShowForm(false); toast.success("Venue added to the town map."); loadVenues(); }
    }
    setSaving(false);
  };

  const removeVenue = async (id: number) => {
    const { error } = await supabase.from("map_venues").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Venue removed."); loadVenues(); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-bold font-[Outfit] text-xl text-foreground">Tourist Map Venues — {townName}</h3>
          <p className="text-sm text-muted-foreground">These landmarks, parks, and transit points appear on the public Guide map.</p>
        </div>
        <Btn icon={PlusCircle} size="sm" onClick={() => { setShowForm(!showForm); setEditing(null); }}>{showForm ? "Close" : "Add Venue"}</Btn>
      </div>
      {showForm && (
        <GlassCard className="p-5">
          <h4 className="font-bold font-[Outfit] text-foreground mb-4">{editing ? "Edit Venue" : "New Venue"}</h4>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input label="Name *" placeholder="Pila Municipal Plaza" value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} icon={MapPin} />
            <Input label="Area / Category" placeholder="Riverbanks, Plaza, Landmark" value={form.area} onChange={v => setForm(p => ({ ...p, area: v }))} />
            <Input label="Address" placeholder="Poblacion, Bay, Laguna" value={form.address} onChange={v => setForm(p => ({ ...p, address: v }))} />
            <Input label="Latitude" placeholder="14.1819" value={form.lat} onChange={v => setForm(p => ({ ...p, lat: v }))} />
            <Input label="Longitude" placeholder="121.2854" value={form.lng} onChange={v => setForm(p => ({ ...p, lng: v }))} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">Tip: right-click Google Maps to copy coordinates. Venues without coordinates show no pin.</p>
          <div className="flex gap-2 mt-4">
            <Btn size="sm" icon={Save} onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Save Venue" : "Add Venue"}</Btn>
            <Btn variant="outline" size="sm" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Btn>
          </div>
        </GlassCard>
      )}
      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : venues.length === 0 ? (
        <GlassCard className="p-12 text-center"><MapPin className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">No map venues yet. Add your town's top tourist spots.</p></GlassCard>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {venues.map(v => (
            <GlassCard key={`mv-${v.id}`} className="p-4">
              <div className="flex items-start gap-3">
                <div className="bg-primary/10 rounded-xl p-2.5 flex-shrink-0"><MapPin className="w-4 h-4 text-primary" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold font-[Outfit] text-foreground">{v.name}</h4>
                    {v.area && <Badge variant="info">{v.area}</Badge>}
                  </div>
                  {v.address && <p className="text-xs text-muted-foreground mt-0.5">{v.address}</p>}
                  <p className="text-xs font-mono text-muted-foreground mt-1">
                    {typeof v.lat === "number" ? `${v.lat.toFixed(4)}, ${v.lng?.toFixed(4)}` : "No coordinates yet"}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(v)} className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary"><Edit2 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => removeVenue(v.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

// Read tourist inquiries submitted through the Contact page.
function AdminInquiries() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("contact_messages").select("*").eq("municipality", town).order("created_at", { ascending: false }).then(({ data }) => {
      setMessages(data || []);
      setLoading(false);
    });
  }, [town]);

  const toggleRead = async (m: any) => {
    const { error } = await supabase.from("contact_messages").update({ read: !m.read }).eq("id", m.id);
    if (error) toast.error(error.message);
    else setMessages(prev => prev.map(x => x.id === m.id ? { ...x, read: !m.read } : x));
  };

  const removeMsg = async (id: number) => {
    const { error } = await supabase.from("contact_messages").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { setMessages(prev => prev.filter(x => x.id !== id)); toast.success("Inquiry deleted."); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-bold font-[Outfit] text-xl text-foreground">Tourist Inquiries — {townName}</h3>
          <p className="text-sm text-muted-foreground">Messages sent from the Contact page, scoped to {townName}.</p>
        </div>
        <Badge variant="info">{messages.length} total · {messages.filter(m => !m.read).length} unread</Badge>
      </div>
      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : messages.length === 0 ? (
        <GlassCard className="p-12 text-center"><Inbox className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">No inquiries yet. Messages from the Contact page will appear here.</p></GlassCard>
      ) : (
        <div className="space-y-3">
          {messages.map(m => (
            <GlassCard key={`msg-${m.id}`} className={`p-5 ${!m.read ? "border-primary/50" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <AvatarIcon name={m.name || "?"} />
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{m.name} <span className="text-xs text-muted-foreground font-normal">{m.email}</span></p>
                    {m.subject && <p className="text-xs text-primary font-medium">{m.subject}</p>}
                  </div>
                  {!m.read && <Badge variant="warning">New</Badge>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => toggleRead(m)} className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary" title={m.read ? "Mark unread" : "Mark read"}>
                    {m.read ? <Eye className="w-3.5 h-3.5 opacity-40" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => removeMsg(m.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-2">{m.message}</p>
              <p className="text-xs text-muted-foreground font-mono mt-2">{localDateLabel(m.created_at)} · {localTimeLabel(m.created_at)}</p>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Organizer Dashboard ──────────────────────────────────────────────────────

function OrganizerDashboard() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality);
  const townName = town ? MUNI_NAME[town] : "";

  const navItems = [
    { label: "Overview", icon: BarChart2, id: "overview" },
    { label: "My Events", icon: Calendar, id: "my-events" },
    { label: "Announcements", icon: Megaphone, id: "announcements" },
    { label: "Notifications", icon: Bell, id: "notifications" },
    { label: "Settings", icon: Settings, id: "settings" },
    { label: "Activity Log", icon: Activity, id: "activity" },
  ];

  return (
    <DashboardLayout title={townName ? `${townName} (Laguna) — Event Organizer` : "Organizer"} navItems={navItems}>
      {(active, setActive) => {
        if (active === "overview") return <OrganizerOverview />;
        if (active === "my-events") return <OrganizerEvents />;
        if (active === "announcements") return <AdminAnnouncements />;
        if (active === "notifications") return <OrganizerNotifications setActive={setActive} />;
        if (active === "settings") return <AdminSettings />;
        if (active === "activity") return <AdminActivity />;
        return <PlaceholderView title={active} />;
      }}
    </DashboardLayout>
  );
}

function OrganizerOverview() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];
  const [events, setEvents] = useState<Event[]>([]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    (async () => {
      const fid = await townFestivalId(town);
      const res = fid
        ? await supabase.from("events").select("*, festivals(title)").eq("festival_id", fid).order("start_time")
        : await supabase.from("events").select("*, festivals(title)").order("start_time");
      const list = (res.data?.length ? res.data : FALLBACK_EVENTS) as Event[];
      setEvents(list);
      setCount(list.length);
    })();
  }, [town]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h3 className="font-bold font-[Outfit] text-lg text-foreground">Overview — Users from:</h3>
        <Badge variant="info"><Landmark className="w-3 h-3 mr-1 inline" /> {townName}, Laguna</Badge>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Events" value={count || "—"} icon={Calendar} color="bg-primary" />
        <StatCard label="Upcoming" value={events.filter(e => new Date(e.start_time) > new Date()).length} icon={Clock} color="bg-secondary" />
        <StatCard label="Festival" value="1" icon={Ticket} color="bg-accent" />
        <StatCard label="Attendees" value={events.length ? `${events.length * 40}+` : "—"} icon={Users} color="bg-rose-500" />
      </div>
      <GlassCard className="p-5">
        <h3 className="font-bold font-[Outfit] text-foreground mb-4">Upcoming Events</h3>
        <div className="space-y-3">
          {events.filter(e => new Date(e.start_time) > new Date()).slice(0, 5).map(e => (
            <div key={e.id} className="flex items-center gap-3 p-3 rounded-xl bg-muted/50">
              <div className="bg-primary/10 rounded-xl p-2.5 flex-shrink-0"><Calendar className="w-4 h-4 text-primary" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{e.title}</p>
                <p className="text-xs text-muted-foreground">{localDateLabel(e.start_time)} • {e.venue}</p>
              </div>
              <Badge variant="success">Upcoming</Badge>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

function OrganizerEvents() {
  const { profile, authUser } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];
  const [events, setEvents] = useState<Event[]>([]);
  const [festivals, setFestivals] = useState<Festival[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Event | null>(null);
  const [form, setForm] = useState({ festival_id: "", title: "", venue: "", start_time: "", end_time: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const fid = await townFestivalId(town);
      const [e, f] = await Promise.all([
        fid
          ? supabase.from("events").select("*, festivals(title)").eq("festival_id", fid).order("start_time")
          : Promise.resolve({ data: [] as any[] }),
        fid
          ? supabase.from("festivals").select("*").eq("id", fid)
          : supabase.from("festivals").select("*").eq("municipality", town),
      ]);
      setEvents(Array.from(new Map((e.data as any[] || []).map((ev: Event) => [ev.id, ev])).values()));
      if ((f.data as any[])?.length) setFestivals(f.data as any[]);
      setLoading(false);
    })();
  }, [town]);

  const startEdit = (e: Event) => {
    setEditing(e);
    setForm({
      festival_id: e.festival_id ? String(e.festival_id) : "",
      title: e.title,
      venue: e.venue,
      start_time: isoToLocalInput(e.start_time),
      end_time: isoToLocalInput(e.end_time),
    });
    setShowForm(true);
  };

  const save = async () => {
    const startISO = localInputToISO(form.start_time);
    const endISO = localInputToISO(form.end_time);
    if (!form.title || !form.venue || !startISO) { toast.error("Fill required fields (including the start date/time)."); return; }
    if (endISO && new Date(endISO) <= new Date(startISO)) { toast.error("End time must be after the start time."); return; }
    setSaving(true);
    const payload = {
      festival_id: form.festival_id ? Number(form.festival_id) : null,
      title: form.title, venue: form.venue,
      start_time: startISO, end_time: endISO,
      organizer_id: authUser?.id || null,
    };
    if (editing) {
      const { data, error } = await supabase.from("events").update(payload).eq("id", editing.id).select("*, festivals(title)").maybeSingle();
      if (error) toast.error(error.message);
      else if (!data) toast.error("This event no longer exists in the database — refresh the list.");
      else { setEvents(prev => prev.map(ev => ev.id === editing.id ? data : ev)); setShowForm(false); setEditing(null); toast.success("Event updated!"); }
    } else {
      const { data, error } = await supabase.from("events").insert([payload]).select("*, festivals(title)").single();
      if (!error && data) { setEvents(prev => [data, ...prev]); setShowForm(false); toast.success("Event added!"); }
      else toast.error(error?.message || "Could not save.");
    }
    setSaving(false);
  };

  const remove = async (id: number) => {
    await supabase.from("events").delete().eq("id", id);
    setEvents(prev => prev.filter(e => e.id !== id));
    toast.success("Event deleted.");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-bold font-[Outfit] text-xl text-foreground">My Events — {townName}</h3>
        <Btn icon={PlusCircle} size="sm" onClick={() => { setShowForm(!showForm); setEditing(null); }}>Add Event</Btn>
      </div>
      {showForm && (
        <GlassCard className="p-5">
          <h4 className="font-bold font-[Outfit] text-foreground mb-4">{editing ? "Edit Event" : "New Event"}</h4>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Festival</label>
              <select value={form.festival_id} onChange={e => setForm(p => ({ ...p, festival_id: e.target.value }))}
                className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">Select festival…</option>
                {festivals.map(f => <option key={`fest-${f.id}`} value={f.id}>{f.title}</option>)}
              </select>
            </div>
            <Input label="Event Title *" placeholder="Grand Parade" value={form.title} onChange={v => setForm(p => ({ ...p, title: v }))} />
            <Input label="Venue *" placeholder="Town Plaza" value={form.venue} onChange={v => setForm(p => ({ ...p, venue: v }))} />
            <Input label="Start Date/Time *" type="datetime-local" value={form.start_time} onChange={v => setForm(p => ({ ...p, start_time: v }))} />
            <Input label="End Date/Time" type="datetime-local" value={form.end_time} onChange={v => setForm(p => ({ ...p, end_time: v }))} />
          </div>
          <div className="flex gap-2 mt-4">
            <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Update Event" : "Save Event"}</Btn>
            <Btn variant="outline" size="sm" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Btn>
          </div>
        </GlassCard>
      )}
      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : (
        <div className="space-y-3">
          {events.map(e => (
            <GlassCard key={`event-${e.id}`} className="p-4">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 rounded-xl p-2.5 flex-shrink-0"><Calendar className="w-5 h-5 text-primary" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-bold font-[Outfit] text-foreground">{e.title}</h4>
                    <Badge variant={new Date(e.start_time) > new Date() ? "success" : "default"}>{new Date(e.start_time) > new Date() ? "Upcoming" : "Past"}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{e.festivals?.title} • {e.start_time ? `${new Date(e.start_time).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}, ${localTimeLabel(e.start_time)}` : ""}</p>
                  {e.venue && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" />{e.venue}</p>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(e)} className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary"><Edit2 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => remove(e.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MSME Dashboard ───────────────────────────────────────────────────────────

function OrganizerNotifications({ setActive }: { setActive?: (id: string) => void }) {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [upcoming, setUpcoming] = useState<Event[]>([]);

  useEffect(() => {
    (async () => {
      const fid = await townFestivalId(town);
      const base = fid ? supabase.from("events").select("*, festivals(title)").eq("festival_id", fid) : supabase.from("events").select("*, festivals(title)");
      const [a, f, u] = await Promise.all([
        supabase.from("announcements").select("*").eq("festival_id", fid ?? 0).order("created_at", { ascending: false }).limit(5),
        supabase.from("feedback").select("*, profiles(fullname)").eq("municipality", town).order("created_at", { ascending: false }).limit(5),
        base.gt("start_time", new Date().toISOString()).order("start_time").limit(4),
      ]);
      setAnnouncements(a.data || []);
      setFeedbacks(f.data || []);
      setUpcoming(u.data || []);
    })();
  }, [town]);

  const soon = (d: string) => {
    const diff = new Date(d).getTime() - Date.now();
    return diff > 0 && diff < 72 * 3600 * 1000;
  };

  return (
    <div className="space-y-5">
      <h3 className="font-bold font-[Outfit] text-xl text-foreground">Notifications — {MUNI_NAME[town]}</h3>

      {/* Upcoming events */}
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5"><Bell className="w-3.5 h-3.5" />Upcoming Reminders</h4>
        {upcoming.length ? (
          <div className="space-y-2">
            {upcoming.map(e => (
              <button key={`up-${e.id}`} className="w-full text-left" onClick={() => setActive?.("my-events")}>
                <GlassCard className="p-4 transition-colors hover:bg-primary/5">
                  <div className="flex items-center gap-3">
                    <div className={`rounded-xl p-2.5 flex-shrink-0 ${soon(e.start_time) ? "bg-amber-500/10" : "bg-primary/10"}`}>
                      <Clock className={`w-5 h-5 ${soon(e.start_time) ? "text-amber-500" : "text-primary"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground">{e.title}</p>
                      <p className="text-xs text-muted-foreground">{e.festivals?.title} • {e.start_time ? `${localDateLabel(e.start_time)}${e.end_time ? `, ${localTimeLabel(e.start_time)}` : ""}` : ""}</p>
                    </div>
                    {soon(e.start_time) && <Badge variant="warning">Soon</Badge>}
                  </div>
                </GlassCard>
              </button>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No upcoming events scheduled.</p>}
      </div>

      {/* Latest feedback */}
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" />Latest Feedback</h4>
        {feedbacks.length ? (
          <div className="space-y-2">
            {feedbacks.map(f => (
              <GlassCard key={`fb-${f.id}`} className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-foreground text-sm">{f.profiles?.fullname || "Tourist"}</p>
                      <span className="flex items-center gap-0.5">
                        {Array.from({ length: f.rating }).map((_, i) => <Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/90 mt-1">{f.comment}</p>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No feedback yet.</p>}
      </div>

      {/* Announcements */}
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5"><Megaphone className="w-3.5 h-3.5" />Announcements</h4>
        {announcements.length ? (
          <div className="space-y-2">
            {announcements.map(a => (
              <button key={`ann-${a.id}`} className="w-full text-left" onClick={() => setActive?.("announcements")}>
                <GlassCard className="p-4 transition-colors hover:bg-primary/5">
                  <p className="font-semibold text-foreground">{a.title}</p>
                  {a.description && <p className="text-sm text-muted-foreground mt-0.5">{a.description}</p>}
                </GlassCard>
              </button>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No announcements.</p>}
      </div>
    </div>
  );
}

function MSMEDash() {
  const { profile, authUser } = useApp();
  const town = muniOf(profile?.municipality);
  const townName = town ? MUNI_NAME[town] : "";
  // Businesses that aren't approved yet land on Business Profile to finish
  // their requirements and registration fee.
  const [initialTab, setInitialTab] = useState<string | null>(null);

  useEffect(() => {
    if (!authUser) return;
    supabase.from("msmes").select("status").eq("owner", authUser.id).order("id").limit(1).then(({ data }) => {
      setInitialTab(data?.[0]?.status === "approved" ? "overview" : "business");
    });
  }, [authUser]);

  const navItems = [
    { label: "Overview", icon: BarChart2, id: "overview" },
    { label: "Point of Sale", icon: Store, id: "pos" },
    { label: "Business Profile", icon: Building2, id: "business" },
    { label: "My Products", icon: Package, id: "products" },
    { label: "Transactions", icon: DollarSign, id: "transactions" },
    { label: "Settings", icon: Settings, id: "settings" },
  ];

  if (!initialTab) return <div className="min-h-screen bg-background flex items-center justify-center"><Spinner /></div>;

  return (
    <DashboardLayout title={townName ? `${townName} (Laguna) — MSME Portal` : "MSME Portal"} navItems={navItems} initialTab={initialTab}>
      {(active, setActive) => {
        if (active === "overview") return <MSMEOverview goTab={setActive} />;
        if (active === "pos") return <MSMEPOS goTab={setActive} />;
        if (active === "business") return <MSMEProfile />;
        if (active === "products") return <MSMEProducts gotoBusiness={() => setActive("business")} />;
        if (active === "transactions") return <MSMETransactions />;
        if (active === "settings") return <ProfileSettings />;
        return <PlaceholderView title={active} />;
      }}
    </DashboardLayout>
  );
}

function useMyMSMEState() {
  const { authUser } = useApp();
  const [msme, setMSME] = useState<any | null>(null);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    if (!authUser) return;
    const { data } = await supabase.from("msmes").select("*").eq("owner", authUser.id).order("id").limit(1);
    setMSME(data?.[0] ?? null);
    setLoaded(true);
  }, [authUser]);
  useEffect(() => { reload(); }, [reload]);
  return { msme, loaded, reload, setMSME };
}

function useMyMSME() {
  return useMyMSMEState().msme as MSME | null;
}

const REG_PAY_METHODS = ["GCash", "Maya / PayMaya", "Bank Transfer", "Bank Deposit", "Over-the-Counter"];

// One upload slot (requirement document or proof of payment).
function UploadSlot({ label, required, fileName, uploadedAt, onPick, onView, disabled, busy }: {
  label: string; required?: boolean; fileName?: string | null; uploadedAt?: string | null;
  onPick: (f: File) => void; onView?: () => void; disabled?: boolean; busy?: boolean;
}) {
  const done = !!fileName;
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${done ? "border-green-500/40 bg-green-500/5" : required ? "border-amber-500/40 bg-amber-500/5" : "border-border"}`}>
      {done ? <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" /> : <Upload className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</p>
        <p className="text-xs text-muted-foreground truncate">{done ? `${fileName}${uploadedAt ? ` · ${localDateLabel(uploadedAt)}` : ""}` : "Photo or PDF, up to 4 MB"}</p>
      </div>
      {done && onView && <button onClick={onView} className="text-xs font-semibold text-primary hover:underline flex-shrink-0">View</button>}
      {!disabled && (
        <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold cursor-pointer hover:bg-muted flex-shrink-0 ${busy ? "opacity-50 pointer-events-none" : ""}`}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {done ? "Replace" : "Upload"}
          <input type="file" accept="image/*,application/pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(f); }} />
        </label>
      )}
    </div>
  );
}

function MSMEProfile() {
  const { authUser, profile } = useApp();
  const town = muniOf(profile?.municipality);
  const townName = town ? MUNI_NAME[town] : "";
  const { msme, loaded, reload, setMSME } = useMyMSMEState();
  const { rates } = useFeeRates(msme?.municipality || town);
  const [payment, setPayment] = useState<any | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [office, setOffice] = useState<any | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const emptyDetails = {
    business_name: "", business_type: "", category: "", address: "", contact_number: "", description: "", logo: "",
    years_in_operation: "", employee_count: "", business_size: "", business_reg_no: "",
    owner_name: "", owner_birthdate: "", owner_sex: "", owner_contact: "", owner_email: "", owner_address: "", owner_city: "", owner_province: "",
  };
  const [details, setDetails] = useState(emptyDetails);
  const [req, setReq] = useState({ dti_sec_cda_no: "", tin: "", capitalization: "" });
  const [pay, setPay] = useState<{ method: string; reference: string; proof: { dataUrl: string; name: string } | null }>({ method: "GCash", reference: "", proof: null });

  const loadExtras = useCallback(async (id: number) => {
    const [p, d] = await Promise.all([
      supabase.from("registration_payments")
        .select("id, msme_id, amount, method, status, reference, receipt_no, paid_at, created_at, submitted_at, verified_at, review_note, proof_file_name")
        .eq("msme_id", id).order("id", { ascending: false }).limit(1),
      supabase.from("msme_documents").select("doc_type, file_name, uploaded_at").eq("msme_id", id),
    ]);
    setPayment(p.data?.[0] ?? null);
    setDocs((d.data as any[]) || []);
  }, []);

  useEffect(() => {
    if (!msme) return;
    const v = (x: any) => (x === null || x === undefined ? "" : String(x));
    setDetails({
      business_name: v(msme.business_name), business_type: v(msme.business_type), category: v(msme.category), address: v(msme.address),
      contact_number: v(msme.contact_number), description: v(msme.description), logo: v(msme.logo),
      years_in_operation: v(msme.years_in_operation), employee_count: v(msme.employee_count), business_size: v(msme.business_size), business_reg_no: v(msme.business_reg_no),
      owner_name: v(msme.owner_name || profile?.fullname), owner_birthdate: v(msme.owner_birthdate), owner_sex: v(msme.owner_sex), owner_contact: v(msme.owner_contact),
      owner_email: v(msme.owner_email || profile?.email), owner_address: v(msme.owner_address), owner_city: v(msme.owner_city), owner_province: v(msme.owner_province),
    });
    setReq({ dti_sec_cda_no: v(msme.dti_sec_cda_no), tin: v(msme.tin), capitalization: v(msme.capitalization) });
    loadExtras(msme.id);
  }, [msme, loadExtras, profile?.fullname, profile?.email]);

  useEffect(() => {
    const t = msme?.municipality || town;
    if (!t) return;
    supabase.from("municipalities").select("office_name, name, phone, email, address, hours").eq("id", t).maybeSingle().then(({ data }) => setOffice(data));
  }, [msme?.municipality, town]);

  const setD = (k: keyof typeof emptyDetails) => (val: string) => setDetails(p => ({ ...p, [k]: val }));

  const handleLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file."); return; }
    try { const { dataUrl } = await readUploadFile(file); setDetails(p => ({ ...p, logo: dataUrl })); }
    catch (err: any) { toast.error(err.message); }
  };

  const status: string = msme?.status || "unpaid";
  const payStatus: string = payment?.status || "unpaid";
  const feeLocked = payStatus === "submitted" || payStatus === "paid";
  const underReview = status === "pending";
  // editable until submitted for review; approved businesses with an unpaid
  // fee (older accounts) can still complete them to pay
  const reqEditable = !!msme && !underReview && !(status === "approved" && payStatus === "paid");
  const docOf = (id: string) => docs.find(d => d.doc_type === id);
  const missingReq = [
    !req.dti_sec_cda_no.trim() && "DTI/SEC/CDA Registration Number",
    !req.tin.trim() && "TIN",
    !(Number(req.capitalization) > 0) && "Business Capitalization",
    ...DOC_TYPES.filter(d => d.required && !docOf(d.id)).map(d => d.label),
  ].filter(Boolean) as string[];
  const reqSaved = !!msme && !!msme.dti_sec_cda_no && !!msme.tin && Number(msme.capitalization) > 0
    && DOC_TYPES.every(d => !d.required || docOf(d.id));
  const fee = Number(msme?.registration_fee || 0);

  const saveDetails = async () => {
    if (!authUser) return;
    if (!details.business_name.trim()) { toast.error("Business name is required."); return; }
    if (!details.business_size) { toast.error("Select your business size — it sets your registration fee."); return; }
    if (details.years_in_operation !== "" && !/^\d+$/.test(details.years_in_operation)) { toast.error("Years in operation must be a whole number."); return; }
    if (details.employee_count !== "" && !/^\d+$/.test(details.employee_count)) { toast.error("Number of employees must be a whole number."); return; }
    setSaving("details");
    const nz = (x: string) => x.trim() || null;
    const payload: any = {
      owner: authUser.id,
      business_name: details.business_name.trim(), business_type: nz(details.business_type), category: nz(details.category),
      address: nz(details.address), contact_number: nz(details.contact_number), description: nz(details.description), logo: details.logo || null,
      years_in_operation: details.years_in_operation === "" ? null : Number(details.years_in_operation),
      employee_count: details.employee_count === "" ? null : Number(details.employee_count),
      business_size: details.business_size || null, business_reg_no: nz(details.business_reg_no),
      owner_name: nz(details.owner_name), owner_birthdate: details.owner_birthdate || null, owner_sex: nz(details.owner_sex),
      owner_contact: nz(details.owner_contact), owner_email: nz(details.owner_email), owner_address: nz(details.owner_address),
      owner_city: nz(details.owner_city), owner_province: nz(details.owner_province),
    };
    if (msme) {
      const { data, error } = await supabase.from("msmes").update(payload).eq("id", msme.id).select().maybeSingle();
      if (error) toast.error(error.message);
      else if (data) {
        setMSME(data);
        await recordActivity("update", "msme", data.id, `${data.business_name} updated its business profile.`, data.municipality);
        toast.success("Business details saved.");
      }
    } else {
      const { data, error } = await supabase.from("msmes").insert([{
        ...payload, municipality: town ?? null, status: "unpaid",
        registration_code: `MB-${(Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase()}`,
      }]).select().maybeSingle();
      if (error) toast.error(error.message || "Could not register business.");
      else if (data) {
        setMSME(data);
        await recordActivity("create", "msme", data.id, `New business registration: ${data.business_name}.`, data.municipality);
        toast.success("Business registered — complete your requirements and registration fee below.");
      }
    }
    setSaving(null);
  };

  const saveRequirements = async () => {
    if (!msme) return;
    const cap = Number(req.capitalization);
    if (req.capitalization !== "" && !(cap >= 0)) { toast.error("Capitalization must be a valid amount."); return; }
    setSaving("req");
    const { data, error } = await supabase.from("msmes").update({
      dti_sec_cda_no: req.dti_sec_cda_no.trim() || null, tin: req.tin.trim() || null,
      capitalization: req.capitalization === "" ? null : cap,
    }).eq("id", msme.id).select().maybeSingle();
    if (error) toast.error(error.message);
    else if (data) { setMSME(data); toast.success("Requirements saved."); }
    setSaving(null);
  };

  const uploadDoc = async (docType: string, file: File) => {
    if (!msme) return;
    setUploading(docType);
    try {
      const { dataUrl, name } = await readUploadFile(file);
      const { error } = await supabase.from("msme_documents").upsert(
        { msme_id: msme.id, doc_type: docType, file_name: name, file_data: dataUrl, uploaded_at: new Date().toISOString() },
        { onConflict: "msme_id,doc_type" });
      if (error) throw error;
      await loadExtras(msme.id);
      toast.success("Document uploaded.");
    } catch (err: any) {
      toast.error(err.message || "Upload failed.");
    }
    setUploading(null);
  };

  const viewDoc = async (docType: string) => {
    if (!msme) return;
    const { data } = await supabase.from("msme_documents").select("file_data").eq("msme_id", msme.id).eq("doc_type", docType).maybeSingle();
    openDataUrl((data as any)?.file_data);
  };

  const viewProof = async () => {
    if (!payment) return;
    const { data } = await supabase.from("registration_payments").select("proof_file").eq("id", payment.id).maybeSingle();
    openDataUrl((data as any)?.proof_file);
  };

  const pickProof = async (file: File) => {
    try { setPay(p => ({ ...p, proof: null })); const f = await readUploadFile(file); setPay(p => ({ ...p, proof: f })); }
    catch (err: any) { toast.error(err.message); }
  };

  const submitPayment = async () => {
    if (!msme) return;
    if (!reqSaved) { toast.error(`Complete and save your requirements first: ${missingReq.join(", ") || "save the requirements form"}.`); return; }
    if (!msme.business_size) { toast.error("Set your business size in Business Details first."); return; }
    if (!(fee > 0)) { toast.error("The LGU hasn't set a fee for your business size yet — contact the LGU."); return; }
    if (!pay.reference.trim()) { toast.error("Enter the payment reference / transaction number."); return; }
    if (!pay.proof) { toast.error("Upload your proof of payment (receipt photo or screenshot)."); return; }
    setSaving("pay");
    const payload = {
      msme_id: msme.id, amount: fee, method: pay.method, reference: pay.reference.trim(), status: "submitted",
      proof_file: pay.proof.dataUrl, proof_file_name: pay.proof.name, submitted_at: new Date().toISOString(),
    };
    const { data, error } = payment && payment.status !== "paid"
      ? await supabase.from("registration_payments").update(payload).eq("id", payment.id).select("id").maybeSingle()
      : await supabase.from("registration_payments").insert([payload]).select("id").maybeSingle();
    if (error) { toast.error(error.message); setSaving(null); return; }
    if (status !== "approved") {
      const { error: e2 } = await supabase.from("msmes").update({ status: "pending", requirements_submitted_at: new Date().toISOString() }).eq("id", msme.id);
      if (e2) { toast.error(e2.message); setSaving(null); return; }
    }
    await recordActivity("payment", "registration_payment", (data as any)?.id || null, `${msme.business_name} submitted a proof of payment (${peso(fee)}, ${pay.method}) for LGU verification.`, msme.municipality);
    setPay({ method: pay.method, reference: "", proof: null });
    await reload();
    setSaving(null);
    toast.success("Proof of payment submitted! The LGU will verify it and approve your registration.");
  };

  const resubmit = async () => {
    if (!msme) return;
    setSaving("resubmit");
    const next = payStatus === "submitted" || payStatus === "paid" ? "pending" : "unpaid";
    const { error } = await supabase.from("msmes").update({ status: next }).eq("id", msme.id);
    if (error) toast.error(error.message);
    else {
      await recordActivity("update", "msme", msme.id, `${msme.business_name} resubmitted its application.`, msme.municipality);
      await reload();
      toast.success(next === "pending" ? "Re-submitted for LGU review." : "Re-submitted — complete your registration fee payment.");
    }
    setSaving(null);
  };

  if (!loaded) return <div className="flex justify-center py-20"><Spinner /></div>;

  const steps = [
    { label: "Account", done: !!msme },
    { label: "Requirements", done: reqSaved },
    { label: "Payment", done: feeLocked },
    { label: "LGU Verification", done: payStatus === "paid" },
    { label: "Approved", done: status === "approved" },
  ];
  const statusMap: Record<string, { label: string; variant: "warning" | "success" | "danger" | "info" }> = {
    unpaid: { label: "Requirements & Fee Due", variant: "danger" },
    pending: { label: "For LGU Verification", variant: "warning" },
    approved: { label: "Active & Listed", variant: "success" },
    rejected: { label: "Rejected by LGU", variant: "danger" },
  };
  const selectCls = "w-full bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60";

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Registered business header */}
      <GlassCard className="p-5">
        <div className="flex items-center gap-4 flex-wrap">
          {details.logo
            ? <img src={details.logo} alt="" className="w-14 h-14 rounded-2xl object-cover" />
            : <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center"><Building2 className="w-7 h-7 text-primary" /></div>}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Registered Business</p>
            <h3 className="font-bold font-[Outfit] text-xl text-foreground truncate">{msme?.business_name || "Register your business"}</h3>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              {msme && <Badge variant={(statusMap[status] || statusMap.unpaid).variant}>{(statusMap[status] || statusMap.unpaid).label}</Badge>}
              {(msme?.municipality || town) && <Badge variant="info"><Landmark className="w-3 h-3 mr-1 inline" /> {MUNI_NAME[msme?.municipality || town || ""] || townName}, Laguna</Badge>}
              {msme?.registration_code && <span className="text-xs font-mono text-muted-foreground">{msme.registration_code}</span>}
            </div>
          </div>
          {msme?.business_size && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{SIZE_LABEL[msme.business_size]} business · fee</p>
              <p className="text-lg font-bold font-mono text-foreground">{peso(fee)}</p>
            </div>
          )}
        </div>
        {msme && (
          <div className="grid grid-cols-5 gap-1.5 mt-5">
            {steps.map((s, i) => (
              <div key={s.label} className="flex flex-col items-center gap-1.5 text-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${s.done ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                  {s.done ? <CheckCircle className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`text-[10px] sm:text-xs leading-tight ${s.done ? "text-foreground font-semibold" : "text-muted-foreground"}`}>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Status banners */}
      {status === "pending" && (
        <GlassCard className="p-4 border-amber-500/40 bg-amber-500/5 flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-foreground/90">
            <p className="font-semibold">Proof of payment submitted — waiting for LGU verification</p>
            <p className="text-muted-foreground text-xs mt-0.5">The {townName} LGU will check your requirements and payment, then approve your business. You'll be able to use the Point of Sale once approved.</p>
          </div>
        </GlassCard>
      )}
      {payStatus === "rejected" && status !== "approved" && (
        <GlassCard className="p-4 border-red-500/40 bg-red-500/5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-foreground/90">
            <p className="font-semibold">Your proof of payment was not accepted</p>
            <p className="text-muted-foreground text-xs mt-0.5">{payment?.review_note || msme?.rejection_reason || "Please upload a clear, valid proof of payment."} — upload a new proof below.</p>
          </div>
        </GlassCard>
      )}
      {status === "rejected" && (
        <GlassCard className="p-4 border-red-500/40 bg-red-500/5 flex items-start gap-3">
          <X className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-foreground/90">
            <p className="font-semibold">Application rejected by the LGU</p>
            <p className="text-muted-foreground text-xs mt-0.5">{msme?.rejection_reason ? `Reason: ${msme.rejection_reason}. ` : ""}Update your details or requirements below, then resubmit for a fresh review.</p>
            <Btn size="sm" variant="outline" className="mt-2" onClick={resubmit} disabled={saving === "resubmit"}>Resubmit for Approval</Btn>
          </div>
        </GlassCard>
      )}
      {status === "approved" && (
        <GlassCard className="p-4 border-green-500/40 bg-green-500/5 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-foreground/90">
            <p className="font-semibold">You're live! 🎉</p>
            <p className="text-muted-foreground text-xs mt-0.5">The LGU approved your business. Record your sales in the Point of Sale — every receipt has a QR code customers scan to earn points.</p>
          </div>
        </GlassCard>
      )}

      {/* Step 2: requirements */}
      {msme && (
        <GlassCard className="p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
            <div>
              <h4 className="font-bold font-[Outfit] text-foreground text-lg flex items-center gap-2"><FileText className="w-5 h-5 text-primary" /> Business Requirements</h4>
              <p className="text-xs text-muted-foreground mt-0.5">{reqEditable ? "Fill in and upload the requirements below. Items marked * are required." : underReview ? "Locked while the LGU reviews your application." : "Submitted requirements."}</p>
            </div>
            {reqSaved && <Badge variant="success">Complete</Badge>}
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">DTI / SEC / CDA Registration No.<span className="text-red-500 ml-0.5">*</span></label>
              <input value={req.dti_sec_cda_no} disabled={!reqEditable} onChange={e => setReq(p => ({ ...p, dti_sec_cda_no: e.target.value }))} placeholder="e.g. 3456789"
                className="w-full bg-input-background border border-border rounded-xl py-2.5 px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Tax Identification No. (TIN)<span className="text-red-500 ml-0.5">*</span></label>
              <input value={req.tin} disabled={!reqEditable} onChange={e => setReq(p => ({ ...p, tin: e.target.value }))} placeholder="000-000-000-000"
                className="w-full bg-input-background border border-border rounded-xl py-2.5 px-4 text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Business Capitalization (₱)<span className="text-red-500 ml-0.5">*</span></label>
              <input type="number" min={0} value={req.capitalization} disabled={!reqEditable} onChange={e => setReq(p => ({ ...p, capitalization: e.target.value }))} placeholder="50000"
                className="w-full bg-input-background border border-border rounded-xl py-2.5 px-4 text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60" />
            </div>
          </div>
          {reqEditable && <Btn size="sm" className="mt-4" icon={Save} onClick={saveRequirements} disabled={saving === "req"}>{saving === "req" ? "Saving…" : "Save Requirements"}</Btn>}
          <div className="space-y-2 mt-5">
            {DOC_TYPES.map(d => {
              const doc = docOf(d.id);
              return (
                <UploadSlot key={d.id} label={d.label} required={d.required} fileName={doc?.file_name || (doc ? "Uploaded" : null)} uploadedAt={doc?.uploaded_at}
                  disabled={!reqEditable} busy={uploading === d.id} onPick={f => uploadDoc(d.id, f)} onView={() => viewDoc(d.id)} />
              );
            })}
          </div>
          {reqEditable && missingReq.length > 0 && <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">Still needed: {missingReq.join(", ")}.</p>}
        </GlassCard>
      )}

      {/* Step 3: registration fee + proof of payment */}
      {msme && payStatus !== "paid" && payStatus !== "submitted" && (
        <GlassCard className={`p-6 ${reqSaved ? "border-amber-500/40" : "opacity-80"}`}>
          <h4 className="font-bold font-[Outfit] text-foreground text-lg flex items-center gap-2"><Wallet className="w-5 h-5 text-amber-500" /> Registration Fee Payment</h4>
          <p className="text-sm text-muted-foreground mt-1">
            {msme.business_size
              ? <>Your fee as a <b className="text-foreground">{SIZE_LABEL[msme.business_size]}</b> business is <b className="text-foreground font-mono">{peso(fee)}</b> — set automatically by the {townName} LGU.</>
              : "Set your business size in Business Details below to see your fee."}
          </p>
          {office && (
            <p className="text-xs text-muted-foreground mt-2">Pay via e-wallet/bank or over the counter at the <b>{office.office_name || `${office.name} office`}</b>{office.address ? `, ${office.address}` : ""}{office.phone ? ` · ${office.phone}` : ""}. Keep your receipt or screenshot — you'll upload it as proof.</p>
          )}
          {!reqSaved ? (
            <p className="text-sm text-amber-600 dark:text-amber-400 mt-4">Complete and save your business requirements first to unlock payment.</p>
          ) : (
            <>
              <div className="grid sm:grid-cols-3 gap-3 mt-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Payment Method</label>
                  <select value={pay.method} onChange={e => setPay(p => ({ ...p, method: e.target.value }))} className={selectCls}>
                    {REG_PAY_METHODS.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">Reference / Transaction / OR No. *</label>
                  <Input placeholder="e.g. GCash ref 1234 5678 901" value={pay.reference} onChange={v => setPay(p => ({ ...p, reference: v }))} />
                </div>
              </div>
              <div className="mt-3">
                <UploadSlot label="Proof of Payment (receipt photo or e-wallet screenshot)" required fileName={pay.proof?.name} onPick={pickProof}
                  onView={pay.proof ? () => openDataUrl(pay.proof!.dataUrl) : undefined} />
                {pay.proof?.dataUrl.startsWith("data:image") && <img src={pay.proof.dataUrl} alt="Proof preview" className="mt-2 h-32 rounded-xl border border-border object-cover" />}
              </div>
              <Btn className="mt-4" onClick={submitPayment} disabled={saving === "pay" || !(fee > 0)} icon={CheckCircle}>
                {saving === "pay" ? "Submitting…" : `Submit Payment of ${peso(fee)}`}
              </Btn>
              <p className="text-xs text-muted-foreground mt-2">The LGU checks your proof of payment before approving your business.</p>
            </>
          )}
        </GlassCard>
      )}

      {msme && payStatus === "submitted" && (
        <GlassCard className="p-5 border-blue-500/40 bg-blue-500/5">
          <h4 className="font-bold font-[Outfit] text-foreground flex items-center gap-2"><Clock className="w-5 h-5 text-blue-500" /> Payment Submitted</h4>
          <div className="grid sm:grid-cols-2 gap-x-6 mt-3">
            <InfoRow label="Amount" value={<span className="font-mono">{peso(payment.amount)}</span>} />
            <InfoRow label="Method" value={payment.method} />
            <InfoRow label="Reference" value={<span className="font-mono">{payment.reference}</span>} />
            <InfoRow label="Submitted" value={payment.submitted_at ? `${localDateLabel(payment.submitted_at)} ${localTimeLabel(payment.submitted_at)}` : "—"} />
          </div>
          <Btn size="sm" variant="outline" className="mt-3" icon={Eye} onClick={viewProof}>View my proof of payment</Btn>
        </GlassCard>
      )}

      {msme && payStatus === "paid" && (
        <GlassCard className="p-5 border-green-500/40 bg-green-500/5">
          <div className="flex items-start gap-3">
            <Receipt className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-bold font-[Outfit] text-foreground">Official Receipt — Registration Fee</h4>
              <div className="grid sm:grid-cols-2 gap-x-6 mt-3">
                <InfoRow label="Receipt No." value={<span className="font-mono">{payment.receipt_no}</span>} />
                <InfoRow label="Business" value={msme.business_name} />
                <InfoRow label="Amount" value={<span className="font-mono">{peso(payment.amount)}</span>} />
                <InfoRow label="Method" value={payment.method} />
                <InfoRow label="Reference" value={<span className="font-mono">{payment.reference}</span>} />
                <InfoRow label="Verified On" value={localDateLabel(payment.verified_at || payment.paid_at || payment.created_at)} />
              </div>
              <div className="flex gap-2 mt-4">
                <Btn variant="outline" size="sm" icon={Printer} onClick={() => window.print()}>Print Receipt</Btn>
                {payment.proof_file_name && <Btn variant="ghost" size="sm" icon={Eye} onClick={viewProof}>View proof</Btn>}
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Business + owner details */}
      <GlassCard className="p-6">
        <h4 className="font-bold font-[Outfit] text-foreground text-lg mb-4">{msme ? "Business Details" : "Register Your Business"}</h4>
        <div className="flex items-center gap-4 mb-6">
          <div className="relative">
            {details.logo ? <img src={details.logo} alt="Logo" className="w-20 h-20 rounded-2xl object-cover" />
              : <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center"><Building2 className="w-9 h-9 text-primary" /></div>}
            <label className="absolute -bottom-1 -right-1 p-1.5 rounded-full bg-primary text-white cursor-pointer shadow-lg">
              <Camera className="w-3.5 h-3.5" />
              <input type="file" accept="image/*" className="hidden" onChange={handleLogo} />
            </label>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Business Logo</p>
            <p className="text-xs text-muted-foreground/70">Click the camera to upload your logo</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Business Name *" placeholder="Elena's Delicacies" value={details.business_name} onChange={setD("business_name")} icon={Building2} />
          <SelectField label="Business Type" value={BUSINESS_TYPES.includes(details.business_type) || !details.business_type ? details.business_type : "Other"} onChange={setD("business_type")} placeholder="Select type…"
            options={[...BUSINESS_TYPES, ...(details.business_type && !BUSINESS_TYPES.includes(details.business_type) ? [details.business_type] : [])].map(v => ({ value: v, label: v }))} />
          <SearchSelect label="Business Category / Industry" value={details.category} onChange={setD("category")}
            options={details.category && !BUSINESS_CATEGORIES.includes(details.category) ? [details.category, ...BUSINESS_CATEGORIES] : BUSINESS_CATEGORIES} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Business Size<span className="text-red-500 ml-0.5">*</span></label>
            <select value={details.business_size} disabled={feeLocked} onChange={e => setD("business_size")(e.target.value)} className={selectCls}>
              <option value="">Select size…</option>
              {BUSINESS_SIZES.map(s => <option key={s.id} value={s.id}>{s.label} — {rates[s.id] !== undefined ? peso(rates[s.id]) : "fee not set"}</option>)}
            </select>
            {feeLocked && <p className="text-xs text-muted-foreground">Locked — your registration fee was already paid/submitted.</p>}
          </div>
          <Input label="Business Address" placeholder="Stall no. / street, barangay, town" value={details.address} onChange={setD("address")} icon={MapPin} />
          <Input label="Business Contact Number" placeholder="09xx-xxx-xxxx" value={details.contact_number} onChange={setD("contact_number")} icon={Phone} />
          <Input label="Years in Operation" type="number" placeholder="0" value={details.years_in_operation} onChange={setD("years_in_operation")} />
          <Input label="Number of Employees (optional)" type="number" placeholder="3" value={details.employee_count} onChange={setD("employee_count")} />
          <div className="sm:col-span-2"><Input label="Business Registration No. (if required)" placeholder="DTI / SEC / CDA no." value={details.business_reg_no} onChange={setD("business_reg_no")} icon={FileText} /></div>
        </div>
        <div className="flex flex-col gap-1.5 mt-4">
          <label className="text-sm font-medium text-foreground">Description</label>
          <textarea value={details.description} onChange={e => setD("description")(e.target.value)} rows={3} placeholder="Tell tourists what your business offers…"
            className="w-full bg-input-background border border-border rounded-xl py-2.5 px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all" />
        </div>

        <h5 className="font-bold font-[Outfit] text-foreground mt-6 mb-3">Owner / Personal Information</h5>
        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Full Name" value={details.owner_name} onChange={setD("owner_name")} icon={Users} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Date of Birth {details.owner_birthdate && ageFrom(details.owner_birthdate) !== null && <span className="text-muted-foreground font-normal">· {ageFrom(details.owner_birthdate)} yrs</span>}</label>
            <input type="date" value={details.owner_birthdate} max={todayStr()} onChange={e => setD("owner_birthdate")(e.target.value)}
              className="w-full bg-input-background border border-border rounded-xl py-2.5 px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <SelectField label="Sex / Gender (optional)" value={details.owner_sex} onChange={setD("owner_sex")} placeholder="Prefer not to say" options={["Male", "Female", "Other"].map(v => ({ value: v, label: v }))} />
          <Input label="Contact Number" value={details.owner_contact} onChange={setD("owner_contact")} icon={Phone} />
          <Input label="Email Address" type="email" value={details.owner_email} onChange={setD("owner_email")} icon={Mail} />
          <Input label="Residential Address" value={details.owner_address} onChange={setD("owner_address")} icon={Home} />
          <Input label="City / Municipality" value={details.owner_city} onChange={setD("owner_city")} icon={MapPin} />
          <Input label="Province" value={details.owner_province} onChange={setD("owner_province")} icon={Landmark} />
        </div>
        <Btn className="mt-5" onClick={saveDetails} disabled={saving === "details"} icon={CheckCircle}>{saving === "details" ? "Saving…" : msme ? "Save Business Details" : "Register Business"}</Btn>
        {!msme && <p className="text-xs text-muted-foreground mt-3">Registering in {townName || "your municipality"} adds you to the festival directory once the LGU verifies your requirements and registration fee.</p>}
      </GlassCard>
    </div>
  );
}

function MSMEOverview({ goTab }: { goTab?: (id: string) => void }) {
  const { msme, loaded } = useMyMSMEState();
  const [sales, setSales] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [redeemed, setRedeemed] = useState(0);

  useEffect(() => {
    if (!msme) return;
    Promise.all([
      fetchAll((from, to) => supabase.from("sales").select("id, total, item_count, created_at, customer_id, sale_items(product_name, quantity, line_total)").eq("msme_id", msme.id).order("id").range(from, to)).catch(() => [] as any[]),
      supabase.from("products").select("*").eq("msme_id", msme.id).order("product_name"),
      supabase.from("redeemed_rewards").select("id", { count: "exact", head: true }).eq("msme_id", msme.id),
    ]).then(([s, p, r]) => {
      setSales(s);
      setProducts((p.data as Product[]) || []);
      setRedeemed(r.count || 0);
    });
  }, [msme]);

  const today = todayStr();
  const todays = sales.filter(s => localDateKey(s.created_at) === today);
  const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const key = d.toLocaleDateString("en-CA");
    return { day: d.toLocaleDateString("en-PH", { weekday: "short" }), sales: sum(sales.filter(s => localDateKey(s.created_at) === key), "total") };
  });
  const itemTotals: Record<string, { name: string; qty: number }> = {};
  for (const s of sales) for (const it of s.sale_items || []) {
    const r = (itemTotals[it.product_name] ||= { name: it.product_name, qty: 0 });
    r.qty += Number(it.quantity || 0);
  }
  const topItems = Object.values(itemTotals).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const lowStock = products.filter(p => p.stock <= 5);

  if (!loaded) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div className="space-y-6">
      {msme ? (
        <GlassCard className="p-5 flex items-center gap-4 flex-wrap">
          {msme.logo ? <img src={msme.logo} alt={msme.business_name} className="w-12 h-12 rounded-2xl object-cover" />
            : <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center"><Building2 className="w-6 h-6 text-primary" /></div>}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold font-[Outfit] text-foreground text-lg">{msme.business_name}</h3>
            <p className="text-sm text-muted-foreground truncate">{msme.description || "Your MSME business"}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={msme.status === "approved" ? "success" : msme.status === "pending" ? "warning" : "danger"}>
              {msme.status === "approved" ? "Active & Listed" : msme.status === "unpaid" ? "Requirements & Fee Due" : msme.status === "pending" ? "For LGU Verification" : msme.status === "rejected" ? "Rejected" : msme.status || "—"}
            </Badge>
            {msme.status === "approved"
              ? <Btn size="sm" icon={Store} onClick={() => goTab?.("pos")}>Open Point of Sale</Btn>
              : <Btn size="sm" variant="outline" icon={ArrowRight} onClick={() => goTab?.("business")}>Finish registration</Btn>}
          </div>
        </GlassCard>
      ) : (
        <GlassCard className="p-5 border-dashed text-center">
          <Building2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">No MSME profile found. Go to Business Profile to register your business.</p>
        </GlassCard>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Sales Today" value={peso(sum(todays, "total"))} icon={DollarSign} color="bg-green-500" />
        <StatCard label="Total Sales" value={peso(sum(sales, "total"))} icon={TrendingUp} color="bg-primary" />
        <StatCard label="Transactions" value={`${sales.length} (${todays.length} today)`} icon={Receipt} color="bg-secondary" />
        <StatCard label="Items Sold" value={sum(sales, "item_count")} icon={ShoppingBag} color="bg-accent" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Products" value={products.length} icon={Package} color="bg-sky-500" />
        <StatCard label="Low / Out of Stock" value={lowStock.length} icon={AlertCircle} color="bg-amber-500" />
        <StatCard label="Receipts Claimed for Points" value={sales.filter(s => s.customer_id).length} icon={Award} color="bg-violet-500" />
        <StatCard label="Rewards Redeemed Here" value={redeemed} icon={Gift} color="bg-rose-500" />
      </div>
      <div className="grid lg:grid-cols-[2fr_1fr] gap-6">
        <GlassCard className="p-5">
          <h3 className="font-bold font-[Outfit] text-foreground mb-4">Sales — Last 7 Days</h3>
          <Suspense fallback={<ChartFallback height={220} />}>
            <WeeklySalesChart week={week} />
          </Suspense>
        </GlassCard>
        <div className="space-y-6">
          <GlassCard className="p-5">
            <h3 className="font-bold font-[Outfit] text-foreground mb-3">Best Sellers</h3>
            {topItems.length ? topItems.map(t => (
              <div key={t.name} className="flex justify-between gap-2 py-1.5 border-b border-border/50 last:border-0 text-sm">
                <span className="text-foreground truncate">{t.name}</span>
                <span className="font-mono text-muted-foreground flex-shrink-0">{t.qty} sold</span>
              </div>
            )) : <p className="text-sm text-muted-foreground">No sales yet.</p>}
          </GlassCard>
          <GlassCard className="p-5">
            <h3 className="font-bold font-[Outfit] text-foreground mb-3">Stock Alerts</h3>
            {lowStock.length ? lowStock.map(p => (
              <div key={p.id} className="flex justify-between gap-2 py-1.5 border-b border-border/50 last:border-0 text-sm">
                <span className="text-foreground truncate">{p.product_name}</span>
                <Badge variant={p.stock <= 0 ? "danger" : "warning"}>{p.stock <= 0 ? "Out of stock" : `${p.stock} left`}</Badge>
              </div>
            )) : <p className="text-sm text-muted-foreground">All products are well stocked.</p>}
            {lowStock.length > 0 && <button onClick={() => goTab?.("products")} className="text-xs font-semibold text-primary hover:underline mt-2">Restock in My Products →</button>}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

function MSMEProducts({ gotoBusiness }: { gotoBusiness?: () => void }) {
  const msme = useMyMSME();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ product_name: "", price: "", stock: "", description: "", image: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!msme) { setLoading(false); return; }
    supabase.from("products").select("*").eq("msme_id", msme.id).then(({ data }) => {
      setProducts(data || []);
      setLoading(false);
    });
  }, [msme]);

  const startEdit = (p: Product) => {
    setEditing(p);
    setForm({ product_name: p.product_name, price: String(p.price), stock: String(p.stock), description: p.description || "", image: p.image || "" });
    setShowForm(true);
  };

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file."); return; }
    const reader = new FileReader();
    reader.onload = () => setForm(p => ({ ...p, image: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!msme) { toast.error("Register your business first in Business Profile."); return; }
    if (!form.product_name.trim()) { toast.error("Product name is required."); return; }
    if (!form.price || Number(form.price) <= 0) { toast.error("Enter a valid price."); return; }
    setSaving(true);
    const payload = {
      msme_id: msme.id, product_name: form.product_name,
      price: Number(form.price), stock: Number(form.stock) || 0,
      description: form.description || null,
      image: form.image || null,
    };
    if (editing) {
      const { data, error } = await supabase.from("products").update(payload).eq("id", editing.id).select().single();
      if (!error && data) {
        setProducts(prev => prev.map(p => p.id === editing.id ? data : p)); setShowForm(false); setEditing(null); toast.success("Product updated!");
        await recordActivity("update", "product", data.id, `${msme.business_name} updated product "${data.product_name}" (₱${Number(data.price).toLocaleString()}, stock ${data.stock}).`, msme.municipality);
      }
      else toast.error(error?.message || "Could not update product.");
    } else {
      const { data, error } = await supabase.from("products").insert([payload]).select().single();
      if (!error && data) {
        setProducts(prev => [data, ...prev]); setShowForm(false); setForm({ product_name: "", price: "", stock: "", description: "", image: "" }); toast.success("Product added!");
        await recordActivity("create", "product", data.id, `${msme.business_name} added product "${data.product_name}".`, msme.municipality);
      }
      else toast.error(error?.message || "Could not save product.");
    }
    setSaving(false);
  };

  const remove = async (id: number) => {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    const gone = products.find(p => p.id === id);
    setProducts(prev => prev.filter(p => p.id !== id));
    toast.success("Product removed.");
    if (msme && gone) await recordActivity("update", "product", id, `${msme.business_name} removed product "${gone.product_name}".`, msme.municipality);
  };

  const fallbackImgs = ["https://images.unsplash.com/photo-1555126634-323283e090fa?w=300&h=200&fit=crop", "https://images.unsplash.com/photo-1605883705077-8d3d3cebe78c?w=300&h=200&fit=crop", "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=300&h=200&fit=crop", "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=300&h=200&fit=crop"];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-bold font-[Outfit] text-xl text-foreground">My Products</h3>
        <Btn icon={PlusCircle} size="sm" disabled={!msme} onClick={() => { setShowForm(!showForm); setEditing(null); setForm({ product_name: "", price: "", stock: "", description: "", image: "" }); }}>Add Product</Btn>
      </div>
      {msme && msme.status !== "approved" && (
        <GlassCard className="p-4 border-amber-500/40 bg-amber-500/5 flex items-start gap-3">
          <LockIcon className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-foreground/90">
            <p className="font-semibold">Your listings stay hidden until your business is active</p>
            <p className="text-muted-foreground text-xs mt-0.5">Products are reviewed and published individually by the LGU once your registration is approved and paid. You can add &amp; edit them now — they just won't be visible to tourists yet.</p>
          </div>
        </GlassCard>
      )}
      {!msme && (
        <GlassCard className="p-6 border-dashed">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0"><Building2 className="w-5 h-5 text-primary" /></div>
            <div className="flex-1">
              <h4 className="font-bold font-[Outfit] text-foreground">No business registered yet</h4>
              <p className="text-sm text-muted-foreground mt-1">You need to register your business before you can add products. Go to Business Profile and fill in your business details.</p>
              <Btn size="sm" className="mt-3" icon={ArrowRight} onClick={() => gotoBusiness?.()}>Go to Business Profile</Btn>
            </div>
          </div>
        </GlassCard>
      )}
      {showForm && (
        <GlassCard className="p-5">
          <h4 className="font-bold font-[Outfit] text-foreground mb-4">{editing ? "Edit Product" : "New Product"}</h4>
          <div className="flex flex-col items-center gap-3 mb-5">
            {form.image ? (
              <div className="relative">
                <img src={form.image} alt="Product preview" className="w-40 h-40 rounded-2xl object-cover" />
                <button onClick={() => setForm(p => ({ ...p, image: "" }))} className="absolute -top-2 -right-2 p-1 rounded-full bg-red-500 text-white shadow-lg"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <label className="w-40 h-40 rounded-2xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors">
                <Upload className="w-7 h-7 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Upload picture</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImage} />
              </label>
            )}
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-border text-sm hover:bg-muted cursor-pointer transition-colors">
                <Camera className="w-4 h-4" /> {form.image ? "Change Picture" : "Choose Picture"}
                <input type="file" accept="image/*" className="hidden" onChange={handleImage} />
              </label>
              {form.image && <Btn variant="outline" size="sm" onClick={() => setForm(p => ({ ...p, image: "" }))} icon={X}>Remove</Btn>}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input label="Product Name *" placeholder="Lakatan Banana Jam" value={form.product_name} onChange={v => setForm(p => ({ ...p, product_name: v }))} />
            <Input label="Price (₱) *" type="number" placeholder="280" value={form.price} onChange={v => setForm(p => ({ ...p, price: v }))} />
            <Input label="Stock" type="number" placeholder="100" value={form.stock} onChange={v => setForm(p => ({ ...p, stock: v }))} />
            <Input label="Description" placeholder="Brief description" value={form.description} onChange={v => setForm(p => ({ ...p, description: v }))} />
          </div>
          <div className="flex gap-2 mt-4">
            <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Update" : "Save"}</Btn>
            <Btn variant="outline" size="sm" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Btn>
          </div>
        </GlassCard>
      )}
      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : products.length === 0 ? (
        <GlassCard className="p-12 text-center"><Package className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">No products yet. Add your first product!</p></GlassCard>
      ) : (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
          {products.map((p, i) => (
            <GlassCard key={p.id} className="overflow-hidden">
              <div className="relative h-32"><img src={p.image || fallbackImgs[i % fallbackImgs.length]} alt={p.product_name} className="w-full h-full object-cover" />
                <div className="absolute top-2 right-2 flex gap-1">
                  <button onClick={() => startEdit(p)} className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-primary/60"><Edit2 className="w-3 h-3" /></button>
                  <button onClick={() => remove(p.id)} className="p-1.5 rounded-lg bg-black/40 text-white hover:bg-red-500/60"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
              <div className="p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-semibold text-foreground text-sm font-[Outfit]">{p.product_name}</h4>
                  {p.approved ? <Badge variant="success">Published</Badge> : <Badge variant="warning">Awaiting LGU</Badge>}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-primary font-mono font-semibold text-sm">₱{p.price}</span>
                  <Badge variant={p.stock <= 0 ? "danger" : p.stock <= 5 ? "warning" : "success"}>{p.stock <= 0 ? "Out of stock" : p.stock <= 5 ? `Low: ${p.stock} left` : `${p.stock} in stock`}</Badge>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

function MSMEQRGenerator({ gotoBusiness }: { gotoBusiness?: () => void }) {
  const msme = useMyMSME();
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Product | null>(null);
  const [points, setPoints] = useState("50");
  const [generated, setGenerated] = useState<{ code: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!msme) return;
    supabase.from("products").select("*").eq("msme_id", msme.id).then(({ data }) => setProducts(data || []));
  }, [msme]);

  useEffect(() => {
    if (!generated) { setQrDataUrl(null); return; }
    qrDataURL(generated.code, { width: 320, margin: 2, color: { dark: "#000000", light: "#ffffff" } })
      .then(url => setQrDataUrl(url))
      .catch(() => setQrDataUrl(null));
  }, [generated]);

  const generate = async () => {
    if (!selected) { toast.error("Select a product."); return; }
    setLoading(true);
    const code = `FTLGU-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const { error } = await supabase.from("reward_qr").insert([{ product_id: selected.id, qr_code: code, points: Number(points) }]);
    if (error) { toast.error("Could not generate QR."); } else { setGenerated({ code }); toast.success("QR Code generated!"); }
    setLoading(false);
  };

  const download = () => {
    if (!qrDataUrl) { toast.error("QR not ready yet."); return; }
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `${generated?.code || "festivalgu-qr"}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("QR downloaded!");
  };

  return (
    <div className="space-y-5">
      <h3 className="font-bold font-[Outfit] text-xl text-foreground">QR Code Generator</h3>
      <div className="grid md:grid-cols-2 gap-6">
        <GlassCard className="p-5">
          <h4 className="font-semibold text-foreground mb-3">Select Product & Points</h4>
          {!msme ? (
            <div>
              <p className="text-sm text-muted-foreground">Register your business first to generate QR codes.</p>
              <Btn size="sm" className="mt-3" icon={ArrowRight} onClick={() => gotoBusiness?.()}>Go to Business Profile</Btn>
            </div>
          ) : products.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add products first to generate QR codes.</p>
          ) : (
            <div className="space-y-2 mb-4">
              {products.map(p => (
                <button key={p.id} onClick={() => { setSelected(p); setGenerated(null); }}
                  className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border transition-all ${selected?.id === p.id ? "border-primary bg-primary/8" : "border-border hover:bg-muted/50"}`}>
                  <div>
                    <p className="text-sm font-medium text-foreground">{p.product_name}</p>
                    <p className="text-xs text-muted-foreground font-mono">₱{p.price}</p>
                  </div>
                  {selected?.id === p.id && <CheckCircle className="w-4 h-4 text-primary ml-auto" />}
                </button>
              ))}
            </div>
          )}
          <Input label="Points to Award" type="number" value={points} onChange={setPoints} />
          <Btn className="w-full justify-center mt-4" onClick={generate} disabled={loading || !selected} icon={QrCode}>
            {loading ? "Generating…" : "Generate QR Code"}
          </Btn>
        </GlassCard>

        <GlassCard className="p-5 flex flex-col items-center justify-center">
          {generated ? (
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
              <div className="bg-white rounded-2xl p-4 mb-4 inline-block shadow-xl">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Reward QR" className="w-40 h-40" />
                ) : (
                  <div className="w-40 h-40 flex items-center justify-center"><Spinner /></div>
                )}
              </div>
              <p className="font-bold font-[Outfit] text-foreground">{selected?.product_name}</p>
              <p className="text-sm text-muted-foreground mb-1">Scan to earn {points} reward points</p>
              <p className="text-xs font-mono text-muted-foreground mb-4">{generated.code}</p>
              <div className="flex gap-2 justify-center">
                <Btn size="sm" icon={Download} onClick={download}>Download</Btn>
                <Btn variant="outline" size="sm" onClick={() => { setGenerated(null); setSelected(null); }}>New QR</Btn>
              </div>
            </motion.div>
          ) : (
            <div className="text-center">
              <div className="w-24 h-24 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4"><QrCode className="w-10 h-10 text-muted-foreground" /></div>
              <p className="text-muted-foreground text-sm">Select a product and click Generate</p>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

// Receipt preview with the claim QR (after checkout, or reprinted from history).
function SaleReceiptModal({ sale, items, business, onClose, onNewSale }: {
  sale: any; items: ReceiptItem[]; business: any; onClose: () => void; onNewSale?: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => { qrDataURL(claimUrl(sale.claim_code), { width: 320, margin: 1 }).then(setQr).catch(() => setQr(null)); }, [sale.claim_code]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        onClick={e => e.stopPropagation()} className="w-full max-w-sm max-h-[92vh] overflow-y-auto">
        <GlassCard className="p-5">
          <div className="text-center">
            <p className="font-bold font-[Outfit] text-foreground">{business?.business_name}</p>
            <p className="text-xs font-mono text-muted-foreground">{sale.receipt_no}</p>
            <p className="text-xs text-muted-foreground">{localDateLabel(sale.created_at)} {localTimeLabel(sale.created_at)}</p>
          </div>
          <div className="my-3 border-t border-dashed border-border" />
          <div className="space-y-1.5">
            {items.map((i, idx) => (
              <div key={idx} className="flex justify-between gap-3 text-sm">
                <span className="text-foreground">{i.product_name} <span className="text-muted-foreground">× {i.quantity}</span></span>
                <span className="font-mono text-foreground">{peso(i.line_total)}</span>
              </div>
            ))}
          </div>
          <div className="my-3 border-t border-dashed border-border" />
          <div className="flex justify-between text-base font-bold"><span className="text-foreground">Total</span><span className="font-mono text-foreground">{peso(sale.total)}</span></div>
          {sale.payment_method === "cash" ? (
            <>
              <div className="flex justify-between text-sm text-muted-foreground"><span>Cash</span><span className="font-mono">{peso(sale.amount_tendered)}</span></div>
              <div className="flex justify-between text-sm text-muted-foreground"><span>Change</span><span className="font-mono">{peso(sale.change_due)}</span></div>
            </>
          ) : (
            <div className="flex justify-between text-sm text-muted-foreground"><span>E-Wallet{sale.ewallet_provider ? ` (${sale.ewallet_provider})` : ""}</span><span className="font-mono">{sale.ewallet_ref}</span></div>
          )}
          <div className="mt-4 text-center">
            <div className="inline-block bg-white rounded-xl p-2">
              {qr ? <img src={qr} alt="Points QR" className="w-40 h-40" /> : <div className="w-40 h-40 flex items-center justify-center"><Spinner /></div>}
            </div>
            <p className="text-sm font-semibold text-foreground mt-2">Scan to earn {sale.points_earned} point{sale.points_earned === 1 ? "" : "s"}</p>
            <p className="text-xs text-muted-foreground">+{FEEDBACK_BONUS} bonus points for optional feedback · code <span className="font-mono">{sale.claim_code}</span></p>
            {sale.customer_id && <p className="text-xs text-green-600 dark:text-green-400 mt-1">✓ Points already collected by the customer</p>}
          </div>
          <div className="flex gap-2 mt-5">
            <Btn className="flex-1 justify-center" icon={Printer} onClick={() => printSaleReceipt(sale, items, business)}>Print</Btn>
            {onNewSale
              ? <Btn className="flex-1 justify-center" variant="outline" icon={PlusCircle} onClick={onNewSale}>New Sale</Btn>
              : <Btn className="flex-1 justify-center" variant="outline" onClick={onClose}>Close</Btn>}
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}

// Point of Sale: tap products into the cart, take Cash or E-Wallet, and issue a
// receipt whose QR lets the customer collect purchase points. Stock is
// deducted atomically in the database (pos_create_sale).
function MSMEPOS({ goTab }: { goTab?: (id: string) => void }) {
  const { profile } = useApp();
  const { msme, loaded } = useMyMSMEState();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState<"cash" | "e-wallet">("cash");
  const [tendered, setTendered] = useState("");
  const [provider, setProvider] = useState("GCash");
  const [ewRef, setEwRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ sale: any; items: ReceiptItem[] } | null>(null);
  const [today, setToday] = useState({ total: 0, count: 0 });

  const loadProducts = useCallback(async () => {
    if (!msme) return;
    const [p, s] = await Promise.all([
      supabase.from("products").select("*").eq("msme_id", msme.id).order("product_name"),
      supabase.from("sales").select("total, created_at").eq("msme_id", msme.id).gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    ]);
    setProducts((p.data as Product[]) || []);
    const rows = (s.data as any[]) || [];
    setToday({ total: rows.reduce((a, r) => a + Number(r.total || 0), 0), count: rows.length });
  }, [msme]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const lines = products.filter(p => cart[p.id]).map(p => ({ p, qty: cart[p.id], total: Number(p.price) * cart[p.id] }));
  const total = lines.reduce((a, l) => a + l.total, 0);
  const itemCount = lines.reduce((a, l) => a + l.qty, 0);
  const cash = Number(tendered);
  const change = method === "cash" && tendered !== "" ? cash - total : 0;

  const setQty = (p: Product, qty: number) => {
    if (qty > p.stock) { toast.error(`Only ${p.stock} "${p.product_name}" left in stock.`); qty = p.stock; }
    setCart(c => { const n = { ...c }; if (qty <= 0) delete n[p.id]; else n[p.id] = qty; return n; });
  };

  const reset = () => { setCart({}); setTendered(""); setEwRef(""); setMethod("cash"); };

  const checkout = async () => {
    if (!msme || !lines.length) return;
    if (method === "cash" && (tendered === "" || cash < total)) { toast.error("Cash received is less than the total."); return; }
    if (method === "e-wallet" && !ewRef.trim()) { toast.error("Enter the e-wallet reference number."); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("pos_create_sale", {
      p_msme_id: msme.id,
      p_items: lines.map(l => ({ product_id: l.p.id, quantity: l.qty })),
      p_method: method,
      p_tendered: method === "cash" ? cash : null,
      p_ewallet_provider: method === "e-wallet" ? provider : null,
      p_ewallet_ref: method === "e-wallet" ? ewRef.trim() : null,
    });
    setBusy(false);
    if (error || !data) { toast.error(error?.message || "Could not record the sale."); await loadProducts(); return; }
    const sale = Array.isArray(data) ? data[0] : data;
    setReceipt({ sale, items: lines.map(l => ({ product_name: l.p.product_name, quantity: l.qty, unit_price: Number(l.p.price), line_total: l.total })) });
    reset();
    await loadProducts();
    toast.success(`Sale recorded — ${peso(sale.total)}.`);
  };

  if (!loaded) return <div className="flex justify-center py-20"><Spinner /></div>;

  if (!msme || msme.status !== "approved") {
    return (
      <GlassCard className="p-8 text-center max-w-lg mx-auto">
        <LockIcon className="w-10 h-10 mx-auto mb-3 text-amber-500" />
        <h3 className="font-bold font-[Outfit] text-foreground text-lg">Point of Sale is locked</h3>
        <p className="text-sm text-muted-foreground mt-1">You can record sales once the LGU approves your business registration and verifies your registration fee.</p>
        <Btn className="mt-4" icon={ArrowRight} onClick={() => goTab?.("business")}>Go to Business Profile</Btn>
      </GlassCard>
    );
  }

  const visible = products.filter(p => p.product_name.toLowerCase().includes(search.trim().toLowerCase()));
  const business = { ...msme, owner_name: msme.owner_name || profile?.fullname };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold font-[Outfit] text-xl text-foreground">Point of Sale</h3>
          <p className="text-xs text-muted-foreground">Cash or E-Wallet only · every receipt earns the customer {`1 point per ₱${PESOS_PER_POINT}`}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="success">Today: {peso(today.total)}</Badge>
          <Badge variant="info">{today.count} sale{today.count === 1 ? "" : "s"}</Badge>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
        {/* products */}
        <div className="space-y-3">
          <Input placeholder="Search products…" value={search} onChange={setSearch} icon={Search} />
          {products.length === 0 ? (
            <GlassCard className="p-10 text-center">
              <Package className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">Add products first to start selling.</p>
              <Btn size="sm" className="mt-3" icon={PlusCircle} onClick={() => goTab?.("products")}>Add Products</Btn>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {visible.map(p => {
                const inCart = cart[p.id] || 0;
                const out = p.stock <= 0;
                return (
                  <button key={p.id} disabled={out} onClick={() => setQty(p, inCart + 1)}
                    className={`relative text-left rounded-2xl border overflow-hidden transition-all ${out ? "opacity-50 cursor-not-allowed border-border" : inCart ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"}`}>
                    {p.image ? <img src={p.image} alt="" className="w-full h-20 object-cover" />
                      : <div className="w-full h-20 bg-primary/10 flex items-center justify-center"><ShoppingBag className="w-6 h-6 text-primary" /></div>}
                    <div className="p-2.5">
                      <p className="text-sm font-semibold text-foreground line-clamp-2 leading-tight">{p.product_name}</p>
                      <p className="text-sm font-mono text-primary mt-0.5">{peso(p.price)}</p>
                      <p className={`text-[11px] mt-0.5 ${out ? "text-red-500" : p.stock <= 5 ? "text-amber-500" : "text-muted-foreground"}`}>{out ? "Out of stock" : `${p.stock - inCart} left`}</p>
                    </div>
                    {inCart > 0 && <span className="absolute top-1.5 right-1.5 min-w-[22px] h-[22px] px-1 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">{inCart}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* cart */}
        <GlassCard className="p-5 lg:sticky lg:top-0">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-bold font-[Outfit] text-foreground flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-primary" /> Current Order</h4>
            {lines.length > 0 && <button onClick={reset} className="text-xs text-muted-foreground hover:text-red-500">Clear</button>}
          </div>
          {lines.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">Tap products to add them to the order.</p> : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {lines.map(l => (
                <div key={l.p.id} className="flex items-center gap-2 rounded-xl bg-muted/30 px-2.5 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{l.p.product_name}</p>
                    <p className="text-xs font-mono text-muted-foreground">{peso(l.p.price)} × {l.qty} = {peso(l.total)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setQty(l.p, l.qty - 1)} className="w-7 h-7 rounded-lg border border-border hover:bg-muted text-foreground">−</button>
                    <input value={l.qty} onChange={e => setQty(l.p, Math.floor(Number(e.target.value) || 0))}
                      className="w-10 text-center bg-input-background border border-border rounded-lg py-1 text-sm font-mono text-foreground" />
                    <button onClick={() => setQty(l.p, l.qty + 1)} className="w-7 h-7 rounded-lg border border-border hover:bg-muted text-foreground">+</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-border space-y-1">
            <div className="flex justify-between text-sm text-muted-foreground"><span>Items</span><span className="font-mono">{itemCount}</span></div>
            <div className="flex justify-between text-xl font-bold"><span className="text-foreground">Total</span><span className="font-mono text-foreground">{peso(total)}</span></div>
            <p className="text-xs text-muted-foreground text-right">Customer earns {pointsFor(total)} pts</p>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-4">
            {(["cash", "e-wallet"] as const).map(m => (
              <button key={m} onClick={() => setMethod(m)}
                className={`py-2.5 rounded-xl border text-sm font-semibold flex items-center justify-center gap-1.5 transition-all ${method === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
                {m === "cash" ? <><Wallet className="w-4 h-4" /> Cash</> : <><Phone className="w-4 h-4" /> E-Wallet</>}
              </button>
            ))}
          </div>

          {method === "cash" ? (
            <div className="mt-3 space-y-2">
              <Input label="Cash Received (₱)" type="number" placeholder="0.00" value={tendered} onChange={setTendered} />
              {total > 0 && <div className="flex flex-wrap gap-1.5">
                {[total, 50, 100, 200, 500, 1000].filter((v, i, a) => v > 0 && (i === 0 || v >= total) && a.indexOf(v) === i).map((v, i) => (
                  <button key={`${v}-${i}`} onClick={() => setTendered(String(v))} className="px-2.5 py-1 rounded-lg border border-border text-xs font-mono hover:bg-muted text-foreground">
                    {i === 0 ? "Exact" : `₱${v}`}
                  </button>
                ))}
              </div>}
              {tendered !== "" && (
                <div className={`flex justify-between text-sm font-semibold ${change < 0 ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>
                  <span>{change < 0 ? "Short by" : "Change"}</span><span className="font-mono">{peso(Math.abs(change))}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
              <select value={provider} onChange={e => setProvider(e.target.value)} className="bg-input-background border border-border rounded-xl px-3 py-2 text-sm text-foreground">
                {["GCash", "Maya", "ShopeePay", "GrabPay", "Other"].map(v => <option key={v}>{v}</option>)}
              </select>
              <input value={ewRef} onChange={e => setEwRef(e.target.value)} placeholder="Reference no."
                className="bg-input-background border border-border rounded-xl px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
          )}

          <Btn size="lg" className="w-full justify-center mt-4" icon={CheckCircle} onClick={checkout}
            disabled={busy || !lines.length || (method === "cash" ? tendered === "" || change < 0 : !ewRef.trim())}>
            {busy ? "Recording…" : `Charge ${peso(total)}`}
          </Btn>
        </GlassCard>
      </div>

      <AnimatePresence>
        {receipt && <SaleReceiptModal sale={receipt.sale} items={receipt.items} business={business} onClose={() => setReceipt(null)} onNewSale={() => setReceipt(null)} />}
      </AnimatePresence>
    </div>
  );
}

function MSMETransactions() {
  const { profile } = useApp();
  const { msme, loaded } = useMyMSMEState();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState("all");
  const [range, setRange] = useState("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<any | null>(null);

  const load = useCallback(async () => {
    if (!msme) { setLoading(false); return; }
    const [sales, payments, rewards] = await Promise.all([
      fetchAll((from, to) => supabase.from("sales").select("*, sale_items(product_name, quantity, unit_price, line_total)").eq("msme_id", msme.id).order("id").range(from, to)).catch(() => [] as any[]),
      supabase.from("registration_payments").select("id, amount, method, status, reference, receipt_no, paid_at, created_at, submitted_at, verified_at").eq("msme_id", msme.id),
      supabase.from("redeemed_rewards").select("id, redeemed_date, products(product_name, price), rewards(reward_name), profiles!tourist_id(fullname)").eq("msme_id", msme.id),
    ]);
    const saleRows = sales.map(s => ({
      key: `sale-${s.id}`, type: "sale", date: s.created_at, reference: s.receipt_no,
      description: (s.sale_items || []).map((i: any) => `${i.quantity}× ${i.product_name}`).join(", ") || "Sale",
      amount: Number(s.total || 0), items: Number(s.item_count || 0),
      method: s.payment_method === "cash" ? "Cash" : `E-Wallet${s.ewallet_provider ? ` (${s.ewallet_provider})` : ""}`,
      status: s.customer_id ? "Points claimed" : "Completed", statusVariant: "success", raw: s,
    }));
    const payLabel: Record<string, [string, string]> = { paid: ["Verified", "success"], submitted: ["For verification", "info"], rejected: ["Rejected", "danger"], unpaid: ["Unpaid", "danger"] };
    const payRows = ((payments.data as any[]) || []).map(p => ({
      key: `pay-${p.id}`, type: "registration_fee", date: p.verified_at || p.paid_at || p.submitted_at || p.created_at,
      reference: p.receipt_no || p.reference || `PAY-${p.id}`, description: "LGU registration fee",
      amount: Number(p.amount || 0), items: 0, method: p.method || "—",
      status: (payLabel[p.status] || payLabel.unpaid)[0], statusVariant: (payLabel[p.status] || payLabel.unpaid)[1],
    }));
    const rewardRows = ((rewards.data as any[]) || []).map(r => ({
      key: `rw-${r.id}`, type: "reward_redemption", date: r.redeemed_date, reference: `REWARD-${r.id}`,
      description: `${r.rewards?.reward_name || r.products?.product_name || "Reward"} claimed by ${r.profiles?.fullname || "a tourist"}`,
      amount: null, items: 0, method: "Reward", status: "Redeemed", statusVariant: "warning",
    }));
    setRows([...saleRows, ...payRows, ...rewardRows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    setLoading(false);
  }, [msme]);

  useEffect(() => { if (loaded) load(); }, [loaded, load]);

  const since = (days: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - days); return d.getTime(); };
  const q = search.trim().toLowerCase();
  const filtered = rows.filter(t =>
    (type === "all" || t.type === type) &&
    (range === "all" || new Date(t.date).getTime() >= since(range === "today" ? 0 : range === "7d" ? 6 : 29)) &&
    (!q || `${t.reference} ${t.description} ${t.method}`.toLowerCase().includes(q)));
  const sales = filtered.filter(t => t.type === "sale");
  const salesTotal = sales.reduce((a, t) => a + t.amount, 0);
  const cashTotal = sales.filter(t => t.raw.payment_method === "cash").reduce((a, t) => a + t.amount, 0);

  const exportCsv = () => csvDownload(`${slugify(msme?.business_name || "msme")}-transactions-${todayStr()}.csv`,
    ["Date", "Time", "Type", "Reference", "Description", "Items", "Amount (PHP)", "Method", "Status"],
    filtered.map(t => [localDateLabel(t.date), localTimeLabel(t.date), t.type.replace(/_/g, " "), t.reference, t.description, t.items || "", t.amount === null ? "" : t.amount.toFixed(2), t.method, t.status]));

  const selectCls = "bg-input-background border border-border rounded-xl px-3 py-2 text-sm text-foreground";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold font-[Outfit] text-xl text-foreground">Transaction History</h3>
          <p className="text-sm text-muted-foreground">Every sale, registration fee, and reward claim for your business.</p>
        </div>
        <Btn size="sm" variant="outline" icon={Download} onClick={exportCsv} disabled={!filtered.length}>Export CSV</Btn>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Sales (filtered)" value={peso(salesTotal)} icon={DollarSign} color="bg-green-500" />
        <StatCard label="Sales Transactions" value={sales.length} icon={Receipt} color="bg-primary" />
        <StatCard label="Cash" value={peso(cashTotal)} icon={Wallet} color="bg-amber-500" />
        <StatCard label="E-Wallet" value={peso(salesTotal - cashTotal)} icon={Phone} color="bg-sky-500" />
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-[200px]"><Input placeholder="Search receipt no., item, reference…" value={search} onChange={setSearch} icon={Search} /></div>
        <select value={type} onChange={e => setType(e.target.value)} className={selectCls}>
          <option value="all">All Transactions</option>
          <option value="sale">Sales</option>
          <option value="registration_fee">Registration Fees</option>
          <option value="reward_redemption">Reward Claims</option>
        </select>
        <select value={range} onChange={e => setRange(e.target.value)} className={selectCls}>
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>

      {loading || !loaded ? <div className="flex justify-center py-20"><Spinner /></div> : filtered.length === 0 ? (
        <GlassCard className="p-12 text-center"><DollarSign className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">{rows.length ? "No transactions match your filters." : "No transactions yet. Sales you record in the Point of Sale will show up here."}</p></GlassCard>
      ) : (
        <GlassCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-border">{["Date", "Reference", "Description", "Amount", "Method", "Type", "Status"].map(h => <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase px-4 py-3 whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.key} onClick={() => t.type === "sale" && setOpen(t.raw)}
                    className={`border-b border-border last:border-0 hover:bg-muted/30 ${t.type === "sale" ? "cursor-pointer" : ""}`}>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">{localDateLabel(t.date)} {localTimeLabel(t.date)}</td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">{t.reference}</td>
                    <td className="px-4 py-3 text-sm text-foreground min-w-[200px]">{t.description}</td>
                    <td className="px-4 py-3 text-sm font-mono text-foreground whitespace-nowrap">{t.amount === null ? "—" : peso(t.amount)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{t.method}</td>
                    <td className="px-4 py-3"><Badge variant={t.type === "registration_fee" ? "info" : t.type === "sale" ? "success" : "warning"}>{t.type === "sale" ? "sale" : t.type === "registration_fee" ? "registration fee" : "reward"}</Badge></td>
                    <td className="px-4 py-3"><Badge variant={t.statusVariant}>{t.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      <AnimatePresence>
        {open && (
          <SaleReceiptModal sale={open} business={{ ...msme, owner_name: msme?.owner_name || profile?.fullname }}
            items={(open.sale_items || []).map((i: any) => ({ product_name: i.product_name, quantity: i.quantity, unit_price: Number(i.unit_price), line_total: Number(i.line_total) }))}
            onClose={() => setOpen(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Tourist Dashboard ────────────────────────────────────────────────────────

function MSMERewardScans() {
  const msme = useMyMSME();
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!msme) { setLoading(false); return; }
    supabase.from("transactions").select("*, profiles!tourist_id(fullname), reward_qr(qr_code)").eq("msme_id", msme.id).order("created_at", { ascending: false }).then(({ data }) => {
      setTxs((data as any) || []);
      setLoading(false);
    });
  }, [msme]);

  return (
    <div className="space-y-5">
      <h3 className="font-bold font-[Outfit] text-xl text-foreground">Reward Scans</h3>
      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : txs.length === 0 ? (
        <GlassCard className="p-12 text-center">
          <QrCode className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">No reward scans yet. Tourists earn points when they scan your QR codes — try one with the Tourist QR Scanner.</p>
        </GlassCard>
      ) : (
        <GlassCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-border">{["Tourist", "QR Code", "Points Awarded", "Date"].map(h => <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase px-4 py-3">{h}</th>)}</tr></thead>
              <tbody>
                {txs.map(t => (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 text-sm text-foreground">{(t as any).profiles?.fullname || "—"}</td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{(t as any).reward_qr?.qr_code || "—"}</td>
                    <td className="px-4 py-3"><Badge variant="success">+{t.points} pts</Badge></td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{t.created_at?.slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </div>
  );
}

function TouristDash() {
  const navItems = [
    { label: "My Dashboard", icon: Home, id: "overview" },
    { label: "Browse Events", icon: Calendar, id: "browse-events" },
    { label: "Browse MSMEs", icon: ShoppingBag, id: "browse-msmes" },
    { label: "Rewards & Milestones", icon: Gift, id: "rewards" },
    { label: "QR Scanner", icon: QrCode, id: "qr-scanner" },
    { label: "Submit Feedback", icon: MessageSquare, id: "feedback" },
    { label: "Settings", icon: Settings, id: "settings" },
  ];

  return (
    <DashboardLayout title="Tourist Portal" navItems={navItems}>
      {(active) => {
        if (active === "overview") return <TouristOverview />;
        if (active === "browse-events") return <TouristEvents />;
        if (active === "rewards") return <TouristRewards />;
        if (active === "qr-scanner") return <TouristQRScanner />;
        if (active === "feedback") return <TouristFeedback />;
        if (active === "browse-msmes") return <TouristMSMEs />;
        if (active === "settings") return <ProfileSettings />;
        return <PlaceholderView title={active} />;
      }}
    </DashboardLayout>
  );
}

// Load the tourist's attendance stamp card (scans) and aggregate helpers
function useAttendance() {
  const { authUser } = useApp();
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const load = useCallback(() => {
    if (!authUser) { setLogs([]); return; }
    supabase.from("attendance_logs").select("*, attendance_qr(qr_code_string, label)").eq("tourist_id", authUser.id).order("scan_date", { ascending: false }).then(({ data }) => {
      setLogs((data as any) || []);
    });
  }, [authUser]);
  useEffect(() => { load(); }, [load]);
  const daysByFestival = useCallback((festivalId: number | null | undefined) =>
    new Set((logs || []).filter(l => l.festival_id === festivalId).map(l => l.scan_date)), [logs]);
  const totalDays = new Set((logs || []).map(l => l.scan_date)).size;
  return { logs, setLogs, load, totalDays, daysByFestival };
}

// The stamp-card visual: one square per festival day
function StampCard({ festival, logs, compact }: { festival: Festival; logs: AttendanceLog[]; compact?: boolean }) {
  const days = festivalDays(festival);
  const stamped = new Set(logs.filter(l => l.festival_id === festival.id).map(l => l.scan_date));
  if (!days.length) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {days.map(d => {
        const st = stamped.has(d);
        const dt = new Date(d + "T12:00:00");
        return (
          <div key={d} className="flex flex-col items-center gap-1">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-all ${st ? "bg-primary border-primary text-white shadow-md" : "bg-muted/40 border-dashed border-border text-muted-foreground/50"}`}>
              {st ? (
                <span className="text-sm font-black font-[Outfit]">{dt.toLocaleDateString("en-US", { day: "numeric" })}</span>
              ) : (
                <span className="text-sm font-bold font-[Outfit]">{dt.getDate()}</span>
              )}
            </div>
            <span className={`text-[9px] font-medium uppercase tracking-wide ${st ? "text-primary" : "text-muted-foreground/50"}`}>
              {dt.toLocaleDateString("en-US", { month: "short" })}{compact ? "" : ` ${dt.getDate()}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TouristOverview() {
  const { profile, authUser } = useApp();
  const { totalDays, logs, daysByFestival } = useAttendance();
  const { points } = useTouristPoints();
  const [events, setEvents] = useState<Event[]>([]);
  const [festivals, setFestivals] = useState<Festival[]>(FALLBACK_FESTIVALS);
  const [stats, setStats] = useState({ saved: 0, scans: 0, rewards: 0, feedback: 0 });
  const [saved, setSaved] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!authUser) return;
    Promise.all([
      supabase.from("events").select("*, festivals(title)").gt("start_time", new Date().toISOString()).order("start_time").limit(5),
      supabase.from("saved_events").select("event_id").eq("tourist_id", authUser.id),
      supabase.from("redeemed_rewards").select("id", { count: "exact", head: true }).eq("tourist_id", authUser.id),
      supabase.from("feedback").select("id", { count: "exact", head: true }).eq("tourist_id", authUser.id),
      supabase.from("festivals").select("*"),
    ]).then(([ev, sv, rd, fb, fs]) => {
      setEvents(ev.data?.length ? ev.data : FALLBACK_EVENTS.slice(0, 3) as Event[]);
      setSaved(new Set(((sv as any).data || []).map((x: any) => x.event_id)));
      setStats({
        saved: (sv.data || []).length,
        scans: logs.length,
        rewards: rd.count || 0,
        feedback: fb.count || 0,
      });
      if ((fs as any).data?.length) setFestivals((fs as any).data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser, logs.length]);

  const toggleSave = async (e: Event) => {
    if (!authUser) { toast.info("Sign in to save events."); return; }
    if (saved.has(e.id)) {
      const { error } = await supabase.from("saved_events").delete().eq("tourist_id", authUser.id).eq("event_id", e.id);
      if (!error) {
        setSaved(prev => { const n = new Set(prev); n.delete(e.id); return n; });
        setStats(p => ({ ...p, saved: p.saved - 1 }));
        toast.success("Removed from saved events.");
      }
    } else {
      const { error } = await supabase.from("saved_events").insert([{ tourist_id: authUser.id, event_id: e.id }]);
      if (!error) {
        setSaved(prev => new Set(prev).add(e.id));
        setStats(p => ({ ...p, saved: p.saved + 1 }));
        toast.success("Event saved!");
      }
      else toast.error("Could not save event.");
    }
  };

  return (
    <div className="space-y-6">
      <GlassCard className="p-6 bg-gradient-to-r from-primary/20 to-secondary/20">
        <div className="flex items-center gap-4 flex-wrap">
          <AvatarIcon name={profile?.fullname || "Tourist"} photo={profile?.profile_photo} size="lg" />
          <div className="flex-1 min-w-[180px]">
            <h2 className="text-xl font-bold font-[Outfit] text-foreground">Welcome back, {profile?.fullname?.split(" ")[0]}!</h2>
            <p className="text-muted-foreground text-sm">Tourist Member</p>
            <div className="flex items-center gap-2 mt-2">
              <Stamp className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground font-mono">{totalDays} festival {totalDays === 1 ? "day" : "days"} attended</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="bg-primary/10 rounded-xl px-4 py-2.5">
              <p className="text-2xl font-bold font-[Outfit] text-primary">{stats.saved}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Saved Events</p>
            </div>
            <div className="bg-secondary/10 rounded-xl px-4 py-2.5">
              <p className="text-2xl font-bold font-[Outfit] text-secondary">{stats.rewards}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Rewards</p>
            </div>
          </div>
        </div>
      </GlassCard>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Attendance Days" value={totalDays} icon={Stamp} color="bg-primary" />
        <StatCard label="Reward Points" value={points.toLocaleString()} icon={Award} color="bg-rose-500" />
        <StatCard label="QR Scans" value={stats.scans} icon={QrCode} color="bg-blue-500" />
        <StatCard label="Rewards Earned" value={stats.rewards} icon={Award} color="bg-amber-500" />
      </div>

      <GlassCard className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold font-[Outfit] text-foreground">Your Stamp Card</h3>
          <Badge variant="info"><Stamp className="w-3 h-3 mr-1 inline" /> Scan entrance QRs to stamp</Badge>
        </div>
        <div className="space-y-5">
          {festivals.map(f => {
            const days = daysByFestival(f.id).size;
            return (
              <div key={`stamp-${f.id}`} className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex items-center gap-2.5 md:w-48 flex-shrink-0">
                  {f.logo ? <img src={f.logo} alt="" className="w-10 h-10 rounded-xl object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} /> : null}
                  <div>
                    <p className="text-sm font-bold font-[Outfit] text-foreground leading-tight">{f.title}</p>
                    <p className="text-xs text-muted-foreground">{days}/{festivalDays(f).length} days</p>
                  </div>
                </div>
                <div className="flex-1"><StampCard festival={f} logs={logs} compact /></div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <h3 className="font-bold font-[Outfit] text-foreground mb-4">Upcoming Events Near You</h3>
        <div className="space-y-3">
          {events.map(e => (
            <div key={e.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors">
              <div className="bg-secondary/10 rounded-xl p-2.5 flex-shrink-0"><Calendar className="w-4 h-4 text-secondary" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{e.title}</p>
                <p className="text-xs text-muted-foreground">{localDateLabel(e.start_time)} • {e.venue}</p>
              </div>
              <button
                onClick={() => toggleSave(e)}
                className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${saved.has(e.id) ? "bg-rose-500/10 text-rose-500" : "hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500"}`}
              >
                <Heart className={`w-3.5 h-3.5 ${saved.has(e.id) ? "fill-rose-500" : ""}`} />
              </button>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

function TouristEvents() {
  const { authUser } = useApp();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [saved, setSaved] = useState<Set<number>>(new Set());

  useEffect(() => {
    Promise.all([
      supabase.from("events").select("*, festivals(title)").order("start_time"),
      authUser ? supabase.from("saved_events").select("event_id").eq("tourist_id", authUser.id) : Promise.resolve({ data: [] }),
    ]).then(([e, s]) => {
      setEvents(e.error || !e.data?.length ? FALLBACK_EVENTS as Event[] : e.data);
      setSaved(new Set(((s as any).data || []).map((x: any) => x.event_id)));
      setLoading(false);
    });
  }, [authUser]);

  const filtered = events.filter(e => e.title.toLowerCase().includes(search.toLowerCase()));

  const toggleSave = async (e: Event) => {
    if (!authUser) { toast.info("Sign in to save events."); return; }
    const isSaved = saved.has(e.id);
    if (isSaved) {
      const { error } = await supabase.from("saved_events").delete().eq("tourist_id", authUser.id).eq("event_id", e.id);
      if (!error) { setSaved(prev => { const n = new Set(prev); n.delete(e.id); return n; }); toast.success("Removed from saved events."); }
    } else {
      const { error } = await supabase.from("saved_events").insert([{ tourist_id: authUser.id, event_id: e.id }]);
      if (!error) { setSaved(prev => new Set(prev).add(e.id)); toast.success("Event saved!"); }
      else toast.error("Could not save event.");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex gap-3">
        <div className="flex-1"><Input placeholder="Search events..." value={search} onChange={setSearch} icon={Search} /></div>
      </div>
      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : (
        <div className="space-y-3">
          {filtered.map(e => (
            <GlassCard key={e.id} className="p-4">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 rounded-xl p-3 flex-shrink-0"><Calendar className="w-5 h-5 text-primary" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold font-[Outfit] text-foreground">{e.title}</h4>
                    <Badge variant={new Date(e.start_time) > new Date() ? "success" : "default"}>{new Date(e.start_time) > new Date() ? "Upcoming" : "Past"}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{e.festivals?.title} • {localDateLabel(e.start_time)}</p>
                  {e.venue && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" />{e.venue}</p>}
                </div>
                <button className={`p-2 rounded-xl transition-colors flex-shrink-0 ${saved.has(e.id) ? "bg-rose-500/10 text-rose-500" : "hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500"}`} onClick={() => toggleSave(e)}>
                  <Heart className={`w-4 h-4 ${saved.has(e.id) ? "fill-rose-500" : ""}`} />
                </button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

function TouristMSMEs() {
  const [msmes, setMSMEs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [town, setTown] = useState<string>("all");
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    supabase.from("msmes").select("*, products(id, product_name, price, image, approved)").eq("status", "approved").then(({ data }) => {
      setMSMEs((data as any) || []);
      setLoading(false);
    });
  }, []);

  const filtered = msmes.filter(m => (town === "all" || m.municipality === town));

  const photos = ["https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400&h=200&fit=crop", "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=400&h=200&fit=crop", "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=400&h=200&fit=crop", "https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=400&h=200&fit=crop"];

  return (
    <div className="space-y-5">
      <h3 className="font-bold font-[Outfit] text-xl text-foreground">MSME Partners</h3>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTown("all")} className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition-all ${town === "all" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>All Towns</button>
        {MUNICIPALITIES.map(m => (
          <button key={m.id} onClick={() => setTown(m.id)} className={`px-3.5 py-2 rounded-xl text-sm font-semibold border transition-all ${town === m.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
            {m.name}
          </button>
        ))}
      </div>
      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : filtered.length === 0 ? (
        <GlassCard className="p-12 text-center"><Building2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">No active MSME partners in this town yet.</p></GlassCard>
      ) : (
        <div className="grid sm:grid-cols-2 gap-5">
          {filtered.map((m: any, i) => {
            const live = (m.products || []).filter((p: any) => p.approved);
            return (
              <button key={m.id} onClick={() => setSelected(m)} className="text-left">
                <GlassCard className="overflow-hidden transition-all hover:border-primary/50 hover:shadow-xl cursor-pointer">
                  <div className="relative h-32">
                    <img src={m.logo || photos[i % photos.length]} alt={m.business_name} className="w-full h-full object-cover" />
                    {m.municipality && (
                      <div className="absolute top-2 left-2"><Badge variant="info"><Landmark className="w-3 h-3 mr-1 inline" />{MUNI_NAME[m.municipality] || "Laguna"}</Badge></div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-bold font-[Outfit] text-foreground">{m.business_name}</h4>
                      <span className="text-xs font-semibold text-primary flex-shrink-0">View profile →</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{m.description || "Local MSME partner"}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <p className="text-xs text-muted-foreground font-mono">{live.length} product{live.length === 1 ? "" : "s"} on sale</p>
                      {m.contact_number && <p className="text-xs text-muted-foreground font-mono flex items-center gap-1"><Phone className="w-3 h-3" />{m.contact_number}</p>}
                    </div>
                    {live.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-2">
                        {live.slice(0, 2).map((p: any) => (
                          <div key={p.id} className="flex items-center gap-2 rounded-lg bg-muted/40 p-1.5">
                            {p.image ? <img src={p.image} alt="" className="w-8 h-8 rounded-md object-cover" /> : <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center"><Store className="w-4 h-4 text-primary" /></div>}
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-foreground truncate">{p.product_name}</p>
                              <p className="text-[11px] font-mono text-primary">₱{Number(p.price).toLocaleString()}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </GlassCard>
              </button>
            );
          })}
        </div>
      )}
      <AnimatePresence>
        {selected && <MSMEProfileModal m={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
}

function useTouristPoints() {
  const { authUser } = useApp();
  const [points, setPoints] = useState(0);
  const [ledger, setLedger] = useState<any[]>([]);
  const reload = useCallback(async () => {
    if (!authUser) return;
    const [p, l] = await Promise.all([
      supabase.from("tourist_points").select("points").eq("tourist_id", authUser.id).maybeSingle(),
      supabase.from("transactions").select("id, points, transaction_type, reference_no, description, amount, created_at, msmes(business_name)")
        .eq("tourist_id", authUser.id).in("transaction_type", ["purchase_points", "feedback_bonus", "points_redemption"])
        .order("created_at", { ascending: false }).limit(100),
    ]);
    setPoints(Number((p.data as any)?.points || 0));
    setLedger((l.data as any[]) || []);
  }, [authUser]);
  useEffect(() => { reload(); }, [reload]);
  return { points, ledger, reload };
}

function TouristRewards() {
  const { authUser } = useApp();
  const { totalDays } = useAttendance();
  const { points, ledger, reload: reloadPoints } = useTouristPoints();
  const [rewards, setRewards] = useState<Reward[]>(FALLBACK_REWARDS);
  const [redeemed, setRedeemed] = useState<number[]>([]);
  const [town, setTown] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    if (!authUser) { setLoading(false); return; }
    Promise.all([
      supabase.from("rewards").select("*, festivals(title, municipality)"),
      supabase.from("redeemed_rewards").select("reward_id").eq("tourist_id", authUser.id),
    ]).then(([r, rd]) => {
      if (r.data?.length) setRewards(r.data);
      setRedeemed((rd.data || []).map((x: any) => x.reward_id));
      setLoading(false);
    });
  }, [authUser]);

  // Milestone redemption — unlocked by festival attendance days.
  const redeemByDays = async (reward: Reward) => {
    if (!authUser) return;
    if (totalDays < (reward.required_days ?? 1)) { toast.error("Not enough attendance days yet."); return; }
    if (redeemed.includes(reward.id)) { toast.error("Already redeemed."); return; }
    setBusy(reward.id);
    const payload: any = { tourist_id: authUser.id, reward_id: reward.id, redeemed_date: new Date().toISOString() };
    if (reward.msme_id) payload.msme_id = reward.msme_id;
    if (reward.product_id) payload.product_id = reward.product_id;
    const { error } = await supabase.from("redeemed_rewards").insert([payload]);
    if (!error) {
      setRedeemed(prev => [...prev, reward.id]);
      await recordActivity("redeem", "reward", reward.id, `Reward redeemed: ${reward.reward_name}.`, (reward as any).festivals?.municipality);
      toast.success(`Redeemed: ${reward.reward_name}! 🎉`);
    }
    else toast.error(error.message || "Could not redeem.");
    setBusy(null);
  };

  // Points redemption — spends purchase points (atomic in the database).
  const redeemByPoints = async (reward: Reward) => {
    setBusy(reward.id);
    const { error } = await supabase.rpc("redeem_reward_with_points", { p_reward_id: reward.id });
    if (error) toast.error(error.message);
    else {
      setRedeemed(prev => [...prev, reward.id]);
      await recordActivity("redeem", "reward", reward.id, `Reward redeemed with ${reward.required_points} points: ${reward.reward_name}.`, (reward as any).festivals?.municipality);
      await reloadPoints();
      toast.success(`Redeemed with ${reward.required_points} points: ${reward.reward_name}! 🎉`);
    }
    setBusy(null);
  };

  const imgs = FALLBACK_REWARDS.map(r => r.image!);
  const shown = rewards.filter(r => town === "all" || (r as any).festivals?.municipality === town);
  const nextMilestone = shown
    .filter(r => (r.required_days ?? 1) > totalDays && !redeemed.includes(r.id))
    .sort((a, b) => (a.required_days ?? 1) - (b.required_days ?? 1))[0];

  return (
    <div className="space-y-5">
      <div className="grid md:grid-cols-2 gap-4">
        <GlassCard className="p-5 bg-gradient-to-r from-primary/20 to-secondary/20">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Festival Days Attended</p>
              <p className="text-4xl font-bold font-[Outfit] text-foreground mt-1">{totalDays} <span className="text-lg text-muted-foreground font-normal">days</span></p>
            </div>
            <div className="bg-primary/10 rounded-2xl p-4"><Stamp className="w-8 h-8 text-primary" /></div>
          </div>
          {nextMilestone && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>Progress to <b className="text-foreground">{nextMilestone.reward_name}</b></span>
                <span className="font-mono">{Math.min(totalDays, nextMilestone.required_days ?? 1)}/{nextMilestone.required_days} days</span>
              </div>
              <div className="bg-muted/50 rounded-full h-2">
                <div className="bg-gradient-to-r from-primary to-secondary h-2 rounded-full transition-all" style={{ width: `${Math.min((totalDays / (nextMilestone.required_days ?? 1)) * 100, 100)}%` }} />
              </div>
            </div>
          )}
        </GlassCard>
        <GlassCard className="p-5 bg-gradient-to-r from-amber-500/20 to-rose-500/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Reward Points</p>
              <p className="text-4xl font-bold font-[Outfit] text-foreground mt-1">{points.toLocaleString()} <span className="text-lg text-muted-foreground font-normal">pts</span></p>
            </div>
            <div className="bg-amber-500/10 rounded-2xl p-4"><Award className="w-8 h-8 text-amber-500" /></div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">Earn 1 point per ₱{PESOS_PER_POINT} spent at festival MSMEs — scan the QR on your receipt. Rate your purchase for +{FEEDBACK_BONUS} bonus points.</p>
        </GlassCard>
      </div>

      <div className="flex items-center gap-3"><label className="text-sm font-medium text-foreground">Show rewards from:</label><select value={town} onChange={e => setTown(e.target.value)} className="bg-input-background border border-border rounded-xl px-3 py-2 text-sm text-foreground"><option value="all">All Municipalities</option>{MUNICIPALITIES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>

      {loading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
          {shown.map((r, i) => {
            const days = r.required_days ?? 1;
            const cost = Number(r.required_points) || 0;
            const isRedeemed = redeemed.includes(r.id);
            const byDays = totalDays >= days;
            const byPoints = cost > 0 && points >= cost;
            const pct = Math.max(Math.min((totalDays / days) * 100, 100), cost > 0 ? Math.min((points / cost) * 100, 100) : 0);
            return (
              <GlassCard key={r.id} className={`overflow-hidden ${isRedeemed ? "opacity-60" : ""}`}>
                <div className="h-32 relative">
                  <img src={r.image || imgs[i % imgs.length]} alt={r.reward_name} className="w-full h-full object-cover" />
                  {!isRedeemed && (byDays || byPoints) && <span className="absolute top-2 left-2"><Badge variant="success">Ready to redeem</Badge></span>}
                </div>
                <div className="p-4">
                  <h4 className="font-semibold text-foreground font-[Outfit] mb-1">{r.reward_name}</h4>
                  <p className="text-xs font-semibold text-primary mb-1">{(r as any).festivals?.title || "Festival"} · {MUNI_NAME[(r as any).festivals?.municipality] || "Laguna"}</p>
                  <p className="text-xs text-muted-foreground mb-3">{r.description || `${days} days of festival attendance`}</p>
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <span className="flex items-center gap-1 text-sm font-mono font-semibold text-accent"><Stamp className="w-3.5 h-3.5 text-primary" />{days} {days === 1 ? "day" : "days"}</span>
                    {cost > 0 && <span className="flex items-center gap-1 text-sm font-mono font-semibold text-amber-500"><Award className="w-3.5 h-3.5" />or {cost} pts</span>}
                  </div>
                  <div className="bg-muted/50 rounded-full h-1.5 mb-3">
                    <div className="bg-gradient-to-r from-primary to-secondary h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  {isRedeemed ? (
                    <Btn size="sm" variant="outline" className="w-full justify-center" disabled>Redeemed ✓</Btn>
                  ) : byDays ? (
                    <Btn size="sm" className="w-full justify-center" disabled={busy === r.id} onClick={() => redeemByDays(r)}>Redeem</Btn>
                  ) : byPoints ? (
                    <Btn size="sm" className="w-full justify-center" disabled={busy === r.id} onClick={() => redeemByPoints(r)}>Redeem for {cost} pts</Btn>
                  ) : (
                    <Btn size="sm" variant="outline" className="w-full justify-center" disabled>
                      {`${days - totalDays} more day${days - totalDays === 1 ? "" : "s"}`}{cost > 0 ? ` or ${cost - points} more pts` : ""}
                    </Btn>
                  )}
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      <GlassCard className="overflow-hidden">
        <div className="p-5 pb-3 flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="font-bold font-[Outfit] text-foreground">Points History</h3>
            <p className="text-xs text-muted-foreground">Purchases, feedback bonuses, and redemptions.</p>
          </div>
        </div>
        {ledger.length === 0 ? (
          <p className="px-5 pb-6 text-sm text-muted-foreground">No points yet. Buy from a festival MSME and scan the QR code on your receipt (QR Scanner tab) to earn points.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-border">{["Date", "Details", "Receipt", "Points"].map(h => <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase px-4 py-2">{h}</th>)}</tr></thead>
              <tbody>
                {ledger.map(t => (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 text-xs font-mono text-muted-foreground whitespace-nowrap">{localDateLabel(t.created_at)} {localTimeLabel(t.created_at)}</td>
                    <td className="px-4 py-2 text-sm text-foreground">{t.description || t.msmes?.business_name}{t.transaction_type === "purchase_points" && Number(t.amount) > 0 && <span className="text-muted-foreground"> · {peso(t.amount)}</span>}</td>
                    <td className="px-4 py-2 text-xs font-mono text-muted-foreground">{t.reference_no || "—"}</td>
                    <td className={`px-4 py-2 text-sm font-mono font-semibold ${t.points < 0 ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>{t.points > 0 ? `+${t.points}` : t.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function TouristQRScanner() {
  const { authUser, setView } = useApp();
  const { totalDays, load: reloadAttendance } = useAttendance();
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; detail?: string } | null>(null);
  const [useCam, setUseCam] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const camRef = useRef<any>(null);

  // In-app camera QR reader (loaded on demand) so tourists don't have to type
  // the code — phones just point at the printed/on-screen QR.
  useEffect(() => {
    if (!useCam) return;
    let cancelled = false;
    setCamError(null);
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const box = document.getElementById("qr-reader-box");
        if (!box) return;
        const scanner = new Html5Qrcode("qr-reader-box");
        camRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 230, height: 230 } },
          (txt: string) => { runScan(txt); setUseCam(false); },
          () => {}
        );
      } catch (e: any) {
        if (!cancelled) {
          camRef.current = null;
          setCamError(e?.message || String(e));
          setUseCam(false);
        }
      }
    })();
    return () => { cancelled = true; if (camRef.current) { camRef.current.stop().catch(() => {}); camRef.current = null; } };
  }, [useCam]);

  const runScan = async (raw: string) => {
    if (!raw.trim()) { toast.error("Enter a QR code."); return; }
    if (!authUser) { toast.error("Please login."); return; }
    // MSME sales receipt QR → collect purchase points
    if (!/FLGU-/i.test(raw)) {
      const claim = extractClaimCode(raw);
      if (claim) { setPendingClaim(claim); setView("claim"); return; }
    }
    setScanning(true);
    const value = cleanCode(raw);
    if (!QR_CODE_RE.test(value)) {
      setResult({ success: false, message: "Invalid QR code format", detail: "Registered codes look like FLGU-BAYENOS-ENTRANCE or FLGU-PINYA-XK2M7QA." });
      toast.error("Invalid QR code format.");
      setScanning(false);
      return;
    }
    // Case/accent-insensitive lookup: try the typed form and the ñ-spelling of the
    // festival name so Bañamos == Banamos and Bayeños == Bayenos always match.
    const patterns: string[] = [value];
    patterns.push(value.replace(/^FLGU-BANAMOS/, "FLGU-BAÑAMOS"));
    patterns.push(value.replace(/^FLGU-BAYENOS/, "FLGU-BAYEÑOS"));
    let qr: any = null;
    for (const pat of patterns) {
      const { data } = await supabase.from("attendance_qr").select("*").ilike("qr_code_string", pat).maybeSingle();
      if (data) { qr = data; break; }
    }
    if (!qr) {
      setResult({ success: false, message: "Invalid QR code.", detail: "Only codes generated by the LGU (admin) QR Generator are registered. Generate it, then scan it here." });
      toast.error("QR code not found. Make sure it was issued by the LGU QR Generator for this festival.");
      setScanning(false);
      return;
    }
    if (qr.is_active === false) {
      setResult({ success: false, message: "QR code is inactive", detail: "This station QR has been deactivated by the LGU. Try another station." });
      toast.error("This QR code is no longer active.");
      setScanning(false);
      return;
    }
    if (qr.expires_at && new Date(qr.expires_at).getTime() < Date.now()) {
      setResult({ success: false, message: "QR code expired", detail: "This station QR is no longer valid. Try another station." });
      toast.error("This QR code has expired.");
      setScanning(false);
      return;
    }
    const scanDate = todayStr();
    const dupKey: any = qr.venue_id ? { venue_id: qr.venue_id } : { qr_id: qr.id };
    const { data: existing } = await supabase.from("attendance_logs").select("id")
      .eq("tourist_id", authUser.id)
      .eq("scan_date", scanDate)
      .eq(Object.keys(dupKey)[0], Object.values(dupKey)[0])
      .maybeSingle();
    if (existing) {
      setResult({ success: false, message: "Already stamped for today", detail: qr.venue_id ? "You already stamped at this venue today." : "One scan per QR per day — come back tomorrow." });
      toast.error("You've already stamped at this station today.");
      setScanning(false);
      return;
    }
    const { error } = await supabase.from("attendance_logs").insert([{
      tourist_id: authUser.id,
      qr_id: qr.id,
      venue_id: qr.venue_id ?? null,
      festival_id: qr.festival_id,
      scan_date: scanDate,
    }]);
    if (error) {
      setResult({ success: false, message: "Already stamped for today", detail: "One scan per QR per day — come back tomorrow or try another station." });
      toast.error("You've already stamped this QR today.");
    } else {
      setResult({ success: true, message: `Day stamped! (+1)` });
      await recordActivity("scan", "attendance", qr.id, `Attendance QR scanned at ${qr.label || "festival station"}.`, qr.municipality_id);
      toast.success("Attendance recorded — your stamp card is updated!");
      reloadAttendance();
    }
    setScanning(false);
  };

  const scan = () => runScan(code);

  return (
    <div className="space-y-5 max-w-md mx-auto">
      <h3 className="font-bold font-[Outfit] text-xl text-foreground">Attendance QR Scanner</h3>
      <GlassCard className="p-6 text-center">
        <div className={`relative w-52 h-52 mx-auto mb-5 rounded-2xl overflow-hidden border-2 ${scanning ? "border-primary animate-pulse" : result?.success ? "border-green-500" : "border-border"}`}>
          {scanning ? (
            <div className="w-full h-full bg-black/80 flex flex-col items-center justify-center gap-2">
              <Spinner />
              <p className="text-white/70 text-sm">Checking QR…</p>
            </div>
          ) : result ? (
            <div className={`w-full h-full flex flex-col items-center justify-center gap-2 ${result.success ? "bg-green-500/20" : "bg-red-500/10"}`}>
              {result.success ? <CheckCircle className="w-12 h-12 text-green-500" /> : <X className="w-12 h-12 text-red-500" />}
              <p className={`font-semibold font-mono px-4 ${result.success ? "text-green-500" : "text-red-500"}`}>{result.message}</p>
              {result.detail && <p className="text-xs text-muted-foreground px-6">{result.detail}</p>}
            </div>
          ) : (
            <div className="w-full h-full bg-muted/50 flex flex-col items-center justify-center gap-2">
              <ScanLine className="w-12 h-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Enter QR code below</p>
            </div>
          )}
          <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-primary rounded-tl" />
          <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-primary rounded-tr" />
          <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-primary rounded-bl" />
          <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-primary rounded-br" />
        </div>
        <Input placeholder="Enter QR code (e.g. FLGU-BAYENOS-ENTRANCE)" value={code} onChange={v => { setCode(v); setResult(null); }} icon={ScanLine} />
        <Btn onClick={scan} disabled={scanning} className="w-full justify-center mt-3" icon={QrCode} size="lg">
          {scanning ? "Verifying…" : "Stamp Attendance"}
        </Btn>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-px bg-border flex-1" />
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">or</span>
          <div className="h-px bg-border flex-1" />
        </div>
        <Btn variant="outline" onClick={() => { setUseCam(v => !v); setResult(null); }} className="w-full justify-center text-sm" icon={Camera}>
          {useCam ? "Close camera" : "Use my phone camera to scan"}
        </Btn>
        {camError && <p className="text-xs text-red-500 mt-2 text-center">{camError}. You can still type the code above instead.</p>}
        {useCam && (
          <div className="mt-3">
            <div id="qr-reader-box" className="overflow-hidden rounded-xl border border-border bg-black mx-auto" style={{ minHeight: 240, maxWidth: 320 }} />
            <p className="text-xs text-muted-foreground mt-2">Point your camera at the QR code at the entrance — it stamps automatically.</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-3">Scan the QR at any festival entrance to stamp that day on your card — or the QR on an MSME receipt to collect purchase points.</p>
        <p className="text-xs text-muted-foreground mt-4 font-mono flex items-center justify-center gap-1"><Stamp className="w-3.5 h-3.5 text-primary" />Attendance days: {totalDays}</p>
      </GlassCard>
      <p className="text-xs text-muted-foreground text-center">Each entrance QR stamps once per day — collect stamps across the festival's days to unlock milestone rewards.</p>
    </div>
  );
}

function TouristFeedback() {
  const { authUser } = useApp();
  const [type, setType] = useState<FeedbackType>("festival");
  const [festivals, setFestivals] = useState<Festival[]>(FALLBACK_FESTIVALS);
  const [msmes, setMSMEs] = useState<any[]>([]);
  const [form, setForm] = useState({ municipality: "", festival_id: "", msme_id: "", rating: 5, comment: "", suggestion: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("festivals").select("id, title, municipality"),
      supabase.from("msmes").select("id, business_name, municipality").eq("status", "approved"),
      supabase.from("registration_payments").select("msme_id", { count: "exact" }).eq("status", "paid"),
    ]).then(([f, m, p]) => {
      if ((f as any).data?.length) setFestivals((f as any).data);
      const paidIds = new Set(((p as any).data || []).map((x: any) => x.msme_id));
      setMSMEs(((m as any).data || []).filter((x: any) => paidIds.has(x.id)));
    });
  }, []);

  const muniFestivals = festivals.filter(f => !form.municipality || f.municipality === form.municipality);
  const muniMSMEs = msmes.filter(m => !form.municipality || m.municipality === form.municipality);

  const submit = async () => {
    if (!form.comment.trim()) { toast.error("Please write a comment."); return; }
    if (!authUser) { toast.error("Please login."); return; }
    if (type === "festival" && !form.festival_id) { toast.error("Pick the festival you're rating."); return; }
    if (type === "msme" && !form.msme_id) { toast.error("Pick the business you're rating."); return; }
    setLoading(true);
    const payload: any = {
      tourist_id: authUser.id,
      rating: form.rating,
      comment: form.comment,
      suggestion: form.suggestion || null,
      feedback_type: type,
      municipality: form.municipality || null,
      festival_id: type === "festival" ? Number(form.festival_id) : null,
      msme_id: type === "msme" ? Number(form.msme_id) : null,
    };
    const { error } = await supabase.from("feedback").insert([payload]);
    if (!error) { toast.success("Thank you for your feedback! 🙏"); setForm({ municipality: form.municipality, festival_id: "", msme_id: "", rating: 5, comment: "", suggestion: "" }); }
    else toast.error(error.message || "Could not submit feedback.");
    setLoading(false);
  };

  return (
    <div className="space-y-5 max-w-xl">
      <h3 className="font-bold font-[Outfit] text-xl text-foreground">Submit Feedback</h3>
      <GlassCard className="p-5">
        <div className="space-y-4">
          <div className="flex gap-2">
            <button onClick={() => setType("festival")}
              className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${type === "festival" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
              <Ticket className="w-4 h-4" /> Festival
            </button>
            <button onClick={() => setType("msme")}
              className={`flex-1 py-2.5 rounded-xl border text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${type === "msme" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
              <Store className="w-4 h-4" /> MSME Business
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Municipality / Town</label>
            <select value={form.municipality} onChange={e => setForm(p => ({ ...p, municipality: e.target.value, festival_id: "", msme_id: "" }))}
              className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
              <option value="">All towns</option>
              {MUNICIPALITIES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          {type === "festival" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Festival *</label>
              <select value={form.festival_id} onChange={e => setForm(p => ({ ...p, festival_id: e.target.value }))}
                className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">Select festival…</option>
                {muniFestivals.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
              </select>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">MSME Business *</label>
              <select value={form.msme_id} onChange={e => setForm(p => ({ ...p, msme_id: e.target.value }))}
                className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">Select business…</option>
                {muniMSMEs.map(m => <option key={m.id} value={m.id}>{m.business_name}</option>)}
              </select>
              {muniMSMEs.length === 0 && <p className="text-xs text-muted-foreground">No paid & active MSMEs in this town yet.</p>}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Rating</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(r => (
                <button key={r} onClick={() => setForm(p => ({ ...p, rating: r }))} className={`transition-transform hover:scale-110 ${r <= form.rating ? "text-amber-400" : "text-muted"}`}>
                  <Star className={`w-7 h-7 ${r <= form.rating ? "fill-amber-400" : ""}`} />
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Comment *</label>
            <textarea value={form.comment} onChange={e => setForm(p => ({ ...p, comment: e.target.value }))} rows={3}
              placeholder="Share your experience…"
              className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Suggestions (optional)</label>
            <textarea value={form.suggestion} onChange={e => setForm(p => ({ ...p, suggestion: e.target.value }))} rows={2}
              placeholder="How can we improve?"
              className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
          </div>
          <Btn className="w-full justify-center" disabled={loading} onClick={submit}>{loading ? "Submitting…" : "Submit Feedback"}</Btn>
        </div>
      </GlassCard>
    </div>
  );
}

// ─── Receipt points claim ─────────────────────────────────────────────────────

// Landing page for the QR on an MSME sales receipt: shows the purchase,
// credits the purchase points to the signed-in tourist automatically, and
// offers optional feedback for bonus points.
function ClaimPage() {
  const { authUser, profile, setView } = useApp();
  const [code, setCode] = useState<string | null>(() => getPendingClaim());
  const [manual, setManual] = useState("");
  const [info, setInfo] = useState<any | null | undefined>(undefined);
  const [claimed, setClaimed] = useState<{ points: number; balance: number; newly: boolean } | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [fb, setFb] = useState({ rating: 5, comment: "", suggestion: "" });
  const [bonus, setBonus] = useState<{ bonus: number; balance: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const attempted = useRef(false);

  const lookup = useCallback(async (c: string) => {
    const { data, error } = await supabase.rpc("sale_receipt_lookup", { p_code: c });
    setInfo(error ? null : (data as any) || null);
  }, []);

  useEffect(() => { if (code) lookup(code); else setInfo(undefined); }, [code, lookup, authUser]);

  // Tourist signed in → collect the points right away.
  useEffect(() => {
    if (!code || !info || !authUser || profile?.role !== "tourist" || attempted.current) return;
    if (info.claimed && !info.claimed_by_me) return;
    attempted.current = true;
    (async () => {
      const { data, error } = await supabase.rpc("claim_sale_points", { p_code: code });
      if (error) { setClaimError(error.message); return; }
      const res = data as any;
      setClaimed({ points: res.points, balance: res.balance, newly: res.newly_claimed });
      if (res.newly_claimed) toast.success(`+${res.points} points added to your account!`);
      clearPendingClaim();
      await lookup(code);
    })();
  }, [code, info, authUser, profile?.role, lookup]);

  const submitFeedback = async () => {
    if (!code) return;
    if (!fb.comment.trim()) { toast.error("Write a short comment about your purchase."); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("submit_sale_feedback", { p_code: code, p_rating: fb.rating, p_comment: fb.comment, p_suggestion: fb.suggestion || null });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setBonus(data as any);
    toast.success(`Thank you! +${(data as any).bonus} bonus points 🎉`);
    await lookup(code);
  };

  const useManual = () => {
    const c = extractClaimCode(manual);
    if (!c) { toast.error("Enter the 10-character code printed under the receipt QR."); return; }
    setPendingClaim(c);
    attempted.current = false;
    setClaimed(null); setClaimError(null); setBonus(null);
    setCode(c);
  };

  const done = () => {
    clearPendingClaim();
    if (profile?.role === "tourist") { nextDashTab = "rewards"; setView("tourist-dash"); }
    else setView("home");
  };

  const isTourist = profile?.role === "tourist";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 pt-20 pb-10">
      <motion.div className="w-full max-w-md" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <GlassCard className="p-6">
          <div className="text-center mb-5">
            <div className="w-14 h-14 bg-gradient-to-br from-amber-500 to-rose-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Award className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold font-[Outfit] text-foreground">Collect Your Points</h1>
            <p className="text-sm text-muted-foreground">Every festival purchase earns 1 point per ₱{PESOS_PER_POINT}.</p>
          </div>

          {!code ? (
            <div className="space-y-3">
              <Input label="Receipt code" placeholder="10-character code under the QR" value={manual} onChange={setManual} icon={Receipt} />
              <Btn className="w-full justify-center" onClick={useManual}>Look up receipt</Btn>
            </div>
          ) : info === undefined ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : info === null ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-red-500">Receipt not found. Check the code and try again.</p>
              <Btn variant="outline" className="w-full justify-center" onClick={() => { clearPendingClaim(); setCode(null); }}>Enter a code manually</Btn>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl bg-muted/30 p-4">
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{info.business_name}</p>
                    <p className="text-xs text-muted-foreground">{MUNI_NAME[info.municipality] || "Laguna"} · {localDateLabel(info.created_at)} {localTimeLabel(info.created_at)}</p>
                  </div>
                  <p className="font-mono font-bold text-foreground flex-shrink-0">{peso(info.total)}</p>
                </div>
                <div className="mt-2 space-y-0.5">
                  {(info.items || []).map((i: any, idx: number) => (
                    <div key={idx} className="flex justify-between text-xs text-muted-foreground"><span>{i.quantity}× {i.name}</span><span className="font-mono">{peso(i.line_total)}</span></div>
                  ))}
                </div>
                <p className="text-[11px] font-mono text-muted-foreground mt-2">{info.receipt_no}</p>
              </div>

              {!authUser ? (
                <div className="space-y-2 text-center">
                  <p className="text-sm text-foreground">Sign in with your tourist account to collect <b>{info.points_earned} points</b>{info.claimed ? "" : "."}</p>
                  {info.claimed && <p className="text-xs text-amber-500">These points were already collected.</p>}
                  <Btn className="w-full justify-center" onClick={() => setView("login")}>Sign in</Btn>
                  <Btn variant="outline" className="w-full justify-center" onClick={() => setView("register")}>Create a tourist account</Btn>
                </div>
              ) : !profile ? (
                <div className="flex justify-center py-4"><Spinner /></div>
              ) : !isTourist ? (
                <p className="text-sm text-center text-amber-600 dark:text-amber-400">Only tourist accounts can collect purchase points. Sign in with a tourist account on this device to claim.</p>
              ) : claimError || (info.claimed && !info.claimed_by_me) ? (
                <p className="text-sm text-center text-red-500">{claimError || "These points were already collected by another account."}</p>
              ) : !claimed ? (
                <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground"><Spinner /> Adding your points…</div>
              ) : (
                <>
                  <div className="rounded-xl border border-green-500/40 bg-green-500/5 p-4 text-center">
                    <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-1" />
                    <p className="font-bold text-foreground">{claimed.newly ? `+${claimed.points} points collected!` : `You already collected these ${claimed.points} points.`}</p>
                    <p className="text-xs text-muted-foreground">Balance: <span className="font-mono">{(bonus?.balance ?? claimed.balance).toLocaleString()} pts</span></p>
                  </div>
                  {info.feedback_given || bonus ? (
                    <p className="text-sm text-center text-green-600 dark:text-green-400">{bonus ? `+${bonus.bonus} feedback bonus added. Salamat!` : "Feedback already submitted for this receipt."}</p>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-foreground">Rate your purchase <span className="text-muted-foreground font-normal">(optional · +{FEEDBACK_BONUS} bonus points)</span></p>
                      <div className="flex gap-2 justify-center">
                        {[1, 2, 3, 4, 5].map(r => (
                          <button key={r} onClick={() => setFb(p => ({ ...p, rating: r }))} className={`transition-transform hover:scale-110 ${r <= fb.rating ? "text-amber-400" : "text-muted"}`}>
                            <Star className={`w-7 h-7 ${r <= fb.rating ? "fill-amber-400" : ""}`} />
                          </button>
                        ))}
                      </div>
                      <textarea value={fb.comment} onChange={e => setFb(p => ({ ...p, comment: e.target.value }))} rows={2} placeholder="How was the food / product and service?"
                        className="w-full bg-input-background border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
                      <input value={fb.suggestion} onChange={e => setFb(p => ({ ...p, suggestion: e.target.value }))} placeholder="Suggestion (optional)"
                        className="w-full bg-input-background border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      <Btn className="w-full justify-center" disabled={busy} onClick={submitFeedback}>{busy ? "Submitting…" : `Submit feedback (+${FEEDBACK_BONUS} pts)`}</Btn>
                    </div>
                  )}
                </>
              )}
              {authUser && <Btn variant="outline" className="w-full justify-center" onClick={done}>{isTourist ? "Go to my Rewards" : "Done"}</Btn>}
            </div>
          )}
        </GlassCard>
      </motion.div>
    </div>
  );
}

// ─── Placeholder ──────────────────────────────────────────────────────────────

function PlaceholderView({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center"><Layers className="w-7 h-7 text-muted-foreground" /></div>
      <div>
        <h3 className="font-bold font-[Outfit] text-foreground capitalize">{title.replace(/-/g, " ")}</h3>
        <p className="text-sm text-muted-foreground mt-1">Connected to Supabase — ready to build.</p>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [dark, setDark] = useState(true);
  const [authUser, setAuthUser] = useState<LocalUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setViewState] = useState<View>(viewFromHash);

  // Keep URL hash in sync so public pages have shareable/deep-linkable URLs
  useEffect(() => {
    const syncView = () => setViewState(viewFromHash());
    window.addEventListener("hashchange", syncView);
    return () => window.removeEventListener("hashchange", syncView);
  }, []);

  const setView = useCallback((v: View) => {
    setViewState(v);
    if (v !== "forgot-password") resetFlowActive = false;
    const target = HASH_VIEWS[v] ? `#${v}` : "#";
    if (window.location.hash !== target) window.history.replaceState(null, "", target);
  }, []);

  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  const toggleDark = useCallback(() => setDark(d => !d), []);

  const DASH_VIEW: Record<string, View> = { admin: "admin", organizer: "organizer", msme: "msme-dash", tourist: "tourist-dash" };

  // Derive dashboard view from role string — never returns undefined
  const roleToView = (role: string): View => (DASH_VIEW[role] as View) ?? "tourist-dash";

  // Redirect immediately, then hydrate profile in background
  const handleAuthedUser = useCallback(async (user: LocalUser) => {
    // 1. Redirect NOW using metadata (instant, no DB round-trip) — unless a
    //    password reset is mid-flow, in which case the OTP verify just signed
    //    the user in and we must stay on the reset screen until it finishes.
    const metaRole = (user.user_metadata?.role as string) || "tourist";
    // A tourist who opened a receipt QR goes to the claim page instead.
    const landing = (role: string): View => role === "tourist" && getPendingClaim() ? "claim" : roleToView(role);
    if (!resetFlowActive) setView(landing(metaRole));

    // 2. Load / create profile row in background
    try {
      let { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (!data) {
        const fullname = user.user_metadata?.fullname || user.email?.split("@")[0] || "User";
        await supabase.from("profiles").upsert({ id: user.id, fullname, email: user.email ?? "", role: metaRole });
        data = { id: user.id, fullname, email: user.email ?? "", role: metaRole, profile_photo: null, created_at: new Date().toISOString() } as Profile;
      }
      setProfile(data);
      // Correct the view if DB role differs from metadata
      if (!resetFlowActive) setView(landing(data.role));
    } catch {
      // Profile load failed but user is already on their dashboard — set minimal profile
      setProfile({ id: user.id, fullname: user.email?.split("@")[0] ?? "User", email: user.email ?? "", role: metaRole, profile_photo: null, created_at: "" } as Profile);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthUser(session?.user ?? null);
      if (session?.user) handleAuthedUser(session.user).finally(() => setAuthLoading(false));
      else setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthUser(session?.user ?? null);
      if (session?.user && event === "SIGNED_IN") {
        handleAuthedUser(session.user);
      } else if (!session && event === "SIGNED_OUT") {
        setProfile(null);
        setView("home");
      }
    });

    return () => { subscription.unsubscribe(); };
  }, [handleAuthedUser]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setAuthUser(null);
    setView("home");
    toast.success("Signed out successfully.");
  }, []);

  const isPublic = ["home", "about", "events", "msmes", "guide", "contact", "login", "register", "forgot-password", "claim"].includes(view);
  const isDash = ["admin", "organizer", "msme-dash", "tourist-dash"].includes(view);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-14 h-14 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Ticket className="w-7 h-7 text-white" />
          </div>
          <Spinner />
          <p className="text-muted-foreground text-sm mt-3">Loading FestivaLGU…</p>
        </div>
      </div>
    );
  }

  return (
    <Ctx.Provider value={{ dark, toggleDark, authUser, profile, setProfile, authLoading, logout, view, setView }}>
      <Toaster richColors position="bottom-right" toastOptions={{ style: { marginBottom: "1.5rem" } }} />
      {isPublic && (
        <div className="min-h-screen bg-background">
          <PublicNav />
          <AnimatePresence mode="wait">
            <motion.div key={view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              {view === "home" && <HomePage />}
              {view === "about" && <AboutPage />}
              {view === "events" && <EventsPage />}
              {view === "msmes" && <MSMEsPage />}
              {view === "guide" && <GuidePage />}
              {view === "contact" && <ContactPage />}
              {view === "login" && <LoginPage />}
              {view === "register" && <RegisterPage />}
              {view === "forgot-password" && <ForgotPasswordPage />}
              {view === "claim" && <ClaimPage />}
            </motion.div>
          </AnimatePresence>
          <PublicFooter />
        </div>
      )}
      {isDash && (
        <>
          {view === "admin" && <AdminDashboard />}
          {view === "organizer" && <OrganizerDashboard />}
          {view === "msme-dash" && <MSMEDash />}
          {view === "tourist-dash" && <TouristDash />}
        </>
      )}
    </Ctx.Provider>
  );
}
