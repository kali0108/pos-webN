// supabase/functions/create-staff-user/index.ts
//
// Creates a staff login (auth user + profile + branch assignments).
// Deployed as a Supabase Edge Function so the SERVICE ROLE KEY never
// reaches the browser — this is the one operation in the whole app
// (creating another login) that the anon-key + RLS model can't do on
// its own, since only the Admin API can create auth.users rows.
//
// Deploy:  supabase functions deploy create-staff-user
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
//          are all injected automatically by the Supabase platform into
//          every Edge Function's environment — no manual secret setup
//          needed for this function to run.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  // Edge Functions don't get CORS headers automatically (unlike the
  // Data API) — without this, the browser's preflight OPTIONS request
  // would be rejected before this function's real logic ever runs,
  // regardless of what host the frontend is served from.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerToken = authHeader.replace("Bearer ", "");

    // Client scoped to the CALLER's own JWT — used only to check that
    // the caller is allowed to do this, via the same has_permission()
    // function RLS uses everywhere else. This re-uses one source of
    // truth for "who can manage staff" instead of duplicating logic.
    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${callerToken}` } } }
    );

    const { data: allowed, error: permErr } = await callerClient.rpc("has_permission", {
      perm_key: "staff.manage",
    });
    if (permErr || !allowed) {
      return new Response(JSON.stringify({ error: "Not authorized to manage staff." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, password, full_name, role_template_id, branch_ids } = await req.json();
    if (!email || !password || !full_name) {
      return new Response(JSON.stringify({ error: "email, password and full_name are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin client — service role, never exposed to the browser.
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // staff accounts don't need an email confirmation loop
      user_metadata: { full_name, role_template_id: role_template_id ?? null, is_owner: false },
    });
    if (createErr) throw createErr;

    const newUserId = created.user.id;
    // handle_new_user() trigger has already inserted the `profiles` row by now.

    if (Array.isArray(branch_ids) && branch_ids.length > 0) {
      const rows = branch_ids.map((branch_id: string) => ({ user_id: newUserId, branch_id }));
      const { error: branchErr } = await adminClient.from("user_branches").insert(rows);
      if (branchErr) throw branchErr;
    }

    await adminClient.rpc("log_activity", {
      p_action: "staff.create",
      p_entity_type: "profile",
      p_entity_id: newUserId,
      p_details: { email, full_name },
    });

    return new Response(JSON.stringify({ user_id: newUserId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
