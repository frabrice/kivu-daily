// supabase.functions.invoke reports any 4xx/5xx as the generic "Edge
// Function returned a non-2xx status code" - the function's own message
// (e.g. "this email is already registered") is in the response body,
// which this reads so people see what actually went wrong.
export async function edgeFunctionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return friendly(String(body.error));
      if (body?.message) return friendly(String(body.message));
    } catch {
      try {
        const text = await ctx.clone().text();
        if (text) return friendly(text);
      } catch { /* fall through */ }
    }
    if (ctx.status === 401) return 'Your session has expired. Sign out and back in, then try again.';
  }
  return error instanceof Error ? friendly(error.message) : 'Something went wrong. Please try again.';
}

function friendly(message: string): string {
  if (/already been registered|already registered|already exists/i.test(message)) {
    return 'This email already has a Kivu Daily account — possibly a deactivated or terminated employee. Use a different email, or find them in the employee list.';
  }
  if (/invalid.*email|email.*invalid|unable to validate email/i.test(message)) {
    return "That email address doesn't look valid. Check it for typos.";
  }
  if (/^Unauthorized$/i.test(message)) return 'Your session has expired. Sign out and back in, then try again.';
  return message;
}
