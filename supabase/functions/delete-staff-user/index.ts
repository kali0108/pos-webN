// supabase/functions/delete-staff-user/index.ts
//
// Permanently deletes a staff login. Different from deactivating
// (reversible, keeps the login). The person's bills, refunds and other
// records are NOT deleted — they keep the person's name as plain text
// (see supabase/migrations/0022_archive_on_delete.sql), so accounting
// and tracking stay complete.
//
// The caller must re-enter their own password, verified here on the
// server (not just prompted for in the browser) by actually signing
// in with it against Supabase Auth.
//
// Deploy: supabase functions deploy delete-staff-user

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
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

    const { data: caller } = await callerClient.auth.getUser();
    const { user_id, password } = await req.json();

    // Server-side password re-check. A throwaway client with no
    // stored session signs in as the caller; success = right password.
    // (Supabase Auth rate-limits repeated failures on its side.)
    if (!password || !caller?.user?.email) {
      return new Response(JSON.stringify({ error: "Enter your password to confirm." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const verifier = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { error: pwErr } = await verifier.auth.signInWithPassword({ email: caller.user.email, password });
    if (pwErr) {
      return new Response(JSON.stringify({ error: "Incorrect password." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (user_id === caller?.user?.id) {
      return new Response(JSON.stringify({ error: "You can't delete your own account while signed in as it." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Same anti-escalation spirit as every other Owner-only guard in
    // this project: a delegated (non-Owner) staff.manage holder can
    // delete other staff, never the Owner.
    const { data: targetProfile } = await adminClient.from("profiles").select("is_owner, full_name, email").eq("id", user_id).single();
    const { data: callerIsOwner } = await callerClient.rpc("is_owner");
    if (targetProfile?.is_owner && !callerIsOwner) {
      return new Response(JSON.stringify({ error: "Only the Owner can delete the Owner's own account." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Deletes the auth.users row; the profile, their branch links and
    // permission overrides cascade away. Everything else that pointed
    // at this person (bills, refunds, orders, production, stock
    // records, the activity log) is kept, just disconnected — each row
    // already carries the person's name as text.
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(user_id);
    if (deleteErr) {
      return new Response(JSON.stringify({ error: String(deleteErr.message || deleteErr) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await adminClient.rpc("log_activity", {
      p_action: "staff.delete",
      p_entity_type: "profile",
      p_entity_id: user_id,
      p_details: { full_name: targetProfile?.full_name, email: targetProfile?.email },
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
