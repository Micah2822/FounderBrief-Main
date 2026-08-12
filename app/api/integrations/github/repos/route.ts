import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInstallationToken } from "@/lib/github/app-auth";
import { listRepos } from "@/lib/collectors/github";

async function requireUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("integrations")
    .select("config")
    .eq("user_id", user.id)
    .eq("provider", "github")
    .maybeSingle();
  // Rows written by the old OAuth App have no installation_id. They can't mint
  // a token, so they read as not connected and the user reconnects.
  if (!integration?.config?.installation_id) {
    return NextResponse.json({ error: "github_not_connected" }, { status: 400 });
  }

  try {
    const token = await getInstallationToken(integration.config.installation_id);
    const repos = await listRepos(token);
    return NextResponse.json({ repos, selected: integration.config?.repos ?? [] });
  } catch (e) {
    console.error("github repos: listing failed", e);
    return NextResponse.json({ error: "github_api_failed" }, { status: 502 });
  }
}

const SaveSchema = z.object({ repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).min(1).max(5) });

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = SaveSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick between 1 and 5 repositories" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Merge rather than replace: config also carries installation_id, and
  // overwriting it would leave a row that can never mint a token again.
  const { data: existing } = await admin
    .from("integrations")
    .select("config")
    .eq("user_id", user.id)
    .eq("provider", "github")
    .maybeSingle();
  if (!existing?.config?.installation_id) {
    return NextResponse.json({ error: "github_not_connected" }, { status: 400 });
  }

  const { error } = await admin
    .from("integrations")
    .update({
      config: { ...existing.config, repos: parsed.data.repos },
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("provider", "github");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
