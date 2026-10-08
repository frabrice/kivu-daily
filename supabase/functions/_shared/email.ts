// Shared Resend-sending helper + branded email chrome, used by any edge
// function that needs to send a Kivu Daily email (create-user's invite,
// send-email's generic notifications, etc).

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

export interface EmailAttachment {
  filename: string;
  // Base64-encoded file content, no data-URI prefix - matches Resend's
  // attachments API (https://resend.com/docs/api-reference/emails/send-email).
  content: string;
}

export async function sendWithResend(
  to: string | string[],
  subject: string,
  html: string,
  text: string,
  attachments?: EmailAttachment[],
  // Overrides FROM_EMAIL (the invites address) for a different sender.
  from?: string
): Promise<SendEmailResult> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (!resendApiKey) {
    console.error("RESEND_API_KEY not configured");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const fromEmail = from || Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Resend API error:", response.status, errorText);

      let errorMessage = `Resend API error: ${response.status}`;
      if (response.status === 403) {
        errorMessage = "Email sending forbidden. For Resend trial accounts, verify recipient emails at resend.com/emails. For production, verify your sending domain at resend.com/domains.";
      } else if (response.status === 401) {
        errorMessage = "Invalid Resend API key. Check RESEND_API_KEY secret.";
      } else if (response.status === 422) {
        errorMessage = "Invalid email address format or sender domain not verified.";
      }

      return { success: false, error: errorMessage };
    }

    const data = await response.json();
    return { success: true, id: data.id };
  } catch (err) {
    console.error("Failed to send email:", err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ---------------------------------------------------------------------
// Branded email shell. Table-based with inline styles so it renders the
// same in Gmail, Outlook and phone mail apps: navy header with the logo,
// a white card, and a quiet footer. Every Kivu Daily email uses it.
// ---------------------------------------------------------------------
export const BRAND = {
  navy: "#17263A", teal: "#2F8C86", ink: "#1f2937", body: "#374151", muted: "#6b7280",
  line: "#e5e7eb", soft: "#f8fafc", page: "#eef1f4", headerMuted: "#aebcc9",
};

const appUrlOf = () => (Deno.env.get("APP_URL") || "https://kivu-daily.app").replace(/\/$/, "");

export function emailShell(opts: { inner: string; preheader?: string; dateLabel?: string; footerNote?: string }): string {
  const appUrl = appUrlOf();
  const pre = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${opts.preheader}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Kivu Daily</title>
${legacyStyles()}
</head>
<body style="margin:0;padding:0;background:${BRAND.page};-webkit-text-size-adjust:100%;">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;border-collapse:separate;">
      <tr><td style="background:${BRAND.navy};border-radius:14px 14px 0 0;padding:18px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="vertical-align:middle;padding-right:10px;">
                <div style="width:34px;height:34px;border-radius:8px;background:#ffffff;text-align:center;">
                  <img src="${appUrl}/kivu-ride-logo.png" width="26" height="26" alt="Kivu Ride" style="display:inline-block;margin-top:4px;border:0;">
                </div>
              </td>
              <td style="vertical-align:middle;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
                <div style="font-size:16px;font-weight:700;color:#ffffff;line-height:1.2;">Kivu Daily</div>
                <div style="font-size:11px;color:${BRAND.headerMuted};line-height:1.3;">Kivu Ride Ltd</div>
              </td>
            </tr></table>
          </td>
          ${opts.dateLabel ? `<td align="right" style="vertical-align:middle;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.headerMuted};white-space:nowrap;">${opts.dateLabel}</td>` : ""}
        </tr></table>
      </td></tr>
      <tr><td style="background:${BRAND.teal};height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>
      <tr><td class="kd-card" style="background:#ffffff;border-radius:0 0 14px 14px;padding:28px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.body};font-size:14px;line-height:1.55;">
        ${opts.inner}
      </td></tr>
      <tr><td align="center" style="padding:18px 12px 4px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#8699ad;">
        Kivu Daily · Kivu Ride Ltd<br>
        ${opts.footerNote ? `${opts.footerNote}<br>` : ""}Automated message — please don't reply. <a href="${appUrl}/?page=settings" style="color:${BRAND.teal};text-decoration:none;">Email preferences</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// Classes still used by the invite and generic emails' own HTML.
function legacyStyles(): string {
  return `<style>
  .title { font-size: 21px; font-weight: 700; color: ${BRAND.navy}; margin: 0 0 14px; line-height: 1.3; }
  .content { color: ${BRAND.body}; margin-bottom: 18px; }
  .greeting { font-size: 14px; color: ${BRAND.muted}; margin: 0 0 6px; }
  .button { display: inline-block; background: ${BRAND.teal}; color: #ffffff !important; padding: 12px 26px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 12px 0; }
  .highlight { color: ${BRAND.teal}; font-weight: 600; }
  .warning { color: #b45309; }
  .success { color: #15803d; }
  .stat-box { background: ${BRAND.soft}; border: 1px solid ${BRAND.line}; border-radius: 10px; padding: 14px; text-align: center; }
  .stat-number { font-size: 24px; font-weight: 700; color: ${BRAND.navy}; }
  .stat-label { font-size: 11px; color: ${BRAND.muted}; text-transform: uppercase; letter-spacing: .04em; }
  .task-list { background: ${BRAND.soft}; border-radius: 10px; padding: 14px 16px; margin: 14px 0; }
  .task-item { padding: 8px 0; border-bottom: 1px solid ${BRAND.line}; }
  .task-item:last-child { border-bottom: none; }
  @media (max-width: 520px) {
    .kd-card { padding: 20px 14px !important; }
    .kd-cell { padding: 8px 6px !important; font-size: 12px !important; }
    .kd-num { white-space: normal !important; }
    .kd-hide-sm { display: none !important; }
    .kd-stat { display: inline-block !important; width: 50% !important; box-sizing: border-box; padding: 0 4px 8px 0 !important; vertical-align: top; }
  }
</style>`;
}

export function wrapEmail(innerHtml: string, opts: { preheader?: string; dateLabel?: string } = {}): string {
  return emailShell({ inner: innerHtml, ...opts });
}
