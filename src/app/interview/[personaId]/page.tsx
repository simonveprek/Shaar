import type { Metadata } from "next";
import { Suspense } from "react";
import { InterviewRoom } from "./room";

export const metadata: Metadata = { title: "Interrogation", robots: { index: false } };

/** A simulated voice interview with a persona. The room reads the persona id from the address in the browser. */
export default function InterviewPage() {
  return (
    <Suspense fallback={<main className="dark min-h-svh bg-background" />}>
      <InterviewRoom />
    </Suspense>
  );
}
