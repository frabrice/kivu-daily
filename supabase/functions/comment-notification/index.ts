import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const appUrl = Deno.env.get("APP_URL") || "https://kivu-daily.app";

async function sendEmail(to: string, subject: string, html: string, userId: string, emailType: string) {
  const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      to,
      subject,
      html,
      user_id: userId,
      email_type: emailType,
    }),
  });
  return response.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json();
    const { comment_id, target_user_id, author_id, content, task_date } = body;

    if (!target_user_id || !content) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: target_user_id, content" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if target user has comment notifications enabled
    const { data: prefs } = await supabase
      .from("email_preferences")
      .select("comment_notifications")
      .eq("user_id", target_user_id)
      .maybeSingle();

    if (!prefs || !prefs.comment_notifications) {
      return new Response(
        JSON.stringify({ success: true, message: "Comment notifications disabled for this user" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get target user profile and email
    const { data: targetProfile } = await supabase
      .from("profiles")
      .select("id, full_name, email, is_active")
      .eq("id", target_user_id)
      .maybeSingle();

    if (!targetProfile || !targetProfile.is_active) {
      return new Response(
        JSON.stringify({ success: true, message: "Target user not found or inactive" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get author profile
    const { data: authorProfile } = await supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("id", author_id)
      .maybeSingle();

    // Get target user's email
    let email = targetProfile.email;
    if (!email) {
      const { data: authUser } = await supabase.auth.admin.getUserById(target_user_id);
      email = authUser?.user?.email || null;
    }

    if (!email) {
      return new Response(
        JSON.stringify({ success: true, message: "No email found for target user" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const firstName = targetProfile.full_name?.split(" ")[0] || "Team Member";
    const authorName = authorProfile?.full_name || "The Managing Director";
    const authorRole = authorProfile?.role === "managing_director"
      ? "Managing Director"
      : "Colleague";

    const truncatedContent = content.length > 200 ? content.substring(0, 200) + "..." : content;

    const html = `
      <div class="greeting">Hi ${firstName},</div>
      <div class="content">
        <p>You've received new feedback from <strong>${authorName}</strong> (${authorRole}).</p>
      </div>

      <div class="task-list" style="background: #f0f9ff; border-left: 4px solid #007BFF;">
        <p style="margin: 0 0 8px 0; font-size: 12px; color: #007BFF; font-weight: 600;">NEW FEEDBACK</p>
        <p style="margin: 0; font-size: 15px; color: #333; line-height: 1.6;">"${truncatedContent}"</p>
      </div>

      <div style="text-align: center; margin-top: 24px;">
        <a href="${appUrl}/comments" class="button">View Full Conversation</a>
      </div>

      <div class="content" style="margin-top: 20px;">
        <p style="font-size: 13px; color: #666;">Stay engaged with your tasks and keep up the great work! Feedback helps you grow and improve.</p>
      </div>
    `;

    const result = await sendEmail(
      email,
      `💬 New feedback from ${authorName} - Kivu Daily`,
      html,
      target_user_id,
      "comment_notification"
    );

    if (result.success) {
      return new Response(
        JSON.stringify({ success: true, message: "Comment notification sent" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      return new Response(
        JSON.stringify({ success: false, error: result.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
