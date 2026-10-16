import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendWithResend } from "../_shared/email.ts";

// Emails an issued business invoice (its PDF attached) to the company's
// billing contacts from administration@kivuride.com, and records it.
// Finance or the MD only.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const FROM = Deno.env.get("INVOICES_FROM_EMAIL") || "Kivu Ride <administration@kivuride.com>";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const rwf = (n: number) => `${Math.round(n).toLocaleString("en-US")} RWF`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: me } = await db.from("profiles").select("id, full_name, role, is_active, department:departments(slug)").eq("id", user.id).maybeSingle();
    const slug = (me?.department as { slug?: string } | null)?.slug;
    if (!me?.is_active || !(me.role === "managing_director" || slug === "finance")) return json({ error: "Only Finance or the MD can send invoices" }, 403);

    const body = await req.json().catch(() => ({}));
    const to = [...new Set(((body?.to ?? []) as string[]).map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
    if (!to.length) return json({ error: "Add at least one email address" }, 400);
    const bad = to.filter((x) => !EMAIL_RE.test(x));
    if (bad.length) return json({ error: `Not an email address: ${bad.join(", ")}` }, 400);

    const { data: inv } = await db.from("business_invoices").select("*, client:business_clients(name, legal_name, contact_name)").eq("id", body?.invoice_id).maybeSingle();
    if (!inv) return json({ error: "Invoice not found" }, 404);
    if (inv.status === "void") return json({ error: "This invoice was cancelled" }, 400);
    if (!inv.pdf_path) return json({ error: "The PDF isn't saved yet - open the invoice and generate it first" }, 400);
    const { data: file, error: dlErr } = await db.storage.from("business-invoices").download(inv.pdf_path);
    if (dlErr || !file) return json({ error: `Couldn't read the PDF: ${dlErr?.message ?? "missing"}` }, 500);

    const client = inv.client as { name: string; legal_name: string | null; contact_name: string | null };
    const due = Number(inv.total) - Number(inv.amount_paid);
    const greeting = client.contact_name ? `Dear ${esc(client.contact_name)},` : `Dear ${esc(client.legal_name || client.name)} team,`;
    const note = String(body?.message ?? "").trim();
    const subject = `Invoice ${inv.number} — Kivu Ride trips ${day(inv.period_from)} to ${day(inv.period_to)}`;
    const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px 12px;background:#f4f6f8;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
<tr><td style="height:4px;background:linear-gradient(90deg,#4F7B3E,#2F8C86,#17263A);background-color:#2F8C86;"></td></tr>
<tr><td style="padding:28px 32px 8px;">
  <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#2F8C86;font-weight:600;">Kivu Ride · Invoice</div>
  <div style="font-size:24px;font-weight:700;color:#17263A;margin-top:6px;">${esc(inv.number)}</div>
</td></tr>
<tr><td style="padding:12px 32px 0;font-size:15px;line-height:1.6;">
  <p style="margin:0 0 12px;">${greeting}</p>
  <p style="margin:0 0 12px;">Please find attached the invoice for the <b>${inv.trip_count} trip${inv.trip_count === 1 ? "" : "s"}</b> taken with Kivu Ride from <b>${day(inv.period_from)}</b> to <b>${day(inv.period_to)}</b>, with every trip listed: date, pickup, destination, driver and fare.</p>
  ${note ? `<p style="margin:0 0 12px;white-space:pre-line;">${esc(note)}</p>` : ""}
</td></tr>
<tr><td style="padding:8px 32px 8px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;">
    <tr><td style="padding:14px 18px;font-size:13px;color:#6b7280;">Trips</td><td align="right" style="padding:14px 18px;font-size:14px;">${inv.trip_count} · ${Number(inv.distance_km).toLocaleString("en-US")} km</td></tr>
    <tr><td style="padding:0 18px 10px;font-size:13px;color:#6b7280;">Subtotal</td><td align="right" style="padding:0 18px 10px;font-size:14px;">${rwf(Number(inv.subtotal))}</td></tr>
    <tr><td style="padding:0 18px 10px;font-size:13px;color:#6b7280;">VAT (${Math.round(Number(inv.vat_rate) * 100)}%)</td><td align="right" style="padding:0 18px 10px;font-size:14px;">${rwf(Number(inv.vat_amount))}</td></tr>
    <tr><td style="padding:12px 18px;border-top:1px solid #e5e7eb;font-size:14px;font-weight:700;color:#17263A;">Amount due</td><td align="right" style="padding:12px 18px;border-top:1px solid #e5e7eb;font-size:18px;font-weight:700;color:#17263A;">${rwf(due)}</td></tr>
    <tr><td colspan="2" style="padding:0 18px 14px;font-size:13px;color:#6b7280;">Due by <b style="color:#1f2937;">${day(inv.due_date)}</b> · please quote <b style="color:#1f2937;">${esc(inv.number)}</b> with your payment.</td></tr>
  </table>
</td></tr>
<tr><td style="padding:16px 32px 28px;font-size:14px;line-height:1.6;color:#374151;">
  <p style="margin:0;">For any question about this invoice, simply reply to this email.</p>
  <p style="margin:12px 0 0;">Murakoze,<br><b>Kivu Ride Ltd</b><br><span style="color:#6b7280;font-size:13px;">administration@kivuride.com · www.kivuride.com</span></p>
</td></tr>
</table>
<div style="font-size:11px;color:#9ca3af;margin-top:14px;">Kivu Ride Ltd · Kigali, Rwanda · Beyond Transport. Into the Future.</div>
</td></tr></table></body></html>`;
    const text = `${greeting.replace(/<[^>]+>/g, "")}\n\nPlease find attached invoice ${inv.number} for ${inv.trip_count} trips from ${day(inv.period_from)} to ${day(inv.period_to)}.\n${note ? `\n${note}\n` : ""}\nAmount due: ${rwf(due)} (VAT included), due by ${day(inv.due_date)}. Please quote ${inv.number} with your payment.\n\nMurakoze,\nKivu Ride Ltd\nadministration@kivuride.com`;

    const result = await sendWithResend(to, subject, html, text, [{ filename: `${inv.number}.pdf`, content: toBase64(await file.arrayBuffer()) }], FROM);
    if (!result.success) return json({ error: result.error ?? "Sending failed" }, 502);
    await db.from("business_invoices").update({ sent_at: new Date().toISOString(), sent_to: to, sent_by: me.id }).eq("id", inv.id);
    return json({ ok: true, id: result.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
