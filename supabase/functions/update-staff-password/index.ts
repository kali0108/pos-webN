// supabase/functions/update-staff-password/index.ts
//
// Resets a staff member's password. Passwords are hashed and can
// never be "shown" again once set — this only ever SETS a new one,
// it doesn't retrieve the existing one (that's not something Supabase
// Auth, or any correctly-built system, can do).
//
// Deploy: supabase functions deploy update-staff-password

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

    const { user_id, password } = await req.json();
    if (!user_id || !password || String(password).length < 6) {
      return new Response(JSON.stringify({ error: "user_id and a password of at least 6 characters are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Same anti-escalation spirit as the RLS rule on permission
    // overrides: a delegated (non-owner) staff.manage holder can reset
    // other staff's passwords, but not the Owner's.
    const { data: targetProfile } = await adminClient.from("profiles").select("is_owner").eq("id", user_id).single();
    const { data: callerIsOwner } = await callerClient.rpc("is_owner");
    if (targetProfile?.is_owner && !callerIsOwner) {
      return new Response(JSON.stringify({ error: "Only the Owner can reset the Owner's password." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateErr } = await adminClient.auth.admin.updateUserById(user_id, { password });
    if (updateErr) throw updateErr;

    await adminClient.rpc("log_activity", {
      p_action: "staff.password_reset",
      p_entity_type: "profile",
      p_entity_id: user_id,
    });

    return new Response(JSON.stringify({ success: true }), {
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
