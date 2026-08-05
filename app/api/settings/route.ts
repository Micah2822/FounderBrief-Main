import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const Schema = z.object({
  timezone: z.string().min(1).max(64).optional(),
  send_hour: z.number().int().min(0).max(23).optional(),
  email_enabled: z.boolean().optional(),
  goal: z.string().max(200).nullable().optional(),
});

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  // Validate timezone actually resolves
  if (parsed.data.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timezone });
    } catch {
      return NextResponse.json({ error: "invalid timezone" }, { status: 400 });
    }
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("user_settings")
    .upsert({ user_id: user.id, ...parsed.data }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
