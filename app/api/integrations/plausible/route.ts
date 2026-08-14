import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { verifyPlausible } from "@/lib/collectors/plausible";
import { canAddConnector, CONNECTOR_LIMIT_MESSAGE } from "@/lib/billing";

const Schema = z.object({
  domain: z
    .string()
    .min(3)
    .max(253)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, "Enter the bare domain, e.g. yourstartup.com"),
  key: z.string().min(20),
});

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid domain or key" },
      { status: 400 }
    );
  }
  const { domain, key } = parsed.data;

  // Before the verify call, not after: a rejected connection should not spend a
  // round trip asking Plausible to validate a key it is about to discard.
  if (!(await canAddConnector(user.id, "plausible"))) {
    return NextResponse.json({ error: CONNECTOR_LIMIT_MESSAGE, code: "limit" }, { status: 402 });
  }

  // Prove the pair works before storing anything
  try {
    await verifyPlausible(key, domain);
  } catch {
    return NextResponse.json(
      { error: `Couldn't read stats for "${domain}". Check the domain and API key.` },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from("integrations").upsert(
    {
      user_id: user.id,
      provider: "plausible",
      access_token: encrypt(key),
      config: { domain },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
