import type { Metadata } from "next";
import type { ReactNode } from "react";
import { bodyFields, routes, type Auth, type RouteDoc } from "@/lib/api-catalog";
import styles from "./docs.module.css";

export const metadata: Metadata = {
  title: "Projstalker API docs",
  description: "How to call the Projstalker backend: every route, with examples.",
};

const groups = [...new Set(routes.map((r) => r.group))];

const anchor = (r: RouteDoc) => `${r.method}-${r.path}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");

/** Renders `code` spans inside plain text. */
function md(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part,
  );
}

function curl(r: RouteDoc): string {
  const path = r.path.replace(/:(\w+)/g, (_, p) => `<${p}>`);
  const lines = [`curl${r.method === "GET" ? "" : ` -X ${r.method}`} "$API${path}"`];
  if (r.auth === "user") lines.push(`  -H "Authorization: Bearer $TOKEN"`);
  if (r.body) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d '${JSON.stringify(r.bodyExample ?? {})}'`);
  }
  return lines.join(" \\\n");
}

const authLabel: Record<Auth, string> = { user: "Bearer token", none: "Public", webhook: "Webhook only" };

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>{cells.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Route({ r }: { r: RouteDoc }) {
  return (
    <section id={anchor(r)} className={styles.route}>
      <h3 className={styles.routeHead}>
        <span className={`${styles.method} ${styles[r.method.toLowerCase()]}`}>{r.method}</span>
        <code className={styles.path}>{r.path}</code>
        <span className={`${styles.auth} ${styles[`auth_${r.auth}`]}`}>{authLabel[r.auth]}</span>
      </h3>
      <p className={styles.summary}>{r.summary}</p>
      {r.description && <p>{md(r.description)}</p>}

      {r.params && (
        <Table head={["Path param", "Meaning"]} rows={Object.entries(r.params).map(([k, v]) => [<code key={k}>{k}</code>, md(v)])} />
      )}
      {r.query && (
        <Table head={["Query", "Meaning"]} rows={Object.entries(r.query).map(([k, v]) => [<code key={k}>{k}</code>, md(v)])} />
      )}
      {r.body && (
        <Table
          head={["Body field", "Type", "", "Meaning"]}
          rows={bodyFields(r.body).map((f) => [
            <code key="n">{f.name}</code>,
            <span key="t" className={styles.type}>{f.type}</span>,
            f.required ? <span key="r" className={styles.required}>required</span> : <span key="r" className={styles.optional}>optional</span>,
            md(f.description),
          ])}
        />
      )}

      <div className={styles.examples}>
        <div>
          <div className={styles.label}>Request</div>
          <pre className={styles.code}>{curl(r)}</pre>
        </div>
        <div>
          <div className={styles.label}>
            Response {r.response.status}
            {r.response.contentType ? ` · ${r.response.contentType}` : ""}
          </div>
          <pre className={styles.code}>
            {r.response.example !== undefined
              ? JSON.stringify(r.response.example, null, 2)
              : r.response.note ?? (r.response.status === 204 ? "(no content)" : "")}
          </pre>
          {r.response.example !== undefined && r.response.note && <p className={styles.note}>{md(r.response.note)}</p>}
        </div>
      </div>
    </section>
  );
}

const quickStart = `// 1. Get the user's Supabase access token
const { data } = await supabase.auth.getSession();
const token = data.session!.access_token;
const api = (path: string, init: RequestInit = {}) =>
  fetch(\`\${process.env.NEXT_PUBLIC_API_URL}\${path}\`, {
    ...init,
    headers: { Authorization: \`Bearer \${token}\`, "Content-Type": "application/json", ...init.headers },
  });

// 2. Start research
const { job } = await (await api("/api/research", {
  method: "POST",
  body: JSON.stringify({ subjectName: "Jane Doe", targets: [{ platform: "instagram", target: "@janedoe" }] }),
})).json();

// 3. Poll until ready (scraping → analyzing → ready)
let state;
do {
  await new Promise((r) => setTimeout(r, 5000));
  state = await (await api(\`/api/research/\${job.id}\`)).json();
} while (!["ready", "failed"].includes(state.job.status));

// 4. Interview the persona (inside <ConversationProvider> from @elevenlabs/react)
const { session } = await (await api(\`/api/personas/\${state.persona.id}/interviews\`, {
  method: "POST",
  body: "{}",
})).json();
await conversation.startSession(session);`;

export default function DocsPage() {
  return (
    <div className={styles.page}>
      <nav className={styles.nav} aria-label="Routes">
        <a href="#top" className={styles.brand}>Projstalker API</a>
        <a href="#quick-start" className={styles.navLink}>Quick start</a>
        <a href="#errors" className={styles.navLink}>Auth & errors</a>
        {groups.map((g) => (
          <div key={g} className={styles.navGroup}>
            <div className={styles.navGroupTitle}>{g}</div>
            {routes
              .filter((r) => r.group === g)
              .map((r) => (
                <a key={anchor(r)} href={`#${anchor(r)}`} className={styles.navRoute}>
                  <span className={`${styles.navMethod} ${styles[r.method.toLowerCase()]}`}>{r.method}</span>
                  {r.path}
                </a>
              ))}
          </div>
        ))}
      </nav>

      <main className={styles.main} id="top">
        <header className={styles.hero}>
          <h1>Projstalker API</h1>
          <p>
            Scrape someone&apos;s public social profiles, turn them into a persona, and interview that persona by voice.
            Every route is listed below with a working example. The same list is available as JSON at{" "}
            <a href="/api"><code>GET /api</code></a>.
          </p>
          <p className={styles.meta}>
            Local base URL <code>http://localhost:4000</code> · {routes.length} routes · Guide for contributors and agents:{" "}
            <code>be.md</code>
          </p>
        </header>

        <section id="quick-start" className={styles.section}>
          <h2>Quick start</h2>
          <p>
            The whole flow from the frontend in four steps. A research job takes a few minutes: Apify scrapes in the
            background, then the model builds the persona. Poll the job, or subscribe to the <code>research_jobs</code>{" "}
            table with Supabase Realtime.
          </p>
          <pre className={styles.code}>{quickStart}</pre>
          <p>
            For the curl examples below, set <code>API=http://localhost:4000</code> and <code>TOKEN=&lt;access token&gt;</code>.
          </p>
        </section>

        <section id="errors" className={styles.section}>
          <h2>Auth & errors</h2>
          <ul>
            <li>
              Routes marked <b>Bearer token</b> need <code>Authorization: Bearer &lt;Supabase access token&gt;</code>. Users only
              ever see their own data; someone else&apos;s IDs return 404.
            </li>
            <li>
              Errors are JSON <code>{"{ error, details? }"}</code>: <code>400</code> invalid body (details lists the
              fields), <code>401</code> missing or expired token, <code>404</code> not found, <code>409</code> not ready
              yet (e.g. interviewing a persona that is still generating), <code>502</code> an upstream service failed.
            </li>
            <li>
              Platforms: <code>instagram</code>, <code>tiktok</code>, <code>x</code>, <code>linkedin</code>,{" "}
              <code>youtube</code>, <code>facebook</code>, <code>reddit</code>, <code>threads</code>,{" "}
              <code>pinterest</code>. A target can be a handle or a profile URL.
            </li>
          </ul>
        </section>

        {groups.map((g) => (
          <section key={g} className={styles.section}>
            <h2>{g}</h2>
            {routes
              .filter((r) => r.group === g)
              .map((r) => (
                <Route key={anchor(r)} r={r} />
              ))}
          </section>
        ))}
      </main>
    </div>
  );
}
