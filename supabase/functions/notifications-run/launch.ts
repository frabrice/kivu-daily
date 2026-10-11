import { ALL_DAYS, Built, Ctx, hm, RuleDef } from "./core.ts";

// One-off: "The new Kivu Daily" - tells every employee about the new
// design on the morning after the MD switches this rule on. It can only
// ever send once: any earlier run of this rule stops it.

const AREA: Record<string, string> = {
  fleet: "Fleet (Drivers, Cars, Deposits, Days off, Fines…)", finance: "Finance (Overview, the new Ledger, Confirmations, Owners…)",
  call_center: "Call Center (Live board, Calls & cases, Outreach, Script Book…)", it: "Product Hub (Issues, Products) and Fleet",
  marketing_sales_bd: "Growth (Campaigns, Follow-ups)", social_media: "Growth (Content calendar)",
};

const ROWS: [string, string][] = [
  ["<b>Search and jump anywhere</b>", "Press Ctrl K (or /) and type a driver, car, person, case or page."],
  ["<b>Your areas on the left</b>", "One icon per area. Hover to slide its menu out; a red dot means something needs attention."],
  ["<b>Tabs</b>", "Every page and person you open gets a tab at the top, like windows on a computer."],
  ["<b>Click any name</b>", "Drivers, cars, people and cases open in a panel on the right; hover a name for a quick summary."],
  ["<b>A page for everything</b>", "Each driver, car and case has its own page: numbers, a calendar of their days and everything that happened."],
  ["<b>Numbers on every page</b>", "Each area opens with the key numbers and what needs someone today. Click a number to see the list behind it."],
  ["<b>Today panel</b>", "Move your mouse to the right edge (or press t) to see today's tasks from any page."],
];

async function build(ctx: Ctx): Promise<Built[]> {
  const { data: earlier } = await ctx.db.from("notification_rule_runs").select("period_key").eq("rule_key", "kivu_os_launch").neq("period_key", ctx.today).limit(1);
  if ((earlier ?? []).length) return [];
  return ctx.profiles.filter((p) => p.role === "employee" && p.is_active && p.email).map((p) => ({
    subject: "The new Kivu Daily is here",
    heading: "The new Kivu Daily is here",
    intro: "Kivu Daily has a new design. Your work, your tasks and all the data are exactly where they were — it's now faster to find things and to see how they're going." +
      (p.department?.slug && AREA[p.department.slug] ? ` Your pages are under <b>${AREA[p.department.slug]}</b>.` : ""),
    table: { head: ["What's new", "How it works"], rows: ROWS.map(([a, b]) => [a, b]), align: ["left", "left"], phoneHide: [] },
    footnote: "Open “What's new” from the menu at your picture (top right) for the full tour. Something not working? Flag it to IT from Kivu Daily or tell the MD.",
    inApp: "The new Kivu Daily is here — press Ctrl K to search anything. See What's new.",
    recipients: [p.id],
    cta: { label: "Open Kivu Daily", query: "page=whats_new" },
  }));
}

export const launchRules: Record<string, RuleDef> = {
  kivu_os_launch: { kind: "scheduled", days: ALL_DAYS, at: hm(7, 45), testAll: true, build: (ctx) => build(ctx) },
};
