import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendWithResend } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Sends the raw, owner-authored newsletter HTML as-is - unlike send-email,
// this never wraps the message in Kivu Daily's internal app chrome, since
// this is external correspondence to a vehicle owner, branded as Kivu
// Ride itself. The closing line is enforced here, server-side, so it's
// never left out regardless of what was pasted into the editor.
const CLOSING_LINE = "<p>Attached is the weekly report.</p>";

interface SendNewsletterRequest {
  newsletter_id?: string;
  owner_id?: string;
  to: string;
  subject: string;
  html: string;
  pdf_base64: string;
  pdf_filename: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body: SendNewsletterRequest = await req.json();
    const { newsletter_id, owner_id, to, subject, html, pdf_base64, pdf_filename } = body;

    if (!to || !subject || !html || !pdf_base64 || !pdf_filename) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, subject, html, pdf_base64, pdf_filename" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fullHtml = `${html}\n${CLOSING_LINE}`;
    const plainText = fullHtml.replace(/<[^>]*>/g, "").trim() || "Attached is the weekly report.";

    const result = await sendWithResend(to, subject, fullHtml, plainText, [
      { filename: pdf_filename, content: pdf_base64 },
    ]);

    if (newsletter_id && owner_id) {
      await supabase.from("newsletter_sends").upsert(
        {
          newsletter_id,
          owner_id,
          email: to,
          status: result.success ? "sent" : "failed",
          error_message: result.error || null,
          sent_at: new Date().toISOString(),
        },
        { onConflict: "newsletter_id,owner_id" }
      );
    }

    if (result.success) {
      return new Response(JSON.stringify({ success: true, id: result.id }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: false, error: result.error }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-newsletter error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
