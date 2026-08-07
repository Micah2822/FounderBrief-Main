// Throwaway diagnostic for the "code is invalid/expired immediately" problem.
// Sends ONE code and makes exactly ONE verification attempt, so nothing is
// burned by a speculative retry, then prints the raw error.
//
//   node scripts/otp-debug.mjs you@example.com [email|signup] [pkce|implicit]
//
// Delete this file once sign-in works.

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const [email, type = "email", flowType = "pkce"] = process.argv.slice(2);
if (!email) {
  console.error("usage: node scripts/otp-debug.mjs <email> [email|signup] [pkce|implicit]");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { flowType, persistSession: false, autoRefreshToken: false } }
);

console.log(`project   ${env.NEXT_PUBLIC_SUPABASE_URL}`);
console.log(`email     ${email}`);
console.log(`type      ${type}`);
console.log(`flowType  ${flowType}\n`);

const sentAt = Date.now();
const { error: sendError } = await supabase.auth.signInWithOtp({ email });
if (sendError) {
  console.error("SEND FAILED:", JSON.stringify(sendError, null, 2));
  process.exit(1);
}
console.log("Code sent. Check the inbox.\n");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const token = (await rl.question("Paste the 6-digit code: ")).replace(/\D/g, "");
rl.close();

const elapsed = Math.round((Date.now() - sentAt) / 1000);
console.log(`\nVerifying ${token} — ${elapsed}s after the code was issued.\n`);

const { data, error } = await supabase.auth.verifyOtp({ email, token, type });

if (error) {
  console.error("VERIFY FAILED");
  console.error(JSON.stringify({ message: error.message, status: error.status, code: error.code }, null, 2));
} else {
  console.log("VERIFY OK — signed in as", data.user?.email);
  console.log("This combination works. Use it in app/login/page.tsx.");
}
