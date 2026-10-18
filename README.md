# Gurukul — School Fee Management System

A full-featured, production-grade school fee management system built entirely on **React + Supabase** — no dedicated backend server required. Designed to maximize the Supabase Free Tier while serving 1,000+ students.

---

## Features

| Module | Capabilities |
|---|---|
| **Dashboard** | Real-time collection, dues, and overdue totals |
| **Students** | Add, edit, delete, bulk CSV import with old dues |
| **Classes** | Manage class sections and default fee assignments |
| **Fee Structures** | Monthly, quarterly, yearly, and one-time fee types |
| **Discounts** | Percentage & fixed discounts with priority, date-range, and exclusivity logic |
| **Payments** | Allocate payments across multiple dues; Cash, Online, Razorpay (UPI) |
| **Late Fees** | Rule-based automatic late fee generation (fixed, daily, % monthly) |
| **Reports** | Defaulters list with pending amounts; transaction history with CSV export |

---

## Architecture

```
┌─────────────────────────────────┐
│      React (Vite + TypeScript)  │  ← Frontend only, zero backend server
│  Pages → api.ts → supabase-js  │
└────────────┬────────────────────┘
             │ HTTPS + JWT
┌────────────▼────────────────────┐
│           Supabase              │
│  ┌──────────────────────────┐   │
│  │  Postgres (RPCs + Views) │   │  ← All business logic lives here
│  │  - add_student_with_dues │   │
│  │  - process_payment       │   │
│  │  - bulk_import_students  │   │
│  │  - get_dashboard_stats   │   │
│  │  - get_defaulters_report │   │
│  │  - student_summary VIEW  │   │
│  └──────────────────────────┘   │
│  ┌──────────────────────────┐   │
│  │  Row Level Security (RLS)│   │  ← All tables require authenticated session
│  └──────────────────────────┘   │
│  ┌──────────────────────────┐   │
│  │  Edge Functions (Deno)   │   │  ← Razorpay payment gateway only
│  │  - razorpay-create-order │   │
│  │  - razorpay-verify       │   │
│  └──────────────────────────┘   │
│  ┌──────────────────────────┐   │
│  │  Supabase Auth           │   │  ← Email + password admin login
│  └──────────────────────────┘   │
└─────────────────────────────────┘
```

### Design Decisions

- **No Backend Server**: All API logic is in Postgres RPCs (`SECURITY DEFINER` functions) and Supabase Edge Functions. This keeps infrastructure costs at zero.
- **RLS on All Tables**: Every table requires an authenticated session. Anonymous access is fully blocked.
- **SECURITY DEFINER RPCs**: Sensitive writes (payments, student creation) bypass RLS and are locked to `authenticated` role only — preventing direct table tampering.
- **Server-Side Aggregation**: Heavy queries (dashboard stats, defaulters report, student list with due totals) run entirely in Postgres to minimize data egress and API roundtrips.
- **Atomic Payments**: The `process_payment` RPC processes allocations in a single transaction — no partial payment states possible.
- **Razorpay TOCTOU Protection**: The `razorpay-verify` edge function atomically claims a `payment_intent` row (setting status to `processing`) before finalizing — preventing double-processing from duplicate webhook calls.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS v4 |
| UI Components | shadcn/ui (Radix UI primitives) |
| Auth | Supabase Auth (JWT) |
| Database | Supabase Postgres |
| API | Supabase JS v2 (auto-attaches JWT) |
| Edge Functions | Deno (Supabase Edge Runtime) |
| Payments | Razorpay (optional) |

---

## Supabase Free Tier Usage

At 1,000 students this system is designed to comfortably fit within the Supabase Free Tier:

| Resource | Free Limit | Estimated Usage |
|---|---|---|
| Database size | 500 MB | ~50 MB for 1k students + 1 year dues |
| API requests | 5M / month | ~200k (all heavy ops are server-side RPCs) |
| Edge Function invocations | 500k / month | ~1k (only Razorpay payments) |
| Auth MAU | 50k users | 1–10 admin users |
| Storage | 1 GB | Not used |
| Bandwidth | 5 GB | ~500 MB (views + RPCs minimize egress) |

---

## Local Development Setup

### Prerequisites

- Node.js 18+
- A Supabase project (free tier at [supabase.com](https://supabase.com))

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd gurukul2
npm install
```

### 2. Configure Environment

Copy the environment template and fill in your Supabase credentials:

```bash
# Create .env.local
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key-here
```

Find these in your Supabase Dashboard → **Project Settings → API**.

### 3. Run Development Server

```bash
npm run dev
```

---

## Supabase Setup from Scratch

### Step 1: Create a Supabase Project

1. Go to [app.supabase.com](https://app.supabase.com) → **New Project**
2. Choose a name, set a strong database password, select a region close to your users
3. Wait for the project to finish provisioning (~2 minutes)

### Step 2: Create an Admin User

1. Go to **Authentication → Users → Add User**
2. Enter the admin email and password
3. This is the login you'll use for the application

### Step 3: Run the Database Schema

Open **SQL Editor** in your Supabase dashboard and run `supabase/schema.sql` —
the single checkpoint file. It is re-runnable on older databases too.

#### Fresh Project (Recommended)

```
1. supabase/schema.sql          ← CHECKPOINT v1 — run FIRST
2. supabase/V2__search.sql      ← add if not applied yet
3. supabase/V3__families_receipts.sql
4. supabase/V4__custom_amount.sql
5. supabase/V5__admission_receipt_finalize.sql
```

**Order matters.** Run in the sequence above; each versioned file is
re-runnable (idempotent) and additive. Re-running `schema.sql` alone after
applying V-files is safe for data, but it **restores v1 function bodies** —
so if you ever re-run the checkpoint, re-run all V-files in order afterwards.

| File | Adds |
|---|---|
| `V2__search.sql` | `students.admission_no` + `phone_normalized` (+ trigger/backfill), trigram indexes, `search_students()` ranked RPC, `check_student_duplicate()`, partial unpaid-dues index |
| `V3__families_receipts.sql` | `families` + `students.family_id`, `link_siblings`/`unlink_sibling`/`get_siblings`, `receipts` + `receipt_counters` + `next_receipt_number()` (AY-scoped `RCPT-2026-27-0001`), `transactions.receipt_id`, `process_family_payment()` (atomic N-child counter payment) |
| `V4__custom_amount.sql` | `set_assignment_custom_amount()` (per-student fee override, reprices unpaid dues only), `add_student_with_dues` honors `custom_amount` |
| `V5__admission_receipt_finalize.sql` | Unique `students.admission_no` (partial index), `add_student_with_dues` + `p_admission_no` (old 7-arg signature dropped — must run after V4), `finalize_transaction_receipt()` (attaches receipt numbers to Razorpay transactions; service-role only), `student_summary` view rebuilt with `admission_no`/`phone_normalized`/`family_id` |

Future changes ship as new versioned files (`V5__*.sql`, …). Never edit an
applied file; never re-run an older file after a newer one except via the
documented re-apply order above.

> **How to run**: In Supabase Dashboard → SQL Editor → paste the file contents → click **Run (F5)**.

### Step 4: Deploy Edge Functions (Razorpay — Optional)

Only needed if you want to accept online payments via Razorpay.

#### 4a. Install Supabase CLI

```bash
npm install -g supabase
supabase login
```

#### 4b. Link Your Project

```bash
supabase link --project-ref your-project-ref
```

Find `your-project-ref` in your Supabase Dashboard URL: `https://app.supabase.com/project/your-project-ref`.

#### 4c. Set Razorpay Secrets

```bash
supabase secrets set RAZORPAY_KEY_ID=rzp_live_xxxxxx
supabase secrets set RAZORPAY_KEY_SECRET=your-secret-here
```

#### 4d. Deploy Functions

```bash
supabase functions deploy razorpay-create-order
supabase functions deploy razorpay-verify
```

#### 4e. Add Razorpay Script to index.html

The Razorpay checkout modal requires their script to be loaded. Open `index.html` and add before `</body>`:

```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

### Step 5: Configure RLS (Already Done in schema.sql)

The schema already sets up all required RLS policies. Verify by going to:
**Database → Tables → (any table) → RLS** — you should see policies for `authenticated` role.

### Step 6: Verify Setup

1. Run `npm run dev`
2. Navigate to `http://localhost:5173`
3. Log in with the admin credentials you created in Step 2
4. You should see the Dashboard with zero counts

---

## Project Structure

```
gurukul2/
├── src/
│   ├── components/
│   │   ├── CsvImportModal.tsx   # Bulk student import UI
│   │   ├── ErrorBoundary.tsx    # React error boundary
│   │   ├── Layout.tsx           # App shell & navigation
│   │   └── ui/                  # shadcn/ui components
│   ├── hooks/
│   │   └── use-debounce.ts      # Search debounce hook
│   ├── lib/
│   │   ├── api.ts               # Central data access layer (all Supabase calls)
│   │   ├── auth.tsx             # Auth context & useAuth hook
│   │   └── supabase.ts          # Supabase client initialization
│   └── pages/
│       ├── Dashboard.tsx        # Home dashboard stats
│       ├── Students.tsx         # Student management
│       ├── Classes.tsx          # Class & fee default management
│       ├── FeeStructures.tsx    # Fee structure catalog
│       ├── Discounts.tsx        # Discount rules
│       ├── LateFeeRules.tsx     # Late fee rule management
│       ├── Payments.tsx         # Payment recording & receipt
│       ├── Reports.tsx          # Defaulters & transaction reports
│       └── Login.tsx            # Auth page
├── supabase/
│   ├── schema.sql               # ★ CHECKPOINT v1 — apply FIRST
│   ├── V2__search.sql           # Ranked search + indexes (apply after checkpoint)
│   ├── V3__families_receipts.sql# Siblings + receipt-first payments
│   ├── V4__custom_amount.sql    # Per-student fee overrides
│   ├── V5__admission_receipt_finalize.sql # Admission-no uniqueness + Razorpay receipts
│   └── functions/
│       ├── razorpay-create-order/index.ts
│       └── razorpay-verify/index.ts
├── .env.local                   # Your Supabase credentials (never commit this)
├── vite.config.ts
└── README.md
```

---

## CSV Import Format

Use **Students → Import CSV** to bulk-import students. Download the template first.

| Column | Required | Notes |
|---|---|---|
| Name | ✅ | Full student name |
| Class Name | ✅ | Must match exactly an existing class name |
| Section | | e.g. `A`, `B` |
| Parent Name | | |
| Phone | | |
| Email | | |
| Old Due 1 Amount | | Numeric, e.g. `500` |
| Old Due 1 Desc | | Required if Amount is set |
| Old Due 1 Date | | `YYYY-MM-DD` format; defaults to today if blank |
| Old Due 2 Amount | | Up to 10 old dues per student |
| ... | | |

---

## Environment Variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your project URL from Supabase Dashboard → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Public anonymous key (safe to expose in browser) |

Edge function secrets (set via `supabase secrets set`, never in `.env`):

| Secret | Description |
|---|---|
| `RAZORPAY_KEY_ID` | Razorpay API key ID |
| `RAZORPAY_KEY_SECRET` | Razorpay API secret |

---

## Production Build

```bash
npm run build   # tsc --noEmit + vite build → /dist
```

Deploy the `/dist` folder to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages). No server required. `public/_headers` ships CSP + `X-Frame-Options` for Netlify/Cloudflare.

---

## Deploy to Cloudflare Pages

Dashboard → Workers & Pages → Create → Pages → connect repo:
Build command: `npm run build` · Output: `dist` · Node: `20`
Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (Production + Preview).
SPA fallback ships via `public/_redirects`, security headers via `public/_headers`
(CSP already allows Razorpay checkout + fonts). No `wrangler.toml` needed for static.

---

## Backup & Restore (Free tier has NO PITR — do this weekly)

```bash
# Weekly dump (Supabase Dashboard → Database → Backups, or via connection string):
pg_dump "$DATABASE_URL" -Fc -f gurukul_$(date +%F).dump
# Restore test to a staging project:
pg_restore -d "$STAGING_DATABASE_URL" gurukul_YYYY-MM-DD.dump
```

Keep 4 weekly dumps off-site. Before any `supabase/*.sql` run, take a manual dump. `schema.sql` is the single checkpoint — re-running it is safe.

---

## Security Notes

- All tables use **Row Level Security** — unauthenticated users can read nothing
- `SECURITY DEFINER` RPCs are explicitly locked to `authenticated` role only
- Razorpay webhook signatures are verified using **HMAC-SHA256** before any payment is recorded
- Payment intents use **atomic status transitions** to prevent double-processing
- CSV injection is neutralized in all export functions (dangerous characters are prefixed)
- Input length constraints are enforced at the database level

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Login fails | Check Supabase Auth → Users — user must exist with confirmed email |
| "Missing VITE_SUPABASE_URL" | Verify `.env.local` exists with correct values |
| Students list is empty after import | Run `schema.sql` again — `student_summary` view may not exist |
| Razorpay payment fails | Check Edge Function logs in Supabase Dashboard → Edge Functions |
| "relation student_summary does not exist" | Run the full `schema.sql` (view lives there) |
| Class not found during CSV import | Class name in CSV must exactly match a class in the system |
