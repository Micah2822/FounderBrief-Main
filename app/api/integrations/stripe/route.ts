import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { verifyStripe } from "@/lib/collectors/stripe";
import { canAddConnector, CONNECTOR_LIMIT_MESSAGE } from "@/lib/billing";

// Restricted keys only. A secret key (sk_) can create charges and issue
// refunds; the brief needs nothing but reads, so accepting one would store far
// more authority than the product ever exercises.
const Schema = z.object({
  key: z
    .string()
    .regex(
      /^rk_(live|test)_[A-Za-z0-9]+$/,
      "That needs to be a restricted key (starts with rk_), not your secret key"
    ),
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

  // This is the paywall for the Stripe *connector* — the founder's own account,
  // read-only. It has nothing to do with the Stripe account that bills for
  // Founder Brief itself, which lives under /api/billing.
  if (!(await canAddConnector(user.id, "stripe"))) {
    return NextResponse.json({ error: CONNECTOR_LIMIT_MESSAGE, code: "limit" }, { status: 402 });
  }

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
      // Always true now that the schema rejects sk_. Kept in config rather than
      // dropped so Settings can still tell an old sk_ row apart from this one.
      config: { mode: key.includes("_test_") ? "test" : "live", restricted: true },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
