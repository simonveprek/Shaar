import type { Metadata } from "next";
import { Suspense } from "react";
import { BRAND } from "@/components/meet/brand";
import { DevMeet } from "./DevMeet";

export const metadata: Metadata = {
  title: `${BRAND.name} ${BRAND.product}`,
  robots: { index: false },
};

/**
 * Practice-interview call UI, test mode:
 *   /meet?agent=<agent_id>&fixture=alex-novak&name=Alex%20Novak&role=Senior%20Frontend%20Engineer
 * `fixture` enables the candidate's feedback after the call (needs OPENAI_API_KEY). `npm run try:agent -- <fixture>
 * --feelings` prints the full URL. Add `&ui=call`, `&ui=left` or `&ui=feedback` to preview a screen with sample data.
 */
export default function MeetPage(props: PageProps<"/meet">) {
  return (
    <Suspense>
      <MeetFromQuery searchParams={props.searchParams} />
    </Suspense>
  );
}

async function MeetFromQuery({ searchParams }: Pick<PageProps<"/meet">, "searchParams">) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const agentId = one(q.agent);
  const difficulty = one(q.difficulty);
  const ui = one(q.ui);
  const fixture = one(q.fixture);

  if (!agentId) {
    return (
      <main style={{ maxWidth: 640, margin: "64px auto", padding: "0 16px", fontFamily: "Roboto, Arial, sans-serif", lineHeight: 1.6 }}>
        <h1 style={{ fontWeight: 400 }}>
          {BRAND.name} {BRAND.product}: test mode
        </h1>
        <p>Open this page with a public candidate agent:</p>
        <pre style={{ background: "#f1f3f4", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap" }}>
          /meet?agent=agent_…&amp;fixture=alex-novak&amp;name=Alex%20Novak&amp;role=Senior%20Frontend%20Engineer
        </pre>
        <p>
          Create one with <code>npm run try:agent -- alex-novak --feelings</code>; it prints the full link.
        </p>
      </main>
    );
  }

  return (
    <DevMeet
      agentId={agentId}
      name={one(q.name) ?? "Candidate"}
      subtitle={one(q.role)}
      difficulty={difficulty === "friendly" || difficulty === "tough" ? difficulty : "realistic"}
      fixture={fixture && /^[a-z0-9-]+$/.test(fixture) ? fixture : undefined}
      ui={ui === "call" || ui === "left" || ui === "feedback" ? ui : undefined}
    />
  );
}
