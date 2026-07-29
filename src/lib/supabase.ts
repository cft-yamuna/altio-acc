import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error(
    'Missing Supabase configuration. Copy .env.example to .env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  );
}

// RLS is the server-side security boundary; never use a service-role key here.
export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
});

