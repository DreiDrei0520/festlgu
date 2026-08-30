# FestivaLGU — Complete Testing Guide

This guide covers **everything that can be tested end-to-end** after applying the
seed script: every demo account, every sample record, every function, and the
SQL to verify each result.

---

## 0. Setup (do this first)

1. Open the **Supabase Dashboard → SQL Editor** for your project.
2. Paste the full contents of `supabase-schema.sql` and click **Run**.
   The script is **idempotent** — you can re-run it at any time without
   duplicates (old builds used to duplicate `map_venues`; that is fixed).
3. After running, execute:
   ```sql
   notify pgrst, 'reload schema';
   ```
4. Start the app (`npm run dev`) and log in with any account below.

> All demo passwords are: `Festival@2025`

---

## 1. Demo Accounts (20 accounts · 5 per role group)

### Admins (5)
| Town | Role | Email | Full Name |
|---|---|---|---|
| Bay | admin | `admin@festivalglu.ph` | Admin Rivera |
| Calauan | admin | `calauan.admin@festivalglu.ph` | Aling Nena Reyes |
| Los Baños | admin | `losbanos.admin@festivalglu.ph` | Ka Mario Cruz |
| Santa Cruz | admin | `santacruz.admin@festivalglu.ph` | Benjamin Sta. Maria |
| San Pablo | admin | `sanpablo.admin@festivalglu.ph` | Fe Manalo |

### Organizers (5)
| Town | Role | Email | Full Name |
|---|---|---|---|
| Bay | organizer | `organizer@festivalglu.ph` | Carlos Mendoza |
| Calauan | organizer | `calauan.organizer@festivalglu.ph` | Rosa Villanueva |
| Los Baños | organizer | `losbanos.organizer@festivalglu.ph` | Lito Salvador |
| Santa Cruz | organizer | `santacruz.organizer@festivalglu.ph` | Diosdado Lim |
| San Pablo | organizer | `sanpablo.organizer@festivalglu.ph` | Nena Flores |

### MSME owners (5 business accounts)
| Business | Status | Email | Owner |
|---|---|---|---|
| Elena's Delicacies (Bay) | approved | `msme@festivalglu.ph` | Elena Cruz |
| Kultura Crafts (Calauan) | approved | `msme2@festivalglu.ph` | Rico Dalisay |
| Makiling Fruit & Coffee Co. (Los Baños) | approved | `msme3@festivalglu.ph` | Diana Lopez |
| Bagong Bayan Pasalubong (Bay) | **unpaid** | `msme4@festivalglu.ph` | Nilda Torres |
| Queso de San Pablo (San Pablo) | **pending** | `msme5@festivalglu.ph` | Gina Reyes |

### Tourists (5)
| Email | Full Name |
|---|---|
| `tourist@festivalglu.ph` | Maria Santos |
| `ana@festivalglu.ph` | Ana Reyes |
| `jose@festivalglu.ph` | Jose Tan |
| `lina@festivalglu.ph` | Lina Bautista |
| `kiko@festivalglu.ph` | Kiko dela Cruz |

---

## 2. Sample Data Summary (what you are testing)

| Table | Count | Notes |
|---|---|---|
| `municipalities` | 5 | Bay, Calauan, Los Baños, Santa Cruz, San Pablo |
| `festivals` | 5 | Bayeños, Bañamos, Pinya, Suman, Kesong Puti |
| `events` | 19 | 5 per festival (Bay/LB/Calauan) + 2 each for Santa Cruz & San Pablo |
| `venues` (map_venues) | 15 | 3 per festival, now with `capacity` + `qr_code_data` |
| `msmes` | 5 | 3 approved + 1 unpaid + 1 paid-pending |
| `products` | 9 | Live inventory across the 5 businesses |
| `rewards` | 5 | Milestone stamp-card rewards |
| `registration_payments` | 5 | 4 paid + 1 pending (the registration-fee flow) |
| `attendance_qr` | 5 | Station QR codes (see §4) |
| `attendance_logs` | 5 | Stamp-card history |
| `feedback` | 5 | 2 msme + 3 festival |
| `announcements` | 5 | Scoped per festival town |
| `guide_items` | 28 | Maps, transport, hotels, restaurants, emergency |

Verify with SQL (run in the SQL Editor):
```sql
select 'municipalities' t, count(*) from public.municipalities
union all select 'festivals', count(*) from public.festivals
union all select 'events', count(*) from public.events
union all select 'venues', count(*) from public.map_venues
union all select 'msmes', count(*) from public.msmes
union all select 'products', count(*) from public.products
union all select 'rewards', count(*) from public.rewards
union all select 'registration_payments', count(*) from public.registration_payments
union all select 'attendance_qr', count(*) from public.attendance_qr
union all select 'attendance_logs', count(*) from public.attendance_logs
union all select 'feedback', count(*) from public.feedback
union all select 'announcements', count(*) from public.announcements
union all select 'admins', count(*) from public.profiles where role='admin'
union all select 'organizers', count(*) from public.profiles where role='organizer'
union all select 'msme owners', count(*) from public.profiles where role='msme'
union all select 'tourists', count(*) from public.profiles where role='tourist';
```

---

## 3. Public (guest) testing

1. **Home** — hero cycles all **5 festivals**; Featured grid shows 5 cards;
   gallery + countdown point at the nearest upcoming festival (Bay, since it
   starts soonest).
2. **Festivals (About)** — "Our Festival Towns" now shows **5 towns**; stats
   read *5 Festivals / 5 Member Municipalities*.
3. **Events** — filter by festival (5 options), search, and upcoming/past tabs.
4. **Business Directory** — town filter has **5 towns**; San Pablo shows
   **Queso de San Pablo** (active).
5. **Plan Your Visit** — interactive map (lazy-loads Leaflet) with 5 town
   filters; guide sections load from `guide_items`.
6. **Contact** — 5 LGU tabs with auto-filled Tourism Office details from the
   `municipalities` table; submit a message and it appears in
   `contact_messages` (SQL: `select * from public.contact_messages order by created_at desc limit 5;`).

---

## 4. Attendance scanning (stamp card) — QR values you can actually scan

The scanner matches `qr_code` **uppercase**, so type or generate exactly these:

| QR Code | Label | Festival | Venue (event id) |
|---|---|---|---|
| `ATT-BAY-D1-MAIN` | Day 1 — Main Entrance | Bayeños | Bay Municipal Plaza (1) |
| `ATT-BAY-D2-PLAZA` | Day 2 — Municipal Plaza | Bayeños | Bay Municipal Plaza (5) |
| `ATT-LB-D1-PLAZA` | Day 1 — Town Gate | Bañamos | LB Municipal Plaza (6) |
| `ATT-LB-D2-MARKET` | Day 2 — Public Market | Bañamos | LB Public Market (7) |
| `ATT-CAL-D1-GROUNDS` | Day 1 — Municipal Grounds | Pinya | Calauan Municipal Grounds (14) |

**Test 4.1 — happy path**
1. Log in as **Maria Santos** (`tourist@festivalglu.ph`).
2. Open **Tourist Dashboard → Scan QR**.
3. Enter `ATT-BAY-D1-MAIN` → *stamped ✓*, stamp card shows **1 day**.
4. SQL: `select * from public.attendance_logs where tourist_id = (select id from auth.users where email='tourist@festivalglu.ph') and date(scan_date) = current_date;`

**Test 4.2 — duplicate rejection (same venue, same day)**
- Scan `ATT-BAY-D1-MAIN` again → *"Already stamped for today"* (no new row).

**Test 4.3 — different venue same day is fine**
- Scan `ATT-BAY-D2-PLAZA` → success. (One stamp per venue per day.)

**Test 4.4 — invalid / inactive / expired**
- Type `NOTAREALCODE` → *"QR code not found."*
- In the DB set a QR inactive: `update public.attendance_qr set status='inactive' where qr_code='ATT-LB-D2-MARKET';` then scan it → *"QR code is inactive"*. Restore with `status='active'`.

**Test 4.5 — rewards**
- Maria already has 2 past-day stamps from the seed, so after one more scan
  (e.g. `ATT-BAY-D1-MAIN`) her card shows 3 days → **Free Umbrella** becomes
  redeemable. Redeem it in **Tourist Dashboard → Rewards**.

---

## 5. MSME owner flow (pay + approval pipeline)

The seed gives you one row in **each** pipeline state:
- **Fee Due (unpaid)** — `msme4@festivalglu.ph` (Bagong Bayan)
- **Paid, awaiting approval (pending)** — `msme5@festivalglu.ph` (Queso de San Pablo)
- **Active (approved)** — `msme@`, `msme2@`, `msme3@`

**Test 5.1 — unpaid → paid**
1. Log in as `msme4@festivalglu.ph`. Dashboard shows **Fee Due · Submit Payment**.
2. Pay the ₱500 fee (e-wallet). Status flips to **Pending LGU**.
3. SQL: `select status from public.msmes where owner = (select id from auth.users where email='msme4@festivalglu.ph');` → `pending`
   and `select * from public.registration_payments where msme_id=4;` → `paid`.

**Test 5.2 — pending → approved (admin side)**
1. Log out. Log in as **Admin Rivera** (`admin@festivalglu.ph`).
2. **Dashboard → MSMEs** list shows the pending applicant (Queso de San Pablo).
3. **Verify Payment** then **Approve** → status becomes **Active & Listed**.
4. Confirm it now appears in the public **Business Directory**.

**Test 5.3 — MSME product QR codes**
- Log in as `msme@festivalglu.ph` → **QR Codes** tab → pick a product →
  **Generate QR Code** → download PNG. The code text (e.g. `FTLGU-DEMO-0001`)
  can be scanned at the booth to award points.

---

## 6. Admin functions (per-town isolation)

Every admin sees **only their town's** data (scoped via `townFestivalId` + RLS
+ app-layer filters). Verify cross-town isolation:

| Login as | Check |
|---|---|
| `admin@festivalglu.ph` | Overview says **Bay**; analytics show Bay-only counts |
| `calauan.admin@festivalglu.ph` | Overview says **Calauan**; no Bay MSMEs/events |
| `losbanos.admin@festivalglu.ph` | Overview says **Los Baños** |
| `santacruz.admin@festivalglu.ph` | Overview says **Santa Cruz** (empty dataset is expected) |
| `sanpablo.admin@festivalglu.ph` | Overview says **San Pablo**; Queso de San Pablo pending |

**Test 6.1 — overview analytics**
- Admin dashboard shows: users, active events, active MSMEs, attendance scans,
  pending/fee-due counts, registration revenue (₱), rewards redeemed, and a
  per-day attendance chart + venue pie chart (recharts lazy-chunk).

**Test 6.2 — QR codes (admin)**
1. As Bay admin, open **QR Codes**.
2. **Generate QR Code** for the Bayeños festival → new `ATT-...` code, active,
   expires on festival end date.
3. Scan it as a tourist the same way as §4 → stamp recorded against Bay.

**Test 6.3 — festivals & events CRUD**
- **Festivals**: add a duplicate title (e.g. `PINYA FESTIVAL` for Calauan) →
  blocked by DB unique index `festivals_title_uq`/duplicate guard. Titles are
  auto Title-Cased. Dates validated (start ≤ end).
- **Events**: create an event for your own festival → appears in the public
  Events page; dates use your local timezone (stored as UTC timestamptz).

**Test 6.4 — announcements & feedback**
- Post an announcement → visible on Home and to your town.
- Feedback left by tourists (unauthorized? login as tourist) lands in
  **Feedback**; ratings feed the analytics charts.

**Test 6.5 — attendance wall-clock (5:00 PM / timezone test)**
- Event times are stored UTC and shown as **local wall-clock**. Create an event
  at a chosen local time, reload, and confirm the same wall-clock time
  appears. The 5:00 PM boundary test: schedule an event at 5:00 PM local —
  it must display 5:00 PM, not an 8-hour-shifted value.

**Test 6.6 — export/copy**
- User list & MSME lists have CSV/export actions (try "Copy" button).

---

## 7. Organizer flow
- Log in as an organizer (e.g. `organizer@festivalglu.ph`).
- Manage your town's **events** only; see your town's **MSME applicants** and
  can approve/reject; post announcements. Confirms organizer ≠ admin scope.

---

## 8. Cross-cutting checks

- **Registration**: create a new **MSME** account (Register → MSME, pick any of
  the 5 towns) → business starts `unpaid`. Create a new **tourist** account →
  gets a tourist dashboard with scan card.
- **Role gating**: Register page only allows tourist/msme; admin/organizer role
  changes are normalized on every login via `profiles`.
- **Payment isolation**: As Bay admin, you never see San Pablo payments.
- **Countdown**: with all 5 festivals future-dated, countdown targets the
  nearest; delete/back-date all festivals (dev only) → "Dates to be announced"
  banner, never a negative countdown.

---

## 9. Full end-to-end story (15 min)

1. Guest: browse Home → Events → Directory (see 5 towns · 5 festivals).
2. Register `kiko@festivalglu.ph` already exists — log in as **Ana** (`ana@festivalglu.ph`).
3. **Scan QR**: `ATT-CAL-D1-GROUNDS` → stamped. Check **Rewards** progress.
4. As **Nilda** (`msme4@`): pay the ₱500 fee → pending.
5. As **Admin Rivera** (`admin@`): approve Queso de San Pablo; overview numbers update.
6. As **Calauan admin**: confirm you do **not** see Bay QR codes.
7. As **Jose** (`jose@`): leave feedback → appears in Calauan admin Feedback.
8. Re-run the count SQL in §2 — every count still matches (idempotency check).

---

## Troubleshooting

- **Forgetting the schema**: re-apply `supabase-schema.sql` **then**
  `notify pgrst, 'reload schema';` — new tables/columns (e.g.
  `map_venues.capacity`, `map_venues.qr_code_data`) won't be visible to the
  PostgREST API until the schema cache reloads.
- **Login "Email not confirmed"**: every seed account is auto-confirmed on
  re-run; if an old account was created earlier, re-running the script
  standardizes the password + confirmation.