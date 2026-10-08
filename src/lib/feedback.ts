import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai } from "./openai";
import { envVar } from "./env";
import { db } from "./supabase";
import { check, maybe, must } from "./http";
import type { TranscriptTurn } from "./elevenlabs";
import type { FeelingEvent, InterviewRow } from "./interviews";
import type { PersonaRow } from "./research";
import type { PersonaProfile } from "./persona";
import type { CandidateBrief } from "./candidate";

/*
 * Candidate feedback after a practice interview. Like persona generation it runs in OpenAI background mode,
 * so no request waits for it:
 *
 *   interview done -> startFeedback claims feedback_status none->generating and starts a background response
 *   GET /api/interviews/:id -> advanceFeedback polls OpenAI -> validates quotes -> feedback_status ready | failed
 */

/** What the model returns. Strict structured outputs: nullable, never optional. */
export const CandidateFeedback = z.object({
  overall_feeling: z.string().describe("2-4 sentences in first person: how the interview felt to you."),
  would_accept_offer: z.enum(["yes", "maybe", "no"]),
  would_recommend_company: z.number().describe("0-10: would you tell a friend to apply here, based on this interview?"),
  scores: z.object({
    rapport: z.number().describe("1-5"),
    clarity_of_questions: z.number().describe("1-5"),
    respect: z.number().describe("1-5"),
    relevance_to_my_experience: z.number().describe("1-5: did they ask about your actual background?"),
    company_pitch: z.number().describe("1-5: did you learn why you'd want to work there?"),
  }),
  highlights: z.array(z.object({ quote: z.string(), why: z.string() })),
  lowlights: z.array(z.object({ quote: z.string(), why: z.string() })),
  inappropriate_questions: z.array(z.object({ quote: z.string(), issue: z.string() })),
  unanswered_candidate_questions: z.array(z.string()),
  undiscovered: z.array(z.string()).describe("Hidden facts the interviewer never got out of you."),
  tips_for_interviewer: z.array(z.string()),
  glassdoor_style_review: z.string().describe("A short, honest review you'd write about this interview."),
});
export type CandidateFeedback = z.infer<typeof CandidateFeedback>;

/** Stored in `interviews.feedback`: the model output plus numbers computed from the transcript. */
export type StoredFeedback = CandidateFeedback & {
  talk_ratio: { interviewer: number; candidate: number };
  words: { interviewer: number; candidate: number };
  dropped_quotes: number;
};

const INSTRUCTIONS = `You are a job candidate who just finished a practice interview. You receive your own persona
(including your private motivations, worries and hidden facts), the difficulty you played, the full transcript
("Interviewer" is the HR person, "Me" is you), and a timeline of how you felt during the call.

Write honest feedback for the interviewer about how YOU felt as the candidate.
- Write in first person, like a real candidate giving a candid debrief.
- Every highlight, lowlight and inappropriate question must quote the transcript word for word.
- Be specific and fair: praise what worked, call out what did not.
- "undiscovered" lists your hidden facts the interviewer never got you to share.
- Flag questions that could be discriminatory or legally risky (age, family plans, religion, health,
  nationality, sexual orientation, politics).
- Tips must be concrete and actionable, tied to this conversation, not generic interview advice.
- If the transcript is very short, say so and keep scores conservative.`;

export async function startFeedback(interview: InterviewRow, opts: { force?: boolean } = {}): Promise<InterviewRow> {
  if (interview.status !== "done") return interview;

  // Claim generation so the webhook and polling can't both start it. A forced restart may take over any state.
  let claim = db()
    .from("interviews")
    .update({ feedback_status: "generating", feedback_response_id: null, feedback_error: null })
    .eq("id", interview.id)
    .eq("status", "done");
  if (!opts.force) claim = claim.eq("feedback_status", "none");
  const claimed = maybe(await claim.select().maybeSingle<InterviewRow>());
  if (!claimed) return reload(interview.id);

  try {
    const transcript = spokenTurns(claimed.transcript);
    if (!transcript.some((t) => t.role === "user")) {
      return fail(claimed.id, NO_INTERVIEWER);
    }
    const persona = must(await db().from("personas").select().eq("id", claimed.persona_id).single<PersonaRow>());

    const responseId = await startFeedbackResponse({
      profile: persona.profile,
      candidate: persona.candidate,
      difficulty: claimed.difficulty,
      feelings: claimed.feelings,
      transcript,
    });
    return must(
      await db()
        .from("interviews")
        .update({ feedback_response_id: responseId })
        .eq("id", claimed.id)
        .select()
        .single<InterviewRow>(),
    );
  } catch (err) {
    return fail(claimed.id, `Could not start feedback: ${err instanceof Error ? err.message : err}`);
  }
}

/** Moves feedback forward as far as it can right now. Safe to call repeatedly and concurrently. */
export async function advanceFeedback(interview: InterviewRow): Promise<InterviewRow> {
  if (interview.status === "done" && interview.feedback_status === "none") return startFeedback(interview);
  if (interview.feedback_status !== "generating" || !interview.feedback_response_id) return interview;

  const poll = await pollFeedbackResponse(interview.feedback_response_id, spokenTurns(interview.transcript));
  if (poll.state === "pending") return interview;
  if (poll.state === "failed") return fail(interview.id, poll.error);

  const feedback = poll.feedback;
  // Only the request that still sees this response as pending writes the result.
  const updated = maybe(
    await db()
      .from("interviews")
      .update({ feedback_status: "ready", feedback })
      .eq("id", interview.id)
      .eq("feedback_status", "generating")
      .eq("feedback_response_id", interview.feedback_response_id)
      .select()
      .maybeSingle<InterviewRow>(),
  );
  return updated ?? reload(interview.id);
}

export const NO_INTERVIEWER = "The interviewer never spoke, so there is nothing to give feedback on";

/** Everything the feedback model needs. Shared by stored interviews and the local test route. */
export type FeedbackSource = {
  profile: PersonaProfile | null;
  candidate: CandidateBrief | null;
  difficulty: string;
  feelings: FeelingEvent[];
  transcript: TranscriptTurn[];
};

/** Starts feedback generation in OpenAI background mode; returns the response ID to poll. */
export async function startFeedbackResponse(src: FeedbackSource): Promise<string> {
  const response = await openai().responses.create({
    model: envVar("OPENAI_FEEDBACK_MODEL") || envVar("OPENAI_PERSONA_MODEL"),
    background: true,
    store: true,
    instructions: INSTRUCTIONS,
    input: feedbackInput(src),
    text: { format: zodTextFormat(CandidateFeedback, "candidate_feedback") },
  });
  return response.id;
}

export type FeedbackPoll =
  | { state: "pending" }
  | { state: "ready"; feedback: StoredFeedback }
  | { state: "failed"; error: string };

/** Checks a background feedback response; when done, validates it against the transcript. */
export async function pollFeedbackResponse(responseId: string, transcript: TranscriptTurn[]): Promise<FeedbackPoll> {
  const response = await openai().responses.retrieve(responseId);
  if (response.status === "queued" || response.status === "in_progress") return { state: "pending" };
  if (response.status !== "completed") {
    return {
      state: "failed",
      error: response.error?.message ?? response.incomplete_details?.reason ?? `OpenAI status: ${response.status}`,
    };
  }
  const parsed = CandidateFeedback.safeParse(safeJson(response.output_text));
  if (!parsed.success) return { state: "failed", error: "Model returned feedback that did not match the schema" };
  return { state: "ready", feedback: finalize(parsed.data, transcript) };
}

/** Transcript turns that contain speech (tool-call turns have no message). */
export function spokenTurns(transcript: unknown[] | null): TranscriptTurn[] {
  return ((transcript ?? []) as TranscriptTurn[]).filter((t) => t.message?.trim());
}

function feedbackInput(src: FeedbackSource): string {
  const feelings = src.feelings.length
    ? src.feelings.map((f) => `[${clock(f.t)}] ${f.feeling} (${f.intensity}/5): ${f.reason}`).join("\n")
    : "(not recorded)";
  const transcript = src.transcript;
  return [
    `# My persona\n${JSON.stringify(src.profile)}`,
    `# My situation as a candidate\n${src.candidate ? JSON.stringify(src.candidate) : "(no candidate brief)"}`,
    `# Difficulty I played\n${src.difficulty}`,
    `# Transcript\n${transcript.map((t) => `[${clock(t.time_in_call_secs)}] ${t.role === "user" ? "Interviewer" : "Me"}: ${t.message}`).join("\n")}`,
    `# How I felt during the call\n${feelings}`,
  ].join("\n\n");
}

/** Drops quotes the model made up and adds talk ratio, both computed from the real transcript. */
function finalize(feedback: CandidateFeedback, transcript: TranscriptTurn[]): StoredFeedback {
  const haystack = normalize(transcript.map((t) => t.message).join(" "));
  const real = (q: { quote: string }) => normalize(q.quote).length > 0 && haystack.includes(normalize(q.quote));
  const highlights = feedback.highlights.filter(real);
  const lowlights = feedback.lowlights.filter(real);
  const inappropriate = feedback.inappropriate_questions.filter(real);
  const dropped =
    feedback.highlights.length + feedback.lowlights.length + feedback.inappropriate_questions.length -
    (highlights.length + lowlights.length + inappropriate.length);

  const count = (role: TranscriptTurn["role"]) =>
    transcript.filter((t) => t.role === role).reduce((n, t) => n + (t.message?.split(/\s+/).filter(Boolean).length ?? 0), 0);
  const words = { interviewer: count("user"), candidate: count("agent") };
  const total = words.interviewer + words.candidate || 1;

  return {
    ...feedback,
    highlights,
    lowlights,
    inappropriate_questions: inappropriate,
    words,
    talk_ratio: {
      interviewer: Math.round((words.interviewer / total) * 100),
      candidate: Math.round((words.candidate / total) * 100),
    },
    dropped_quotes: dropped,
  };
}

const normalize = (s: string | null) =>
  (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const clock = (secs?: number) => {
  const s = Math.max(0, Math.round(secs ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function fail(id: string, error: string): Promise<InterviewRow> {
  check(await db().from("interviews").update({ feedback_status: "failed", feedback_error: error }).eq("id", id));
  return reload(id);
}

async function reload(id: string): Promise<InterviewRow> {
  return must(await db().from("interviews").select().eq("id", id).single<InterviewRow>());
}
