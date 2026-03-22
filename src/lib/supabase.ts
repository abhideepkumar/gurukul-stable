import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!rawUrl) {
  throw new Error('Missing VITE_SUPABASE_URL in .env.local');
}
if (!supabaseAnonKey || supabaseAnonKey === 'your-anon-public-key-here') {
  throw new Error(
    'Missing VITE_SUPABASE_ANON_KEY in .env.local — copy it from your Supabase dashboard → Settings → API'
  );
}

// Derive the HTTPS REST URL from either:
//   "https://xxx.supabase.co"         ← correct format
//   "postgresql://...@db.xxx.supabase.co:5432/postgres"  ← postgres URI (wrong for supabase-js)
function resolveSupabaseUrl(url: string): string {
  if (url.startsWith('https://')) return url;

  // Extract project ref from postgres URI: db.<ref>.supabase.co
  const match = url.match(/db\.([a-z0-9]+)\.supabase\.co/);
  if (match) {
    return `https://${match[1]}.supabase.co`;
  }

  throw new Error(
    `Invalid VITE_SUPABASE_URL format. Expected: https://<ref>.supabase.co\nGot: ${url}`
  );
}

const supabaseUrl = resolveSupabaseUrl(rawUrl);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
