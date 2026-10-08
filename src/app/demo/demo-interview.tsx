"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

/** A demo's way into a conversation: makes the demo persona for this visitor, then opens the room. */
export function DemoInterview({ who }: { who: "mara" | "simon" }) {
  const router = useRouter();
  const [problem, setProblem] = useState("");
  useEffect(() => {
    api<{ personaId: string }>("/api/demo/persona", { method: "POST", body: JSON.stringify({ who }) })
      .then(({ personaId }) => router.replace(`/interview/${personaId}`))
      .catch((err) => setProblem(err instanceof Error ? err.message : "Something went wrong"));
  }, [router, who]);
  return (
    <main className="dark grid min-h-svh place-items-center bg-background text-foreground">
      <p className={problem ? "text-label text-muted" : "shimmer text-[11px] font-medium tracking-[0.22em] text-muted uppercase"}>
        {problem || "Opening the room"}
      </p>
    </main>
  );
}
