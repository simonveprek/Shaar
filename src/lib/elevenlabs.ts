import { createHmac, timingSafeEqual } from "node:crypto";
import { envVar } from "./env";
import { HttpError } from "./http";
import { agentSystemPrompt, type PersonaProfile } from "./persona";
import { FEELING_TOOL, FEELINGS, type CandidateBrief } from "./candidate";

const BASE_URL = "https://api.elevenlabs.io";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "xi-api-key": envVar("ELEVENLABS_API_KEY"), "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new HttpError(502, `ElevenLabs ${init.method ?? "GET"} ${path} failed (${res.status})`, body.slice(0, 1000));
  }
  return (await res.json()) as T;
}

/** Client tool the candidate agent calls silently; the browser handles it (see FEELING_TOOL). */
const feelingToolConfig = {
  type: "client",
  name: FEELING_TOOL,
  description:
    "Silently report how you, the candidate, currently feel about the interview. Call it whenever your feeling noticeably changes. Never mention it out loud.",
  expects_response: false,
  parameters: {
    type: "object",
    properties: {
      feeling: { type: "string", enum: [...FEELINGS], description: "Your current feeling." },
      intensity: { type: "number", description: "How strong the feeling is, 1 (slight) to 5 (very strong)." },
      reason: { type: "string", description: "Short reason, e.g. 'they asked about my open-source project'." },
    },
    required: ["feeling", "intensity", "reason"],
  },
};

/**
 * `feelingTool: false` leaves out reportFeeling, for clients that can't handle it (e.g. the ElevenLabs test page).
 * `publicAccess: true` lets anyone with the agent ID call it (test agents only); otherwise calls need the
 * conversation token or signed URL this backend hands out.
 */
export type AgentOptions = { feelingTool?: boolean; publicAccess?: boolean };

function agentConfig(profile: PersonaProfile, voiceId: string, candidate: CandidateBrief | null, opts: AgentOptions) {
  const feelingTool = opts.feelingTool ?? true;
  const prompt = { prompt: agentSystemPrompt(profile, candidate, { feelingTool }), llm: envVar("ELEVENLABS_AGENT_LLM") };
  return {
    name: `Persona: ${profile.display_name}`.slice(0, 100),
    tags: candidate ? ["projstalker", "persona", "candidate"] : ["projstalker", "persona"],
    conversation_config: {
      agent: candidate
        ? {
            // The candidate just joins the call; HR leads the interview.
            first_message: "Hi, hello? Can you hear me okay?",
            language: "en",
            // `tools` inline is deprecated in favour of `tool_ids`, but still accepted and keeps the agent self-contained.
            // Empty lists also remove a previously added tool on update.
            prompt: feelingTool ? { ...prompt, tools: [feelingToolConfig] } : { ...prompt, tools: [], tool_ids: [] },
            dynamic_variables: { dynamic_variable_placeholders: { difficulty: "realistic" } },
          }
        : { first_message: profile.interview_first_message, language: "en", prompt },
      tts: { voice_id: voiceId, model_id: envVar("ELEVENLABS_TTS_MODEL") },
      // Give HR time to think before the candidate fills the silence, and cap the cost of a forgotten call.
      ...(candidate && { turn: { turn_timeout: 10 }, conversation: { max_duration_seconds: 900 } }),
    },
    platform_settings: { auth: { enable_auth: !opts.publicAccess } },
  };
}

/** Creates a private ElevenLabs agent that plays the persona. The prompt stays server-side. */
export async function createPersonaAgent(
  profile: PersonaProfile,
  voiceId: string,
  candidate: CandidateBrief | null = null,
  opts: AgentOptions = {},
): Promise<string> {
  const { agent_id } = await call<{ agent_id: string }>("/v1/convai/agents/create", {
    method: "POST",
    body: JSON.stringify(agentConfig(profile, voiceId, candidate, opts)),
  });
  return agent_id;
}

export async function updatePersonaAgent(
  agentId: string,
  profile: PersonaProfile,
  voiceId: string,
  candidate: CandidateBrief | null = null,
  opts: AgentOptions = {},
): Promise<void> {
  await call(`/v1/convai/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify(agentConfig(profile, voiceId, candidate, opts)),
  });
}

export async function deleteAgent(agentId: string): Promise<void> {
  await call(`/v1/convai/agents/${agentId}`, { method: "DELETE" });
}

/** WebRTC token for the browser SDK: `startSession({ conversationToken })`. */
export async function getConversationToken(agentId: string, participantName?: string) {
  const params = new URLSearchParams({ agent_id: agentId });
  if (participantName) params.set("participant_name", participantName);
  return call<{ token: string; conversation_id: string }>(`/v1/convai/conversation/token?${params}`);
}

/** Signed WebSocket URL for the browser SDK: `startSession({ signedUrl })`. Valid 15 minutes. */
export async function getSignedUrl(agentId: string) {
  const params = new URLSearchParams({ agent_id: agentId, include_conversation_id: "true" });
  return call<{ signed_url: string }>(`/v1/convai/conversation/get-signed-url?${params}`);
}

export type TranscriptTurn = {
  role: "user" | "agent";
  message: string | null;
  time_in_call_secs?: number;
};

export type ConversationDetails = {
  agent_id: string;
  conversation_id: string;
  status: string; // initiated | in-progress | processing | done | failed
  transcript: TranscriptTurn[];
  metadata?: { call_duration_secs?: number; start_time_unix_secs?: number };
  analysis?: Record<string, unknown> | null;
};

export async function getConversation(conversationId: string): Promise<ConversationDetails> {
  return call<ConversationDetails>(`/v1/convai/conversations/${encodeURIComponent(conversationId)}`);
}

/** Streams speech audio (mp3) for arbitrary text. */
export async function textToSpeech(text: string, voiceId: string, modelId?: string): Promise<Response> {
  const res = await fetch(
    `${BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": envVar("ELEVENLABS_API_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: modelId ?? envVar("ELEVENLABS_TTS_MODEL") }),
    },
  );
  if (!res.ok || !res.body) {
    throw new HttpError(502, `ElevenLabs text-to-speech failed (${res.status})`, (await res.text()).slice(0, 1000));
  }
  return res;
}

/**
 * Verifies the `ElevenLabs-Signature: t=<unix>,v0=<hex>` header:
 * HMAC-SHA256(secret, `${t}.${rawBody}`), rejecting timestamps older than 30 minutes.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!parts.v0 || !Number.isFinite(t)) return false;
  if (Math.abs(Date.now() / 1000 - t) > 30 * 60) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v0);
  return a.length === b.length && timingSafeEqual(a, b);
}
