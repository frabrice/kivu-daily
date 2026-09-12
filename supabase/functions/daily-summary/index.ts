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

    // Get all active users with end_day_report enabled
    const { data: usersWithReports, error: prefsError } = await supabase
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
      .eq("end_day_report", true)
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

    for (const pref of usersWithReports || []) {
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

      // Get today's tasks
      const { data: tasks } = await supabase
        .from("tasks")
        .select("id, title, completed, review_status")
        .eq("user_id", profile.id)
        .eq("date", today);

      const taskList = tasks || [];
      const totalTasks = taskList.length;
      const completedTasks = taskList.filter((t) => t.completed).length;
      const completionPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      const unfinishedTasks = taskList.filter((t) => !t.completed);

      // Get comments received today
      const { data: comments } = await supabase
        .from("comments")
        .select("id, content, author_id, profiles:author_id (full_name)")
        .eq("target_user_id", profile.id)
        .eq("task_date", today);

      const commentsReceived = comments || [];

      // Check if there were any tasks to report on
      if (totalTasks === 0 && commentsReceived.length === 0) {
        results.skipped++;
        continue;
      }

      const firstName = profile.full_name?.split(" ")[0] || "Team Member";

      // Build task list HTML
      let tasksHtml = "";
      if (totalTasks > 0) {
        tasksHtml = `
          <div class="task-list">
            <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #666;">Today's Tasks</h3>
            ${taskList.map((t) => `
              <div class="task-item" style="display: flex; align-items: center; gap: 8px;">
                <span style="color: ${t.completed ? '#16a34a' : '#f97316'};">${t.completed ? '✓' : '○'}</span>
                <span style="${t.completed ? 'text-decoration: line-through; color: #999;' : ''}">${t.title}</span>
              </div>
            `).join("")}
          </div>
        `;
      } else {
        tasksHtml = `
          <div class="task-list" style="text-align: center; padding: 20px;">
            <p style="color: #888;">No tasks added today</p>
          </div>
        `;
      }

      // Build comments HTML
      let commentsHtml = "";
      if (commentsReceived.length > 0) {
        commentsHtml = `
          <div style="margin-top: 24px;">
            <h3 style="font-size: 16px; color: #071A35; margin-bottom: 12px;">💬 Feedback Received (${commentsReceived.length})</h3>
            <div class="task-list">
              ${commentsReceived.slice(0, 3).map((c) => `
                <div class="task-item">
                  <p style="margin: 0; font-size: 13px;"><strong>${(c.profiles as { full_name: string })?.full_name || 'Managing Director'}:</strong></p>
                  <p style="margin: 4px 0 0 0; font-size: 14px; color: #555;">"${c.content.substring(0, 100)}${c.content.length > 100 ? '...' : ''}"</p>
                </div>
              `).join("")}
              ${commentsReceived.length > 3 ? `<p style="text-align: center; color: #888; font-size: 12px;">+ ${commentsReceived.length - 3} more comments</p>` : ''}
            </div>
          </div>
        `;
      }

      // Determine message based on performance
      let performanceMessage = "";
      if (completionPct === 100) {
        performanceMessage = `<p class="success" style="text-align: center; font-size: 16px;">🎉 Perfect day! You completed all your tasks!</p>`;
      } else if (completionPct >= 80) {
        performanceMessage = `<p class="success" style="text-align: center;">Great progress today! Keep it up!</p>`;
      } else if (completionPct >= 50) {
        performanceMessage = `<p class="warning" style="text-align: center;">Good effort! Tomorrow is a chance to do even better.</p>`;
      } else if (totalTasks > 0) {
        performanceMessage = `<p class="warning" style="text-align: center;">Tomorrow is a fresh start. Set achievable goals!</p>`;
      }

      const html = `
        <div class="greeting">Good evening, ${firstName}!</div>
        <p class="content">Here's your daily summary for ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.</p>

        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-number">${completedTasks}/${totalTasks}</div>
            <div class="stat-label">Tasks Completed</div>
          </div>
          <div class="stat-box">
            <div class="stat-number" style="color: ${completionPct >= 80 ? '#16a34a' : completionPct >= 50 ? '#f97316' : '#ef4444'};">${completionPct}%</div>
            <div class="stat-label">Completion Rate</div>
          </div>
        </div>

        ${tasksHtml}

        ${unfinishedTasks.length > 0 ? `
          <div style="margin-top: 16px; padding: 12px; background: #fef3c7; border-radius: 8px; border-left: 4px solid #f97316;">
            <p style="margin: 0; font-size: 13px;"><strong>⚠️ Unfinished tasks:</strong> ${unfinishedTasks.length} task${unfinishedTasks.length > 1 ? 's' : ''} will be carried over to tomorrow.</p>
          </div>
        ` : ''}

        ${performanceMessage}

        ${commentsHtml}

        <div style="text-align: center; margin-top: 24px;">
          <a href="${appUrl}" class="button">View Your Dashboard</a>
        </div>
      `;

      const subject = completionPct === 100
        ? "🎉 Perfect day! All tasks completed - Kivu Daily"
        : `📊 Daily Summary: ${completionPct}% complete - Kivu Daily`;

      const result = await sendEmail(
        email,
        subject,
        html,
        profile.id,
        "daily_summary"
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
        message: "Daily summaries processed",
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
