import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Permanent account deletion.
 *
 * Deleting the `auth.users` row is the whole operation: every table in
 * migration `0001` carries `references auth.users(id) on delete cascade`, so
 * briefs, daily_metrics, integrations, chat_messages, tool_requests and
 * user_settings all go with it. Do not add manual cleanup here — a hand-written
 * delete list is a thing that silently falls out of date when a table is added,
 * and the cascade cannot.
 *
 * Anything added later that stores user data must cascade from `auth.users`
 * too, or this route quietly stops being complete and the privacy policy stops
 * being true.
 */
export async function DELETE() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("account deletion failed", error);
    return NextResponse.json({ error: "Couldn't delete your account." }, { status: 500 });
  }

  // The user row is gone, so the session's refresh token is already dead. This
  // clears the cookies so the browser isn't left holding a token for an account
  // that no longer exists.
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
