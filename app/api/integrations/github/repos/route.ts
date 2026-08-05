import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
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
    .select("access_token, config")
    .eq("user_id", user.id)
    .eq("provider", "github")
    .maybeSingle();
  if (!integration?.access_token) {
    return NextResponse.json({ error: "github_not_connected" }, { status: 400 });
  }

  try {
    const repos = await listRepos(decrypt(integration.access_token));
    return NextResponse.json({ repos, selected: integration.config?.repos ?? [] });
  } catch {
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
  const { error } = await admin
    .from("integrations")
    .update({ config: { repos: parsed.data.repos }, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("provider", "github");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
