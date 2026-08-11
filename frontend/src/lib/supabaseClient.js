import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fails loudly in dev rather than silently hitting undefined endpoints.
  console.error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy frontend/.env.example to .env.local and fill in your project values.'
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // sessionStorage, NOT localStorage: this is what keeps each
    // browser TAB logged in as its own, independent user. With
    // localStorage, every tab on the same browser shares one login —
    // signing in as a different staff member in one tab would
    // silently swap the session (and mid-load, blank out the
    // profile/permissions) in every OTHER open tab too, which is what
    // caused the admin screen to crash when someone else logged in
    // elsewhere. sessionStorage still survives a reload of the same
    // tab (so the idle-timeout logic in AuthContext.jsx still applies
    // normally), it just doesn't leak across tabs or across a fully
    // closed browser, which is the right behavior for a shared branch
    // computer where more than one person may be signed in in
    // different tabs/windows at once.
    storage: window.sessionStorage,
  },
});
