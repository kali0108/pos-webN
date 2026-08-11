import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useRealtimeRefresh } from '../lib/realtime';

const AuthContext = createContext(null);

// "Session timeout on shared branch computers": sign the user out
// after this long with no mouse/keyboard/touch activity, regardless
// of whether the Supabase JWT itself is still valid. Adjust to taste
// per store policy.
const IDLE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [branches, setBranches] = useState([]);
  const [currentBranchId, setCurrentBranchId] = useState(
    () => localStorage.getItem('pos_current_branch') || null
  );
  const [loading, setLoading] = useState(true);
  const idleTimer = useRef(null);

  const loadUserContext = useCallback(async (userId) => {
    // CRITICAL: must filter by the caller's own id. Without .eq(),
    // this query returns every profile row RLS allows the caller to
    // see — and staff.manage holders (including the Owner) can see
    // ALL staff profiles, not just their own. The moment a second
    // staff account existed, .single() started throwing "multiple
    // rows returned", profile silently stayed null forever, and any
    // page that waited on it (like Staff & Permissions) was stuck on
    // "Loading…" permanently. Filtering to exactly one row fixes it.
    if (!userId) return;
    const [{ data: profileRow }, { data: perms }, { data: myBranches }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.rpc('get_my_permissions'),
      supabase.rpc('get_my_branches'),
    ]);
    setProfile(profileRow || null);
    setPermissions(perms || {});
    setBranches(myBranches || []);
    setCurrentBranchId((prev) => {
      if (prev && myBranches?.some((b) => b.id === prev)) return prev;
      const first = myBranches?.[0]?.id || null;
      if (first) localStorage.setItem('pos_current_branch', first);
      return first;
    });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadUserContext(session.user.id).finally(() => setLoading(false));
      else setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadUserContext(session.user.id);
      else {
        setProfile(null);
        setPermissions({});
        setBranches([]);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [loadUserContext]);

  // If an admin changes THIS user's own permissions, branch
  // assignments, or active status — from another tab, another
  // device, or another admin entirely — pick it up live instead of
  // requiring this session to be manually refreshed. This is the fix
  // for "I changed someone's access and they still had the old
  // permissions until they reloaded the page".
  const myUserId = session?.user?.id;
  useRealtimeRefresh('profiles', () => loadUserContext(myUserId), myUserId ? `id=eq.${myUserId}` : undefined, !!myUserId);
  useRealtimeRefresh('user_permission_overrides', () => loadUserContext(myUserId), myUserId ? `user_id=eq.${myUserId}` : undefined, !!myUserId);
  useRealtimeRefresh('user_branches', () => loadUserContext(myUserId), myUserId ? `user_id=eq.${myUserId}` : undefined, !!myUserId);

  // Idle-timeout watcher
  useEffect(() => {
    if (!session) return;
    const resetTimer = () => {
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        supabase.auth.signOut();
      }, IDLE_LIMIT_MS);
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer();
    return () => {
      clearTimeout(idleTimer.current);
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [session]);

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password });
  const signOut = () => supabase.auth.signOut();

  const can = (permissionKey) => !!permissions[permissionKey];

  const switchBranch = (branchId) => {
    setCurrentBranchId(branchId);
    localStorage.setItem('pos_current_branch', branchId);
  };

  const value = {
    session,
    user: session?.user || null,
    profile,
    isOwner: !!profile?.is_owner,
    permissions,
    can,
    branches,
    currentBranchId,
    switchBranch,
    loading,
    signIn,
    signOut,
    refresh: () => loadUserContext(session?.user?.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
