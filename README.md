<div align="center">
<h1>🎓 School Fees Management System</h1>
<p>A comprehensive, full-stack application for managing educational institution finances, student dues, and fee collections.</p>
</div>

## 📌 Product Overview

The **School Fees Management System** is a modular web application designed to help educational institutions effortlessly manage their fee structures, student enrollments, payment processing, and financial reporting. 

Built with modern web technologies, it replaces manual ledger entries with automated due generation, dynamic payment allocations, and real-time dashboard analytics.

## ✨ Key Features

- **📊 Financial Dashboard**: Get a real-time overview of total students, current month's collection and generated dues, and aggregated overdue amounts.
- **🏫 Class & Fee Management**: 
  - Manage classes and configure versatile fee structures (e.g., Tuition, Admission, Transport).
  - Define custom frequencies: **Monthly, Quarterly, or Yearly**.
  - Map default fee structures to specific classes for rapid onboarding.
- **👨‍🎓 Student Profiles**: Register new students, track parent/guardian contact details, and automatically assign annual dues based on their class's fee configurations.
- **💳 Payment Processing**: 
  - Robust transaction handling with support for various native payment methods.
  - Granular fee allocations: split a single transaction across multiple unpaid or partially paid dues securely.
  - Handles **partial payments** dynamically until due statuses switch from `unpaid` to `partial` to `paid`.
- **📑 Detailed Reports**: Export and visualize real-time defaulters' lists and daily transaction histories, easily filterable by date constraints.

## 🛠️ Technology Stack

### Frontend
- **Framework**: React 19 mapped heavily with React Router v7.
- **Build Tool**: Vite 6 for rapid HMR and optimized builds.
- **Styling**: TailwindCSS v4 natively integrated.
- **State & Forms**: React Hook Form coupled with Zod for rigorous runtime validation.
- **UI & Animations**: Lucide React (icons), Recharts (data visualization), and Framer Motion (page transitions).

### Backend
- **Server**: Express.js REST API natively utilizing Node.js ESM.
- **Database**: `better-sqlite3` offering synchronous, high-performance local data storage without heavy external dependencies.
- **TypeScript**: Written entirely in strictly-typed TypeScript, executed using Node.js's native `--experimental-strip-types` runner.

## 🚀 Run Locally

**Prerequisites:** 
- Node.js (v22.6.0+ recommended for native TypeScript strip-types execution)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Variables:**
   Set the `GEMINI_API_KEY` in `.env.local` to your Gemini API key if required by AI integrations.

3. **Start the Development Server:**
   ```bash
   npm run dev
   ```
   > By default, the app initializes the SQLite memory bank `school_fees.db` at the root and starts the API/Frontend concurrently on `http://localhost:3000`.

## 📂 Architecture Note
The application runs as a cohesive monolith. In development, the backend orchestrates a Vite middleware layer to serve the React SPA dynamically. In production, the backend serves static assets directly from the `dist/` build directory.
