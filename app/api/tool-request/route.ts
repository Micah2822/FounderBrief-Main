import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Demand capture: "I use X, not one of your integrations."
// Every row here is a prioritized vote for the integration roadmap.

const Schema = z.object({ tool: z.string().trim().min(2).max(100) });

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const admin = createAdminClient();
  await admin.from("tool_requests").upsert(
    { user_id: user.id, tool: parsed.data.tool.toLowerCase() },
    { onConflict: "user_id,tool", ignoreDuplicates: true }
  );
  return NextResponse.json({ ok: true });
}
