import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { discoverSchema, countInWindow } from "@/lib/collectors/supabase";

async function requireUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Only real Supabase hosts — this URL is fetched server-side, so an open
// pattern here would be an SSRF hole (probing internal services through us).
const urlSchema = z
  .string()
  .url()
  .refine((u) => {
    try {
      const parsed = new URL(u);
      return (
        parsed.protocol === "https:" &&
        parsed.port === "" &&
        /^[a-z0-9-]+\.supabase\.(co|com)$/.test(parsed.hostname)
      );
    } catch {
      return false;
    }
  }, "Must be your project URL, e.g. https://abc123.supabase.co");

// Postgres identifiers only — these end up in a URL path we request.
const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Invalid name").max(63);

// Step 1: discover — validate credentials and list tables (nothing stored yet)
const DiscoverSchema = z.object({
  action: z.literal("discover"),
  url: urlSchema,
  key: z.string().min(20),
});

// Step 2: save — verify the mapping works, then store encrypted
const SaveSchema = z.object({
  action: z.literal("save"),
  url: urlSchema,
  key: z.string().min(20),
  table: identifier,
  ts_column: identifier,
});

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json();

  if (body.action === "discover") {
    const parsed = DiscoverSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid URL or key" }, { status: 400 });
    try {
      const tables = await discoverSchema(parsed.data.url, parsed.data.key);
      const usable = tables.filter((t) => t.timestamp_columns.length > 0);
      if (!usable.length) {
        return NextResponse.json(
          { error: "Connected, but no tables with a timestamp column were found." },
          { status: 422 }
        );
      }
      return NextResponse.json({ tables: usable });
    } catch (e: any) {
      return NextResponse.json({ error: e.message ?? "Could not connect" }, { status: 502 });
    }
  }

  if (body.action === "save") {
    const parsed = SaveSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid mapping" }, { status: 400 });
    const { url, key, table, ts_column } = parsed.data;

    // Verify the mapping actually counts before trusting it
    try {
      const now = new Date();
      await countInWindow(url, key, table, ts_column, new Date(now.getTime() - 86400000), now);
    } catch {
      return NextResponse.json(
        { error: `Couldn't count rows in "${table}" by "${ts_column}". Check the mapping.` },
        { status: 422 }
      );
    }

    const admin = createAdminClient();
    const { error } = await admin.from("integrations").upsert(
      {
        user_id: user.id,
        provider: "supabase",
        access_token: encrypt(key),
        config: { url, table, ts_column },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
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
