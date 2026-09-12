import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendWithResend, wrapEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { user_id } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "user_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const appUrl = Deno.env.get("APP_URL") || "https://kivu-daily.app";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role, full_name")
      .eq("id", user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "managing_director") {
      return new Response(JSON.stringify({ error: "Only the Managing Director can resend invites" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: targetProfile } = await adminClient
      .from("profiles")
      .select("id, full_name, email, force_password_change")
      .eq("id", user_id)
      .maybeSingle();

    if (!targetProfile || !targetProfile.email) {
      return new Response(JSON.stringify({ error: "User not found or has no email on file" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The user already exists (create-user made the auth account up front),
    // so a fresh 'invite' link would fail with email_exists - 'recovery' is
    // the correct type for re-sending a set-password link to an existing,
    // still-unconfirmed account.
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: targetProfile.email,
      options: { redirectTo: appUrl },
    });

    if (linkError || !linkData?.properties?.action_link) {
      return new Response(JSON.stringify({ error: linkError?.message || "Failed to generate invite link" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const actionLink = linkData.properties.action_link;
    const firstName = targetProfile.full_name.split(" ")[0];

    const html = `
      <div class="title">Your Kivu Daily invite, resent</div>
      <div class="content">
        <p class="greeting">Hi ${firstName},</p>
        <p>${callerProfile.full_name} just resent your invite to Kivu Daily, Kivu Ride's internal workspace.</p>
        <p>Click below to sign in and set your own password. This link can only be used once.</p>
      </div>
      <div style="text-align:center;">
        <a href="${actionLink}" class="button">Set Your Password</a>
      </div>
      <div class="content" style="font-size:13px; color:#888;">
        <p>If the button doesn't work, copy and paste this link into your browser:<br>${actionLink}</p>
      </div>
    `;
    const result = await sendWithResend(
      targetProfile.email,
      "Your Kivu Daily invite (resent)",
      wrapEmail(html),
      `Hi ${firstName}, set your Kivu Daily password here: ${actionLink}`
    );

    await adminClient.from("email_logs").insert({
      user_id: targetProfile.id,
      email_type: "invite_resend",
      recipient_email: targetProfile.email,
      subject: "Your Kivu Daily invite (resent)",
      status: result.success ? "sent" : "failed",
      error_message: result.error || null,
    });

    if (result.success) {
      await adminClient.from("activity_log").insert({
        actor_id: user.id,
        action: "resent an invite to " + targetProfile.full_name,
        entity_type: "profile",
        entity_id: targetProfile.id,
        entity_label: targetProfile.full_name,
      });
    }

    return new Response(
      JSON.stringify({ success: result.success, email_error: result.error ?? null }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
