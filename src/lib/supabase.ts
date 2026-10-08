import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let admin: SupabaseClient | undefined;

/** Server-only client using the secret key. Bypasses RLS, so always filter by user_id. */
export function db(): SupabaseClient {
  admin ??= createClient(env().SUPABASE_URL, env().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
