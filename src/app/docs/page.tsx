import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { Badge, Button, CodeBlock, Panel, SectionHeader, Text, ThemeToggle } from "@/components/ui";
import { bodyFields, routes, type Auth, type RouteDoc } from "@/lib/api-catalog";
import { DocsMobileNav, DocsSidebar, type DocsNavSection } from "./docs-nav";

export const metadata: Metadata = {
  title: "API docs",
  description: "Every Shaar API route, with examples.",
};

const anchor = (r: RouteDoc) => `${r.method}-${r.path}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");

const groups = [...new Set(routes.map((r) => r.group))];

const nav: DocsNavSection[] = [
  {
    label: "Start here",
    items: [
      { id: "quick-start", name: "Quick start" },
      { id: "auth-and-errors", name: "Auth and errors" },
    ],
  },
  ...groups.map((group) => ({
    label: group,
    items: routes.filter((r) => r.group === group).map((r) => ({ id: anchor(r), name: r.path, method: r.method })),
  })),
];

/** Renders `code` spans inside plain text. */
function md(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code key={i} className="rounded-md bg-control px-1 py-px font-mono text-[0.9em]">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

function curl(r: RouteDoc): string {
  const path = r.path.replace(/:(\w+)/g, (_, p) => `<${p}>`);
  const lines = [`curl${r.method === "GET" ? "" : ` -X ${r.method}`} "$API${path}"`];
  if (r.auth === "user") lines.push(`  -H "Authorization: Bearer $TOKEN"`);
  if (r.body) {
    lines.push(`  -H "Content-Type: application/json"`);
    // A quote can't be escaped inside shell single quotes, so each one becomes: close, escaped quote, reopen.
    lines.push(`  -d '${JSON.stringify(r.bodyExample ?? {}).replaceAll("'", `'\\''`)}'`);
  }
  return lines.join(" \\\n");
}

const METHOD_TONE = { GET: "neutral", POST: "strong", DELETE: "danger" } as const;
const AUTH_LABEL: Record<Auth, string> = { user: "Bearer token", none: "Public", webhook: "Webhook only" };

/** Definition rows on a panel, the way Fragms lays out an API reference. */
function Rows({ title, rows }: { title: string; rows: { name: string; meta?: ReactNode; note: ReactNode }[] }) {
  return (
    <div className="mt-5">
      <p className="mb-2 text-caption font-medium text-muted">{title}</p>
      <div className="divide-y divide-border rounded-field border border-border bg-well px-4">
        {rows.map((row) => (
          <div key={row.name} className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[200px_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <code className="font-mono text-label font-medium break-all">{row.name}</code>
              {row.meta}
            </div>
            <p className="text-[14px] leading-relaxed text-muted">{row.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Route({ r }: { r: RouteDoc }) {
  const fields = r.body ? bodyFields(r.body) : [];
  return (
    <section id={anchor(r)} className="scroll-mt-24">
      <Panel className="sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge tone={METHOD_TONE[r.method]} size="md" className="font-mono">
            {r.method}
          </Badge>
          <code className="min-w-0 font-mono text-[15px] font-medium break-all">{r.path}</code>
          <Badge size="md" className="sm:ml-auto">
            {AUTH_LABEL[r.auth]}
          </Badge>
        </div>
        <p className="mt-4 text-[15px] font-medium">{r.summary}</p>
        {r.description && <p className="mt-1.5 max-w-[68ch] text-[14px] leading-relaxed text-muted">{md(r.description)}</p>}

        {r.params && (
          <Rows title="Path" rows={Object.entries(r.params).map(([name, note]) => ({ name, note: md(note) }))} />
        )}
        {r.query && (
          <Rows title="Query" rows={Object.entries(r.query).map(([name, note]) => ({ name, note: md(note) }))} />
        )}
        {fields.length > 0 && (
          <Rows
            title="Body"
            rows={fields.map((f) => ({
              name: f.name,
              meta: (
                <span className="font-mono text-caption text-muted">
                  {f.type}
                  {f.required ? "" : " · optional"}
                </span>
              ),
              note: md(f.description),
            }))}
          />
        )}

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-2 text-caption font-medium text-muted">Request</p>
            <CodeBlock code={curl(r)} lang="bash" />
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-caption font-medium text-muted">
              Response {r.response.status}
              {r.response.contentType ? ` · ${r.response.contentType}` : ""}
            </p>
            {r.response.example !== undefined ? (
              <CodeBlock code={JSON.stringify(r.response.example, null, 2)} lang="json" />
            ) : (
              <div className="rounded-field border border-border bg-well p-3 pl-4 text-[14px] text-muted">
                {r.response.status === 204 ? "No content" : md(r.response.note ?? "")}
              </div>
            )}
            {r.response.example !== undefined && r.response.note && (
              <p className="mt-2 text-caption text-muted">{md(r.response.note)}</p>
            )}
          </div>
        </div>
      </Panel>
    </section>
  );
}

const steps = [
  {
    title: "Get the user's token",
    body: "Sign in with Supabase on the frontend and send its access token as a Bearer token.",
    code: `const { data } = await supabase.auth.getSession();
const token = data.session!.access_token;
const api = (path: string, init: RequestInit = {}) =>
  fetch(\`\${process.env.NEXT_PUBLIC_API_URL}\${path}\`, {
    ...init,
    headers: { Authorization: \`Bearer \${token}\`, "Content-Type": "application/json", ...init.headers },
  });`,
  },
  {
    title: "Start research",
    body: "Give a name and one or more profiles. Apify scrapes them in the background.",
    code: `const { job } = await (await api("/api/research", {
  method: "POST",
  body: JSON.stringify({ subjectName: "Jane Doe", targets: [{ platform: "instagram", target: "@janedoe" }] }),
})).json();`,
  },
  {
    title: "Wait for the persona",
    body: "Poll the job every few seconds. It goes from scraping to analyzing to ready in a few minutes.",
    code: `let state;
do {
  await new Promise((r) => setTimeout(r, 5000));
  state = await (await api(\`/api/research/\${job.id}\`)).json();
} while (!["ready", "failed"].includes(state.job.status));`,
  },
  {
    title: "Interview them",
    body: "Start a session and hand it to the ElevenLabs React SDK inside its ConversationProvider.",
    code: `const { session } = await (await api(\`/api/personas/\${state.persona.id}/interviews\`, {
  method: "POST",
  body: "{}",
})).json();
await conversation.startSession(session);`,
  },
];

function Heading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mb-5 scroll-mt-24 text-heading">
      <a href={`#${id}`}>{children}</a>
    </h2>
  );
}

export default function DocsPage() {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-4 sm:px-5 md:px-8">
          <Link href="/" className="flex items-center gap-2.5 text-[15px] font-medium">
            <Logo className="h-5 w-auto" />
            Shaar
          </Link>
          <Badge>API</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button href="/api" variant="ghost" size="sm">
              JSON index
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div
        id="top"
        className="mx-auto grid w-full max-w-[1400px] gap-x-12 px-4 pt-8 pb-24 sm:px-5 sm:pt-12 md:px-8 lg:grid-cols-[264px_minmax(0,1fr)]"
      >
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <DocsSidebar nav={nav} />
          </div>
        </aside>

        <main className="min-w-0 max-w-[920px]">
          <SectionHeader
            as="h1"
            title="Shaar API"
            description="Scrape someone's public profiles, turn them into a persona and interview that persona by voice. Every route is below with a request you can copy."
          />
          <Text size="label" tone="muted" className="mt-4">
            Local base URL <code className="font-mono">http://localhost:4000</code> · {routes.length} routes · The same list as
            JSON at <a href="/api" className="underline decoration-underline underline-offset-4">/api</a>
          </Text>

          <section className="mt-16">
            <Heading id="quick-start">Quick start</Heading>
            <ol className="rounded-panel border border-border bg-card p-5 shadow-card sm:p-6">
              {steps.map((step, i) => (
                <li key={step.title} className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-4 pb-7 last:pb-0">
                  <span
                    aria-hidden="true"
                    className="absolute top-8 bottom-1 left-[13.5px] w-px bg-border [li:last-child>&]:hidden"
                  />
                  <span className="flex size-7 items-center justify-center rounded-full bg-control text-label font-medium tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-[15px] font-medium">{step.title}</p>
                    <p className="mt-1.5 mb-3 max-w-[60ch] text-[14px] leading-relaxed text-muted">{step.body}</p>
                    <CodeBlock code={step.code} lang="ts" />
                  </div>
                </li>
              ))}
            </ol>
            <Text size="label" tone="muted" className="mt-3">
              For the curl requests below, set <code className="font-mono">API=http://localhost:4000</code> and{" "}
              <code className="font-mono">TOKEN</code> to an access token.
            </Text>
          </section>

          <section className="mt-16">
            <Heading id="auth-and-errors">Auth and errors</Heading>
            <div className="divide-y divide-border rounded-panel border border-border bg-card px-5 shadow-card">
              {[
                ["Bearer token", "Routes marked Bearer token need `Authorization: Bearer <Supabase access token>`. People only see their own data. Someone else's IDs return 404."],
                ["400", "The body is invalid. `details` lists each field that failed."],
                ["401", "The token is missing or expired."],
                ["404", "Not found, or not yours."],
                ["409", "Not ready yet, like interviewing a persona that is still being written."],
                ["502", "Apify, OpenAI or ElevenLabs failed. Try again."],
                ["Platforms", "`instagram` `tiktok` `x` `linkedin` `youtube` `facebook` `reddit` `threads` `pinterest`. A target is a handle or a profile URL."],
              ].map(([name, note]) => (
                <div key={name} className="grid gap-x-6 gap-y-1 py-3.5 sm:grid-cols-[140px_minmax(0,1fr)]">
                  <code className="font-mono text-label font-medium">{name}</code>
                  <p className="text-[14px] leading-relaxed text-muted">{md(note)}</p>
                </div>
              ))}
            </div>
            <Text size="label" tone="muted" className="mt-3">
              Every error is JSON with <code className="font-mono">error</code> and sometimes{" "}
              <code className="font-mono">details</code>.
            </Text>
          </section>

          {groups.map((group) => (
            <section key={group} className="mt-16">
              <h2 className="mb-5 text-heading">{group}</h2>
              <div className="flex flex-col gap-4">
                {routes
                  .filter((r) => r.group === group)
                  .map((r) => (
                    <Route key={anchor(r)} r={r} />
                  ))}
              </div>
            </section>
          ))}
        </main>
      </div>

      <DocsMobileNav nav={nav} />
    </>
  );
}
