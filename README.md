<div align="center">
<h1>🎓 Gurukul: School Fees Management System</h1>
<p><b>Delhi Republic School</b> — A comprehensive, modern application for managing educational institution finances, student dues, and fee collections.</p>
</div>

## 📌 Product Overview

**Gurukul** is a modular web application designed to help **Delhi Republic School** effortlessly manage its fee structures, student enrollments, payment processing, and financial reporting. 

Built with a modern serverless architecture, it replaces manual ledger entries with automated due generation, dynamic payment allocations via Razorpay, and real-time dashboard analytics.

## ✨ Key Features

- **📊 Financial Dashboard**: Real-time overview of total students, current month's collections, monthly generated dues, and aggregated overdue amounts.
- **🏫 Class & Fee Management**: 
  - Manage classes and configure versatile fee structures (e.g., Tuition, Admission, Transport).
  - Define custom frequencies: **Monthly, Quarterly, or Yearly**.
  - Map default fee structures to specific classes for rapid onboarding.
- **👨‍🎓 Student Profiles**: Register students, track parent details, and automatically assign annual dues based on class-specific fee configurations.
- **💳 Payment Processing**: 
  - **Razorpay Integration**: Native support for online payments with automated verification and receipt generation.
  - Granular fee allocations: Split a single transaction across multiple unpaid or partially paid dues securely.
  - Dynamic status tracking from `unpaid` to `partial` to `paid`.
- **📑 Detailed Reports**: Export and visualize real-time defaulters' lists and transaction histories, filterable by date.

## 🛠️ Technology Stack

### Frontend
- **Framework**: React 19 + React Router v7.
- **Build Tool**: Vite 6 (standard setup).
- **Styling**: Tailwind CSS v4.
- **State & Forms**: React Hook Form + Zod for runtime validation.
- **UI & Animations**: Lucide React (icons), Recharts (data visualization), and Framer Motion.

### Backend & Database
- **Platform**: Supabase (PostgreSQL).
- **Logic**: Supabase Edge Functions (Deno) for secure payment processing (Razorpay order creation and verification).
- **Scripts**: Written in TypeScript using Native Node.js ESM.

## 🚀 Run Locally

### Prerequisites
- Node.js (v22.14.0+)
- Supabase CLI (if managing local functions)
- A Supabase Project

### Setup Instructions

1. **Clone the repository and install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Variables:**
   Create a `.env.local` file in the root and add your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

3. **Database Schema:**
   The database schema is located in `supabase/schema.sql`. You can apply this to your Supabase project via the SQL Editor or CLI.

4. **Edge Functions:**
   Deploy the Razorpay Edge Functions:
   ```bash
   supabase functions deploy razorpay-create-order
   supabase functions deploy razorpay-verify
   ```

5. **Start the Development Server:**
   ```bash
   npm run dev
   ```
   > The app will be available at `http://localhost:5173` (default Vite port).

## 📂 Architecture Note
This project follows a modern serverless architecture. The React frontend interacts directly with the Supabase REST API for data and invokes Supabase Edge Functions for sensitive operations like payment processing. There is no traditional Express server; all backend logic is either handled by Supabase's RLS and storage or via decoupled serverless functions.
