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
    const { email, full_name, role, department_id } = await req.json();

    if (!email || !full_name) {
      return new Response(
        JSON.stringify({ error: "Email and full name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resolvedRole = role === "managing_director" ? "managing_director" : "employee";
    if (resolvedRole === "employee" && !department_id) {
      return new Response(
        JSON.stringify({ error: "A department is required for employees" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify the caller is the Managing Director using their JWT
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

    // Use service role to read the caller's profile (bypasses RLS)
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role, full_name")
      .eq("id", user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "managing_director") {
      return new Response(JSON.stringify({ error: "Only the Managing Director can create users" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create the user and a one-time invite link in a single call - no
    // password is ever set or seen by the MD; the new employee sets their
    // own via the emailed link.
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: {
          full_name,
          role: resolvedRole,
          department_id: resolvedRole === "employee" ? department_id : "",
        },
        redirectTo: appUrl,
      },
    });

    if (linkError || !linkData?.user) {
      return new Response(JSON.stringify({ error: linkError?.message || "Failed to create user" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newUser = linkData.user;
    const actionLink = linkData.properties?.action_link;

    if (newUser.id) {
      await adminClient.from("activity_log").insert({
        actor_id: user.id,
        department_id: resolvedRole === "employee" ? department_id : null,
        action: "created a new user",
        entity_type: "profile",
        entity_id: newUser.id,
        entity_label: full_name,
      });
    }

    let emailSent = false;
    let emailError: string | null = null;
    if (actionLink) {
      const html = `
        <div class="title">Welcome to Kivu Daily</div>
        <div class="content">
          <p class="greeting">Hi ${full_name.split(" ")[0]},</p>
          <p>${callerProfile.full_name} has set up your account on Kivu Daily, Kivu Ride's internal workspace.</p>
          <p>Click below to sign in and set your own password. This link can only be used once.</p>
        </div>
        <div style="text-align:center;">
          <a href="${actionLink}" class="button">Set Your Password</a>
        </div>
        <div class="content" style="font-size:13px; color:#888;">
          <p>If the button doesn't work, copy and paste this link into your browser:<br>${actionLink}</p>
        </div>
      `;
      const result = await sendWithResend(email, "You're invited to Kivu Daily", wrapEmail(html), `Hi ${full_name.split(" ")[0]}, set your Kivu Daily password here: ${actionLink}`);
      emailSent = result.success;
      emailError = result.error ?? null;
      await adminClient.from("email_logs").insert({
        user_id: newUser.id,
        email_type: "invite",
        recipient_email: email,
        subject: "You're invited to Kivu Daily",
        status: result.success ? "sent" : "failed",
        error_message: result.error || null,
      });
    }

    return new Response(
      JSON.stringify({ success: true, user_id: newUser.id, email_sent: emailSent, email_error: emailError }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
