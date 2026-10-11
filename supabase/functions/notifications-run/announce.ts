import { ALL_DAYS, Built, Ctx, esc, hm, Profile, RuleDef } from "./core.ts";

// One-off: tell each person what changed in their own dashboard (Oct 2026).
// Sent once, at 08:00 on SEND_ON; everyone gets only the parts that apply
// to their department and duties. The MD gets every version first as a
// test ({ mode: "test", rule_key: "dashboard_changes_oct", all: true }).
const SEND_ON = "2026-10-12";

interface Change { what: string; where: string; for: (p: Profile, duties: Set<string>) => boolean }

const dept = (...slugs: string[]) => (p: Profile) => slugs.includes(p.department?.slug ?? "");
const duty = (...keys: string[]) => (_p: Profile, d: Set<string>) => keys.some((k) => d.has(k));
const everyone = () => true;

const CHANGES: Change[] = [
  // ---- everyone
  { for: everyone, what: "<b>Tasks that update themselves.</b> Many of your daily tasks are now made from live data — e.g. the drivers to call or the payments to check. Each one shows its list, counts your progress and ticks itself off when the work is done. If new work appears, it reopens.", where: "My Tasks — look for the “Updates itself” badge" },
  { for: everyone, what: "<b>One email a morning.</b> At 07:00 you get “Your day”: what to start with, your tasks and the updates since yesterday, in one email instead of many. At 16:00 you only get a short reminder if something urgent is still open.", where: "Your email" },

  // ---- Call Center
  { for: dept("call_center"), what: "<b>Non-Insider outreach in rounds.</b> Call every Non-Insider driver once per round and record three answers: the updated app, our device (120,000 RWF) and branding (20,000 RWF). Office visits, categories and filters show where each driver stands. A driver you open is reserved for you for 15 minutes so two agents never call the same person.", where: "Outreach → Call drivers" },
  { for: dept("call_center"), what: "<b>Your outreach target counts itself.</b> “Make 15 Non-Insider outreach calls” fills up as you log calls. Call-backs promised to callers also appear as a task and tick off when you close them.", where: "My Tasks" },
  { for: dept("call_center"), what: "<b>Calls log shows everything.</b> It now opens on all outreach calls, page by page, with filters for dates, agent, result, round, each answer and the driver’s current status, a search box and a CSV download.", where: "Outreach → Calls log" },
  { for: dept("call_center"), what: "<b>New duty: drivers who owe commission.</b> Call drivers whose trip was paid to them in cash or MoMo, explain that the app (and we) can’t give them new rides until Kivu Ride’s commission is paid, and help them pay it. The Script Book card with the exact payment steps is coming soon.", where: "My Tasks · Script Book" },
  { for: dept("call_center"), what: "<b>Driver payments are no longer in the Call Center.</b> Deposits, contracts and payment details of our drivers are handled by Fleet and Finance. On cases you still see the driver’s name and car.", where: "—" },
  { for: dept("call_center"), what: "<b>Your shifts matter.</b> Start your shift in Kivu Daily when you arrive and always end it with your shift report. Start times, calls and outreach for each agent are now shown on a performance page the MD reviews.", where: "Start / End shift" },

  // ---- Driver days off (pauses)
  { for: duty("fleet_manager", "driver_payment_followup"), what: "<b>Record driver days off.</b> When a driver is sick, the car is in the garage, after an accident, a family emergency or approved leave, record a pause with the reason (a photo or document is optional). The days stop counting at once: the driver owes nothing for them and isn’t chased. Resume the driver as soon as they’re back.", where: "Driver profile → Days off → Pause days, or Driver days off" },
  { for: (p) => dept("finance")(p), what: "<b>Approve or reject driver pauses.</b> Fleet records days off (sick, garage, accident…). Paused days don’t count in deposits. You or the MD approve or reject each one; a rejected pause makes the days count again. Vehicle owners are still paid as usual unless you or the MD decide otherwise.", where: "Driver days off · My Tasks" },
  { for: (p, d) => dept("fleet")(p) && !d.has("fleet_manager"), what: "<b>Paused drivers.</b> Drivers on approved days off (sick, garage…) now show a “Paused” badge and aren’t counted as owing for those days.", where: "Fleet → Pipeline and Deposits · Driver days off" },
  { for: duty("fleet_manager"), what: "<b>Check on long pauses.</b> Open-ended pauses of more than 3 days appear as a task: call the driver or the garage and resume them as soon as they’re back.", where: "My Tasks" },

  // ---- Fleet & payments
  { for: duty("route_operations", "fleet_manager", "driver_payment_followup", "route_finance", "deposit_confirmation"), what: "<b>Driver payments report at 06:30.</b> Every morning: who is cleared to drive, who owes and how much, and now who is paused today and why. Anyone owing is listed every day until they pay.", where: "Your email" },
  { for: duty("route_operations"), what: "<b>Cars to act on.</b> “Keep cars off the road until the driver pays” and “Find drivers for idle cars” are now tasks that list each car and tick off by themselves when the driver pays or a driver is assigned.", where: "My Tasks" },
  { for: duty("fleet_manager"), what: "<b>Non-Insider drivers to follow up.</b> Drivers who said yes to our device or branding appear as a task; move the car on in Branding & Devices and it ticks off. You also get the daily outreach summary and an email when a fleet owner is interested.", where: "My Tasks · Fleet → Branding & Devices" },
  { for: duty("driver_payment_followup"), what: "<b>Drivers who owe us.</b> “Call drivers who owe us” lists each driver and amount, and each one ticks off the moment their payment is logged.", where: "My Tasks" },
  { for: duty("deposit_confirmation", "route_finance"), what: "<b>Payments to check and deposits to confirm.</b> Both are now tasks listing each entry; they tick off as you confirm deposits and mark payments checked for the MD.", where: "My Tasks · Deposit Confirmations" },

  // ---- IT
  { for: duty("route_it"), what: "<b>Partner Promo & EV Reporting.</b> 21 new stories are assigned to you in the IT Hub, with the MD’s decisions written into them.", where: "IT Hub → Products / Issues" },
  { for: duty("route_it"), what: "<b>Issues page shows everything.</b> Every story and flagged issue is listed, with filter chips per product. Flagged issues also appear in your tasks and tick off when handled.", where: "IT Hub → Issues · My Tasks" },
];

async function build(ctx: Ctx): Promise<Built[]> {
  const dutiesOf = (id: string) => new Set(Object.entries(ctx.responsibilities).filter(([, pid]) => pid === id).map(([k]) => k));
  const staff = ctx.profiles.filter((p) => p.role === "employee" && p.is_active && p.email);
  return staff.map((p) => {
    const mine = CHANGES.filter((c) => c.for(p, dutiesOf(p.id)));
    const own = mine.length - 2; // beyond the two everyone gets
    return {
      subject: "What’s new in your Kivu Daily",
      heading: "What’s new in your Kivu Daily",
      intro: `We’ve made changes to Kivu Daily to make your day clearer and the work easier to follow. Here ${own > 0 ? `are the ${mine.length} changes that affect you` : "is what changed for you"} and where to find each one.`,
      table: { head: ["What changed", "Where"], rows: mine.map((c) => [c.what, esc(c.where)]), align: ["left", "left"], phoneHide: [] },
      footnote: "Questions, or something not working? Ask the MD, or flag it to IT from Kivu Daily. Nothing changes in how you sign in.",
      inApp: `What’s new in your Kivu Daily: ${mine.length} changes for you — see your email.`,
      recipients: [p.id],
    };
  });
}

export const announceRules: Record<string, RuleDef> = {
  dashboard_changes_oct: { kind: "scheduled", days: ALL_DAYS, at: hm(8), when: (d) => d === SEND_ON, testAll: true, build: (ctx) => build(ctx) },
};
