import { shiftDay } from "../_shared/depositRules.ts";
import { activeEmployees, Built, cached, Ctx, esc, firstName, hm, MON_SAT, personName, plural, RuleDef, rows } from "./core.ts";

// Everyone's own workspace (Phase 3): add today's tasks, finish them,
// and hear back when someone replies to a comment. These are the only
// emails a person can switch off themselves (Settings).

export interface TaskRow { user_id: string; title: string; completed: boolean; date: string }

// The last ~2 weeks of tasks covers the daily digest and the weekly report.
export function loadRecentTasks(ctx: Ctx) {
  return cached(ctx, "tasks", () => rows<TaskRow>(ctx.db.from("tasks").select("user_id, title, completed, date").gte("date", shiftDay(ctx.today, -14))));
}

export const workspaceRules: Record<string, RuleDef> = {
  task_morning: {
    kind: "scheduled", days: MON_SAT, at: hm(8),
    build: async (ctx) => {
      const tasks = (await loadRecentTasks(ctx)).filter((t) => t.date === ctx.today);
      return activeEmployees(ctx)
        .filter((p) => !tasks.some((t) => t.user_id === p.id))
        .map((p): Built => ({
          recipients: [p.id],
          subject: "Add today's tasks",
          heading: "What are you working on today?",
          intro: `Good morning ${esc(firstName(p.full_name))} — you haven't added any tasks for today yet. Take two minutes to list what you'll get done, so your day counts on the team board.`,
          inApp: "Add today's tasks",
        }));
    },
  },

  task_unfinished: {
    kind: "scheduled", days: MON_SAT, at: hm(17, 30),
    build: async (ctx) => {
      const open = (await loadRecentTasks(ctx)).filter((t) => t.date === ctx.today && !t.completed);
      return activeEmployees(ctx)
        .map((p) => ({ p, mine: open.filter((t) => t.user_id === p.id) }))
        .filter((r) => r.mine.length > 0)
        .map(({ p, mine }): Built => ({
          recipients: [p.id],
          subject: `${plural(mine.length, "task")} still open today`,
          heading: "Before you finish for the day",
          intro: `${esc(firstName(p.full_name))}, these are still open. Tick off what's done — anything left carries over to tomorrow.`,
          table: { head: ["Task"], rows: mine.map((t) => [esc(t.title)]) },
          inApp: `${plural(mine.length, "task")} still open today`,
        }));
    },
  },

  comment_reply: {
    kind: "event",
    sample: async (ctx) => {
      const [latest] = await rows<{ id: string }>(ctx.db.from("comments").select("id").order("created_at", { ascending: false }).limit(1));
      return latest ? { comment_id: latest.id } : null;
    },
    build: async (p, ctx) => {
      const [c] = await rows<{ author_id: string; target_user_id: string | null; content: string; parent_comment_id: string | null }>(
        ctx.db.from("comments").select("author_id, target_user_id, content, parent_comment_id").eq("id", p.comment_id as string),
      );
      if (!c || !c.target_user_id || c.target_user_id === c.author_id) return null;
      const author = personName(ctx, c.author_id);
      return {
        recipients: [c.target_user_id],
        subject: `${author} ${c.parent_comment_id ? "replied to you" : "left you a comment"}`,
        heading: `${esc(author)} ${c.parent_comment_id ? "replied" : "left you a comment"}`,
        intro: `<div style="border-left:3px solid #4F7B3E;padding:4px 12px;margin:8px 0;color:#333;">${esc(c.content).replace(/\n/g, "<br>")}</div>Reply from Comments in Kivu Daily.`,
        inApp: `${author} ${c.parent_comment_id ? "replied to you" : "left you a comment"}`,
      };
    },
  },
};
