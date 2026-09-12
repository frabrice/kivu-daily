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

// Calculate user stats for the past week
async function getUserWeeklyStats(supabase: ReturnType<typeof createClient>, userId: string) {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const todayStr = today.toISOString().slice(0, 10);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  // Get tasks for the past 7 days
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, completed, date")
    .eq("user_id", userId)
    .gte("date", weekAgoStr)
    .lte("date", todayStr);

  const taskList = tasks || [];

  // Calculate metrics
  const totalTasks = taskList.length;
  const completedTasks = taskList.filter((t) => t.completed).length;
  const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

  // Days with no tasks
  const daysWithTasks = new Set(taskList.map((t) => t.date)).size;
  const daysWithNoTasks = 7 - daysWithTasks;

  // Average tasks per day
  const avgTasksPerDay = daysWithTasks > 0 ? totalTasks / daysWithTasks : 0;

  // Carried over tasks (incomplete from previous days, excluding today)
  const incompletePreviousDays = taskList.filter(
    (t) => !t.completed && t.date !== todayStr
  ).length;

  return {
    totalTasks,
    completedTasks,
    completionRate: Math.round(completionRate),
    daysWithNoTasks,
    daysWithTasks,
    avgTasksPerDay: Math.round(avgTasksPerDay * 10) / 10,
    incompletePreviousDays,
    hasIssues: completionRate < 50 || daysWithNoTasks >= 3 || (totalTasks === 0),
  };
}

// Get company average for comparison
async function getCompanyAverage(supabase: ReturnType<typeof createClient>) {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  // Get all active employees
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id")
    .eq("is_active", true);

  const activeUsers = profiles || [];

  if (activeUsers.length === 0) {
    return { avgCompletionRate: 0, avgTasksPerDay: 0 };
  }

  // Get all tasks for the week
  const { data: allTasks } = await supabase
    .from("tasks")
    .select("user_id, completed, date")
    .gte("date", weekAgoStr);

  const tasks = allTasks || [];

  // Calculate per-user stats
  const userStats = new Map<string, { total: number; completed: number; days: Set<string> }>();

  for (const t of tasks) {
    if (!userStats.has(t.user_id)) {
      userStats.set(t.user_id, { total: 0, completed: 0, days: new Set() });
    }
    const stats = userStats.get(t.user_id)!;
    stats.total++;
    if (t.completed) stats.completed++;
    stats.days.add(t.date);
  }

  // Calculate averages
  let totalCompletionRate = 0;
  let totalTasksPerDay = 0;
  let usersWithTasks = 0;

  userStats.forEach((stats) => {
    if (stats.total > 0) {
      totalCompletionRate += (stats.completed / stats.total) * 100;
      const activeDays = stats.days.size || 1;
      totalTasksPerDay += stats.total / activeDays;
      usersWithTasks++;
    }
  });

  return {
    avgCompletionRate: usersWithTasks > 0 ? Math.round(totalCompletionRate / usersWithTasks) : 0,
    avgTasksPerDay: usersWithTasks > 0 ? Math.round((totalTasksPerDay / usersWithTasks) * 10) / 10 : 0,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Get company average for comparison
    const companyAvg = await getCompanyAverage(supabase);

    // Get all active users with performance nudges enabled
    const { data: usersWithNudges, error: prefsError } = await supabase
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
      .eq("performance_nudges", true)
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
      noIssues: 0,
      errors: 0,
    };

    for (const pref of usersWithNudges || []) {
      const profile = pref.profiles as { id: string; full_name: string; email: string | null; is_active: boolean };

      if (!profile || !profile.is_active) continue;

      // Get user's weekly stats
      const stats = await getUserWeeklyStats(supabase, profile.id);

      // Only send nudge if there are actual issues
      if (!stats.hasIssues) {
        results.noIssues++;
        continue;
      }

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

      const firstName = profile.full_name?.split(" ")[0] || "Team Member";

      // Determine the main issue
      let mainIssue = "";
      let actionSuggestion = "";

      if (stats.totalTasks === 0) {
        mainIssue = "No tasks were added this week";
        actionSuggestion = "Start by adding 3-5 achievable tasks each day. Small wins build momentum!";
      } else if (stats.completionRate < 50) {
        mainIssue = `Only ${stats.completionRate}% of tasks were completed`;
        actionSuggestion = "Focus on fewer, more achievable goals. It's better to complete 3 tasks than to start 10.";
      } else if (stats.daysWithNoTasks >= 3) {
        mainIssue = `${stats.daysWithNoTasks} days without any tasks`;
        actionSuggestion = "Consistency is key! Try to add at least a few tasks every day, even on slower days.";
      }

      // Compare to company average
      const comparisonToTeam = stats.completionRate < companyAvg.avgCompletionRate
        ? `<p style="font-size: 13px; color: #666; margin-top: 16px;">The team average this week is <strong>${companyAvg.avgCompletionRate}%</strong> completion. You've got this!</p>`
        : "";

      const html = `
        <div class="greeting">Hi ${firstName},</div>
        <div class="content">
          <p>We noticed there's room for improvement in your productivity this week. At Kivu Ride, we believe in helping every team member reach their full potential!</p>
        </div>

        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-number" style="color: ${stats.completionRate >= 50 ? '#16a34a' : '#ef4444'};">${stats.completionRate}%</div>
            <div class="stat-label">Your Completion Rate</div>
          </div>
          <div class="stat-box">
            <div class="stat-number" style="color: #007BFF;">${companyAvg.avgCompletionRate}%</div>
            <div class="stat-label">Team Average</div>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-number" style="color: ${stats.daysWithTasks >= 5 ? '#16a34a' : '#f97316'};">${stats.daysWithTasks}</div>
            <div class="stat-label">Days with Tasks</div>
          </div>
          <div class="stat-box">
            <div class="stat-number" style="color: ${stats.avgTasksPerDay >= 3 ? '#16a34a' : '#f97316'};">${stats.avgTasksPerDay}</div>
            <div class="stat-label">Avg Tasks/Day</div>
          </div>
        </div>

        <div style="margin-top: 20px; padding: 16px; background: #fef2f2; border-radius: 8px; border-left: 4px solid #ef4444;">
          <p style="margin: 0 0 8px 0; font-weight: 600; color: #dc2626;">📉 Area for Improvement</p>
          <p style="margin: 0; color: #555;">${mainIssue}</p>
        </div>

        <div style="margin-top: 16px; padding: 16px; background: #f0fdf4; border-radius: 8px; border-left: 4px solid #16a34a;">
          <p style="margin: 0 0 8px 0; font-weight: 600; color: #16a34a;">💡 Suggested Action</p>
          <p style="margin: 0; color: #555;">${actionSuggestion}</p>
        </div>

        ${comparisonToTeam}

        <div style="text-align: center; margin-top: 24px;">
          <a href="${appUrl}" class="button">Start Fresh Today</a>
        </div>

        <div class="content" style="margin-top: 20px;">
          <p style="font-size: 13px; color: #666;">Remember: Every expert was once a beginner. What matters most is showing up and trying again. We believe in you! 💪</p>
        </div>
      `;

      const result = await sendEmail(
        email,
        "📈 Let's get back on track - Weekly Productivity Check - Kivu Daily",
        html,
        profile.id,
        "performance_nudge"
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
        message: "Performance nudges processed",
        companyAverage: companyAvg,
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
