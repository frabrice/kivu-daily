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

    const today = new Date().toISOString().slice(0, 10);

    // Get all active users with morning reminders enabled and no tasks for today
    const { data: usersNeedingReminder, error: prefsError } = await supabase
      .from("email_preferences")
      .select(`
        user_id,
        profiles!email_preferences_user_id_fkey (
          id,
          full_name,
          email,
          is_active
        )
      `)
      .eq("morning_reminder", true)
      .eq("profiles.is_active", true);

    if (prefsError) {
      console.error("Error fetching preferences:", prefsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch preferences" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = {
      sent: 0,
      skipped: 0,
      errors: 0,
    };

    for (const pref of usersNeedingReminder || []) {
      const profile = pref.profiles as { id: string; full_name: string; email: string | null; is_active: boolean };

      if (!profile || !profile.is_active) continue;

      // Get user's email from auth.users if not in profile
      let email = profile.email;
      if (!email) {
        const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
        email = authUser?.user?.email || null;
      }

      if (!email) {
        console.log(`No email for user ${profile.id}`);
        results.skipped++;
        continue;
      }

      // Check if user already has tasks for today
      const { data: todayTasks } = await supabase
        .from("tasks")
        .select("id")
        .eq("user_id", profile.id)
        .eq("date", today)
        .limit(1);

      if (todayTasks && todayTasks.length > 0) {
        // User already has tasks, skip
        results.skipped++;
        continue;
      }

      // Send morning reminder email
      const firstName = profile.full_name?.split(" ")[0] || "Team Member";
      const html = `
        <div class="greeting">Good morning, ${firstName}!</div>
        <div class="content">
          <p>It's a new day at Kivu Ride! Start your day right by adding your tasks for today.</p>
          <p>Remember, task submission is available from <strong>7:00 AM to 12:00 PM</strong>.</p>
        </div>
        <div class="task-list" style="text-align: center; padding: 24px;">
          <p style="font-size: 48px; margin: 0;">📝</p>
          <p style="font-size: 16px; color: #666; margin-top: 12px;">No tasks added yet today</p>
        </div>
        <div style="text-align: center;">
          <a href="${appUrl}" class="button">Add Your Tasks Now</a>
        </div>
        <div class="content" style="margin-top: 20px;">
          <p><strong>Tip:</strong> Set clear, achievable goals for the day. Start with your most important tasks first!</p>
        </div>
      `;

      const result = await sendEmail(
        email,
        "🌤️ Good morning! Time to plan your day - Kivu Daily",
        html,
        profile.id,
        "morning_reminder"
      );

      if (result.success) {
        results.sent++;
      } else {
        results.errors++;
        console.error(`Failed to send to ${email}:`, result.error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Morning reminders processed",
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
