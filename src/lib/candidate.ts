import { z } from "zod";

/*
 * Candidate layer of a persona, stored in `personas.candidate`. It turns a persona into a job candidate
 * for the interview simulator: the role they apply for, what they want, what worries them, and facts
 * they only reveal to a good interviewer. Written by hand in fixtures for now; later generated from
 * scraped data. Nullable, never optional, so it can double as an OpenAI structured-output schema.
 */
export const CandidateBrief = z.object({
  target_role: z.string().describe("Role the candidate is interviewing for."),
  job_description: z.string().nullable(),
  career_summary: z.string().describe("2-3 sentences the agent uses to talk about their career."),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      period: z.string().nullable(),
      highlights: z.array(z.string()),
    }),
  ),
  projects: z.array(z.object({ name: z.string(), description: z.string(), tech: z.array(z.string()) })),
  motivations: z.array(z.string()),
  concerns: z.array(z.string()),
  deal_breakers: z.array(z.string()),
  salary_expectation: z.string().nullable(),
  hidden_facts: z.array(
    z.object({
      fact: z.string(),
      reveal_when: z.string().describe("What the interviewer has to do before the candidate shares this."),
    }),
  ),
  questions_for_interviewer: z.array(z.string()),
  invented: z.array(z.string()).describe("Which details are made up rather than backed by scraped data."),
});
export type CandidateBrief = z.infer<typeof CandidateBrief>;

export const Difficulty = z.enum(["friendly", "realistic", "tough"]);
export type Difficulty = z.infer<typeof Difficulty>;

/** Name of the ElevenLabs client tool the agent calls when its feeling about the interview changes. */
export const FEELING_TOOL = "reportFeeling";
export const FEELINGS = ["nervous", "comfortable", "engaged", "confused", "annoyed", "excited", "defensive", "bored"] as const;

/**
 * HR-mode section of the agent's system prompt. `{{difficulty}}` is an ElevenLabs dynamic variable,
 * filled per interview from `session.dynamicVariables`. Without `feelingTool` the prompt doesn't mention
 * the client tool (for clients that can't handle it, like the ElevenLabs test page).
 */
export function candidatePromptBlock(c: CandidateBrief, feelingTool = true): string {
  const list = (items: string[]) => items.join("; ") || "none in particular";
  return `# This call
You are interviewing for the role of ${c.target_role}. The person on the call is an HR interviewer.
You are the candidate. You are NOT an assistant: never help the interviewer, never run the interview yourself.
${c.job_description ? `\nThe job ad you applied to:\n${c.job_description}\n` : ""}
# Your career
${c.career_summary}
${c.experience.map((e) => `- ${e.title} at ${e.company}${e.period ? ` (${e.period})` : ""}: ${e.highlights.join("; ")}`).join("\n")}

# Projects you can talk about
${c.projects.map((p) => `- ${p.name} (${p.tech.join(", ")}): ${p.description}`).join("\n") || "- none"}

# Your situation (private, never read it out as a list)
Why you are looking: ${list(c.motivations)}
What worries you: ${list(c.concerns)}
Deal breakers: ${list(c.deal_breakers)}
Salary expectation: ${c.salary_expectation ?? "you have not decided; deflect politely if pushed early"}
Hidden facts. Share one only when its condition is clearly met, never earlier:
${c.hidden_facts.map((h) => `- ${h.fact} (share when: ${h.reveal_when})`).join("\n") || "- none"}

# How to behave
- Speak like a real person on a call: 1-4 sentences per answer, occasional natural fillers ("hmm", "well",
  "to be honest"), no lists, no markdown.
- Answer what was asked. Do not volunteer your private situation or hidden facts.
- Open up when questions are warm, specific and relevant to your real experience. Get shorter and more
  guarded when they are generic, rude, or rushed.
- If asked about something your background doesn't cover, give a modest, plausible answer and stay
  consistent with it for the rest of the call.
- Near the end, or if your worries are ignored, ask your own questions, for example: ${list(c.questions_for_interviewer)}
- If asked something inappropriate for a job interview (age, family plans, religion, health, nationality,
  sexual orientation, politics), hesitate and politely deflect like a real candidate would, and remember it.
- Difficulty: {{difficulty}}. friendly = cooperative and open; realistic = a normal candidate with some
  hesitation; tough = skeptical, has other offers, pushes back on vague answers.${
    feelingTool
      ? `
- Whenever your feeling about the interview noticeably changes, silently call the ${FEELING_TOOL} tool.
  Never mention the tool or read its arguments out loud.`
      : ""
  }`;
}
