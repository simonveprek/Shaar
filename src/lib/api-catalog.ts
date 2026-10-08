import { z } from "zod";
import { Chat, CreateJob, RunConnector, StartDiscovery, StartInterview, Tts } from "./schemas";

/*
 * Every public route, in one place. Powers GET /api (JSON index) and /docs (how-to page).
 * When you add or change a route, update its entry here. Request bodies come from the same zod
 * schemas the routes validate with, so field docs can't drift.
 */

export type Auth = "user" | "none" | "webhook";

export type RouteDoc = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  group: string;
  summary: string;
  description?: string;
  auth: Auth;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: z.ZodType;
  bodyExample?: unknown;
  response: { status: number; contentType?: string; example?: unknown; note?: string };
};

const job = {
  id: "8f0c…",
  user_id: "1b2d…",
  subject_name: "Jane Doe",
  notes: null,
  status: "scraping",
  error: null,
  created_at: "2026-10-08T18:00:00Z",
  updated_at: "2026-10-08T18:00:00Z",
};

const run = {
  id: "c41e…",
  job_id: "8f0c…",
  platform: "instagram",
  target: "@janedoe",
  actor_id: "apify/instagram-scraper",
  apify_run_id: "HG7…",
  status: "running",
  item_count: 0,
  error: null,
};

const persona = {
  id: "5a9b…",
  job_id: "8f0c…",
  status: "ready",
  model: "gpt-6.1-sol",
  profile: {
    display_name: "Jane Doe",
    one_line_summary: "Brooklyn-based climbing photographer who posts dry, self-deprecating captions.",
    summary: "…",
    communication_style: { tone: "dry, warm", typical_phrases: ["no notes", "send it"], "…": "…" },
    suggested_interview_questions: ["How did you get into climbing photography?"],
    "…": "see PersonaProfile in src/lib/persona.ts",
  },
  voice_id: null,
  elevenlabs_agent_id: null,
};

export const routes: RouteDoc[] = [
  // ── Basics
  {
    method: "GET",
    path: "/api",
    group: "Basics",
    summary: "This index of every route",
    auth: "none",
    response: { status: 200, example: { name: "Shaar API", docs: "/docs", routes: ["…"] } },
  },
  {
    method: "GET",
    path: "/api/health",
    group: "Basics",
    summary: "Health check",
    auth: "none",
    response: { status: 200, example: { ok: true, time: "2026-10-08T18:00:00.000Z" } },
  },

  // ── Connectors
  {
    method: "GET",
    path: "/api/connectors",
    group: "Connectors",
    summary: "List supported platforms",
    description: "Builds the add a source form. Use `targetHint` as the placeholder and show `notes` as a caveat.",
    auth: "none",
    response: {
      status: 200,
      example: {
        connectors: [
          {
            platform: "instagram",
            label: "Instagram",
            targetHint: "Instagram username or profile URL",
            notes: "Private accounts only return basic profile info.",
            actors: [
              { actorId: "apify/instagram-profile-scraper", role: "profile" },
              { actorId: "apify/instagram-scraper", role: "posts" },
            ],
          },
        ],
      },
    },
  },
  {
    method: "GET",
    path: "/api/connectors/:platform",
    group: "Connectors",
    summary: "One platform's details",
    auth: "none",
    params: { platform: "instagram, tiktok, x, linkedin, youtube, facebook, reddit, threads or pinterest" },
    response: { status: 200, example: { connector: { platform: "tiktok", label: "TikTok", "…": "…" } } },
  },
  {
    method: "POST",
    path: "/api/connectors/:platform",
    group: "Connectors",
    summary: "Scrape one platform profile",
    description:
      "Without `jobId` this starts a new research job for one profile. With `jobId` it adds the profile to that job. The job goes back to `scraping` and the persona is rebuilt when it finishes.",
    auth: "user",
    params: { platform: "Platform key" },
    body: RunConnector,
    bodyExample: { target: "@janedoe", maxPosts: 30, jobId: "8f0c…" },
    response: { status: 201, example: { job, runs: [run] } },
  },

  // ── Discovery
  {
    method: "POST",
    path: "/api/discover",
    group: "Discovery",
    summary: "Find a name's public profiles",
    description:
      "Runs one Google search per platform for the name in quotes. Poll `GET /api/discover/:id` until `status` is `ready`, then let the visitor confirm which candidates are really the person and pass those to `POST /api/research` as targets.",
    auth: "user",
    body: StartDiscovery,
    bodyExample: { name: "Jane Doe", purpose: "Gather intelligence" },
    response: { status: 201, example: { discovery: { id: "d81a…", name: "Jane Doe", status: "searching", candidates: [] } } },
  },
  {
    method: "GET",
    path: "/api/discover/:id",
    group: "Discovery",
    summary: "Candidate profiles for a name",
    description: "Each call checks the search. Candidates are profile links whose title matches the name, at most two per platform, closest first.",
    auth: "user",
    params: { id: "Discovery ID" },
    response: {
      status: 200,
      example: {
        discovery: {
          id: "d81a…",
          status: "ready",
          candidates: [
            {
              id: "instagram:janedoe",
              platform: "instagram",
              label: "Instagram",
              handle: "janedoe",
              url: "https://instagram.com/janedoe",
              title: "Jane Doe (@janedoe) • Instagram photos and videos",
              snippet: "1,204 followers…",
              match: 1,
            },
          ],
        },
      },
    },
  },

  // ── Research
  {
    method: "POST",
    path: "/api/research",
    group: "Research",
    summary: "Start a research job",
    description:
      "Starts the Apify runs for every target. Some platforms use one actor for the profile and one for posts. Scraping takes a few minutes. Then poll `GET /api/research/:id` until `job.status` is `ready` or `failed`.",
    auth: "user",
    body: CreateJob,
    bodyExample: {
      subjectName: "Jane Doe",
      notes: "Photographer, based in NYC",
      targets: [
        { platform: "instagram", target: "@janedoe" },
        { platform: "tiktok", target: "https://www.tiktok.com/@janedoe", maxPosts: 50 },
      ],
    },
    response: { status: 201, example: { job, runs: [run] } },
  },
  {
    method: "GET",
    path: "/api/research",
    group: "Research",
    summary: "List my research jobs",
    auth: "user",
    query: { limit: "Max jobs to return (default 50, max 100)" },
    response: {
      status: 200,
      example: { jobs: [{ ...job, status: "ready", personas: [{ id: "5a9b…", status: "ready", display_name: "Jane Doe", one_line_summary: "…" }] }] },
    },
  },
  {
    method: "GET",
    path: "/api/research/:id",
    group: "Research",
    summary: "Job progress, runs and persona",
    description:
      "Poll this every 5 seconds or so. Each call also moves the job forward by pulling in finished Apify runs and checking on the persona. `job.status` goes from `scraping` to `analyzing` to `ready` or `failed`.",
    auth: "user",
    params: { id: "Job ID" },
    response: {
      status: 200,
      example: {
        job: { ...job, status: "analyzing" },
        runs: [{ ...run, status: "succeeded", item_count: 31 }],
        persona: { ...persona, status: "generating", profile: null },
        itemCounts: { instagram: { profile: 1, post: 30 } },
      },
    },
  },
  {
    method: "DELETE",
    path: "/api/research/:id",
    group: "Research",
    summary: "Delete a job and everything derived from it",
    description: "Removes scraped items, the persona, interviews, and the persona's ElevenLabs agent.",
    auth: "user",
    params: { id: "Job ID" },
    response: { status: 204 },
  },
  {
    method: "GET",
    path: "/api/research/:id/items",
    group: "Research",
    summary: "Scraped profiles and posts",
    description: "Normalized items, newest first, for the profile and feed views.",
    auth: "user",
    params: { id: "Job ID" },
    query: {
      platform: "Filter by platform",
      kind: "profile | post | comment",
      limit: "1-200 (default 50)",
      offset: "Pagination offset (default 0)",
      raw: "Set to 1 to include the original Apify item as `data`",
    },
    response: {
      status: 200,
      example: {
        items: [
          {
            id: 412,
            platform: "instagram",
            kind: "post",
            external_id: "3311…",
            url: "https://www.instagram.com/p/…",
            author: "janedoe",
            text: "Sunrise at the Gunks. No notes.",
            posted_at: "2026-09-30T11:02:00Z",
            metrics: { likes: 1204, comments: 48 },
            media: ["https://…jpg"],
          },
        ],
        total: 31,
        limit: 50,
        offset: 0,
      },
    },
  },
  {
    method: "GET",
    path: "/api/research/:id/dossier",
    group: "Research",
    summary: "The watcher's file",
    description:
      "What a watcher could put together from the job's public data. Where they are, when they post (UTC), how much, who they mention, their most seen posts and an exposure score out of 100. It describes exposure only and never scores the person. The `/dossier/sample` page shows it for a fictional subject.",
    auth: "user",
    params: { id: "Job ID" },
    response: {
      status: 200,
      example: {
        jobStatus: "ready",
        sources: [{ platform: "instagram", status: "done", items: 31 }],
        dossier: {
          fileNumber: "0417-K",
          subject: { name: "Mara Vell", oneLine: "Film photographer in Prague…" },
          totals: { items: 214, posts: 210, platforms: 4, reach: 7070, yearsVisible: 3.1 },
          routine: { peak: { day: 1, hour: 20, count: 9 }, busiestHours: [20, 21, 10] },
          exposure: { score: 78, factors: [{ label: "Volume", detail: "210 public posts", value: 27 }] },
          "…": "presence, activity, topics, circle, quotes, views",
        },
      },
    },
  },
  {
    method: "POST",
    path: "/api/research/:id/persona",
    group: "Research",
    summary: "Regenerate the persona",
    description: "Rebuilds the persona from all scraped data. Returns 409 while the job is still scraping. Poll the job afterwards.",
    auth: "user",
    params: { id: "Job ID" },
    response: { status: 202, example: { persona: { ...persona, status: "generating", profile: null } } },
  },

  // ── Personas & interviews
  {
    method: "GET",
    path: "/api/personas/:id",
    group: "Personas & interviews",
    summary: "Get a persona",
    auth: "user",
    params: { id: "Persona ID (from `persona.id` on the job)" },
    response: { status: 200, example: { persona } },
  },
  {
    method: "POST",
    path: "/api/personas/:id/interviews",
    group: "Personas & interviews",
    summary: "Start a simulated voice interview",
    description:
      "Creates the persona's ElevenLabs voice agent on first use and returns a session for the browser. Pass `session` straight to `conversation.startSession(session)` from `@elevenlabs/react`. Returns 409 if the persona isn't ready.",
    auth: "user",
    params: { id: "Persona ID" },
    body: StartInterview,
    bodyExample: {},
    response: {
      status: 201,
      example: {
        interview: { id: "e77d…", persona_id: "5a9b…", status: "pending", elevenlabs_conversation_id: "conv_…" },
        agentId: "agent_…",
        session: { conversationToken: "eyJ…" },
      },
    },
  },
  {
    method: "GET",
    path: "/api/personas/:id/interviews",
    group: "Personas & interviews",
    summary: "Past interviews with a persona",
    auth: "user",
    params: { id: "Persona ID" },
    response: { status: 200, example: { interviews: [{ id: "e77d…", status: "done", duration_secs: 312, created_at: "…" }] } },
  },
  {
    method: "GET",
    path: "/api/interviews/:id",
    group: "Personas & interviews",
    summary: "Interview transcript",
    description: "Fetches the transcript from ElevenLabs if the post-call webhook hasn't delivered it yet.",
    auth: "user",
    params: { id: "Interview ID" },
    response: {
      status: 200,
      example: {
        interview: {
          id: "e77d…",
          status: "done",
          duration_secs: 312,
          transcript: [
            { role: "agent", message: "Hey! Okay, I'm told you have questions. Go easy on me.", time_in_call_secs: 0 },
            { role: "user", message: "How did you start shooting climbing?", time_in_call_secs: 6 },
          ],
          analysis: { transcript_summary: "…" },
        },
      },
    },
  },

  // ── AI & voice
  {
    method: "POST",
    path: "/api/ai/chat",
    group: "AI & voice",
    summary: "Streaming chat with the research assistant",
    description:
      "Streams the reply as plain text. With `jobId` the answers come from that job's persona, so you can ask what they think about something.",
    auth: "user",
    body: Chat,
    bodyExample: { jobId: "8f0c…", messages: [{ role: "user", content: "What topics does she post about most?" }] },
    response: { status: 200, contentType: "text/plain (streamed)", note: "Read with `res.body.getReader()`." },
  },
  {
    method: "POST",
    path: "/api/voice/tts",
    group: "AI & voice",
    summary: "Text to speech",
    auth: "user",
    body: Tts,
    bodyExample: { text: "Here's what I found about Jane." },
    response: { status: 200, contentType: "audio/mpeg (streamed)", note: "Play with `new Audio(URL.createObjectURL(await res.blob()))`." },
  },

  // ── Webhooks
  {
    method: "POST",
    path: "/api/webhooks/apify",
    group: "Webhooks",
    summary: "Apify run finished",
    description:
      "Registered automatically on every Apify run when PUBLIC_API_URL is set. Authenticated with `?secret=APIFY_WEBHOOK_SECRET`. Don't call it from the frontend.",
    auth: "webhook",
    response: { status: 200, example: { ok: true, jobStatus: "analyzing" } },
  },
  {
    method: "POST",
    path: "/api/webhooks/elevenlabs",
    group: "Webhooks",
    summary: "ElevenLabs post-call transcript",
    description:
      "Set this URL as the post-call webhook in ElevenLabs and put its secret in ELEVENLABS_WEBHOOK_SECRET. Verified with the `ElevenLabs-Signature` HMAC header.",
    auth: "webhook",
    response: { status: 200, example: { ok: true } },
  },
];

export type BodyField = { name: string; type: string; required: boolean; description: string };

/** Flattens a body schema into rows for docs (one level of nesting for arrays of objects). */
export function bodyFields(schema: z.ZodType): BodyField[] {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
  return fieldsOf(json, "");
}

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  format?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  default?: unknown;
};

function fieldsOf(schema: JsonSchema, prefix: string): BodyField[] {
  const out: BodyField[] = [];
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const name = prefix + key;
    out.push({
      name,
      type: typeOf(prop),
      required: schema.required?.includes(key) ?? false,
      description: prop.description ?? "",
    });
    if (prop.type === "array" && prop.items?.properties) out.push(...fieldsOf(prop.items, `${name}[].`));
  }
  return out;
}

function typeOf(s: JsonSchema): string {
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (s.type === "array") return `${s.items ? typeOf(s.items) : "any"}[]`;
  let t = Array.isArray(s.type) ? s.type.join(" | ") : (s.type ?? "any");
  if (s.format === "uuid") t = "uuid";
  if (s.type === "object" && s.properties) t = "object";
  return t;
}

/** JSON-friendly catalog for GET /api. */
export function catalogJson() {
  return routes.map(({ body, bodyExample, ...rest }) => ({
    ...rest,
    ...(body ? { body: { fields: bodyFields(body), example: bodyExample } } : {}),
  }));
}
