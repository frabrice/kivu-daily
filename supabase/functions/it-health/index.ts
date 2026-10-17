import { createClient } from "jsr:@supabase/supabase-js@2";

// Product health for IT & Product (migration 20261020100000). Every hour
// (pg_cron, x-cron-secret) or when an IT lead presses "Refresh", reads:
//   - Sentry: unresolved errors, new errors in the last 24 h, crash-free
//     sessions/users per day (SENTRY_AUTH_TOKEN; organisation + projects
//     from it_health_settings)
//   - GitHub: commits (stored in it_commits, mentions of KR-123 added to
//     that issue's activity), open and merged pull requests (GITHUB_TOKEN;
//     repositories from it_health_settings)
// and saves one snapshot per source. Tokens never leave this function.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-cron-secret",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const cronSecret = Deno.env.get("NOTIFICATIONS_CRON_SECRET");
const sentryToken = Deno.env.get("SENTRY_AUTH_TOKEN")?.trim();
const githubToken = Deno.env.get("GITHUB_TOKEN")?.trim();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
// deno-lint-ignore no-explicit-any
type Any = any;

interface Settings { sentry_base_url: string; sentry_org: string | null; sentry_projects: string[]; github_repos: string[] }

async function get(url: string, headers: Record<string, string>): Promise<{ body: Any; res: Response }> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status} ${new URL(url).pathname}: ${JSON.stringify(body?.detail ?? body?.message ?? body).slice(0, 200)}`);
  return { body, res };
}

// ------------------------------------------------------------ Sentry
async function sentry(s: Settings) {
  const base = s.sentry_base_url.replace(/\/+$/, "");
  const h = { Authorization: `Bearer ${sentryToken}` };
  const org = encodeURIComponent(s.sentry_org!);
  const projects = [];
  for (const slug of s.sentry_projects) {
    try {
      const { body: p } = await get(`${base}/api/0/projects/${org}/${encodeURIComponent(slug)}/`, h);
      const q = (query: string, extra = "") => `${base}/api/0/organizations/${org}/issues/?project=${p.id}&query=${encodeURIComponent(query)}${extra}`;
      const [open, fresh] = await Promise.all([
        get(q("is:unresolved", "&statsPeriod=14d&sort=freq&limit=25"), h),
        get(q("is:unresolved firstSeen:-24h", "&statsPeriod=24h&limit=100"), h),
      ]);
      let sessions: Any = null;
      try {
        const { body } = await get(`${base}/api/0/organizations/${org}/sessions/?project=${p.id}&field=${encodeURIComponent("crash_free_rate(session)")}&field=${encodeURIComponent("crash_free_rate(user)")}&field=${encodeURIComponent("sum(session)")}&statsPeriod=14d&interval=1d`, h);
        const g = body?.groups?.[0];
        if (g && g.totals?.["sum(session)"]) {
          sessions = {
            days: (body.intervals ?? []).map((iso: string) => iso.slice(0, 10)),
            crashFreeSessions: g.series?.["crash_free_rate(session)"] ?? [], crashFreeUsers: g.series?.["crash_free_rate(user)"] ?? [], sessions: g.series?.["sum(session)"] ?? [],
            totals: { crashFreeSessions: g.totals["crash_free_rate(session)"], crashFreeUsers: g.totals["crash_free_rate(user)"], sessions: g.totals["sum(session)"] },
          };
        }
      } catch { /* projects without release health (e.g. the backend) have no sessions */ }
      const issues = (open.body ?? []) as Any[];
      projects.push({
        slug, name: p.name, platform: p.platform, ok: true,
        unresolved: Number(open.res.headers.get("X-Hits") ?? issues.length), new24h: Number(fresh.res.headers.get("X-Hits") ?? (fresh.body ?? []).length),
        top: issues.slice(0, 15).map((i) => ({ id: i.id, shortId: i.shortId, title: i.title, culprit: i.culprit, level: i.level, count: Number(i.count), users: i.userCount, firstSeen: i.firstSeen, lastSeen: i.lastSeen, url: i.permalink })),
        sessions,
      });
    } catch (e) {
      projects.push({ slug, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { projects };
}

// ------------------------------------------------------------ GitHub
async function github(s: Settings, db: Any) {
  const h = { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "kivu-daily-it-health" };
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data: members } = await db.from("it_members").select("profile_id, github_login");
  const who = new Map<string, string>(((members ?? []) as { profile_id: string; github_login: string | null }[]).filter((m) => m.github_login).map((m) => [m.github_login!.toLowerCase(), m.profile_id]));
  const { data: issueRows } = await db.from("it_issues").select("id");
  const issueIds = new Set(((issueRows ?? []) as { id: number }[]).map((i) => Number(i.id)));
  const repos = [];
  let linked = 0;
  for (const repo of s.github_repos) {
    try {
      const commits: Any[] = [];
      for (let page = 1; page <= 5; page++) {
        const { body } = await get(`https://api.github.com/repos/${repo}/commits?since=${since}&per_page=100&page=${page}`, h);
        commits.push(...(body ?? []));
        if ((body ?? []).length < 100) break;
      }
      const [openPrs, closedPrs] = await Promise.all([
        get(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`, h),
        get(`https://api.github.com/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`, h),
      ]);
      const rows = commits.map((c) => {
        const login = c.author?.login ?? null;
        const message = String(c.commit?.message ?? "");
        const ids = [...new Set([...message.matchAll(/\bKR-(\d+)\b/gi)].map((m) => Number(m[1])))].filter((n) => issueIds.has(n));
        return { repo, sha: c.sha, author_login: login, author_name: c.commit?.author?.name ?? null, profile_id: login ? who.get(login.toLowerCase()) ?? null : null, message: message.slice(0, 2000), committed_at: c.commit?.author?.date ?? c.commit?.committer?.date, url: c.html_url, issue_ids: ids };
      }).filter((r) => r.committed_at);
      // New commits that mention an issue appear in that issue's activity.
      const known = new Set<string>();
      for (let i = 0; i < rows.length; i += 200) {
        const { data } = await db.from("it_commits").select("sha").eq("repo", repo).in("sha", rows.slice(i, i + 200).map((r) => r.sha));
        for (const k of data ?? []) known.add(k.sha);
      }
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await db.from("it_commits").upsert(rows.slice(i, i + 200), { onConflict: "repo,sha" });
        if (error) throw new Error(`Saving commits: ${error.message}`);
      }
      const events = rows.filter((r) => !known.has(r.sha) && r.issue_ids.length).flatMap((r) => r.issue_ids.map((id: number) => ({
        issue_id: id, actor: r.profile_id, kind: "comment", at: r.committed_at,
        body: `Commit ${r.sha.slice(0, 7)} in ${repo}${r.author_login ? ` by ${r.author_login}` : ""}: ${r.message.split("\n")[0].slice(0, 200)}\n${r.url}`,
      })));
      if (events.length) { await db.from("it_issue_events").insert(events); linked += events.length; }
      const pr = (p: Any) => ({ number: p.number, title: p.title, author: p.user?.login ?? null, url: p.html_url, created_at: p.created_at, updated_at: p.updated_at, merged_at: p.merged_at ?? null, draft: !!p.draft });
      repos.push({
        repo, ok: true, commits14: rows.length, withIssue: rows.filter((r) => r.issue_ids.length).length,
        open: ((openPrs.body ?? []) as Any[]).map(pr),
        merged: ((closedPrs.body ?? []) as Any[]).filter((p) => p.merged_at && p.merged_at >= since).map(pr),
      });
    } catch (e) {
      repos.push({ repo, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { repos, linked };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  // Cron, or an IT lead pressing "Refresh".
  if (!(cronSecret && req.headers.get("x-cron-secret") === cronSecret)) {
    const user = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
    const { data: lead } = await user.rpc("is_it_lead");
    if (lead !== true) return json({ error: "Only the head of IT or the MD can refresh health data" }, 403);
  }
  const { data: s } = await db.from("it_health_settings").select("*").eq("id", 1).single();
  const settings = s as Settings;
  const out: Record<string, unknown> = { sentry: "not connected", github: "not connected" };

  if (sentryToken && settings?.sentry_org && settings.sentry_projects.length) {
    try {
      const data = await sentry(settings);
      const failed = data.projects.filter((p: Any) => !p.ok);
      await db.from("it_health_snapshots").insert({ source: "sentry", ok: failed.length < data.projects.length, error: failed.map((p: Any) => `${p.slug}: ${p.error}`).join("; ") || null, data });
      out.sentry = failed.length ? `errors: ${failed.length}` : "ok";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from("it_health_snapshots").insert({ source: "sentry", ok: false, error: msg.slice(0, 500) });
      out.sentry = msg;
    }
  }
  if (githubToken && settings?.github_repos.length) {
    try {
      const data = await github(settings, db);
      const failed = data.repos.filter((r: Any) => !r.ok);
      await db.from("it_health_snapshots").insert({ source: "github", ok: failed.length < data.repos.length, error: failed.map((r: Any) => `${r.repo}: ${r.error}`).join("; ") || null, data });
      out.github = failed.length ? `errors: ${failed.length}` : `ok, ${data.linked} new issue links`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from("it_health_snapshots").insert({ source: "github", ok: false, error: msg.slice(0, 500) });
      out.github = msg;
    }
  }
  out.configured = { sentryToken: !!sentryToken, githubToken: !!githubToken };
  return json(out);
});
