import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import { openai } from "./openai";
import { env } from "./env";
import { candidatePromptBlock, type CandidateBrief } from "./candidate";

/** Structured persona produced by the OpenAI model. Strict structured outputs: nullable, never optional. */
export const PersonaProfile = z.object({
  display_name: z.string(),
  one_line_summary: z.string(),
  summary: z.string().describe("3-6 sentence overview of who this person is publicly."),
  demographics: z.object({
    age_range: z.string().nullable(),
    location: z.string().nullable(),
    occupation: z.string().nullable(),
    languages: z.array(z.string()),
  }),
  personality_traits: z.array(z.string()),
  interests: z.array(z.string()),
  opinions: z.array(
    z.object({
      topic: z.string(),
      stance: z.string(),
      evidence: z.string().describe("Short quote or paraphrase from their posts backing this."),
      source_platform: z.string(),
    }),
  ),
  communication_style: z.object({
    tone: z.string(),
    vocabulary: z.string(),
    humor: z.string(),
    sentence_length: z.string(),
    emoji_and_slang: z.string(),
    typical_phrases: z.array(z.string()),
  }),
  notable_facts: z.array(
    z.object({
      fact: z.string(),
      source_platform: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  timeline: z.array(z.object({ date: z.string(), event: z.string() })),
  topics_to_avoid: z.array(z.string()),
  suggested_interview_questions: z.array(z.string()),
  voice: z.object({
    gender_presentation: z
      .enum(["male", "female", "neutral", "unknown"])
      .describe(
        "How the person presents publicly, from their name, photos, bio and how others refer to them. Picks a male or female voice; use neutral/unknown only when the data gives no signal.",
      ),
    age_sound: z.enum(["young", "middle_aged", "old", "unknown"]),
    accent: z.string().nullable(),
    description: z.string().describe("How their voice and delivery should sound in a voice simulation."),
  }),
  interview_first_message: z.string().describe("What the persona says to open the interview, in their voice."),
  roleplay_instructions: z
    .string()
    .describe("Second-person instructions ('You are ...') for a voice agent to play this persona in an interview."),
});
export type PersonaProfile = z.infer<typeof PersonaProfile>;

const SYSTEM_PROMPT = `You are an analyst building a realistic persona from a person's PUBLIC social media activity.
The persona will be used to simulate an interview with this person through a voice agent.

Rules:
- Ground every claim in the provided data. Do not invent private facts (addresses, family members' names, health, finances) that are not explicitly public in the data.
- When the data is thin, say so in the summary and lower confidence instead of guessing.
- Capture HOW they talk (tone, phrases, humor, emoji, slang) as carefully as WHAT they think.
- Opinions must cite evidence from the posts.
- roleplay_instructions must tell the agent to stay in character, answer as this person would, keep spoken answers short and natural, admit uncertainty about things not covered by their public activity, and never claim to be the real person if sincerely asked whether it is an AI.`;

export type DigestItem = {
  platform: string;
  kind: string;
  author: string | null;
  text: string | null;
  posted_at: string | null;
  url: string | null;
  metrics: Record<string, unknown>;
};

const MAX_DIGEST_CHARS = 120_000;
const MAX_POST_CHARS = 1_200;

/** Turns scraped items into a compact text digest that fits comfortably in the model context. */
export function buildDigest(subjectName: string, notes: string | null, items: DigestItem[]): string {
  const parts: string[] = [`Subject: ${subjectName}`];
  if (notes) parts.push(`Researcher notes: ${notes}`);

  const profiles = items.filter((i) => i.kind === "profile");
  const posts = items
    .filter((i) => i.kind !== "profile" && i.text)
    .sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""));

  parts.push("\n## Profiles");
  for (const p of profiles) {
    const stats = Object.keys(p.metrics).length ? ` ${JSON.stringify(p.metrics)}` : "";
    parts.push(`[${p.platform}] @${p.author ?? "?"}${stats} ${p.url ?? ""}\nBio: ${p.text ?? "(none)"}`);
  }

  parts.push("\n## Posts (newest first)");
  let size = parts.join("\n").length;
  for (const post of posts) {
    const line = `[${post.platform} ${post.kind} ${post.posted_at?.slice(0, 10) ?? "?"}${
      Object.keys(post.metrics).length ? " " + JSON.stringify(post.metrics) : ""
    }] ${post.text!.slice(0, MAX_POST_CHARS)}`;
    if (size + line.length > MAX_DIGEST_CHARS) break;
    parts.push(line);
    size += line.length + 1;
  }
  return parts.join("\n");
}

/** Starts persona generation in OpenAI background mode, so no serverless function has to wait for it. */
export async function startPersonaGeneration(digest: string): Promise<{ responseId: string; model: string }> {
  const model = env().OPENAI_PERSONA_MODEL;
  const response = await openai().responses.create({
    model,
    background: true,
    store: true,
    instructions: SYSTEM_PROMPT,
    input: digest,
    text: { format: zodTextFormat(PersonaProfile, "persona") },
  });
  return { responseId: response.id, model };
}

export type PersonaPoll =
  | { state: "pending" }
  | { state: "ready"; profile: PersonaProfile }
  | { state: "failed"; error: string };

export async function pollPersonaGeneration(responseId: string): Promise<PersonaPoll> {
  const response: OpenAIResponse = await openai().responses.retrieve(responseId);
  switch (response.status) {
    case "queued":
    case "in_progress":
      return { state: "pending" };
    case "completed": {
      const parsed = PersonaProfile.safeParse(safeJson(response.output_text));
      return parsed.success
        ? { state: "ready", profile: parsed.data }
        : { state: "failed", error: "Model returned a persona that did not match the schema" };
    }
    default:
      return {
        state: "failed",
        error: response.error?.message ?? response.incomplete_details?.reason ?? `OpenAI status: ${response.status}`,
      };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Full system prompt for the ElevenLabs voice agent playing this persona. With a candidate brief the persona
 * plays a job candidate interviewed by HR (see src/lib/candidate.ts).
 */
export function agentSystemPrompt(
  profile: PersonaProfile,
  candidate?: CandidateBrief | null,
  opts: { feelingTool?: boolean } = {},
): string {
  return `${profile.roleplay_instructions}
${candidate ? `\n${candidatePromptBlock(candidate, opts.feelingTool ?? true)}\n` : ""}

# Who you are
${profile.summary}

# How you talk
Tone: ${profile.communication_style.tone}
Vocabulary: ${profile.communication_style.vocabulary}
Humor: ${profile.communication_style.humor}
Sentence length: ${profile.communication_style.sentence_length}
Typical phrases: ${profile.communication_style.typical_phrases.join(" | ")}

# What you care about
Interests: ${profile.interests.join(", ")}
Traits: ${profile.personality_traits.join(", ")}
${profile.opinions.map((o) => `- ${o.topic}: ${o.stance}`).join("\n")}

# Facts you can draw on
${profile.notable_facts.map((f) => `- ${f.fact}`).join("\n")}

# Boundaries
Avoid or deflect: ${profile.topics_to_avoid.join(", ") || "nothing specific"}.
This is a simulated interview based only on public posts. Stay in character, keep answers spoken and concise,
and if you are sincerely asked whether you are an AI, say that you are an AI simulation.`;
}
