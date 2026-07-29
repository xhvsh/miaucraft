import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// The Supabase UMD bundle (loaded via <script> in index.html) attaches a
// global `supabase` object with `.createClient`. We build our own client
// instance from it here and export that instead.
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
