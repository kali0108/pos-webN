// supabase/functions/_shared/cors.ts
//
// Supabase Edge Functions do NOT get CORS headers automatically —
// unlike the Data API (PostgREST), which Supabase forces to allow any
// origin at the proxy level. Every Edge Function invoked directly
// from the browser (as both create-staff-user and update-staff-password
// are, via fetch()) needs to handle the CORS preflight itself, or the
// browser blocks the request before it reaches the function at all.
//
// '*' is fine here: these functions already authenticate the caller
// via their JWT and check has_permission('staff.manage') internally —
// the protection is the permission check, not the request's origin.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
