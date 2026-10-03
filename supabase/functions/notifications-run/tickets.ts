import { Block, Built, cached, Ctx, esc, firstName, hm, MON_SAT, personName, plural, RuleDef, rows } from "./core.ts";

// Call Center tickets: a caller's issue the agent couldn't solve on the
// call, assigned to whoever is in charge. Emails carry everything the
// assignee needs to act without opening the app first, and a button
// straight to the ticket.

export interface TicketRow {
  id: string; reference: string; caller_name: string; caller_phone: string; caller_email: string | null; caller_type: string;
  driver_id: string | null; category: string; priority: "normal" | "urgent"; details: string; status: string;
  resolved_on_call: boolean; assignee_id: string | null; created_by: string | null; resolution_note: string | null;
  resolved_by: string | null; resolved_at: string | null; created_at: string; last_activity_at: string;
  driver: { full_name: string; vehicle: { plate_number: string } | null } | null;
}

export const CATEGORY_LABEL: Record<string, string> = {
  app: "App problem", payment: "Payment", trip: "Trip", driver_behaviour: "Driver behaviour",
  lost_item: "Lost item", complaint: "Complaint", other: "Other",
};
const CALLER_TYPE_LABEL: Record<string, string> = {
  passenger: "Passenger", driver: "Driver", car_owner: "Car owner", partner: "Partner", other: "Other",
};
const STATUS_LABEL: Record<string, string> = {
  open: "Open", in_progress: "In progress", waiting_on_caller: "Waiting on caller", resolved: "Resolved", closed: "Closed",
};
export const UNRESOLVED = ["open", "in_progress", "waiting_on_caller"];

export function loadTickets(ctx: Ctx) {
  return cached(ctx, "tickets", () => rows<TicketRow>(ctx.db.from("call_tickets").select(
    "id, reference, caller_name, caller_phone, caller_email, caller_type, driver_id, category, priority, details, status, resolved_on_call, assignee_id, created_by, resolution_note, resolved_by, resolved_at, created_at, last_activity_at, driver:drivers(full_name, vehicle:vehicles(plate_number))",
  ).order("created_at", { ascending: false }).limit(1000)));
}

async function ticket(ctx: Ctx, id: unknown) {
  return (await loadTickets(ctx)).find((t) => t.id === id) ?? null;
}

// Overdue = still unresolved 24 hours after an urgent call, or 3 days
// after a normal one.
export function isOverdue(t: TicketRow, now = Date.now()) {
  if (!UNRESOLVED.includes(t.status)) return false;
  const hours = (now - new Date(t.created_at).getTime()) / 3600000;
  return hours > (t.priority === "urgent" ? 24 : 72);
}

export function waitingFor(t: TicketRow, now = Date.now()) {
  const h = Math.floor((now - new Date(t.created_at).getTime()) / 3600000);
  return h < 24 ? plural(h, "hour") : plural(Math.floor(h / 24), "day");
}

const kigaliTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" });

const phoneLink = (p: string) => `<a href="tel:${esc(p.replace(/[^\d+]/g, ""))}">${esc(p)}</a>`;
const urgentTag = '<span style="background:#dc2626;color:#fff;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;">URGENT</span>';
const quote = (s: string) => `<div style="border-left:3px solid #2F8C86;background:#f8fafc;padding:10px 12px;margin:4px 0 8px;white-space:pre-wrap;">${esc(s)}</div>`;

function callerTable(t: TicketRow, ctx: Ctx): Block["table"] {
  const rowsOut: string[][] = [
    ["Reference", `<b>${esc(t.reference)}</b>`],
    ["Priority", t.priority === "urgent" ? urgentTag : "Normal"],
    ["Category", CATEGORY_LABEL[t.category] ?? t.category],
    ["Caller", `${esc(t.caller_name)} (${CALLER_TYPE_LABEL[t.caller_type] ?? t.caller_type})`],
    ["Phone", phoneLink(t.caller_phone)],
  ];
  if (t.caller_email) rowsOut.push(["Email", `<a href="mailto:${esc(t.caller_email)}">${esc(t.caller_email)}</a>`]);
  if (t.driver) rowsOut.push(["Our driver", `${esc(t.driver.full_name)}${t.driver.vehicle ? ` · ${esc(t.driver.vehicle.plate_number)}` : ""}`]);
  rowsOut.push(["Logged by", `${esc(personName(ctx, t.created_by))}, ${kigaliTime(t.created_at)}`]);
  return { head: ["", ""], rows: rowsOut };
}

const openTicket = (t: TicketRow) => ({ label: "Open ticket", query: `ticket=${t.id}` });

async function sampleTicket(ctx: Ctx) {
  const latest = (await loadTickets(ctx)).find((t) => !t.resolved_on_call);
  return latest ? { ticket_id: latest.id, note: "Example note", action: "note", reason: "new" } : null;
}

const ACTION_VERB: Record<string, string> = {
  start: "started working on", waiting: "needs something from the caller on", note: "added a note to",
  reassign: "reassigned", close: "closed",
};

export const ticketRules: Record<string, RuleDef> = {
  ticket_assigned: {
    kind: "event",
    sample: sampleTicket,
    build: async (p, ctx): Promise<Built | null> => {
      const t = await ticket(ctx, p.ticket_id);
      if (!t || !UNRESOLVED.includes(t.status)) return null;
      const actor = personName(ctx, p.actor_id as string);
      const reason = String(p.reason ?? "new");
      const lead = reason === "reassigned"
        ? `${esc(actor)} reassigned this ticket to you.`
        : reason === "reopened"
          ? `${esc(actor)} reopened this ticket — the caller says it isn't fixed yet.`
          : `${esc(actor)} from the Call Center took this call and needs you to handle it.`;
      return {
        subject: `${t.priority === "urgent" ? "URGENT: " : ""}${reason === "reopened" ? "Reopened" : reason === "reassigned" ? "Reassigned to you" : "New ticket"} ${t.reference} — ${CATEGORY_LABEL[t.category] ?? t.category}, ${t.caller_name}`,
        heading: `${reason === "reopened" ? "Ticket reopened" : "A ticket for you from the Call Center"}`,
        intro: lead + (p.note ? `<br>${quote(String(p.note))}` : ""),
        blocks: [
          { table: callerTable(t, ctx) },
          { heading: "What the caller said", text: quote(t.details) },
          { text: `Open the ticket, press <b>Start working</b>, and when it's done mark it <b>Resolved</b> with what you did — the Call Center will call ${esc(firstName(t.caller_name))} back. ${t.priority === "urgent" ? "Urgent tickets are overdue after 24 hours." : "Tickets are overdue after 3 days."}` },
        ],
        cta: openTicket(t),
        inApp: `${t.priority === "urgent" ? "URGENT " : ""}ticket ${t.reference} from the Call Center: ${CATEGORY_LABEL[t.category] ?? t.category}, ${t.caller_name}`,
      };
    },
  },

  ticket_activity: {
    kind: "event",
    sample: sampleTicket,
    build: async (p, ctx) => {
      const t = await ticket(ctx, p.ticket_id);
      if (!t) return null;
      const actor = personName(ctx, p.actor_id as string);
      const action = String(p.action ?? "note");
      const callNow = action === "waiting";
      return {
        subject: callNow
          ? `Please call ${t.caller_name} — ${t.reference} needs more information`
          : `${t.reference}: ${actor} ${ACTION_VERB[action] ?? "updated"} ${action === "reassign" ? `it to ${personName(ctx, t.assignee_id)}` : "the ticket"}`,
        heading: callNow ? "Please call the caller" : `Update on ${esc(t.reference)}`,
        intro: `<b>${esc(actor)}</b> ${ACTION_VERB[action] ?? "updated"} ${action === "reassign" ? `${esc(t.reference)} to <b>${esc(personName(ctx, t.assignee_id))}</b>` : esc(t.reference)}.`
          + (p.note ? quote(String(p.note)) : "")
          + (callNow ? `Call ${esc(t.caller_name)} on ${phoneLink(t.caller_phone)}, get what's needed, and add it as a note on the ticket.` : ""),
        blocks: [{ text: `Status: <b>${STATUS_LABEL[t.status] ?? t.status}</b> · ${esc(t.caller_name)} · ${CATEGORY_LABEL[t.category] ?? t.category}` }],
        cta: openTicket(t),
        inApp: `${t.reference}: ${actor} ${ACTION_VERB[action] ?? "updated"} the ticket`,
      };
    },
  },

  ticket_resolved: {
    kind: "event",
    sample: sampleTicket,
    build: async (p, ctx) => {
      const t = await ticket(ctx, p.ticket_id);
      if (!t || t.status !== "resolved") return null;
      return {
        subject: `Resolved: ${t.reference} — please call ${t.caller_name} back`,
        heading: "Resolved — call the caller back",
        intro: `<b>${esc(personName(ctx, t.resolved_by))}</b> resolved ${esc(t.reference)}:${quote(t.resolution_note ?? "")}`
          + `Call <b>${esc(t.caller_name)}</b> on ${phoneLink(t.caller_phone)} and tell them. Then mark the ticket <b>Closed</b> — or <b>Reopen</b> it if they say it isn't fixed.`,
        blocks: [{ heading: "Their original issue", text: quote(t.details) }],
        cta: openTicket(t),
        inApp: `Resolved: ${t.reference} — call ${t.caller_name} back`,
      };
    },
  },

  ticket_open_digest: {
    kind: "scheduled", days: MON_SAT, at: hm(8),
    build: async (ctx) => {
      const open = (await loadTickets(ctx)).filter((t) => UNRESOLVED.includes(t.status) && t.assignee_id);
      const byPerson = new Map<string, TicketRow[]>();
      for (const t of open) byPerson.set(t.assignee_id!, [...(byPerson.get(t.assignee_id!) ?? []), t]);
      return [...byPerson].map(([id, mine]): Built => {
        // Overdue first, then urgent, then oldest.
        const rank = (t: TicketRow) => (isOverdue(t) ? 0 : 2) + (t.priority === "urgent" ? 0 : 1);
        mine.sort((a, b) => rank(a) - rank(b) || a.created_at.localeCompare(b.created_at));
        const overdue = mine.filter((t) => isOverdue(t)).length;
        return {
          recipients: [id],
          subject: `You have ${plural(mine.length, "open ticket")} from the Call Center${overdue ? `, ${overdue} overdue` : ""}`,
          heading: "Your open tickets",
          intro: "Callers are waiting on these. Update each one — even a note tells the Call Center what to say if the caller rings again.",
          table: {
            head: ["Ticket", "Caller", "Issue", "Status", "Waiting"],
            rows: mine.map((t) => [
              `${esc(t.reference)}${t.priority === "urgent" ? ` ${urgentTag}` : ""}`,
              esc(t.caller_name), CATEGORY_LABEL[t.category] ?? t.category, STATUS_LABEL[t.status] ?? t.status,
              isOverdue(t) ? `<span style="color:#dc2626;font-weight:600;">${waitingFor(t)} — overdue</span>` : waitingFor(t),
            ]),
          },
          cta: { label: "Open From Call Center", query: "page=from_call_center" },
          inApp: `${plural(mine.length, "open ticket")} from the Call Center${overdue ? `, ${overdue} overdue` : ""}`,
        };
      });
    },
  },
};
