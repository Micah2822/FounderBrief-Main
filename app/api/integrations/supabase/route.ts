import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/crypto";
import { discoverSchema, countInWindow } from "@/lib/collectors/supabase";
import {
  getProjectServiceKey,
  listProjects,
  projectUrl,
  TOKEN_COOKIE,
} from "@/lib/supabase-oauth";

async function requireUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * The management token from the OAuth callback. Short-lived by design: if it
 * has expired the user just reconnects, which is one click.
 */
function managementToken(): string | null {
  const raw = cookies().get(TOKEN_COOKIE)?.value;
  if (!raw) return null;
  try {
    return decrypt(raw);
  } catch {
    return null;
  }
}

type DiscoveredTable = { table: string; timestamp_columns: string[] };

/**
 * Best guess at "which table means signups". Wrong guesses cost nothing — both
 * dropdowns stay editable — but a right one removes the only step in onboarding
 * that asks the founder to know their own schema by heart.
 */
function suggestMapping(tables: DiscoveredTable[]) {
  const byName = (re: RegExp) => tables.find((t) => re.test(t.table));
  const table =
    byName(/^(users|profiles|accounts)$/i) ?? byName(/(users|profiles|accounts)/i) ?? tables[0];
  if (!table) return null;

  const cols = table.timestamp_columns;
  const ts =
    cols.find((c) => /^(created_at|inserted_at)$/i.test(c)) ??
    cols.find((c) => /created|inserted|signed_up|joined/i.test(c)) ??
    cols[0];
  return ts ? { table: table.table, ts_column: ts } : null;
}

/** Tables worth offering: a signup count needs something to count *by*. */
function usableTables(tables: DiscoveredTable[]) {
  return tables.filter((t) => t.timestamp_columns.length > 0);
}

// Postgres identifiers only — these end up in a URL path we request.
const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Invalid name").max(63);

// Supabase project refs are lowercase alphanumeric, and this is the **only**
// thing a caller can influence about the host we fetch. `projectUrl()` builds
// the URL from it, so this regex is the SSRF guard: without it a caller could
// point our server at an arbitrary host and probe it through us. There is no
// longer a path that accepts a full URL from the client.
const projectRef = z.string().regex(/^[a-z0-9]{16,32}$/, "Invalid project");

// OAuth is the only path. The project key is fetched server-side from the
// short-lived management token and never reaches the browser — there is
// deliberately no way to paste one in; see ARCHITECTURE › Auth and security.
const SelectProjectSchema = z.object({
  action: z.literal("select-project"),
  project_ref: projectRef,
});

const SaveOAuthSchema = z.object({
  action: z.literal("save-oauth"),
  project_ref: projectRef,
  table: identifier,
  ts_column: identifier,
});

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json();

  // ── OAuth path ─────────────────────────────────────────────────────
  // Every branch below re-reads the management token from the cookie rather
  // than trusting anything the client sends, and the project key it fetches is
  // used and discarded within the request.

  if (body.action === "list-projects") {
    const token = managementToken();
    if (!token) return NextResponse.json({ error: "supabase_reconnect" }, { status: 440 });
    try {
      return NextResponse.json({ projects: await listProjects(token) });
    } catch (e: any) {
      return NextResponse.json({ error: e.message ?? "Could not list projects" }, { status: 502 });
    }
  }

  if (body.action === "select-project") {
    const parsed = SelectProjectSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid project" }, { status: 400 });
    const token = managementToken();
    if (!token) return NextResponse.json({ error: "supabase_reconnect" }, { status: 440 });
    try {
      const key = await getProjectServiceKey(token, parsed.data.project_ref);
      const usable = usableTables(await discoverSchema(projectUrl(parsed.data.project_ref), key));
      if (!usable.length) {
        return NextResponse.json(
          { error: "Connected, but no tables with a timestamp column were found." },
          { status: 422 }
        );
      }
      return NextResponse.json({ tables: usable, suggested: suggestMapping(usable) });
    } catch (e: any) {
      return NextResponse.json({ error: e.message ?? "Could not read that project" }, { status: 502 });
    }
  }

  if (body.action === "save-oauth") {
    const parsed = SaveOAuthSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid mapping" }, { status: 400 });
    const token = managementToken();
    if (!token) return NextResponse.json({ error: "supabase_reconnect" }, { status: 440 });
    const { project_ref, table, ts_column } = parsed.data;
    const url = projectUrl(project_ref);

    let key: string;
    try {
      key = await getProjectServiceKey(token, project_ref);
    } catch (e: any) {
      return NextResponse.json({ error: e.message ?? "Could not read that project" }, { status: 502 });
    }

    // Same guard as the manual path: prove the mapping counts before trusting it.
    try {
      const now = new Date();
      await countInWindow(url, key, table, ts_column, new Date(now.getTime() - 86400000), now);
    } catch {
      return NextResponse.json(
        { error: `Couldn't count rows in "${table}" by "${ts_column}". Pick a different mapping.` },
        { status: 422 }
      );
    }

    const admin = createAdminClient();
    const { error } = await admin.from("integrations").upsert(
      {
        user_id: user.id,
        provider: "supabase",
        access_token: encrypt(key),
        config: { url, table, ts_column, project_ref },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // The management token has done its only job. Drop it.
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(TOKEN_COOKIE);
    return res;
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function DELETE(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { provider } = await request.json();
  if (!["github", "supabase", "plausible", "stripe"].includes(provider)) {
    return NextResponse.json({ error: "bad provider" }, { status: 400 });
  }
  const admin = createAdminClient();
  await admin.from("integrations").delete().eq("user_id", user.id).eq("provider", provider);
  return NextResponse.json({ ok: true });
}
