import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  APIFY_TOKEN: z.string().min(1),
  APIFY_WEBHOOK_SECRET: z.string().min(16),
  // Hard spending cap per actor run (all connectors use pay-per-event actors).
  APIFY_MAX_CHARGE_USD_PER_RUN: z.coerce.number().positive().default(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_PERSONA_MODEL: z.string().default("gpt-6.1-sol"),
  OPENAI_CHAT_MODEL: z.string().default("gpt-6-luna"),
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_WEBHOOK_SECRET: z.string().optional(),
  ELEVENLABS_DEFAULT_VOICE_ID: z.string().min(1),
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
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid or missing environment variables: ${missing}`);
    }
    cached = parsed.data;
  }
  return cached;
}
