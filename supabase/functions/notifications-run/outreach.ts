import { shiftDay, isoWeekday } from "../_shared/depositRules.ts";
import { Block, Built, Ctx, day, esc, hm, MON_SAT, personName, plural, RuleDef, rows } from "./core.ts";

// Non-Insider outreach -> the Fleet Manager (Ndekwe Jean Bertrand). Every
// morning: every Non-Insider driver who said yes to our device (120,000 RWF)
// or branding (20,000 RWF, priority driver), the ones new since the last
// report first, with where Fleet's own follow-up stands.

interface StatusRow {
  platform_driver_id: string; app_status: string | null; app_usage: string | null; device_answer: string | null; branding_answer: string | null;
  usual_area: string | null; came_to_office_on: string | null; last_called_at: string | null; last_agent_id: string | null;
  driver: { full_name: string; phone: string | null; car: { plate_number: string; make: string | null; model: string | null; branding_status: string | null; device_status: string | null } | null } | null;
}
interface CallRow { platform_driver_id: string; created_at: string; note: string | null; device_answer: string | null; branding_answer: string | null; agent_id: string | null }

const ANSWER: Record<string, string> = { yes: "Yes", thinking: "Thinking", no: "No" };
const APP: Record<string, string> = { will_come: "Coming for it", has_latest: "Has it", not_interested: "Doesn't want it" };
const FLEET: Record<string, string> = {
  to_contact: "To contact", scheduled: "Scheduled", branded: "Branded", agreed: "Agreed", installed: "Installed", not_going_ahead: "Not going ahead",
};

async function interested(ctx: Ctx) {
  const [statuses, calls] = await Promise.all([
    rows<StatusRow>(ctx.db.from("platform_outreach_status")
      .select("platform_driver_id, app_status, app_usage, device_answer, branding_answer, usual_area, came_to_office_on, last_called_at, last_agent_id, driver:platform_drivers(full_name, phone, car:platform_cars(plate_number, make, model, branding_status, device_status))")
      .or("device_answer.eq.yes,branding_answer.eq.yes")),
    rows<CallRow>(ctx.db.from("platform_outreach_calls").select("platform_driver_id, created_at, note, device_answer, branding_answer, agent_id").order("created_at", { ascending: false })),
  ]);
  return { statuses, calls };
}

export const outreachRules: Record<string, RuleDef> = {
  outreach_interested_fleet: {
    kind: "scheduled", days: MON_SAT, at: hm(8),
    build: async (ctx): Promise<Built[]> => {
      const { statuses, calls } = await interested(ctx);
      if (statuses.length === 0) return [];
      // New = said yes since the last report (Saturday's on a Monday).
      const since = `${shiftDay(ctx.today, isoWeekday(ctx.today) === 1 ? -2 : -1)}T06:00:00Z`;
      const firstYes = (id: string) => {
        const yes = calls.filter((c) => c.platform_driver_id === id && (c.device_answer === "yes" || c.branding_answer === "yes"));
        return yes.length ? yes[yes.length - 1].created_at : null; // calls are newest first
      };
      const lastNote = (id: string) => calls.find((c) => c.platform_driver_id === id && c.note)?.note ?? null;
      const list = statuses.map((s) => ({ s, firstYes: firstYes(s.platform_driver_id), note: lastNote(s.platform_driver_id) }))
        .sort((a, b) => (b.firstYes ?? "").localeCompare(a.firstYes ?? ""));
      const isNew = (r: typeof list[number]) => !!r.firstYes && r.firstYes >= since;
      const fresh = list.filter(isNew);
      const device = statuses.filter((s) => s.device_answer === "yes").length;
      const branding = statuses.filter((s) => s.branding_answer === "yes").length;
      const notStarted = list.filter((r) => (r.s.device_answer === "yes" && (r.s.driver?.car?.device_status ?? "to_contact") === "to_contact") || (r.s.branding_answer === "yes" && (r.s.driver?.car?.branding_status ?? "to_contact") === "to_contact")).length;

      const fleetStatus = (r: typeof list[number]) => [
        r.s.device_answer === "yes" ? `Device: ${FLEET[r.s.driver?.car?.device_status ?? "to_contact"] ?? "To contact"}` : "",
        r.s.branding_answer === "yes" ? `Branding: ${FLEET[r.s.driver?.car?.branding_status ?? "to_contact"] ?? "To contact"}` : "",
      ].filter(Boolean).join("<br>");
      const row = (r: typeof list[number]) => [
        `<b>${esc(r.s.driver?.full_name ?? "Unknown driver")}</b><br><span style="color:#6b7280;font-size:12px;">${esc(r.s.driver?.phone ?? "no phone")} · ${esc(r.s.driver?.car?.plate_number ?? "no car")}${r.s.driver?.car?.make ? ` ${esc(r.s.driver.car.make)} ${esc(r.s.driver.car.model ?? "")}` : ""}</span>`,
        [r.s.device_answer === "yes" ? "<b>Device</b>" : r.s.device_answer ? `Device: ${ANSWER[r.s.device_answer]}` : "", r.s.branding_answer === "yes" ? "<b>Branding</b>" : r.s.branding_answer ? `Branding: ${ANSWER[r.s.branding_answer]}` : ""].filter(Boolean).join("<br>"),
        fleetStatus(r),
        `${r.s.came_to_office_on ? `Came ${day(r.s.came_to_office_on)}` : r.s.app_status ? APP[r.s.app_status] ?? "—" : "—"}${r.s.usual_area ? `<br><span style="color:#6b7280;font-size:12px;">Works around ${esc(r.s.usual_area)}</span>` : ""}`,
        `${r.firstYes ? day(r.firstYes.slice(0, 10)) : "—"}${r.s.last_agent_id ? `<br><span style="color:#6b7280;font-size:12px;">${esc(personName(ctx, r.s.last_agent_id).split(/\s+/)[0])}</span>` : ""}${r.note ? `<br><span style="color:#6b7280;font-size:12px;">“${esc(r.note)}”</span>` : ""}`,
      ];
      const head = ["Driver", "Wants", "Your follow-up", "Updated app", "Said yes"];
      const blocks: Block[] = [];
      if (fresh.length) blocks.push({ heading: `New since the last report (${fresh.length})`, table: { head, rows: fresh.map(row), tones: fresh.map(() => "good" as const), phoneHide: [3] } });
      const older = list.filter((r) => !isNew(r));
      if (older.length) blocks.push({ heading: fresh.length ? `Still interested (${older.length})` : `All interested drivers (${older.length})`, table: { head, rows: older.map(row), tones: older.map((r) => (fleetStatus(r).includes("To contact") ? "warning" as const : null)), phoneHide: [3] } });

      return [{
        subject: `Non-Insider drivers: ${plural(statuses.length, "driver")} want our device or branding${fresh.length ? ` (${fresh.length} new)` : ""}`,
        heading: `${plural(statuses.length, "Non-Insider driver")} said yes`,
        intro: `Drivers the Call Center reached who want our device (120,000 RWF, one-time) or branding (20,000 RWF, one-time — they become priority drivers). Please contact each one, agree the payment and a date, and update their car in Kivu Daily → Branding & Devices.`,
        stats: [
          { label: "Interested drivers", value: String(statuses.length), tone: "good" },
          { label: "New since last report", value: String(fresh.length), tone: fresh.length ? "good" : undefined },
          { label: "Want the device", value: String(device) },
          { label: "Want branding", value: String(branding) },
        ],
        alert: notStarted ? { tone: "warning", text: `<b>${plural(notStarted, "driver")}</b> still marked "To contact" in Branding & Devices — amber rows below.` } : undefined,
        blocks,
        cta: { label: "Open Branding & Devices", query: "page=fleet_branding" },
        inApp: `${plural(statuses.length, "Non-Insider driver")} want our device or branding${fresh.length ? ` (${fresh.length} new)` : ""}`,
      }];
    },
  },
};
