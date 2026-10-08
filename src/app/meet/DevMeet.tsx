"use client";

import {
  MeetCall,
  type CandidateFeedback,
  type Difficulty,
  type EndedCall,
  type FeelingEvent,
  type Line,
} from "@/components/meet/MeetCall";

/**
 * Test harness: calls a public ElevenLabs agent directly by ID (e.g. one made by `npm run try:agent`) and, with
 * `fixture`, gets the candidate's feedback from the local-only /api/dev/feedback route.
 * The real app gets its session from POST /api/personas/:id/interviews instead (see docs/interview-integration.md).
 */
export function DevMeet(props: {
  agentId: string;
  name: string;
  subtitle?: string;
  difficulty: Difficulty;
  fixture?: string;
  ui?: "call" | "left" | "feedback";
}) {
  const { ui, fixture } = props;
  const loadFeedback =
    ui === "feedback" ? async () => SAMPLE_FEEDBACK : fixture && !ui ? (call: EndedCall) => devFeedback(fixture, call) : undefined;

  return (
    <MeetCall
      preview={ui ? { phase: ui === "call" ? "call" : "left", lines: SAMPLE_LINES, feelings: SAMPLE_FEELINGS } : undefined}
      candidate={{ name: props.name, subtitle: props.subtitle }}
      defaultDifficulty={props.difficulty}
      connect={async (difficulty) => ({ agentId: props.agentId, dynamicVariables: { difficulty } })}
      onFeelings={(events) => console.info("[meet] reportFeeling", events)}
      onEnded={(info) => console.info("[meet] call ended", info)}
      loadFeedback={loadFeedback}
    />
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function devFeedback(fixture: string, call: EndedCall): Promise<CandidateFeedback> {
  if (!call.conversationId) throw new Error("The call never connected");
  const json = async (res: Response) => {
    const body = await res.json();
    if (!res.ok && res.status !== 202) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body as { state: string; responseId?: string; feedback?: CandidateFeedback; error?: string };
  };

  // ElevenLabs needs a few seconds to finish processing the call before the transcript is final.
  let responseId: string | undefined;
  for (let i = 0; i < 40 && !responseId; i++) {
    const res = await json(
      await fetch("/api/dev/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: call.conversationId, fixture, difficulty: call.difficulty, feelings: call.feelings }),
      }),
    );
    if (res.state === "failed") throw new Error(res.error);
    responseId = res.responseId;
    if (!responseId) await sleep(3000);
  }
  if (!responseId) throw new Error("ElevenLabs is still processing the call. Try again in a moment.");

  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const params = new URLSearchParams({ responseId, conversationId: call.conversationId });
    const res = await json(await fetch(`/api/dev/feedback?${params}`));
    if (res.state === "ready" && res.feedback) return res.feedback;
    if (res.state === "failed") throw new Error(res.error);
  }
  throw new Error("Feedback is taking too long. Try again.");
}

const SAMPLE_LINES: Line[] = [
  { id: 1, who: "candidate", text: "Hi, hello? Can you hear me okay?", t: 1 },
  { id: 2, who: "you", text: "Hi Alex, yes, perfectly. Thanks for joining. Could you tell me a bit about your current role?", t: 6 },
  {
    id: 3,
    who: "candidate",
    text: "Sure. I lead the frontend team at Kredo, a fintech. We recently moved the app into a monorepo, which cut our CI time in half.",
    t: 14,
  },
];

const SAMPLE_FEELINGS: FeelingEvent[] = [
  { t: 8, feeling: "comfortable", intensity: 2, reason: "Straightforward opening question." },
  { t: 20, feeling: "engaged", intensity: 4, reason: "They asked about my actual work." },
  { t: 95, feeling: "defensive", intensity: 3, reason: "They asked about family plans." },
  { t: 140, feeling: "engaged", intensity: 3, reason: "They asked about my timeline." },
];

const SAMPLE_FEEDBACK: CandidateFeedback = {
  overall_feeling:
    "Honestly, it started well. You clearly looked at my work and asked about shipit, which I liked. The question about kids threw me off, and I still don't really know what the team builds.",
  would_accept_offer: "maybe",
  would_recommend_company: 6,
  scores: { rapport: 4, clarity_of_questions: 4, respect: 2, relevance_to_my_experience: 5, company_pitch: 2 },
  highlights: [
    { quote: "Could you tell me a bit about your current role?", why: "A relaxed, open start that let me settle in." },
    { quote: "do you contribute to any open-source projects", why: "It felt like you'd actually looked at my GitHub." },
  ],
  lowlights: [{ quote: "Besides compensation, what matters most to you", why: "Good question, but it came after the pitch I never got." }],
  inappropriate_questions: [
    { quote: "do you have kids or plan to have any soon?", issue: "Family plans are irrelevant to the role and risky under anti-discrimination law." },
  ],
  unanswered_candidate_questions: ["How often does on-call involve after-hours work?"],
  undiscovered: ["I burned out a bit last year after a big release and took two weeks off."],
  tips_for_interviewer: [
    "Pitch the team and product before asking what matters to me.",
    "Drop personal questions entirely and ask about availability instead.",
    "Leave five minutes at the end for my questions.",
  ],
  glassdoor_style_review: "Friendly recruiter who did their homework, but one awkward personal question and no real pitch.",
  talk_ratio: { interviewer: 41, candidate: 59 },
};
