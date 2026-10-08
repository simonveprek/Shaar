import { z } from "zod";
import { HttpError } from "./http";

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  // Signs the visitor cookie. Optional: derived from SUPABASE_SECRET_KEY when unset.
  VISITOR_SECRET: z.string().min(16).optional(),
  APIFY_TOKEN: z.string().min(1),
  // Needed only with PUBLIC_API_URL, to accept Apify webhooks.
  APIFY_WEBHOOK_SECRET: z.string().min(16).optional(),
  // Hard spending cap per actor run (all connectors use pay-per-event actors).
  APIFY_MAX_CHARGE_USD_PER_RUN: z.coerce.number().positive().default(1),
  // The services below are only needed by the features that use them, so search and the file work without them.
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_PERSONA_MODEL: z.string().default("gpt-6.1-sol"),
  OPENAI_CHAT_MODEL: z.string().default("gpt-6-luna"),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_WEBHOOK_SECRET: z.string().optional(),
  ELEVENLABS_DEFAULT_VOICE_ID: z.string().min(1).optional(),
  ELEVENLABS_AGENT_LLM: z.string().default("gpt-6-luna"),
  ELEVENLABS_TTS_MODEL: z.string().default("eleven_v4_turbo"),
  // Public base URL of this backend, used for Apify webhooks. Leave unset locally: runs are then polled.
  PUBLIC_API_URL: z.url().optional(),
  // Comma-separated list of frontend origins allowed to call the API.
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated server environment. Parsed lazily so `next build` works without secrets. */
export function env(): Env {
  if (!cached) {
    const set = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
    const parsed = schema.safeParse(set);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid or missing environment variables: ${missing}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** A key a feature needs. Throws a clear 503 when that feature is not set up yet. */
export function need<K extends keyof Env>(key: K, feature: string): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === null || value === "") {
    throw new HttpError(503, `${feature} is not set up yet`);
  }
  return value as NonNullable<Env[K]>;
}
