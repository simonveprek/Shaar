"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

/** The demo's way into a conversation with Mara Vell: makes her persona for this visitor, then opens the room. */
export default function DemoInterview() {
  const router = useRouter();
  const [problem, setProblem] = useState("");
  useEffect(() => {
    api<{ personaId: string }>("/api/demo/persona", { method: "POST", body: "{}" })
      .then(({ personaId }) => router.replace(`/interview/${personaId}`))
      .catch((err) => setProblem(err instanceof Error ? err.message : "Something went wrong"));
  }, [router]);
  return (
    <main className="dark grid min-h-svh place-items-center bg-background text-foreground">
      <p className={problem ? "text-label text-muted" : "shimmer text-[11px] font-medium tracking-[0.22em] text-muted uppercase"}>
        {problem || "Opening the room"}
      </p>
    </main>
  );
}
