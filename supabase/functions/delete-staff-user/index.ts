// supabase/functions/delete-staff-user/index.ts
//
// Permanently deletes a staff login. This is different from
// deactivating (profiles.is_active = false, reversible, keeps all
// history intact) — a delete is only possible at all if the account
// has no real business history (bills, refunds, production records,
// etc. all reference profiles with a protective foreign key that
// blocks this at the database level; see
// supabase/migrations/0020_relax_log_fks_for_delete.sql for exactly
// which references were loosened and which were deliberately not).
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
    const { user_id } = await req.json();
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

    // Deletes the auth.users row; profiles cascades automatically
    // (see profiles.id's own foreign key). If this staff member has
    // any real business history (invoices.created_by, refunds, etc.),
    // Postgres rejects the whole cascade with a foreign-key error,
    // which surfaces here as updateErr/deleteErr below — deactivating
    // is the correct action for that case, not deleting.
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(user_id);
    if (deleteErr) {
      const message = String(deleteErr.message || deleteErr);
      const looksLikeHistory = /foreign key|violat|constraint/i.test(message);
      return new Response(JSON.stringify({
        error: looksLikeHistory
          ? `${targetProfile?.full_name || 'This staff member'} has existing bills, refunds, or other records and can't be permanently deleted — use Deactivate instead to remove their access while keeping those records intact.`
          : message,
      }), {
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
