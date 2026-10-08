"use client";

import type { HookOptions } from "@elevenlabs/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MeetCall, type CandidateFeedback, type FeelingEvent } from "@/components/meet/MeetCall";
import { cx } from "@/components/ui";
import { api, ApiError } from "@/lib/client";

/*
 * The interrogation. Michael's MeetCall runs the call (lobby, live captions, feelings, hanging up); this page
 * only starts it through our API, as docs/interview-integration.md 2.4 describes. A persona built from a real
 * person's posts has no candidate layer, so it talks as itself and there is no candidate feedback afterwards.
 * Practice candidates (from /api/dev/seed-candidates) keep their difficulty and feedback.
 */

type Persona = {
  id: string;
  status: "generating" | "ready" | "failed";
  profile: { display_name: string; one_line_summary: string } | null;
  candidate: { target_role?: string } | null;
};
type Interview = { id: string; feedback_status: string; feedback: CandidateFeedback | null; feedback_error: string | null };

const CAPTION = "text-[11px] font-medium tracking-[0.22em] text-muted uppercase";

async function waitForFeedback(id: string): Promise<CandidateFeedback> {
  for (;;) {
    const { interview } = await api<{ interview: Interview }>(`/api/interviews/${id}`);
    if (interview.feedback_status === "ready" && interview.feedback) return interview.feedback;
    if (interview.feedback_status === "failed") throw new Error(interview.feedback_error ?? "Feedback failed");
    await new Promise((r) => setTimeout(r, 3000));
  }
}

export function InterviewRoom() {
  const { personaId } = useParams<{ personaId: string }>();
  const [persona, setPersona] = useState<Persona | null>(null);
  const [problem, setProblem] = useState("");
  const interviewId = useRef<string | null>(null);

  useEffect(() => {
    api<{ persona: Persona }>(`/api/personas/${personaId}`)
      .then(({ persona }) =>
        persona.status === "ready" && persona.profile ? setPersona(persona) : setProblem("They have not been read yet"),
      )
      .catch((err) => setProblem(err instanceof ApiError && err.status !== 401 ? err.message : "This persona does not exist, or it is not yours"));
  }, [personaId]);

  if (!persona?.profile) {
    return (
      <main className="dark grid min-h-svh place-items-center bg-background px-6 text-center text-foreground">
        <div className="flex flex-col items-center gap-8">
          <p className={cx(CAPTION, !problem && "shimmer")}>{problem || "Opening the room"}</p>
          {problem && (
            <Link href="/" className={cx(CAPTION, "underline decoration-underline underline-offset-[6px] hover:text-foreground")}>
              Someone else
            </Link>
          )}
        </div>
      </main>
    );
  }

  const isCandidate = Boolean(persona.candidate);
  return (
    <MeetCall
      candidate={{
        name: persona.profile.display_name,
        subtitle: persona.candidate?.target_role ?? persona.profile.one_line_summary,
      }}
      you="Spectator"
      connect={async (difficulty) => {
        const { interview, session } = await api<{ interview: { id: string }; session: HookOptions }>(
          `/api/personas/${persona.id}/interviews`,
          { method: "POST", body: JSON.stringify({ difficulty }) },
        );
        interviewId.current = interview.id;
        return session; // { conversationToken, dynamicVariables }: passed whole, as MeetCall expects
      }}
      onFeelings={(events: FeelingEvent[]) =>
        interviewId.current
          ? api(`/api/interviews/${interviewId.current}/feelings`, { method: "POST", body: JSON.stringify({ events }) })
          : undefined
      }
      loadFeedback={isCandidate ? () => waitForFeedback(interviewId.current!) : undefined}
    />
  );
}
