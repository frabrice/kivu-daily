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
    const hour = new Date().getHours();

    // Determine reminder type based on time
    const reminderType = hour < 14 ? "midday" : "afternoon";
    const urgencyMessage = hour < 14
      ? "You still have time to complete your tasks today!"
      : "The day is winding down - time to push through!";

    // Get all active users with unfinished task reminders enabled
    const { data: usersWithReminders, error: prefsError } = await supabase
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
      .eq("unfinished_task_reminders", true)
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
      noTasks: 0,
      errors: 0,
    };

    for (const pref of usersWithReminders || []) {
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

      // Get today's unfinished tasks
      const { data: tasks } = await supabase
        .from("tasks")
        .select("id, title, completed")
        .eq("user_id", profile.id)
        .eq("date", today);

      const allTasks = tasks || [];
      const unfinishedTasks = allTasks.filter((t) => !t.completed);
      const completedTasks = allTasks.filter((t) => t.completed);

      // Skip if no tasks or all completed
      if (allTasks.length === 0) {
        results.noTasks++;
        continue;
      }

      if (unfinishedTasks.length === 0) {
        continue;
      }

      const firstName = profile.full_name?.split(" ")[0] || "Team Member";
      const completionPct = allTasks.length > 0 ? Math.round((completedTasks.length / allTasks.length) * 100) : 0;

      // Build task list HTML
      const tasksHtml = unfinishedTasks.map((t) => `
        <div class="task-item" style="display: flex; align-items: center; gap: 8px;">
          <span style="color: #f97316; font-size: 16px;">○</span>
          <span>${t.title}</span>
        </div>
      `).join("");

      const html = `
        <div class="greeting">Hi ${firstName},</div>
        <div class="content">
          <p>${urgencyMessage}</p>
          <p>You have <strong class="warning">${unfinishedTasks.length} unfinished task${unfinishedTasks.length > 1 ? 's' : ''}</strong> for today.</p>
        </div>

        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-number" style="color: #f97316;">${unfinishedTasks.length}</div>
            <div class="stat-label">Unfinished Tasks</div>
          </div>
          <div class="stat-box">
            <div class="stat-number" style="color: ${completionPct >= 50 ? '#16a34a' : '#ef4444'};">${completionPct}%</div>
            <div class="stat-label">Completion Rate</div>
          </div>
        </div>

        <div class="task-list">
          <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #888;">Tasks to complete:</h3>
          ${tasksHtml}
        </div>

        ${hour >= 14 && unfinishedTasks.length > 0 ? `
          <div style="margin-top: 16px; padding: 12px; background: #fef3c7; border-radius: 8px; border-left: 4px solid #f97316;">
            <p style="margin: 0; font-size: 13px;"><strong>⏰ Reminder:</strong> Unfinished tasks will be carried over to tomorrow. Complete what you can!</p>
          </div>
        ` : ''}

        <div style="text-align: center; margin-top: 24px;">
          <a href="${appUrl}" class="button">Complete Your Tasks</a>
        </div>

        <div class="content" style="margin-top: 20px;">
          <p style="font-size: 13px; color: #666;">💡 <strong>Tip:</strong> Focus on one task at a time. Small progress is still progress!</p>
        </div>
      `;

      const subject = hour < 14
        ? `⏰ Midday check: ${unfinishedTasks.length} task${unfinishedTasks.length > 1 ? 's' : ''} remaining - Kivu Daily`
        : `⚠️ Last call: ${unfinishedTasks.length} unfinished task${unfinishedTasks.length > 1 ? 's' : ''} - Kivu Daily`;

      const result = await sendEmail(
        email,
        subject,
        html,
        profile.id,
        "unfinished_tasks"
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
        message: "Unfinished task reminders processed",
        reminderType,
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
