# Pending Features — Deferred (Post-Launch)

> Tracked deliberately deferred items. Current decision: **single full-admin role, no login/edge rate-limit**. Revisit when >10 staff users or abuse observed.
> Status legend: `BACKLOG` = planned, `CONSIDER` = evaluate need first.

## 1. Auth & Access Control — BACKLOG

- [ ] **Multi-role RBAC** (`admin`, `accountant`, `viewer`)
  - Why deferred: single-school, 1–10 trusted admins; RLS currently `TO authenticated USING(true)`.
  - When to trigger: need read-only staff / Fee-collector without delete power.
  - Design: `profiles(id FK auth.users, role TEXT CHECK)` + `is_admin()` helper + replace RLS `USING(true)` with `USING(is_admin() OR ...)` per table; `ProtectedRoute` + per-route `allowedRoles` in `src/App.tsx`; RPCs check `auth.jwt()->>'role'`.
  - Files: `src/lib/auth.tsx`, `src/App.tsx`, `supabase/schema.sql` RLS block.
- [ ] **MFA (TOTP) for admins**
  - Supabase Auth MFA via `supabase.auth.mfa.*`; enroll page + challenge on `Login.tsx`.
- [ ] **Password reset / forgot flow**
  - `supabase.auth.resetPasswordForEmail()` + `/reset-password` route + email template in Supabase Dashboard.
- [ ] **Login hardening: trim/lowercase + friendly errors**
  - `Login.tsx`: `email.trim().toLowerCase()`, length checks, map Supabase errors to user-safe strings (don't leak "user not found").

## 2. Rate Limit & Abuse Protection — BACKLOG

- [ ] **Login brute-force throttle**
  - Why deferred: low user count, Supabase built-in email rate limits suffice for now.
  - Trigger: failed-login spike or public URL exposure.
  - Options: Supabase Auth rate limits → Cloudflare WAF in front of static host → Edge Function counter in `login_attempts` table.
- [ ] **Edge Function rate-limit (`razorpay-create-order`, `razorpay-verify`)**
  - Token-bucket per `user_id`/IP in Postgres (`function_calls` table) or Upstash Redis; return 429.
- [ ] **RPC abuse guard (`bulk_import_students`, `process_payment`)**
  - `pgcrypto` idempotency keys + per-minute call caps per user.

## 3. Data & Scale (evaluate after 2k+ students) — CONSIDER

- [ ] Supabase Pro + PITR (currently no point-in-time recovery on Free).
- [ ] Supabase Realtime for Dashboard / Payments (currently manual refetch).
- [ ] `pg_cron` nightly `evaluate_all_late_fees()` batch (currently on-demand per student).
- [ ] Storage bucket for receipts (signed PDF URLs) — Storage currently unused.
- [ ] Audit log table (`audit_log`) via trigger on `transactions/dues/students`.

## 4. Observability — BACKLOG

- [ ] Sentry (frontend) + Edge Function log drain.
- [ ] Central `logger.ts` replacing `console.error`; strip logs in prod build.

## 5. UX Debt — BACKLOG

- [ ] Replace all `alert()` with toast system.
- [ ] Per-section error states (lookup failure shouldn't kill whole page).
- [ ] Optimistic updates for class-defaults / discounts / late-fee rules.

## 6. Siblings + Search Follow-ups (post-V5) — BACKLOG

- [ ] **CSV import `Admission No` column** — `bulk_import_students` doesn't accept an admission number yet (Import CSV screen). Add optional column + parameter.
- [ ] **Deploy edge functions after V5** — `razorpay-verify` now calls `finalize_transaction_receipt()` to attach receipt numbers on successful online payments. Run `npx supabase functions deploy razorpay-verify` after applying V5, or Razorpay receipts fall back to transaction-ID display (no `RCPT-` number).
- [ ] **Sibling link from Add Student** — today: link after creation via the `group_add` icon on the Students list. Optionally offer "link to sibling" inline in the Add dialog.
- [ ] **Family receipt print copies** — receipt v2 prints one copy; add Office copy / Student copy split (planned with receipt v2 print work).
