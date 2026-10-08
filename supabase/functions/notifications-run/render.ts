import { BRAND, emailShell } from "../_shared/email.ts";
import { Block, Built, esc, firstName, Stat, Table, Tone } from "./core.ts";

// Turns a Built email into branded HTML + plain text. Layout rules that
// keep every email tidy: headline numbers as tiles, numbers right-aligned
// in their own columns, highlighted rows for people who need action, and
// one button at the end.

const FONT = "Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const TONE: Record<Tone, { fg: string; bg: string; bar: string }> = {
  danger: { fg: "#b91c1c", bg: "#fef2f2", bar: "#dc2626" },
  warning: { fg: "#b45309", bg: "#fffbeb", bar: "#f59e0b" },
  good: { fg: "#15803d", bg: "#f0fdf4", bar: "#16a34a" },
  info: { fg: "#1d4ed8", bg: "#eff6ff", bar: "#3b82f6" },
};

const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
// "12", "1,250,000 RWF", "85%", "3h 05m", "—" count as numbers.
const NUMERIC = /^(—|-|[-+]?\d[\d,.]*\s*(RWF|%|h|min|km)?|\d+h \d{1,2}m|\d+\s*\/\s*\d+)$/i;

function columnAlign(t: Table): ("left" | "right" | "center")[] {
  return t.head.map((_, i) => {
    if (t.align?.[i]) return t.align[i];
    if (i === 0) return "left";
    const cells = t.rows.map((r) => strip(r[i] ?? "")).filter((c) => c !== "");
    return cells.length > 0 && cells.some((c) => /\d/.test(c)) && cells.every((c) => NUMERIC.test(c)) ? "right" : "left";
  });
}

export function htmlTable(t: Table): string {
  const align = columnAlign(t);
  const hasHead = t.head.some(Boolean);
  const th = hasHead
    ? `<tr>${t.head.map((h, i) => `<th class="kd-cell${t.phoneHide?.includes(i) ? " kd-hide-sm" : ""}" align="${align[i]}" style="text-align:${align[i]};padding:9px 12px;background:${BRAND.soft};border-bottom:1px solid ${BRAND.line};font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${BRAND.muted};white-space:nowrap;">${h}</th>`).join("")}</tr>`
    : "";
  const body = t.rows.map((r, ri) => {
    const tone = t.tones?.[ri] ? TONE[t.tones[ri]!] : null;
    return `<tr${tone ? ` style="background:${tone.bg};"` : ""}>${r.map((c, ci) => {
      const right = align[ci] === "right";
      const border = ri === 0 && !hasHead ? "" : `border-top:1px solid ${ri === 0 ? BRAND.line : "#f1f5f9"};`;
      const bar = ci === 0 && tone ? `border-left:3px solid ${tone.bar};` : "";
      return `<td class="kd-cell${right ? " kd-num" : ""}${t.phoneHide?.includes(ci) ? " kd-hide-sm" : ""}" align="${align[ci]}" style="text-align:${align[ci]};padding:10px 12px;${border}${bar}vertical-align:top;font-size:13px;color:${BRAND.ink};${right ? "white-space:nowrap;font-variant-numeric:tabular-nums;" : ""}">${c}</td>`;
    }).join("")}</tr>`;
  }).join("");
  return `<div style="overflow-x:auto;margin:10px 0 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;border:1px solid ${BRAND.line};border-radius:10px;overflow:hidden;font-family:${FONT};">${th}${body}</table></div>`;
}

function statTiles(stats: Stat[]): string {
  // At most 4 tiles per row so numbers never squeeze. Gaps come from cell
  // padding (not border-spacing) so the row lines up with the tables.
  const rows: Stat[][] = [];
  for (let i = 0; i < stats.length; i += 4) rows.push(stats.slice(i, i + 4));
  const size = (v: string, perRow: number) => {
    const n = v.length;
    if (perRow >= 4) return n > 11 ? 15 : n > 8 ? 17 : 21;
    if (perRow === 3) return n > 13 ? 17 : 21;
    return 21;
  };
  return rows.map((row) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:6px 0 12px;table-layout:fixed;"><tr>${row.map((s, i) => {
    const fg = s.tone ? TONE[s.tone].fg : BRAND.navy;
    return `<td class="kd-stat" valign="top" width="${Math.floor(100 / row.length)}%" style="padding:0 0 0 ${i === 0 ? 0 : 8}px;">
      <div style="border:1px solid ${BRAND.line};border-radius:10px;padding:12px 12px 11px;background:${s.tone ? TONE[s.tone].bg : "#ffffff"};font-family:${FONT};">
        <div style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${BRAND.muted};line-height:1.3;">${s.label}</div>
        <div style="font-size:${size(strip(s.value), row.length)}px;font-weight:700;color:${fg};line-height:1.25;margin-top:4px;font-variant-numeric:tabular-nums;">${s.value}</div>
        ${s.sub ? `<div style="font-size:11px;color:${BRAND.muted};margin-top:2px;line-height:1.35;">${s.sub}</div>` : ""}
      </div>
    </td>`;
  }).join("")}</tr></table>`).join("");
}

function alertBox(a: { tone: Tone; text: string }): string {
  const t = TONE[a.tone];
  return `<div style="background:${t.bg};border-left:4px solid ${t.bar};border-radius:8px;padding:11px 14px;margin:12px 0;font-size:13px;line-height:1.5;color:${BRAND.ink};">${a.text}</div>`;
}

function block(b: Block): string {
  return [
    b.heading ? `<div style="margin:24px 0 8px;padding-left:10px;border-left:3px solid ${BRAND.teal};font-size:15px;font-weight:700;color:${BRAND.navy};line-height:1.35;">${b.heading}</div>` : "",
    b.text ? `<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:${BRAND.body};">${b.text}</p>` : "",
    b.alert ? alertBox(b.alert) : "",
    b.stats?.length ? statTiles(b.stats) : "",
    b.table ? htmlTable(b.table) : "",
  ].join("");
}

const plain = (s: string) => s.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");

export function renderEmail(b: Built, recipientName: string, appUrl: string, dateLabel: string) {
  const base = appUrl.replace(/\/$/, "");
  const href = b.cta ? `${base}/?${b.cta.query}` : base;
  const inner = `
    <p style="margin:0 0 4px;font-size:13px;color:${BRAND.muted};">Hi ${esc(firstName(recipientName))},</p>
    <h1 style="margin:0 0 10px;font-size:21px;line-height:1.3;font-weight:700;color:${BRAND.navy};">${b.heading}</h1>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${BRAND.body};">${b.intro}</p>
    ${b.alert ? alertBox(b.alert) : ""}
    ${b.stats?.length ? statTiles(b.stats) : ""}
    ${b.table ? htmlTable(b.table) : ""}
    ${(b.blocks ?? []).map(block).join("")}
    ${b.footnote ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.55;color:${BRAND.muted};">${b.footnote}</p>` : ""}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto 4px;"><tr>
      <td style="background:${BRAND.teal};border-radius:8px;"><a href="${href}" style="display:inline-block;padding:12px 26px;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${b.cta?.label ?? "Open Kivu Daily"}</a></td>
    </tr></table>`;

  const tableText = (t?: Table) => (t ? [t.head.join(" | "), ...t.rows.map((r) => r.join(" | "))] : []);
  const statText = (s?: Stat[]) => (s ?? []).map((x) => `${x.label}: ${x.value}${x.sub ? ` (${x.sub})` : ""}`);
  const text = plain([
    b.heading, "", b.intro, "", b.alert?.text ?? "", ...statText(b.stats), ...tableText(b.table),
    ...(b.blocks ?? []).flatMap((bl) => ["", bl.heading ?? "", bl.text ?? "", bl.alert?.text ?? "", ...statText(bl.stats), ...tableText(bl.table)]),
    "", b.footnote ?? "", href,
  ].join("\n"));
  return { html: emailShell({ inner, preheader: strip(b.intro).slice(0, 140), dateLabel }), text };
}
