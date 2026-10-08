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
      <main className="dark grid min-h-svh place-items-center bg-background px-5 text-foreground">
        <div className="w-full max-w-[560px]">
          <p className="text-[11px] font-medium tracking-[0.22em] text-muted uppercase">Test mode</p>
          <h1 className="mt-4 text-title">
            {BRAND.name} {BRAND.product}
          </h1>
          <p className="mt-4 text-body text-muted">Open this page with a public candidate agent.</p>
          <pre className="mt-4 overflow-x-auto rounded-field border border-border bg-well p-4 font-mono text-caption">
            /meet?agent=agent_…&amp;fixture=alex-novak&amp;name=Alex%20Novak&amp;role=Senior%20Frontend%20Engineer
          </pre>
          <p className="mt-4 text-label text-muted">
            Create one with <code className="font-mono">npm run try:agent -- alex-novak --feelings</code>. It prints the full link.
          </p>
        </div>
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
