// Shared Resend-sending helper + branded email chrome, used by any edge
// function that needs to send a Kivu Daily email (create-user's invite,
// send-email's generic notifications, etc).

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

export async function sendWithResend(
  to: string | string[],
  subject: string,
  html: string,
  text: string
): Promise<SendEmailResult> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (!resendApiKey) {
    console.error("RESEND_API_KEY not configured");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const fromEmail = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";

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

export function getEmailBaseStyles(): string {
  return `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f4f4f5; }
      .container { background-color: #ffffff; border-radius: 12px; padding: 32px; margin: 20px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
      .header { text-align: center; margin-bottom: 24px; }
      .logo { font-size: 24px; font-weight: bold; color: #17263A; }
      .logo-subtitle { font-size: 12px; color: #888; margin-top: 4px; }
      .title { font-size: 22px; font-weight: 600; color: #17263A; margin-bottom: 16px; }
      .content { color: #555; margin-bottom: 20px; }
      .button { display: inline-block; background-color: #2F8C86; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0; }
      .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #888; text-align: center; }
      .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 20px 0; }
      .stat-box { background: #f8fafc; border-radius: 8px; padding: 16px; text-align: center; }
      .stat-number { font-size: 28px; font-weight: bold; color: #2F8C86; }
      .stat-label { font-size: 12px; color: #888; margin-top: 4px; }
      .task-list { background: #f8fafc; border-radius: 8px; padding: 16px; margin: 16px 0; }
      .task-item { padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
      .task-item:last-child { border-bottom: none; }
      .greeting { font-size: 18px; margin-bottom: 16px; }
      .highlight { color: #2F8C86; font-weight: 600; }
      .warning { color: #f97316; }
      .success { color: #4F7B3E; }
      @media (prefers-color-scheme: dark) {
        body { background-color: #1a1a1a; }
        .container { background-color: #1f2937; color: #e5e7eb; }
        .content { color: #d1d5db; }
        .title { color: #5eb8b0; }
        .stat-box { background: #374151; }
        .task-list { background: #374151; }
        .task-item { border-bottom-color: #4b5563; }
      }
    </style>
  `;
}

export function getEmailFooter(): string {
  const appUrl = Deno.env.get("APP_URL") || "https://kivu-daily.app";
  return `
    <div class="footer">
      <p>Kivu Daily - Kivu Ride Ltd</p>
      <p>
        <a href="${appUrl}/settings" style="color: #2F8C86;">Manage notification preferences</a>
      </p>
      <p style="margin-top: 12px;">This is an automated message. Please do not reply directly to this email.</p>
    </div>
  `;
}

export function wrapEmail(innerHtml: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      ${getEmailBaseStyles()}
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">Kivu Daily</div>
          <div class="logo-subtitle">Kivu Ride Ltd</div>
        </div>
        ${innerHtml}
        ${getEmailFooter()}
      </div>
    </body>
    </html>
  `;
}
