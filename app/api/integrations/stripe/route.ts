import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { verifyStripe } from "@/lib/collectors/stripe";

const Schema = z.object({
  key: z
    .string()
    .regex(/^(rk|sk)_(live|test)_[A-Za-z0-9]+$/, "That doesn't look like a Stripe API key"),
});

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid key" },
      { status: 400 }
    );
  }
  const { key } = parsed.data;

  try {
    await verifyStripe(key);
  } catch {
    return NextResponse.json(
      { error: "Stripe rejected that key. It needs read access to Charges and Customers." },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from("integrations").upsert(
    {
      user_id: user.id,
      provider: "stripe",
      access_token: encrypt(key),
      config: { mode: key.includes("_test_") ? "test" : "live", restricted: key.startsWith("rk_") },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
