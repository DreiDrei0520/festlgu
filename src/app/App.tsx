import { useState, useEffect, useRef, useMemo, createContext, useContext, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Sun, Moon, Menu, X, LogOut, Bell, Search, ChevronDown,
  MapPin, Calendar, Star, QrCode, Gift, Users, Building2,
  ShoppingBag, TrendingUp, BarChart2, FileText, Settings,
  PlusCircle, Edit2, Trash2, CheckCircle, Clock, AlertCircle,
  Camera, Upload, Eye, ArrowRight, Phone, Mail, Globe,
  Ticket, Award, Heart, MessageSquare, Filter, Download,
  Home, Info, Map as MapIcon, ChevronRight, Megaphone, Package,
  DollarSign, Layers, Activity, Shield, UserCheck, Zap, Loader2, ExternalLink, Lightbulb,
  Bus, Utensils, Bike, Car, Footprints, KeyRound,
  Umbrella, Stamp, Receipt, Landmark, Store, Wallet, CreditCard,
  CalendarDays, ScanLine, ArrowLeft, Printer, Sparkles, ChevronLeft, IdCard, Link2,
  Lock as LockIcon,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import QRCode from "qrcode";
import { supabase } from "../lib/supabase";
import type {
  Profile, Festival, Event, MSME, Product, Reward,
  Transaction, Feedback, Announcement, GuideItem, UserRole, LocalUser,
  Municipality, AttendanceQR, AttendanceLog, RegistrationPayment, FeedbackType,
} from "../lib/supabase";
// ─── Types ─────────────────────────────────────────────────────────────────

type View =
  | "home" | "about" | "events" | "msmes" | "guide" | "contact"
  | "login" | "register" | "forgot-password"
  | "admin" | "organizer" | "msme-dash" | "tourist-dash";

// Public views reachable via URL hash (e.g. #login, #forgot-password)
const HASH_VIEWS: Record<string, View> = {
  home: "home", about: "about", events: "events", msmes: "msmes", guide: "guide", contact: "contact",
  login: "login", register: "register", "forgot-password": "forgot-password",
};

function viewFromHash(): View {
  const h = window.location.hash.replace(/^#\/?/, "");
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

// Enumeration of festival dates (inclusive) as "yyyy-mm-dd" strings
function festivalDays(f: { start_date: string; end_date: string }): string[] {
  const start = new Date(f.start_date);
  const end = new Date(f.end_date);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return [];
  const days: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push(new Date(cur.getTime() + 60000 * cur.getTimezoneOffset()).toISOString().slice(0, 10));
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

const FALLBACK_FESTIVALS: Festival[] = [
  { id: 1, slug: "bayenos", municipality: "bay", title: "Bayenos Festival", tagline: "Bay's thanksgiving for a bountiful harvest from the lake and fields.", description: "A vibrant five-day celebration of agro-fairs, street dancing, and harvest floats in the lakeside town of Bay. Native dishes, fresh catch, and handcrafted goodness fill the town plaza.", banner: "https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=800&h=400&fit=crop", logo: "https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=400&h=400&fit=crop", location: "Bay, Laguna", start_date: "2026-09-11", end_date: "2026-09-15" },
  { id: 2, slug: "banamos", municipality: "calauan", title: "Banamos Festival", tagline: "A sweeter-than-honey celebration of Calauan's banana and rice harvest.", description: "Calauan is the banana capital of Laguna. Banana-leaf costumes, fruit-shaped floats, and the sweetest lakatan and saba trade fair you'll ever taste.", banner: "https://images.unsplash.com/photo-1481349518771-20055b2a7b24?w=800&h=400&fit=crop", logo: "https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&h=400&fit=crop", location: "Calauan, Laguna", start_date: "2026-10-11", end_date: "2026-10-15" },
  { id: 3, slug: "pinya", municipality: "los-banos", title: "Pinya Festival", tagline: "Los Baños crowns the king of tropical fruits with the sweetest harvest festival.", description: "Home to UPLB and Mount Makiling, Los Baños celebrates the pineapple with golden floats, dance showdowns, research exhibits, and the freshest tropical fruits in the province.", banner: "https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=800&h=400&fit=crop", logo: "https://images.unsplash.com/photo-1558945529-0e4c8ec6b5c2?w=400&h=400&fit=crop", location: "Los Baños, Laguna", start_date: "2026-11-19", end_date: "2026-11-23" },
];

const FALLBACK_EVENTS = [
  { id: 1, festival_id: 1, title: "Opening & Street Dance Parade", description: null, venue: "Bay Municipal Plaza", start_time: "2026-09-11T08:00:00", end_time: "2026-09-11T12:00:00", organizer_id: null, festivals: { title: "Bayenos Festival" } },
  { id: 2, festival_id: 1, title: "Agro-Fair & Food Village Day", description: null, venue: "Bay Public Market", start_time: "2026-09-12T09:00:00", end_time: "2026-09-12T17:00:00", organizer_id: null, festivals: { title: "Bayenos Festival" } },
  { id: 3, festival_id: 1, title: "Float & Costume Competition", description: null, venue: "National Highway, Bay", start_time: "2026-09-13T16:00:00", end_time: "2026-09-13T19:00:00", organizer_id: null, festivals: { title: "Bayenos Festival" } },
  { id: 4, festival_id: 1, title: "Rural & Folk Dance Night", description: null, venue: "Bay Municipal Grounds", start_time: "2026-09-14T18:00:00", end_time: "2026-09-14T21:00:00", organizer_id: null, festivals: { title: "Bayenos Festival" } },
  { id: 5, festival_id: 1, title: "Grand Bayenos Thanksgiving", description: null, venue: "Bay Municipal Plaza", start_time: "2026-09-15T09:00:00", end_time: "2026-09-15T13:00:00", organizer_id: null, festivals: { title: "Bayenos Festival" } },
  { id: 6, festival_id: 2, title: "Banamos Kick-off Parade", description: null, venue: "Calauan Municipal Plaza", start_time: "2026-10-11T08:00:00", end_time: "2026-10-11T12:00:00", organizer_id: null, festivals: { title: "Banamos Festival" } },
  { id: 7, festival_id: 2, title: "Banana Trade Fair & Tasting", description: null, venue: "Calauan Public Market", start_time: "2026-10-12T09:00:00", end_time: "2026-10-12T17:00:00", organizer_id: null, festivals: { title: "Banamos Festival" } },
  { id: 8, festival_id: 2, title: "Banamos Street Dance Fest", description: null, venue: "Roads of Calauan", start_time: "2026-10-13T15:00:00", end_time: "2026-10-13T18:00:00", organizer_id: null, festivals: { title: "Banamos Festival" } },
  { id: 9, festival_id: 2, title: "Harvest Night Concert", description: null, venue: "Calauan Covered Court", start_time: "2026-10-14T18:00:00", end_time: "2026-10-14T22:00:00", organizer_id: null, festivals: { title: "Banamos Festival" } },
  { id: 10, festival_id: 2, title: "Banamos Grand Finals", description: null, venue: "Calauan Municipal Plaza", start_time: "2026-10-15T18:00:00", end_time: "2026-10-15T21:00:00", organizer_id: null, festivals: { title: "Banamos Festival" } },
  { id: 11, festival_id: 3, title: "Pinya Parade & Agro Exhibits", description: null, venue: "Los Baños Municipal Plaza", start_time: "2026-11-19T08:00:00", end_time: "2026-11-19T12:00:00", organizer_id: null, festivals: { title: "Pinya Festival" } },
  { id: 12, festival_id: 3, title: "Fruit Harvest Fair", description: null, venue: "Los Baños Public Market", start_time: "2026-11-20T09:00:00", end_time: "2026-11-20T17:00:00", organizer_id: null, festivals: { title: "Pinya Festival" } },
  { id: 13, festival_id: 3, title: "Makiling Street Dance Showdown", description: null, venue: "Roads around the plaza", start_time: "2026-11-21T15:00:00", end_time: "2026-11-21T18:00:00", organizer_id: null, festivals: { title: "Pinya Festival" } },
  { id: 14, festival_id: 3, title: "Pinya Fiesta Night", description: null, venue: "Los Baños Municipal Grounds", start_time: "2026-11-22T18:00:00", end_time: "2026-11-22T22:00:00", organizer_id: null, festivals: { title: "Pinya Festival" } },
  { id: 15, festival_id: 3, title: "Pinya Grand Closing", description: null, venue: "Los Baños Municipal Plaza", start_time: "2026-11-23T18:00:00", end_time: "2026-11-23T21:00:00", organizer_id: null, festivals: { title: "Pinya Festival" } },
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
    { label: "Home", v: "home" }, { label: "About", v: "about" },
    { label: "Events", v: "events" }, { label: "MSMEs", v: "msmes" },
    { label: "Tourist Guide", v: "guide" }, { label: "Contact", v: "contact" },
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
              <Btn size="sm" onClick={() => setView("register")}>Register</Btn>
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
              {!profile && <>
                <Btn variant="ghost" size="sm" onClick={() => { setView("login"); setMenuOpen(false); }}>Login</Btn>
                <Btn size="sm" onClick={() => { setView("register"); setMenuOpen(false); }}>Register</Btn>
              </>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
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

  const nextFestival = festivals
    .filter(f => f.start_date && new Date(`${f.start_date}T00:00:00`) >= new Date())
    .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())[0];

  const fallbackAnn = [
    { id: 1, title: "Registration Now Open for the 2026 Laguna Festival Season", description: "Tourists, organizers, MSMEs, and LGU staff can register now.", image: null, created_by: null, created_at: "2026-08-01", tag: "Registration" },
    { id: 2, title: "Festival QR Stamp Cards Are Here", description: "Scan in on each festival day to unlock milestone rewards.", image: null, created_by: null, created_at: "2026-07-28", tag: "Feature" },
    { id: 3, title: "Three Towns, Three Harvest Festivals", description: "Bayenos · Banamos · Pinya — celebrate with us this year.", image: null, created_by: null, created_at: "2026-07-20", tag: "Call for Entry" },
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
              {nextFestival ? (
                <Countdown target={`${nextFestival.start_date}T00:00:00`} label={`Next: ${nextFestival.title} — ${nextFestival.location}`} />
              ) : (
                <Countdown label="Next festival countdown" />
              )}
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

  useEffect(() => {
    // Public directory shows only fully-registered (approved + paid) businesses
    // and, per business, only the LGU-published products.
    supabase.from("msmes").select("*, products(id, product_name, price, approved)").eq("status", "registered").then(({ data }) => {
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
            {filtered.map((m, i) => {
              const liveCount = (m.products || []).filter((p: any) => p.approved).length;
              return (
                <GlassCard key={m.id} className="overflow-hidden">
                  <div className="h-48 overflow-hidden bg-muted relative">
                    <img src={m.logo || photos[i % photos.length]} alt={m.business_name} className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" />
                    {m.municipality && (
                      <div className="absolute top-3 left-3"><Badge variant="info"><Landmark className="w-3 h-3 mr-1 inline" />{MUNI_NAME[m.municipality] || "Laguna"}</Badge></div>
                    )}
                  </div>
                  <div className="p-5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="font-bold font-[Outfit] text-foreground text-lg">{m.business_name}</h3>
                      {m.category && <Badge variant="info">{m.category}</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{m.description || "Local MSME partner"}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <p className="text-xs text-muted-foreground font-mono">{liveCount} product{liveCount === 1 ? "" : "s"} on sale</p>
                      {m.contact_number && <p className="text-xs text-muted-foreground font-mono flex items-center gap-1"><Phone className="w-3 h-3" />{m.contact_number}</p>}
                    </div>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Guide Page ───────────────────────────────────────────────────────────────

function GuidePage() {
  const [activeSection, setActiveSection] = useState("maps");
  const [items, setItems] = useState<GuideItem[] | null>(null);

  useEffect(() => {
    supabase.from("guide_items").select("*").order("sort_order").then(({ data, error }) => {
      setItems(!error && data?.length ? (data as GuideItem[]) : FALLBACK_GUIDE);
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

        {activeSection === "maps" && (
          <div className="grid lg:grid-cols-5 gap-6">
            <GlassCard className="lg:col-span-3 p-5">
              <h3 className="font-bold font-[Outfit] text-foreground text-lg mb-4 flex items-center gap-2"><MapIcon className="w-5 h-5 text-primary" /> {mapImg?.title || "Festival Venue Map"}</h3>
              <div className="relative rounded-2xl overflow-hidden bg-muted h-[320px]">
                <img src={mapImg?.image || "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=700&fit=crop"} alt="Town map" className="w-full h-full object-cover opacity-90" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
                <div className="absolute inset-0 p-4 flex flex-col justify-end">
                  <div className="flex flex-wrap gap-2">
                    {mapSpots.map((spot, i) => (
                      <span key={spot.id || i} className="px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm border border-white/20 text-white text-xs">{i + 1}. {spot.title}</span>
                    ))}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">{mapImg?.body || "Download the official festival map at the LGU Tourism Office or visit any info booth on site."}</p>
            </GlassCard>
            <div className="lg:col-span-2 space-y-4">
              {mapSpots.length === 0 && <GlassCard className="p-4 text-sm text-muted-foreground">No venue spots added yet.</GlassCard>}
              {mapSpots.map(spot => (
                <GlassCard key={spot.id} className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-semibold text-foreground">{spot.title}</h4>
                    {spot.subtitle && <Badge variant="info">{spot.subtitle}</Badge>}
                  </div>
                  {spot.body && <p className="text-sm text-muted-foreground">{spot.body}</p>}
                </GlassCard>
              ))}
            </div>
          </div>
        )}

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
  const [form, setForm] = useState({ name: profile?.fullname || "", email: profile?.email || "", message: "" });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!form.name || !form.email || !form.message) { toast.error("Please fill in all fields."); return; }
    setLoading(true);
    await new Promise(r => setTimeout(r, 600));
    toast.success("Message sent! We'll get back to you within 24 hours.");
    setForm(p => ({ ...p, message: "" }));
    setLoading(false);
  };

  return (
    <div className="pt-24 pb-20 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <Badge variant="info">Get in Touch</Badge>
          <h1 className="text-5xl font-bold font-[Outfit] text-foreground mt-3 mb-2">Contact Us</h1>
        </div>
        <div className="grid md:grid-cols-2 gap-8">
          <GlassCard className="p-6">
            <h3 className="font-bold font-[Outfit] text-foreground text-xl mb-5">Send a Message</h3>
            <div className="space-y-4">
              <Input label="Full Name" placeholder="Juan dela Cruz" value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} icon={Users} />
              <Input label="Email" type="email" placeholder="juan@email.com" value={form.email} onChange={v => setForm(p => ({ ...p, email: v }))} icon={Mail} />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Message</label>
                <textarea value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))} rows={4}
                  className="bg-input-background border border-border rounded-xl px-4 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
              </div>
              <Btn onClick={submit} disabled={loading} className="w-full justify-center">{loading ? "Sending…" : "Send Message"}</Btn>
            </div>
          </GlassCard>
          <GlassCard className="p-6">
            <h4 className="font-bold font-[Outfit] text-foreground mb-4">LGU Tourism Offices — Laguna</h4>
            {[
              { icon: MapPin, text: "Bay Municipal Hall · Calauan Municipal Hall · Los Baños Municipal Hall, Laguna" },
              { icon: Phone, text: "+63 919-456-7890" },
              { icon: Mail, text: "tourism@festivallgu.gov.ph" },
              { icon: Globe, text: "www.festivallgu.gov.ph" },
            ].map(c => (
              <div key={c.text} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
                <c.icon className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="text-sm text-foreground">{c.text}</span>
              </div>
            ))}
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-3 font-semibold uppercase tracking-wider">Municipality Tourism Officers</p>
              {MUNICIPALITIES.map(m => (
                <div key={m.id} className="flex items-center gap-2.5 py-2">
                  <div className={`w-2 h-2 rounded-full bg-gradient-to-br ${m.gradient}`} />
                  <span className="text-sm text-foreground">{m.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto font-mono">{m.id}@festivallgu.gov.ph</span>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

// ─── Auth Pages ───────────────────────────────────────────────────────────────

// ─── Demo accounts config ───────────────────────────────────────────────────

const DEMO_ACCOUNTS = [
  { role: "admin"     as UserRole, label: "Bay Admin · Bayenos",   email: "admin@festivalglu.ph",             color: "bg-emerald-500", name: "Admin Rivera"    },
  { role: "admin"     as UserRole, label: "Calauan Admin · Banamos", email: "calauan.admin@festivalglu.ph",   color: "bg-amber-500",   name: "Aling Nena Reyes" },
  { role: "admin"     as UserRole, label: "Los Baños Admin · Pinya", email: "losbanos.admin@festivalglu.ph",  color: "bg-indigo-500",  name: "Ka Mario Cruz"  },
  { role: "organizer" as UserRole, label: "Event Organizer",  email: "organizer@festivalglu.ph",         color: "bg-sky-500",     name: "Carlos Mendoza" },
  { role: "msme"      as UserRole, label: "MSME Owner",       email: "msme@festivalglu.ph",              color: "bg-pink-500",    name: "Elena Cruz"     },
  { role: "msme"      as UserRole, label: "Pending MSME",     email: "msme4@festivalglu.ph",             color: "bg-rose-500",    name: "Nilda Torres"   },
  { role: "tourist"   as UserRole, label: "Tourist",          email: "tourist@festivalglu.ph",           color: "bg-violet-500",  name: "Maria Santos"   },
  { role: "tourist"   as UserRole, label: "Tourist (3-day)",  email: "ana@festivalglu.ph",               color: "bg-fuchsia-500", name: "Ana Reyes"      },
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
    if (!email || !password) { toast.error("Enter email and password."); return; }
    setLoginLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) toast.error(error.message);
    setLoginLoading(false);
  };

  // ── Quick login (account row click) ─────────────────────────────────────
  const quickLogin = async (acc: typeof DEMO_ACCOUNTS[0]) => {
    setLoginLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: acc.email, password: DEMO_PASSWORD });
    if (error) toast.error(error.message);
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

          {/* Manual login */}
          <div className="space-y-3 mb-4">
            <Input type="email" placeholder="Email address" value={email} onChange={setEmail} icon={Mail} />
            <Input type="password" placeholder="Password" value={password} onChange={setPassword} icon={Shield} />
          </div>
          <div className="flex justify-end -mt-2 mb-3">
            <button onClick={() => setView("forgot-password")} className="text-xs text-primary font-medium hover:underline">
              Forgot password?
            </button>
          </div>
          <Btn onClick={handleLogin} disabled={loginLoading} className="w-full justify-center mb-2" size="lg">
            {loginLoading ? <><Spinner /> Signing In…</> : "Sign In"}
          </Btn>
          <p className="text-center text-xs text-muted-foreground mb-5">
            No account?{" "}
            <button onClick={() => setView("register")} className="text-primary font-medium hover:underline">Register</button>
          </p>

          {/* ── Demo accounts ─────────────────────────────── */}
          <div className="border-t border-border pt-5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-bold text-foreground uppercase tracking-wider">Demo Accounts</p>
              <p className="text-[11px] text-muted-foreground font-mono">{DEMO_PASSWORD}</p>
            </div>
            <p className="text-xs text-muted-foreground mb-3">Click any row to log in instantly — the system is fully loaded with sample data.</p>

            <div className="space-y-2 mb-4">
              {DEMO_ACCOUNTS.map(a => (
                <button key={a.role} onClick={() => quickLogin(a)} disabled={loginLoading}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-all text-left disabled:opacity-50">
                  <div className={`${a.color} w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm`}>
                    <span className="text-white text-xs font-bold">{a.name.split(" ").map(n => n[0]).join("")}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{a.label}</p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">{a.email}</p>
                  </div>
                  {loginLoading
                    ? <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin flex-shrink-0" />
                    : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}

function RegisterPage() {
  const { setView } = useApp();
  const [role, setRole] = useState<UserRole>("tourist");
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: "", email: "", password: "", municipality: "bay" });
  const [loading, setLoading] = useState(false);

  const needsMuni = role === "admin" || role === "organizer" || role === "msme";

  const roles: { value: UserRole; label: string; icon: React.ElementType; desc: string }[] = [
    { value: "tourist", label: "Tourist / Visitor", icon: Users, desc: "Browse festivals, scan QR stamps, unlock milestone rewards" },
    { value: "msme", label: "MSME / Local Business", icon: ShoppingBag, desc: "Register your business, get approved, sell festival products" },
    { value: "organizer", label: "Event Organizer", icon: Calendar, desc: "Manage your town's festival events and program" },
    { value: "admin", label: "LGU Tourism Staff", icon: Shield, desc: "Verify MSMEs, generate festival QR codes, view analytics" },
  ];

  const handleRegister = async () => {
    if (!form.name || !form.email || !form.password) { toast.error("Please fill all fields."); return; }
    if (form.password.length < 6) { toast.error("Password must be at least 6 characters."); return; }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { fullname: form.name, role, municipality: needsMuni ? form.municipality : null } },
    });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    if (data.session) {
      // Email confirmation is off — already signed in.
      toast.success("Account created! Welcome aboard!");
    } else {
      // Email confirmation required — tell the user to check their inbox.
      toast.success("Account created! Check your email to confirm your account, then sign in.");
      setView("login");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 pt-16 pb-10">
      <motion.div className="w-full max-w-lg" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <GlassCard className="p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center mx-auto mb-4">
              <UserCheck className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold font-[Outfit] text-foreground">Create Account</h1>
            <div className="flex justify-center gap-2 mt-3">
              {[1, 2].map(s => <div key={s} className={`h-1.5 w-12 rounded-full transition-colors ${step >= s ? "bg-primary" : "bg-muted"}`} />)}
            </div>
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
            </div>
          )}
          {step === 2 && (
            <div>
              <div className="space-y-4 mb-6">
                <Input label="Full Name" placeholder="Juan dela Cruz" value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} icon={Users} />
                <Input label="Email Address" type="email" placeholder="juan@email.com" value={form.email} onChange={v => setForm(p => ({ ...p, email: v }))} icon={Mail} />
                <Input label="Password" type="password" placeholder="Min. 6 characters" value={form.password} onChange={v => setForm(p => ({ ...p, password: v }))} icon={Shield} />
                {needsMuni && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-foreground">Municipality<span className="text-red-500 ml-0.5">*</span></label>
                    <div className="grid grid-cols-3 gap-2">
                      {MUNICIPALITIES.map(m => (
                        <button key={m.id} type="button" onClick={() => setForm(p => ({ ...p, municipality: m.id }))}
                          className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${form.municipality === m.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
                          {m.name}, Laguna
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Your account is scoped to this town — you can only manage {role === "admin" ? "that town's data, MSMEs, and QR codes." : role === "organizer" ? "that town's festival events." : "your festival stall under this town's market."}</p>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Btn variant="outline" onClick={() => setStep(1)} className="flex-1 justify-center">Back</Btn>
                <Btn onClick={handleRegister} disabled={loading} className="flex-1 justify-center">
                  {loading ? <><Spinner /> Creating…</> : "Create Account"}
                </Btn>
              </div>
              <p className="text-center text-sm text-muted-foreground mt-4">
                Already have an account?{" "}
                <button onClick={() => setView("login")} className="text-primary font-medium hover:underline">Sign in</button>
              </p>
            </div>
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

function NotificationBell() {
  const { authUser } = useApp();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Announcement[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const seenKey = `fglu_notif_seen_${authUser?.id || "guest"}`;

  const fetchItems = useCallback(async () => {
    const { data, error } = await supabase
      .from("announcements")
      .select("id, title, description, image, created_at")
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) return;
    const list = (data || []) as Announcement[];
    setItems(list);
    const lastSeen = Number(localStorage.getItem(seenKey) || 0);
    setUnread(list.filter(a => new Date(a.created_at || 0).getTime() > lastSeen).length);
  }, [seenKey]);

  useEffect(() => { fetchItems(); const t = setInterval(fetchItems, 20000); return () => clearInterval(t); }, [fetchItems]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const markAllRead = () => {
    localStorage.setItem(seenKey, String(Date.now()));
    setUnread(0);
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
                  No announcements yet.
                </div>
              ) : items.map(a => (
                <button key={a.id} onClick={() => setOpen(false)} className="w-full text-left px-4 py-3 border-b border-border/60 last:border-0 hover:bg-muted/40 transition-colors">
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${new Date(a.created_at || 0).getTime() > Number(localStorage.getItem(seenKey) || 0) ? "bg-primary" : "bg-border"}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{a.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{a.description}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-1">{new Date(a.created_at || "").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
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

function DashboardLayout({ title, navItems, children }: {
  title: string;
  navItems: { label: string; icon: React.ElementType; id: string }[];
  children: (active: string, setActive: (id: string) => void) => React.ReactNode;
}) {
  const { profile, logout, setView, dark, toggleDark } = useApp();
  const [active, setActive] = useState(navItems[0].id);
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
            <NotificationBell />
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
    { label: "Analytics", icon: TrendingUp, id: "analytics" },
    { label: "Feedback", icon: MessageSquare, id: "feedback" },
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
        if (active === "analytics") return <AdminAnalytics />;
        if (active === "feedback") return <AdminFeedback />;
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
  _townFestCache[m] = data?.[0]?.id ?? null;
  return _townFestCache[m];
}

function AdminOverview() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];
  const [counts, setCounts] = useState({ users: 0, events: 0, msmes: 0, pending: 0, scans: 0, revenue: 0, rewards: 0 });
  const [festId, setFestId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fest = await townFestivalId(town);
      if (cancelled) return;
      setFestId(fest);
      const [u, e, mpay, qr] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("municipality", town),
        fest ? supabase.from("events").select("id", { count: "exact", head: true }).eq("festival_id", fest) : Promise.resolve({ count: 0, error: null }),
        supabase.from("msmes").select("id,status,registration_fee", { count: "exact" }).eq("municipality", town),
        fest ? supabase.from("attendance_qr").select("id").eq("festival_id", fest) : Promise.resolve({ data: [], error: null }),
      ]);
      if (cancelled) return;
      const msmes = (mpay.data as any[] | null) || [];
      const qrIds = (qr.data as any[] | null)?.map(r => r.id) || [];
      const scans = qrIds.length ? await supabase.from("attendance_logs").select("id", { count: "exact", head: true }).in("qr_id", qrIds) : { count: 0 };
      const rewards = fest ? await supabase.from("redeemed_rewards").select("id, rewards(festival_id)") : { data: [] as any[] };
      const rewardCount = (rewards.data as any[] || []).filter(r => r.rewards?.festival_id === fest || !r.rewards).length;
      const revenue = msmes.reduce((s, m) => s + (Number(m.registration_fee) || 0), 0);
      if (cancelled) return;
      setCounts({
        users: u.count || 0,
        events: fest ? (e as any).count || 0 : 0,
        msmes: msmes.length,
        pending: msmes.filter(m => m.status === "pending").length,
        scans: (scans as any).count || 0,
        revenue,
        rewards: rewardCount,
      });
    })();
    return () => { cancelled = true; };
  }, [town]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="font-bold font-[Outfit] text-lg text-foreground">Overview — Users from:</h3>
        <Badge variant="info"><Landmark className="w-3 h-3 mr-1 inline" /> {townName}, Laguna</Badge>
        <span className="text-xs text-muted-foreground">Data shown is scoped to {townName} only.</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={`Users from ${townName}`} value={counts.users || "—"} icon={Users} color="bg-primary" />
        <StatCard label="Active Events" value={counts.events || "—"} icon={Calendar} color="bg-secondary" />
        <StatCard label="Registered MSMEs" value={counts.msmes || "—"} icon={Building2} color="bg-accent" />
        <StatCard label="Attendance Scans" value={counts.scans || "—"} icon={ScanLine} color="bg-violet-500" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="MSMEs Awaiting Approval" value={counts.pending || "—"} icon={Clock} color="bg-amber-500" />
        <StatCard label="Registration Fees" value={counts.revenue ? `₱${counts.revenue.toLocaleString()}` : "₱0"} icon={Wallet} color="bg-emerald-500" />
        <StatCard label="Rewards Redeemed" value={counts.rewards || "—"} icon={Gift} color="bg-rose-500" />
        <StatCard label="Festival ID" value={festId ?? "—"} icon={IdCard} color="bg-sky-500" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <GlassCard className="p-5">
          <h3 className="font-bold font-[Outfit] text-foreground mb-4">Visitor Traffic (Monthly)</h3>
          <div className="flex items-end gap-2 h-44">
            {VISITORS_DATA.map(d => {
              const max = Math.max(...VISITORS_DATA.map(x => x.visitors));
              const pct = Math.round((d.visitors / max) * 100);
              return (
                <div key={d.month} className="flex-1 flex flex-col items-center gap-1 group">
                  <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity font-mono">
                    {(d.visitors / 1000).toFixed(1)}k
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
          <h3 className="font-bold font-[Outfit] text-foreground mb-4">Tourist Interests</h3>
          <div className="flex items-center gap-5 h-44">
            <div className="relative w-36 h-36 flex-shrink-0">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                {(() => {
                  const total = PIE_DATA.reduce((s, d) => s + d.value, 0);
                  let offset = 0;
                  return PIE_DATA.map((d, i) => {
                    const pct = d.value / total;
                    const dash = pct * 100;
                    const el = (
                      <circle key={`donut-${d.name}`} cx="18" cy="18" r="15.9"
                        fill="none" stroke={PIE_COLORS[i]} strokeWidth="3.8"
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
            <div className="space-y-2.5 flex-1">
              {PIE_DATA.map((d, i) => (
                <div key={`legend-${d.name}`} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i] }} />
                    <span className="text-xs text-foreground">{d.name}</span>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">{d.value}%</span>
                </div>
              ))}
            </div>
          </div>
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
        <Input label="Festival Title *" placeholder="Bayenos Festival" value={form.title} onChange={set("title")} />
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
    if (!form.title || !form.location) { toast.error("Title and location are required."); return; }
    setSaving(true);
    const payload = { ...form, banner: form.banner || null, logo: form.logo || null, slug: form.slug || form.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), municipality: town };
    const { data, error } = await supabase.from("festivals").insert([payload]).select().single();
    if (error) { toast.error(error.message); }
    else { setFestivals(prev => [...prev, data]); setShowAdd(false); toast.success("Festival added!"); }
    setSaving(false);
  };

  const saveEdit = async (form: typeof EMPTY_FEST_FORM) => {
    if (!editing) return;
    if (!form.title || !form.location) { toast.error("Title and location are required."); return; }
    setSaving(true);
    const payload = { ...form, banner: form.banner || null, logo: form.logo || null, slug: form.slug || editing.slug, municipality: editing.municipality || town };
    const { data, error } = await supabase.from("festivals").update(payload).eq("id", editing.id).select().maybeSingle();
    if (error) { toast.error(error.message); }
    else if (!data) { toast.error("Festival no longer exists — refresh the list."); }
    else { setFestivals(prev => prev.map(f => f.id === editing.id ? data : f)); setEditing(null); toast.success("Festival updated!"); }
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
      start_time: e.start_time ? e.start_time.slice(0, 16) : "",
      end_time: e.end_time ? e.end_time.slice(0, 16) : "",
      description: e.description || "",
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.title || !form.venue || !form.start_time) { toast.error("Fill required fields."); return; }
    setSaving(true);
    const payload = {
      festival_id: form.festival_id ? Number(form.festival_id) : null,
      title: form.title,
      venue: form.venue,
      start_time: form.start_time,
      end_time: form.end_time || null,
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
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{e.start_time?.slice(0, 16)}</td>
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

function AdminMSMEs() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];
  const [msmes, setMSMEs] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "pending" | "approved" | "unpaid" | "rejected">("all");
  const [expanded, setExpanded] = useState<any>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [fee, setFee] = useState<Record<number, string>>({});

  useEffect(() => {
    Promise.all([
      supabase.from("msmes").select("*, profiles!owner(fullname), products(*)").eq("municipality", town).order("id"),
      supabase.from("registration_payments").select("*, msmes(business_name)").order("id"),
    ]).then(([m, p]) => {
      setMSMEs((m.data as any[]) || []);
      setPayments((p.data as any[]) || []);
      setLoading(false);
    });
  }, [town]);

  const payOf = (id: number) => payments.find(p => p.msme_id === id);
  const isPaid = (m: any) => (payOf(m.id)?.status ?? "unpaid") === "paid";

  const setStatus = async (m: any, status: string, msg: string) => {
    setSaving(String(m.id));
    const { error } = await supabase.from("msmes").update({ status }).eq("id", m.id);
    if (error) { toast.error(error.message); setSaving(null); return; }
    setMSMEs(prev => prev.map(x => x.id === m.id ? { ...x, status } : x));
    setSaving(null);
    toast.success(msg);
  };

  const setPayment = async (m: any, status: string) => {
    const existing = payOf(m.id);
    setSaving(String(m.id));
    const payload = {
      msme_id: m.id,
      amount: m.registration_fee ?? (existing?.amount ?? 0),
      method: existing?.method ?? "e-wallet",
      receipt_no: existing?.receipt_no ?? `RC-${Date.now().toString(36).toUpperCase()}`,
      status,
    };
    const { error } = existing
      ? await supabase.from("registration_payments").update(payload).eq("id", existing.id)
      : await supabase.from("registration_payments").insert([payload]);
    if (error) { toast.error(error.message); setSaving(null); return; }
    const fresh = await supabase.from("registration_payments").select("*").order("id");
    setPayments((fresh.data as any[]) || []);
    setSaving(null);
    toast.success(`Payment marked ${status}.`);
  };

  const setProduct = async (p: any, approved: boolean) => {
    setSaving(`p${p.id}`);
    const { error } = await supabase.from("products").update({ approved }).eq("id", p.id);
    if (error) { toast.error(error.message); setSaving(null); return; }
    setMSMEs(prev => prev.map(m => ({ ...m, products: (m.products || []).map((x: any) => x.id === p.id ? { ...x, approved } : x) })));
    setSaving(null);
    toast.success(approved ? "Product published." : "Product hidden.");
  };

  const filtered = msmes.filter(m => {
    if (tab === "all") return true;
    if (tab === "pending") return m.status === "pending";
    if (tab === "approved") return m.status === "approved";
    if (tab === "rejected") return m.status === "rejected";
    if (tab === "unpaid") return !isPaid(m);
    return true;
  });

  const tabs: { id: typeof tab; label: string }[] = [
    { id: "all", label: `All (${msmes.length})` },
    { id: "pending", label: `Pending (${msmes.filter(m => m.status === "pending").length})` },
    { id: "unpaid", label: `Unpaid (${msmes.filter(m => !isPaid(m)).length})` },
    { id: "approved", label: `Approved (${msmes.filter(m => m.status === "approved").length})` },
    { id: "rejected", label: "Rejected" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-bold font-[Outfit] text-xl text-foreground">MSME Management — {townName}</h3>
        <Badge variant="info"><Landmark className="w-3 h-3 mr-1 inline" /> {townName}, Laguna</Badge>
      </div>

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
            const paid = pay?.status === "paid";
            return (
              <GlassCard key={`msme-${m.id}`} className="p-5">
                <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                  {m.logo
                    ? <img src={m.logo} alt="" className="w-14 h-14 rounded-2xl object-cover flex-shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    : <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0"><Building2 className="w-6 h-6 text-primary" /></div>}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold font-[Outfit] text-foreground">{m.business_name}</h4>
                      <Badge variant={m.status === "approved" ? "success" : m.status === "rejected" ? "danger" : "warning"}>{m.status || "pending"}</Badge>
                      <Badge variant={paid ? "success" : "danger"}>{paid ? "Paid" : "Unpaid"}</Badge>
                      {m.category && <Badge variant="info">{m.category}</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">Owner: {m.profiles?.fullname || "—"}{m.contact_number ? ` · ${m.contact_number}` : ""}</p>
                    {m.address && <p className="text-xs text-muted-foreground">{m.address}</p>}
                    {m.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.description}</p>}
                    <div className="flex flex-wrap gap-2 mt-3 text-xs">
                      {pay && <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted"><Receipt className="w-3.5 h-3.5" /> {pay.receipt_no} · ₱{Number(pay.amount).toLocaleString()}</span>}
                      {m.registration_code && <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted font-mono">{m.registration_code}</span>}
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted">{m.products?.length || 0} product(s)</span>
                    </div>
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <span className="text-xs font-semibold text-muted-foreground">Registration fee:</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          value={fee[m.id] ?? m.registration_fee ?? ""}
                          onChange={e => setFee(prev => ({ ...prev, [m.id]: e.target.value }))}
                          placeholder="0"
                          className="w-24 bg-input-background border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                        <button
                          onClick={async () => {
                            const val = Number(fee[m.id] ?? m.registration_fee ?? 0);
                            const { error } = await supabase.from("msmes").update({ registration_fee: val }).eq("id", m.id);
                            if (error) toast.error(error.message);
                            else { setMSMEs(prev => prev.map(x => x.id === m.id ? { ...x, registration_fee: val } : x)); toast.success("Registration fee set — MSME can now pay."); }
                          }}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-border hover:bg-primary/10 hover:text-primary transition-all">
                          Set
                        </button>
                      </div>
                      <span className="text-xs text-muted-foreground">(₱{Number(m.registration_fee || 0).toLocaleString()} current)</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:flex-col lg:w-40 flex-shrink-0">
                    <Btn size="sm" onClick={() => setStatus(m, "approved", "MSME approved!")} disabled={saving === String(m.id)}>
                      <CheckCircle className="w-4 h-4 mr-1" /> Approve
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setStatus(m, "rejected", "MSME rejected.")} disabled={saving === String(m.id)}>Reject</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setPayment(m, paid ? "unpaid" : "paid")} disabled={saving === String(m.id)}>
                      <Wallet className="w-4 h-4 mr-1" /> Mark {paid ? "Unpaid" : "Paid"}
                    </Btn>
                    <button onClick={() => setExpanded(expanded?.id === m.id ? null : m)} className="text-xs font-semibold text-primary hover:underline text-right">
                      {expanded?.id === m.id ? "Hide products" : "Manage products"} ({m.products?.length || 0})
                    </button>
                  </div>
                </div>

                {expanded?.id === m.id && (
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
                            {p.approved
                              ? <Badge variant="success">Published</Badge>
                              : <Badge variant="warning">Pending</Badge>}
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

function AdminAnalytics() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality) || "bay";
  const townName = MUNI_NAME[town];
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fest = await townFestivalId(town);
      if (cancelled) return;
      const msmes = await supabase.from("msmes").select("id,registration_fee").eq("municipality", town);
      const feeSum = (msmes.data as any[] || []).reduce((s, m) => s + (Number(m.registration_fee) || 0), 0);
      const qr = fest ? await supabase.from("attendance_qr").select("id").eq("festival_id", fest) : { data: [] as any[] };
      const qrIds = (qr.data as any[] || []).map(r => r.id);
      let scans = 0;
      if (qrIds.length) {
        const s = await supabase.from("attendance_logs").select("id", { count: "exact", head: true }).in("qr_id", qrIds);
        scans = s.count || 0;
      }
      const rated = await supabase.from("feedback").select("rating").eq("municipality", town);
      const ratings = (rated.data as any[] || []).map(r => r.rating);
      const avg = ratings.length ? (ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1) : "—";
      if (cancelled) return;
      setData({ fees: feeSum, muniScans: scans, avg, count: ratings.length });
    })();
    return () => { cancelled = true; };
  }, [town]);

  return (
    <div className="space-y-6">
      <h3 className="font-bold font-[Outfit] text-xl text-foreground">Analytics & Reports — {townName}</h3>
      <p className="text-xs text-muted-foreground -mt-2">All figures are scoped to {townName} (Laguna) only.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="MSME Registration Fees" value={data ? `₱${data.fees.toLocaleString()}` : "—"} icon={DollarSign} color="bg-green-500" />
        <StatCard label="Attendance Scans" value={data?.muniScans ?? "—"} icon={ScanLine} color="bg-blue-500" />
        <StatCard label="Avg. Feedback Rating" value={data ? data.avg : "—"} icon={Star} color="bg-amber-500" />
        <StatCard label="Feedback Count" value={data?.count ?? "—"} icon={MessageSquare} color="bg-rose-500" />
      </div>
      <GlassCard className="p-5">
        <h3 className="font-bold font-[Outfit] text-foreground mb-4">Monthly Visitors</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={VISITORS_DATA}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <Tooltip contentStyle={{ background: "rgba(15,25,40,0.9)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px", color: "#e8f0fe" }} formatter={(v, name) => [v.toLocaleString(), name]} />
            <Legend />
            <Bar dataKey="visitors" fill="#22c55e" radius={[4, 4, 0, 0]} name="Visitors" />
            <Bar dataKey="revenue" fill="#0ea5e9" radius={[4, 4, 0, 0]} name="Revenue (₱)" />
          </BarChart>
        </ResponsiveContainer>
      </GlassCard>
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

  return (
    <div className="space-y-5">
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
  const [form, setForm] = useState({ reward_name: "", required_days: "3", image: "", description: "", msme_id: "", product_id: "" });
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
      required_days: String(r.required_days || r.required_points || 3),
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
    setSaving(true);
    const fest = await townFestivalId(town);
    const payload: any = {
      reward_name: form.reward_name,
      required_days: Number(form.required_days) || 3,
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
          <p className="text-xs text-muted-foreground">Milestone rewards unlock after N days of festival attendance.</p>
        </div>
        <Btn icon={PlusCircle} size="sm" onClick={() => { setShowForm(!showForm); setEditing(null); setForm({ reward_name: "", required_days: "3", image: "", description: "", msme_id: "", product_id: "" }); }}>Add Reward</Btn>
      </div>
      {showForm && (
        <GlassCard className="p-5">
          <h4 className="font-bold font-[Outfit] text-foreground mb-4">{editing ? "Edit Reward" : "New Reward"}</h4>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input label="Reward Name" placeholder="Festival T-Shirt" value={form.reward_name} onChange={v => setForm(p => ({ ...p, reward_name: v }))} />
            <Input label="Attendance Days Required" type="number" placeholder="3" value={form.required_days} onChange={v => setForm(p => ({ ...p, required_days: v }))} />
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
                      <Badge variant="warning"><CalendarDays className="w-3 h-3 mr-1 inline" /> {(r as any).required_days || r.required_points || 3} days</Badge>
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
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [selectDay, setSelectDay] = useState("all");
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<{ qr: AttendanceQR; dataUrl: string } | null>(null);

  const load = useCallback(async () => {
    const fid = await townFestivalId(town);
    if (!fid) { setLoading(false); return; }
    const [f, q] = await Promise.all([
      supabase.from("festivals").select("*").eq("id", fid).single(),
      supabase.from("attendance_qr").select("*").eq("festival_id", fid).order("created_at", { ascending: false }),
    ]);
    setFestival((f.data as Festival) || null);
    const list = (q.data as AttendanceQR[]) || [];
    setQRs(list);
    const qrIds = list.map(r => r.id);
    if (qrIds.length) {
      const [logsRes, logRes] = await Promise.all([
        supabase.from("attendance_logs").select("*, profiles(fullname), attendance_qr!qr_id(label)").in("qr_id", qrIds).order("created_at", { ascending: false }).limit(200),
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
    const code = `FLGU-${festival.slug || town}-${Date.now().toString(36).toUpperCase()}`;
    const { data, error } = await supabase.from("attendance_qr").insert([
      { festival_id: festival.id, qr_code: code, label: label.trim() || `${townName} Gate / Station`, created_by: authUser?.id || null },
    ]).select().single();
    if (error || !data) {
      toast.error(error?.message || "Could not create QR code.");
      setGenerating(false);
      return;
    }
    const svgOrUrl = await QRCode.toDataURL(code, { width: 480, margin: 2 });
    setPreview({ qr: data as AttendanceQR, dataUrl: svgOrUrl });
    setLabel("");
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
      <p style="font-size:11px;color:#666;margin-top:12px;word-break:break-all">${preview.qr.qr_code}</p>
    </body></html>`);
    w.document.close();
    w.print();
  };

  const downloadQR = () => {
    if (!preview) return;
    const a = document.createElement("a");
    a.href = preview.dataUrl;
    a.download = `${preview.qr.qr_code}.png`;
    a.click();
    toast.success("QR downloaded as PNG.");
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

      {/* Generate + list */}
      <div className="grid lg:grid-cols-2 gap-5">
        <GlassCard className="p-5">
          <h4 className="font-bold font-[Outfit] text-foreground mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> New Attendance QR</h4>
          <div className="space-y-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Station / Gate Label</label>
              <Input placeholder="Main Gate · Day 1" value={label} onChange={setLabel} icon={MapPin} />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" />
              Festival run: {festivalDays[0] || "—"} → {festivalDays[festivalDays.length - 1] || "—"} · one QR works for all days
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
                    const url = await QRCode.toDataURL(q.qr_code, { width: 480, margin: 2 });
                    setPreview({ qr: q, dataUrl: url });
                  }}
                    className="w-full flex items-center gap-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 p-2.5 text-left transition-all">
                    <QrCode className="w-4 h-4 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{q.label}</p>
                      <p className="text-xs font-mono text-muted-foreground truncate">{q.qr_code}</p>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground flex-shrink-0">{scanCounts[q.id] || 0} scans</span>
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
                    {["Tourist", "Station", "Day", "Time"].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map(l => (
                    <tr key={l.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 text-sm text-foreground">{l.profiles?.fullname || "—"}</td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">{l.attendance_qr?.label || `QR #${l.qr_id}`}</td>
                      <td className="px-3 py-2 text-sm font-mono text-muted-foreground">{String(l.scan_date).slice(0, 10)}</td>
                      <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{l.created_at?.slice(0, 5)}</td>
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
                <p className="text-[11px] font-mono text-muted-foreground break-all mb-4">{preview.qr.qr_code}</p>
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
  const [form, setForm] = useState({ title: "", description: "" });

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
    setForm({ title: a.title, description: a.description });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.title || !form.description) { toast.error("Fill all fields."); return; }
    const fest = await townFestivalId(town);
    if (editing) {
      const { data, error } = await supabase.from("announcements").update({ ...form }).eq("id", editing.id).select("*, festivals(title)").single();
      if (!error && data) { setItems(prev => prev.map(a => a.id === editing.id ? data : a)); setShowForm(false); setEditing(null); toast.success("Announcement updated!"); }
      else toast.error("Could not update.");
    } else {
      const { data, error } = await supabase.from("announcements").insert([{ ...form, festival_id: fest, created_by: authUser?.id || null }]).select("*, festivals(title)").single();
      if (!error && data) { setItems(prev => [data, ...prev]); setShowForm(false); setForm({ title: "", description: "" }); toast.success("Announcement published!"); }
      else toast.error("Could not publish.");
    }
  };

  const remove = async (id: number) => {
    await supabase.from("announcements").delete().eq("id", id);
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
  ];

  return (
    <DashboardLayout title={townName ? `${townName} (Laguna) — Event Organizer` : "Organizer"} navItems={navItems}>
      {(active) => {
        if (active === "overview") return <OrganizerOverview />;
        if (active === "my-events") return <OrganizerEvents />;
        if (active === "announcements") return <AdminAnnouncements />;
        if (active === "notifications") return <OrganizerNotifications />;
        if (active === "settings") return <ProfileSettings />;
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
                <p className="text-xs text-muted-foreground">{e.start_time?.slice(0, 10)} • {e.venue}</p>
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
      setEvents(new Map((e.data as any[] || []).map((ev: Event) => [ev.id, ev])).values() as any);
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
      start_time: e.start_time ? e.start_time.slice(0, 16) : "",
      end_time: e.end_time ? e.end_time.slice(0, 16) : "",
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.title || !form.venue || !form.start_time) { toast.error("Fill required fields."); return; }
    setSaving(true);
    const payload = {
      festival_id: form.festival_id ? Number(form.festival_id) : null,
      title: form.title, venue: form.venue,
      start_time: form.start_time, end_time: form.end_time || null,
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
                  <p className="text-sm text-muted-foreground">{e.festivals?.title} • {e.start_time?.slice(0, 10)}</p>
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

function OrganizerNotifications() {
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
              <GlassCard key={`up-${e.id}`} className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`rounded-xl p-2.5 flex-shrink-0 ${soon(e.start_time) ? "bg-amber-500/10" : "bg-primary/10"}`}>
                    <Clock className={`w-5 h-5 ${soon(e.start_time) ? "text-amber-500" : "text-primary"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground">{e.title}</p>
                    <p className="text-xs text-muted-foreground">{e.festivals?.title} • {e.start_time?.slice(0, 16).replace("T", " ")}</p>
                  </div>
                  {soon(e.start_time) && <Badge variant="warning">Soon</Badge>}
                </div>
              </GlassCard>
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
              <GlassCard key={`ann-${a.id}`} className="p-4">
                <p className="font-semibold text-foreground">{a.title}</p>
                {a.description && <p className="text-sm text-muted-foreground mt-0.5">{a.description}</p>}
              </GlassCard>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No announcements.</p>}
      </div>
    </div>
  );
}

function MSMEDash() {
  const { profile } = useApp();
  const town = muniOf(profile?.municipality);
  const townName = town ? MUNI_NAME[town] : "";
  const navItems = [
    { label: "Overview", icon: BarChart2, id: "overview" },
    { label: "Business Profile", icon: Building2, id: "business" },
    { label: "My Products", icon: Package, id: "products" },
    { label: "Transactions", icon: DollarSign, id: "transactions" },
    { label: "Settings", icon: Settings, id: "settings" },
  ];

  return (
    <DashboardLayout title={townName ? `${townName} (Laguna) — MSME Portal` : "MSME Portal"} navItems={navItems}>
      {(active, setActive) => {
        if (active === "overview") return <MSMEOverview />;
        if (active === "business") return <MSMEProfile />;
        if (active === "products") return <MSMEProducts gotoBusiness={() => setActive("business")} />;
        if (active === "transactions") return <MSMETransactions />;
        if (active === "settings") return <ProfileSettings />;
        return <PlaceholderView title={active} />;
      }}
    </DashboardLayout>
  );
}

function useMyMSME() {
  const { authUser } = useApp();
  const [msme, setMSME] = useState<MSME | null>(null);
  useEffect(() => {
    if (!authUser) return;
    supabase.from("msmes").select("*").eq("owner", authUser.id).single().then(({ data }) => setMSME(data));
  }, [authUser]);
  return msme;
}

function MSMEProfile() {
  const { authUser, profile } = useApp();
  const town = muniOf(profile?.municipality);
  const townName = town ? MUNI_NAME[town] : "";
  const [msme, setMSME] = useState<any | null>(null);
  const [payment, setPayment] = useState<any | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [form, setForm] = useState({ business_name: "", category: "", description: "", logo: "", contact_number: "", address: "" });
  const [pay, setPay] = useState({ method: "GCash", reference: "", amount: 0 });

  const load = useCallback(async () => {
    if (!authUser) return;
    const { data } = await supabase.from("msmes").select("*").eq("owner", authUser.id).maybeSingle();
    setMSME(data);
    if (data) {
      setForm({ business_name: data.business_name || "", category: data.category || "", description: data.description || "", logo: data.logo || "", contact_number: data.contact_number || "", address: data.address || "" });
      const { data: payRow } = await supabase.from("registration_payments").select("*").eq("msme_id", data.id).maybeSingle();
      setPayment(payRow);
      setPay(p => ({ ...p, amount: Number(payRow?.amount ?? data.registration_fee ?? 0) }));
    }
    setLoaded(true);
  }, [authUser]);

  useEffect(() => { load(); }, [load]);

  const handleLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file."); return; }
    const reader = new FileReader();
    reader.onload = () => setForm(p => ({ ...p, logo: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!authUser) return;
    if (!form.business_name.trim()) { toast.error("Business name is required."); return; }
    setSaving(true);
    const payload: any = {
      owner: authUser.id,
      business_name: form.business_name.trim(),
      category: form.category.trim() || null,
      description: form.description.trim() || null,
      logo: form.logo || null,
      contact_number: form.contact_number.trim() || null,
      address: form.address.trim() || null,
      municipality: town ?? null,
      registration_code: msme?.registration_code || `MB-${(BigInt(Date.now()).toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase()}`,
    };
    if (msme) {
      const { data, error } = await supabase.from("msmes").update(payload).eq("id", msme.id).select().maybeSingle();
      if (error) toast.error(error.message);
      else if (data) { setMSME(data); toast.success("Business profile updated!"); }
    } else {
      const { data, error } = await supabase.from("msmes").insert([{ ...payload, status: "pending" }]).select().maybeSingle();
      if (error) toast.error(error.message || "Could not register business.");
      else if (data) { setMSME(data); toast.success("Business registration submitted for LGU approval — you can update details anytime."); }
    }
    setSaving(false);
  };

  const resubmit = async () => {
    if (!msme) return;
    setSaving(true);
    const { error } = await supabase.from("msmes").update({ status: "pending" }).eq("id", msme.id);
    if (error) toast.error(error.message);
    else { setMSME({ ...msme, status: "pending" }); toast.success("Re-submitted for LGU approval."); }
    setSaving(false);
  };

  const payFee = async () => {
    if (!authUser || !msme) return;
    if (!pay.reference.trim()) { toast.error("Enter your payment reference number."); return; }
    setPaying(true);
    const receipt = payment?.receipt_no || `RC-${(BigInt(Date.now()).toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase()}`;
    const payload = { msme_id: msme.id, amount: pay.amount, method: pay.method, status: "paid", reference: pay.reference.trim(), receipt_no: receipt, paid_at: new Date().toISOString() };
    const { error, data } = payment
      ? await supabase.from("registration_payments").update(payload).eq("id", payment.id).select().maybeSingle()
      : await supabase.from("registration_payments").insert([payload]).select().maybeSingle();
    if (error) { toast.error(error.message); setPaying(false); return; }
    setPayment(data);
    const { error: e2 } = await supabase.from("msmes").update({ status: "registered" }).eq("id", msme.id);
    if (!e2) setMSME(prev => prev ? { ...prev, status: "registered" } : prev);
    setPaying(false);
    toast.success("Payment recorded! Your e-receipt is below.");
  };

  const statusBadge = () => {
    if (!msme) return null;
    const map: Record<string, { label: string; variant: "warning" | "success" | "danger" | "info" }> = {
      pending: { label: "Pending LGU Approval", variant: "warning" },
      approved: { label: "Approved — Pay Registration Fee", variant: "info" },
      registered: { label: "Active & Registered", variant: "success" },
      rejected: { label: "Rejected by LGU", variant: "danger" },
    };
    const s = map[msme.status] || { label: msme.status, variant: "default" as const };
    return <Badge variant={s.variant}>{s.label}</Badge>;
  };

  if (!loaded) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-bold font-[Outfit] text-xl text-foreground">Business Profile</h3>
        {statusBadge()}
        {town && <Badge variant="info"><Landmark className="w-3 h-3 mr-1 inline" /> {townName}, Laguna</Badge>}
      </div>

      {msme?.status === "pending" && (
        <GlassCard className="p-4 border-amber-500/40 bg-amber-500/5 flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-foreground/90">
            <p className="font-semibold">Registration awaiting LGU approval</p>
            <p className="text-muted-foreground text-xs mt-0.5">Once approved, you'll be asked to settle your registration fee to go live. Reg. code: <span className="font-mono">{msme.registration_code}</span></p>
          </div>
        </GlassCard>
      )}
      {msme?.status === "rejected" && (
        <GlassCard className="p-4 border-red-500/40 bg-red-500/5 flex items-start gap-3">
          <X className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-foreground/90">
            <p className="font-semibold">Application rejected by the LGU</p>
            <p className="text-muted-foreground text-xs mt-0.5">Update your business details below and resubmit for a fresh review.</p>
            <Btn size="sm" variant="outline" className="mt-2" onClick={resubmit} disabled={saving}>Resubmit for Approval</Btn>
          </div>
        </GlassCard>
      )}

      {msme?.status === "approved" && (
        <GlassCard className="p-5 border-primary/40 bg-primary/5">
          <div className="flex items-start gap-3">
            <Wallet className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-bold font-[Outfit] text-foreground">Settle your registration fee</h4>
              <p className="text-sm text-muted-foreground mt-0.5">
                Your business is approved by the LGU. Pay the registration fee of <b className="text-foreground">₱{(msme.registration_fee || pay.amount || 0).toLocaleString()}</b> to activate your stall listing &amp; products.
              </p>
              {(!msme.registration_fee && !pay.amount) && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">The LGU hasn't posted a fee yet — check back shortly or contact them.</p>}
              <div className="grid sm:grid-cols-3 gap-3 mt-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Payment Method</label>
                  <select value={pay.method} onChange={e => setPay(p => ({ ...p, method: e.target.value }))}
                    className="bg-input-background border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                    {["GCash", "Maya / PayMaya", "Bank Transfer", "Over-the-Counter", "Bank Deposit"].map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">Reference / Transaction No. *</label>
                  <Input placeholder="e.g. GCash ref 1234 5678 901" value={pay.reference} onChange={v => setPay(p => ({ ...p, reference: v }))} />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Btn size="sm" onClick={payFee} disabled={paying || (!msme.registration_fee && !pay.amount)} icon={CheckCircle}>
                  {paying ? "Recording…" : "I've Paid — Submit Payment"}
                </Btn>
              </div>
              <p className="text-xs text-muted-foreground mt-3">Proof of payment will be verified by the LGU in their MSME panel.</p>
            </div>
          </div>
        </GlassCard>
      )}

      {msme?.status === "registered" && payment?.status === "paid" && (
        <GlassCard className="p-5 border-green-500/40 bg-green-500/5">
          <div className="flex items-start gap-3">
            <Receipt className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-bold font-[Outfit] text-foreground">Official Receipt — Registration Fee</h4>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mt-3 text-sm">
                <div className="flex justify-between border-b border-border/50 pb-1"><span className="text-muted-foreground">Receipt No.</span><span className="font-mono text-foreground">{payment.receipt_no}</span></div>
                <div className="flex justify-between border-b border-border/50 pb-1"><span className="text-muted-foreground">Business</span><span className="text-foreground font-medium">{msme.business_name}</span></div>
                <div className="flex justify-between border-b border-border/50 pb-1"><span className="text-muted-foreground">Amount</span><span className="font-mono text-foreground">₱{Number(payment.amount).toLocaleString()}</span></div>
                <div className="flex justify-between border-b border-border/50 pb-1"><span className="text-muted-foreground">Method</span><span className="text-foreground">{payment.method}</span></div>
                <div className="flex justify-between border-b border-border/50 pb-1"><span className="text-muted-foreground">Reference</span><span className="font-mono text-foreground">{payment.reference}</span></div>
                <div className="flex justify-between border-b border-border/50 pb-1"><span className="text-muted-foreground">Paid On</span><span className="font-mono text-foreground">{payment.paid_at?.slice(0, 10) || payment.created_at?.slice(0, 10)}</span></div>
              </div>
              <div className="flex gap-2 mt-4">
                <Btn variant="outline" size="sm" icon={Printer} onClick={() => window.print()}>Print Receipt</Btn>
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      <GlassCard className="p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="relative">
            {form.logo ? (
              <img src={form.logo} alt="Logo" className="w-20 h-20 rounded-2xl object-cover" />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center"><Building2 className="w-9 h-9 text-primary" /></div>
            )}
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
          <Input label="Business Name *" placeholder="Elena's Delicacies" value={form.business_name} onChange={v => setForm(p => ({ ...p, business_name: v }))} icon={Building2} />
          <Input label="Category" placeholder="Food & Delicacies" value={form.category} onChange={v => setForm(p => ({ ...p, category: v }))} />
          <Input label="Contact Number" placeholder="09xx-xxx-xxxx" value={form.contact_number} onChange={v => setForm(p => ({ ...p, contact_number: v }))} icon={Phone} />
          <Input label="Address / Barangay & Town" placeholder="Brgy. ___ , Bay, Laguna" value={form.address} onChange={v => setForm(p => ({ ...p, address: v }))} icon={MapPin} />
        </div>
        <div className="flex flex-col gap-1.5 mt-4">
          <label className="text-sm font-medium text-foreground">Description</label>
          <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            rows={3} placeholder="Tell tourists what your business offers…"
            className="w-full bg-input-background border border-border rounded-xl py-2.5 px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all" />
        </div>
        <div className="flex gap-2 mt-5">
          <Btn onClick={save} disabled={saving} icon={CheckCircle}>{saving ? "Saving…" : msme ? "Save Changes" : "Submit Registration"}</Btn>
        </div>
        {!msme && <p className="text-xs text-muted-foreground mt-3">Registering your business in {townName || "your municipality"} adds you to the festival directory. The LGU will review, then you'll pay a one-time registration fee to go live with products.</p>}
      </GlassCard>
    </div>
  );
}

function MSMEOverview() {
  const msme = useMyMSME() as any;
  const [stats, setStats] = useState({ products: 0, published: 0, revenue: 0, transactions: 0 });
  const [week, setWeek] = useState<{ day: string; sales: number }[]>([]);

  useEffect(() => {
    if (!msme) { setWeek(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => ({ day, sales: 0 }))); return; }
    Promise.all([
      supabase.from("products").select("*").eq("msme_id", msme.id),
      supabase.from("redeemed_rewards").select("id", { count: "exact", head: true }).eq("msme_id", msme.id),
    ]).then(([prod, rd]) => {
      const products = (prod.data as any[]) || [];
      const revenue = products.reduce((sum, p) => sum + (Number(p.price) || 0) * (Number(p.stock) || 0), 0);
      setStats({ products: products.length, published: products.filter(p => p.approved).length, revenue, transactions: rd.count || 0 });
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      setWeek(days.map((day, i) => ({ day, sales: products.length ? Math.round(revenue * (0.5 + (i * 0.15) % 0.5)) : 0 })));
    });
  }, [msme]);

  return (
    <div className="space-y-6">
      {msme ? (
        <GlassCard className="p-5 flex items-center gap-4">
          {msme.logo ? (
            <img src={msme.logo} alt={msme.business_name} className="w-12 h-12 rounded-2xl object-cover" />
          ) : (
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center"><Building2 className="w-6 h-6 text-primary" /></div>
          )}
          <div>
            <h3 className="font-bold font-[Outfit] text-foreground text-lg">{msme.business_name}</h3>
            <p className="text-sm text-muted-foreground">{msme.description || "Your MSME business"}</p>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1">
            <Badge variant={msme.status === "registered" ? "success" : msme.status === "approved" ? "info" : msme.status === "rejected" ? "danger" : "warning"}>
              {msme.status === "registered" ? "Active" : msme.status === "pending" ? "Pending LGU" : msme.status === "approved" ? "Fee Due" : msme.status || "—"}
            </Badge>
            {msme.status !== "registered" && <p className="text-xs text-muted-foreground">Products hidden until you're live</p>}
          </div>
        </GlassCard>
      ) : (
        <GlassCard className="p-5 border-dashed text-center">
          <Building2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">No MSME profile found. Go to Business Profile to register your business.</p>
        </GlassCard>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Products" value={stats.products} icon={Package} color="bg-primary" />
        <StatCard label="Published" value={stats.published} icon={CheckCircle} color="bg-secondary" />
        <StatCard label="Inventory Value" value={`₱${stats.revenue.toLocaleString()}`} icon={DollarSign} color="bg-accent" />
        <StatCard label="Rewards Redeemed" value={stats.transactions} icon={Gift} color="bg-violet-500" />
      </div>
      <GlassCard className="p-5">
        <h3 className="font-bold font-[Outfit] text-foreground mb-4">Estimated Weekly Sales</h3>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={week}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
            <Tooltip contentStyle={{ background: "rgba(15,25,40,0.9)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px", color: "#e8f0fe" }} />
            <Area type="monotone" dataKey="sales" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </GlassCard>
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
      if (!error && data) { setProducts(prev => prev.map(p => p.id === editing.id ? data : p)); setShowForm(false); setEditing(null); toast.success("Product updated!"); }
      else toast.error("Could not update product.");
    } else {
      const { data, error } = await supabase.from("products").insert([payload]).select().single();
      if (!error && data) { setProducts(prev => [data, ...prev]); setShowForm(false); setForm({ product_name: "", price: "", stock: "", description: "", image: "" }); toast.success("Product added!"); }
      else toast.error("Could not save product.");
    }
    setSaving(false);
  };

  const remove = async (id: number) => {
    await supabase.from("products").delete().eq("id", id);
    setProducts(prev => prev.filter(p => p.id !== id));
    toast.success("Product removed.");
  };

  const fallbackImgs = ["https://images.unsplash.com/photo-1555126634-323283e090fa?w=300&h=200&fit=crop", "https://images.unsplash.com/photo-1605883705077-8d3d3cebe78c?w=300&h=200&fit=crop", "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=300&h=200&fit=crop", "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=300&h=200&fit=crop"];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-bold font-[Outfit] text-xl text-foreground">My Products</h3>
        <Btn icon={PlusCircle} size="sm" disabled={!msme} onClick={() => { setShowForm(!showForm); setEditing(null); setForm({ product_name: "", price: "", stock: "", description: "", image: "" }); }}>Add Product</Btn>
      </div>
      {msme && msme.status !== "registered" && (
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
                  <Badge variant={p.stock > 20 ? "success" : "warning"}>{p.stock} in stock</Badge>
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
    QRCode.toDataURL(generated.code, { width: 320, margin: 2, color: { dark: "#000000", light: "#ffffff" } })
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

function MSMETransactions() {
  const msme = useMyMSME() as any;
  const [txs, setTxs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!msme) { setLoading(false); return; }
    supabase.from("redeemed_rewards").select("*, products(product_name, price), rewards(reward_name, image), profiles!tourist_id(fullname)").eq("msme_id", msme.id).order("redeemed_at", { ascending: false }).then(({ data }) => {
      setTxs((data as any) || []);
      setLoading(false);
    });
  }, [msme]);

  return (
    <div className="space-y-5">
      <h3 className="font-bold font-[Outfit] text-xl text-foreground">Transaction History</h3>
      <p className="text-sm text-muted-foreground -mt-3">Reward items from your business redeemed by tourists during the festival.</p>
      {loading ? <div className="flex justify-center py-20"><Spinner /></div> : txs.length === 0 ? (
        <GlassCard className="p-12 text-center"><DollarSign className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">No redemptions yet. Reward redemptions for your items will show up here.</p></GlassCard>
      ) : (
        <GlassCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-border">{["Tourist", "Item", "Value", "Redeemed On"].map(h => <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase px-4 py-3">{h}</th>)}</tr></thead>
              <tbody>
                {txs.map(t => (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 text-sm text-foreground">{t.profiles?.fullname || "—"}</td>
                    <td className="px-4 py-3 text-sm text-foreground">
                      <div className="flex items-center gap-2">
                        {t.products?.image || t.rewards?.image
                          ? <img src={t.products?.image || t.rewards?.image} alt="" className="w-8 h-8 rounded-lg object-cover" />
                          : <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Gift className="w-4 h-4 text-primary" /></div>}
                        <span>{t.rewards?.reward_name || t.products?.product_name || "—"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-muted-foreground">₱{Number(t.products?.price || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{t.redeemed_at?.slice(0, 16).replace("T", " ") || t.created_at?.slice(0, 16)}</td>
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
    supabase.from("attendance_logs").select("*, attendance_qr(qr_code, label)").eq("tourist_id", authUser.id).order("scan_date", { ascending: false }).then(({ data }) => {
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
  const stamped = new Set(logs.map(l => l.scan_date));
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
        <StatCard label="Events Saved" value={stats.saved} icon={Heart} color="bg-rose-500" />
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
                <p className="text-xs text-muted-foreground">{e.start_time?.slice(0, 10)} • {e.venue}</p>
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
                  <p className="text-sm text-muted-foreground">{e.festivals?.title} • {e.start_time?.slice(0, 10)}</p>
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

  useEffect(() => {
    supabase.from("msmes").select("*, products(id, product_name, price, image, approved)").eq("status", "registered").then(({ data }) => {
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
        <GlassCard className="p-12 text-center"><Building2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" /><p className="text-muted-foreground">No registered MSMEs in this town yet.</p></GlassCard>
      ) : (
        <div className="grid sm:grid-cols-2 gap-5">
          {filtered.map((m: any, i) => {
            const live = (m.products || []).filter((p: any) => p.approved);
            return (
              <GlassCard key={m.id} className="overflow-hidden">
                <div className="relative h-32">
                  <img src={m.logo || photos[i % photos.length]} alt={m.business_name} className="w-full h-full object-cover" />
                  {m.municipality && (
                    <div className="absolute top-2 left-2"><Badge variant="info"><Landmark className="w-3 h-3 mr-1 inline" />{MUNI_NAME[m.municipality] || "Laguna"}</Badge></div>
                  )}
                </div>
                <div className="p-4">
                  <h4 className="font-bold font-[Outfit] text-foreground">{m.business_name}</h4>
                  <p className="text-sm text-muted-foreground mt-1">{m.description || "Local MSME partner"}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <p className="text-xs text-muted-foreground font-mono">{live.length} product{live.length === 1 ? "" : "s"} on sale</p>
                    {m.contact_number && <p className="text-xs text-muted-foreground font-mono flex items-center gap-1"><Phone className="w-3 h-3" />{m.contact_number}</p>}
                  </div>
                  {live.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-2">
                      {live.map((p: any) => (
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
            );
          })}
        </div>
      )}
    </div>
  );
}

function TouristRewards() {
  const { authUser } = useApp();
  const { totalDays } = useAttendance();
  const [rewards, setRewards] = useState<Reward[]>(FALLBACK_REWARDS);
  const [redeemed, setRedeemed] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authUser) { setLoading(false); return; }
    Promise.all([
      supabase.from("rewards").select("*"),
      supabase.from("redeemed_rewards").select("reward_id").eq("tourist_id", authUser.id),
    ]).then(([r, rd]) => {
      if (r.data?.length) setRewards(r.data);
      setRedeemed((rd.data || []).map((x: any) => x.reward_id));
      setLoading(false);
    });
  }, [authUser]);

  const redeem = async (reward: Reward) => {
    if (!authUser) return;
    if (totalDays < (reward.required_days ?? 1)) { toast.error("Not enough attendance days yet."); return; }
    if (redeemed.includes(reward.id)) { toast.error("Already redeemed."); return; }
    const payload: any = { tourist_id: authUser.id, reward_id: reward.id, redeemed_date: new Date().toISOString() };
    if (reward.msme_id) payload.msme_id = reward.msme_id;
    if (reward.product_id) payload.product_id = reward.product_id;
    const { error } = await supabase.from("redeemed_rewards").insert([payload]);
    if (!error) {
      setRedeemed(prev => [...prev, reward.id]);
      toast.success(`Redeemed: ${reward.reward_name}! 🎉`);
    }
    else toast.error(error.message || "Could not redeem.");
  };

  const imgs = FALLBACK_REWARDS.map(r => r.image!);
  const nextMilestone = rewards
    .filter(r => (r.required_days ?? 1) > totalDays && !redeemed.includes(r.id))
    .sort((a, b) => (a.required_days ?? 1) - (b.required_days ?? 1))[0];

  return (
    <div className="space-y-5">
      <GlassCard className="p-5 bg-gradient-to-r from-primary/20 to-secondary/20">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Festival Days Attended</p>
            <p className="text-4xl font-bold font-[Outfit] text-foreground mt-1">{totalDays} <span className="text-lg text-muted-foreground font-normal">/ 15 across 3 festivals</span></p>
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
            <p className="text-xs text-muted-foreground mt-1">Scan entrance QRs during the festival to stamp each day you attend.</p>
          </div>
        )}
      </GlassCard>

      {loading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
          {rewards.map((r, i) => {
            const days = r.required_days ?? 1;
            const isRedeemed = redeemed.includes(r.id);
            const canRedeem = totalDays >= days;
            const pct = Math.min((totalDays / days) * 100, 100);
            return (
              <GlassCard key={r.id} className={`overflow-hidden ${isRedeemed ? "opacity-60" : ""}`}>
                <div className="h-32"><img src={r.image || imgs[i % imgs.length]} alt={r.reward_name} className="w-full h-full object-cover" /></div>
                <div className="p-4">
                  <h4 className="font-semibold text-foreground font-[Outfit] mb-1">{r.reward_name}</h4>
                  <p className="text-xs text-muted-foreground mb-3">{r.description || `${days} days of festival attendance`}</p>
                  <div className="flex items-center gap-1 mb-2">
                    <Stamp className="w-3.5 h-3.5 text-primary" />
                    <span className="text-sm font-mono font-semibold text-accent">{days} {days === 1 ? "day" : "days"}</span>
                  </div>
                  <div className="bg-muted/50 rounded-full h-1.5 mb-3">
                    <div className="bg-gradient-to-r from-primary to-secondary h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <Btn size="sm" variant={isRedeemed ? "outline" : canRedeem ? "primary" : "outline"} onClick={() => !isRedeemed && redeem(r)} className="w-full justify-center">
                    {isRedeemed ? "Redeemed ✓" : canRedeem ? "Redeem" : `${days - totalDays} more day${days - totalDays === 1 ? "" : "s"}`}
                  </Btn>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TouristQRScanner() {
  const { authUser } = useApp();
  const { totalDays, load: reloadAttendance } = useAttendance();
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; detail?: string } | null>(null);
  const [sampleCodes, setSampleCodes] = useState<{ code: string; label: string }[]>([]);

  useEffect(() => {
    supabase.from("attendance_qr").select("qr_code, label").limit(3).then(({ data }) => {
      setSampleCodes((data || []).map((x: any) => ({ code: x.qr_code, label: x.label || "Entrance QR" })));
    });
  }, []);

  const scan = async () => {
    if (!code.trim()) { toast.error("Enter a QR code."); return; }
    if (!authUser) { toast.error("Please login."); return; }
    setScanning(true);
    const value = code.trim().toUpperCase();
    const { data: qr } = await supabase.from("attendance_qr").select("*").eq("qr_code", value).maybeSingle();
    if (!qr) {
      setResult({ success: false, message: "Invalid QR code." });
      toast.error("QR code not found. Make sure it was issued by the LGU for this festival.");
      setScanning(false);
      return;
    }
    const scanDate = todayStr();
    const { error } = await supabase.from("attendance_logs").insert([{
      tourist_id: authUser.id,
      qr_id: qr.id,
      festival_id: qr.festival_id,
      scan_date: scanDate,
    }]);
    if (error) {
      setResult({ success: false, message: "Already stamped for today", detail: "One scan per QR per day — come back tomorrow or try another station." });
      toast.error("You've already stamped this QR today.");
    } else {
      setResult({ success: true, message: `Day stamped! (+1)` });
      toast.success("Attendance recorded — your stamp card is updated!");
      reloadAttendance();
    }
    setScanning(false);
  };

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
        <Input placeholder="Enter QR code (e.g. FLGU-BAYENOS-ABC123)" value={code} onChange={v => { setCode(v); setResult(null); }} icon={ScanLine} />
        <Btn onClick={scan} disabled={scanning} className="w-full justify-center mt-3" icon={QrCode} size="lg">
          {scanning ? "Verifying…" : "Stamp Attendance"}
        </Btn>
        <p className="text-xs text-muted-foreground mt-3">Scan the QR at any festival entrance to stamp that day on your card.</p>
        {sampleCodes.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border">
            <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><Lightbulb className="w-3.5 h-3.5" />Try a sample code:</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {sampleCodes.map(s => (
                <button key={s.code} onClick={() => { setCode(s.code); setResult(null); }}
                  className="px-3 py-1.5 rounded-lg bg-muted/60 hover:bg-primary/10 text-xs font-mono text-foreground/80 hover:text-primary transition-colors">
                  {s.code}
                </button>
              ))}
            </div>
          </div>
        )}
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
      supabase.from("msmes").select("id, business_name, municipality").eq("status", "registered"),
    ]).then(([f, m]) => {
      if ((f as any).data?.length) setFestivals((f as any).data);
      setMSMEs((m as any).data || []);
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
              {muniMSMEs.length === 0 && <p className="text-xs text-muted-foreground">No registered MSMEs in this town yet.</p>}
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
    if (!resetFlowActive) setView(roleToView(metaRole));

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
      if (!resetFlowActive) setView(roleToView(data.role));
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

  const isPublic = ["home", "about", "events", "msmes", "guide", "contact", "login", "register", "forgot-password"].includes(view);
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
      <Toaster richColors position="top-right" />
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
            </motion.div>
          </AnimatePresence>
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
