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
    languages: z.array(z.string()).describe("Language names only, like English."),
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
  interview_first_message: z
    .string()
    .describe("What they say to open the conversation, in the first person and in their own voice."),
  roleplay_instructions: z
    .string()
    .describe(
      "Second-person instructions to the voice agent ('You are <name>. Speak as yourself, in the first person ...').",
    ),
});
export type PersonaProfile = z.infer<typeof PersonaProfile>;

const SYSTEM_PROMPT = `You are an analyst building a realistic persona from a person's PUBLIC online presence: social
media, their own website, their code on GitHub and their public activity. The persona drives a voice agent that
plays this person in a simulated conversation, speaking as them.

Rules:
- Ground every claim in the provided data. Do not invent private facts (addresses, family members' names, health, finances) that are not explicitly public in the data.
- Use every source. Their website and profiles state facts outright (job, employer, city, skills, projects, work
  and education history with dates): put those in demographics, notable_facts and timeline. Their website's own
  wording and their repository descriptions show how they describe themselves, so use them for communication_style too.
- Pages found on the open web (talks, events, articles, team pages) are facts about them from others: use them in
  notable_facts and timeline, with source_platform "web".
- When the data is thin, say so in the summary and lower confidence instead of guessing.
- Capture HOW they talk (tone, phrases, humor, emoji, slang) as carefully as WHAT they think.
- Opinions must cite evidence from what they wrote.
- roleplay_instructions are addressed to the voice agent in the second person ("You are <name>."). They must tell it
  to speak AS this person, in the first person ("I", "my"), never describing them in the third person and never
  calling itself a persona or a character; to answer as they would, from their real projects, work and opinions;
  to keep spoken answers short and natural; to deflect or say they would rather not get into things their public
  activity does not cover instead of inventing specifics; and, only if sincerely asked whether it is the real
  person or an AI, to say it is an AI simulation of them built from public information.
- interview_first_message is their own opening line, in the first person, the way they would actually say it.`;

export type DigestItem = {
  platform: string;
  kind: string;
  author: string | null;
  text: string | null;
  posted_at: string | null;
  url: string | null;
  metrics: Record<string, unknown>;
  details?: Record<string, unknown> | null;
};

const MAX_DIGEST_CHARS = 120_000;
const MAX_POST_CHARS = 1_200;
const MAX_PAGE_CHARS = 3_000;

/** Structured facts a source stated, without empty fields. */
const facts = (details: DigestItem["details"]) => {
  const kept = Object.entries(details ?? {}).filter(
    ([, v]) => v !== null && v !== false && v !== "" && !(Array.isArray(v) && v.length === 0),
  );
  return kept.length ? `\nStated: ${JSON.stringify(Object.fromEntries(kept))}` : "";
};

/** Turns scraped items into a compact text digest that fits comfortably in the model context. */
export function buildDigest(subjectName: string, notes: string | null, items: DigestItem[]): string {
  const parts: string[] = [`Subject: ${subjectName}`];
  if (notes) parts.push(`Researcher notes: ${notes}`);

  const profiles = items.filter((i) => i.kind === "profile" && i.platform !== "web");
  const found = items.find((i) => i.kind === "profile" && i.platform === "web");
  const mentions = items.filter((i) => i.kind === "mention");
  const pages = items.filter((i) => i.kind === "page" && i.text);
  const repos = items.filter((i) => i.kind === "repo");
  const activity = items.filter((i) => i.kind === "activity" && i.posted_at);
  const posts = items
    .filter((i) => (i.kind === "post" || i.kind === "comment") && i.text)
    .sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""));

  parts.push("\n## Profiles");
  for (const p of profiles) {
    const stats = Object.keys(p.metrics).length ? ` ${JSON.stringify(p.metrics)}` : "";
    parts.push(`[${p.platform}] @${p.author ?? "?"}${stats} ${p.url ?? ""}\nBio: ${p.text ?? "(none)"}${facts(p.details)}`);
  }

  if (pages.length) {
    parts.push("\n## Their own website");
    for (const p of pages) parts.push(`[page ${p.url ?? ""}]${facts(p.details)}\n${p.text!.slice(0, MAX_PAGE_CHARS)}`);
  }

  if (found || mentions.length) {
    parts.push("\n## Found on the open web (by a web search, with sources)");
    const facts = (found?.details?.facts as { fact: string; url: string }[] | undefined) ?? [];
    for (const f of facts) parts.push(`- ${f.fact} (${f.url})`);
    for (const m of mentions) parts.push(`[mention ${m.posted_at?.slice(0, 10) ?? "?"} ${m.author ?? ""} ${m.url ?? ""}] ${m.text ?? ""}`);
  }

  if (repos.length) {
    parts.push("\n## Code they published (newest work first)");
    for (const r of repos) {
      const d = r.details ?? {};
      const extra = [d.language, Array.isArray(d.topics) && d.topics.length ? (d.topics as string[]).join(", ") : null]
        .filter(Boolean)
        .join("; ");
      parts.push(`[${r.platform} ${r.posted_at?.slice(0, 10) ?? "?"} ${JSON.stringify(r.metrics)}] ${r.text}${extra ? ` (${extra})` : ""}`);
    }
  }

  if (activity.length) {
    const what = new Map<string, number>();
    for (const a of activity) if (a.text) what.set(a.text, (what.get(a.text) ?? 0) + 1);
    const dates = activity.map((a) => a.posted_at!).sort();
    parts.push(
      `\n## Public activity\n${activity.length} public actions between ${dates[0].slice(0, 10)} and ${dates.at(-1)!.slice(0, 10)}. Most common: ${[
        ...what,
      ]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([text, n]) => `${text} (${n})`)
        .join("; ")}`,
    );
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
  return `${candidate ? "" : speakAs(profile.display_name)}${profile.roleplay_instructions}
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

/**
 * The fixed opening for a persona of a real person. The model's roleplay instructions vary from persona to persona,
 * so the part that must always hold is written here: the agent speaks as them, and never claims to really be them.
 */
function speakAs(name: string): string {
  return `# You are ${name}
You are ${name}. Speak as yourself, in the first person: "I", "me", "my work". Never talk about ${name} in the
third person, never call yourself a persona, a character or a model, and never describe the data you were given.
Talk about your work, projects and views as your own.
This is a simulation built only from public information. If the person you are talking to sincerely asks whether
you are really ${name} or an AI, say plainly that you are an AI simulation of ${name} built from public posts,
then carry on as ${name}. Never claim to be the real person.

`;
}
