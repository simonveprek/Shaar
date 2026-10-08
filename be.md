# Backend (be.md): how the Projstalker API works

Read this before you change or call the backend. It covers the architecture, request lifecycle, every
route with its request/response shape, the data model, and the rules that keep it working on Netlify.

- Code: `src/app/api/**` (routes), `src/lib/**` (logic), `src/connectors/**` (Apify platforms)
- DB schema: `supabase/migrations/*.sql`
- Apify background reference (actors, pricing, webhooks): `docs/apify-integration.md` on the
  `feature/apify` branch. Where it disagrees with the code, **the code is the source of truth** for
  actor IDs and input fields (they were checked against the actors' published schemas on 2026-10-08).

---

## 1. What the backend does

Given a person (subject) and their social handles, the backend:

1. **Scrapes** public profiles and posts with Apify actors (9 platforms).
2. **Normalizes** everything into one `scraped_items` table.
3. **Builds a persona** with OpenAI: a structured profile of who they are, what they think, and how they talk.
4. **Simulates an interview**: an ElevenLabs voice agent plays the persona; the user talks to it in the browser.
5. Serves all of this to the Next.js frontend through JSON routes, plus streaming chat and text-to-speech.

## 2. Stack and deployment

| Piece | Choice | Notes |
| --- | --- | --- |
| Runtime | Next.js 16 (App Router), **API routes only** | Separate app from the frontend. Dev port **4000** (frontend keeps 3000). |
| Hosting | Netlify | Zero-config Next.js adapter. **Every request must finish in < 60 s.** |
| DB / auth | Supabase (project `zqwuummnghbpeutvxbif`, "s.veprek@outlook.com's Project") | Shares that project with an unrelated hackathon app. Only touch the 5 projstalker tables. |
| Scraping | Apify via `apify-client` | Pay-per-event actors, capped per run. |
| LLM | OpenAI via `openai` (Responses API) | Persona: `gpt-6.1-sol`, chat: `gpt-6-luna` (env-configurable). |
| Voice | ElevenLabs Agents + TTS over REST (`src/lib/elevenlabs.ts`) | Browser connects with `@elevenlabs/react`. |

**Next.js 16 is newer than most training data.** `middleware.ts` is now `src/proxy.ts`; route params are a
`Promise` (`await ctx.params`); `cacheComponents` is on. Read `node_modules/next/dist/docs/` before using
an API you're unsure of (see `AGENTS.md`).

## 3. The core rule: never wait inside a request

Netlify kills functions at 60 s. Apify runs take minutes, and persona generation can take over a minute. So:

- Slow work runs **outside** our functions: Apify runs on Apify, persona generation runs in
  **OpenAI background mode** (`background: true`).
- Our code only **starts** work and **checks** on it. Every step is idempotent and safe to call
  concurrently. State lives in Supabase, never in memory.
- Three things drive progress: **`GET /api/research/:id` (polling)**, the **Apify webhook**, and the
  **ElevenLabs webhook**. Polling alone is enough locally, where webhooks can't reach you.
- Concurrency safety comes from conditional updates ("claims"):
  `update ... set status='ingesting' where id=? and status='running'`. Only the caller that wins the
  claim does the work. Keep this pattern for any new state transition.

Don't add `await sleep`, long polling loops, or "wait until done" calls (e.g. Apify `.call()`,
`waitForFinish`) to a route.

## 4. Research job lifecycle

```
POST /api/research  (subject + targets)
  └─ research_jobs row (status: scraping)
  └─ per target, per actor of that platform's connector: start Apify run  → connector_runs row (running)

Apify run finishes ─► webhook POST /api/webhooks/apify   ┐
Frontend polls    ─► GET /api/research/:id                ┴─► advanceJob(jobId)
  1. syncConnectorRun for each running run:
       Apify status terminal? → claim (running→ingesting) → read dataset → normalize → upsert scraped_items
       → succeeded (partial data from a timed-out/capped run still counts) | failed
  2. all runs done?
       any items → claim job (scraping→analyzing) → build digest → OpenAI background response → personas row (generating)
       no items  → job failed
  3. job analyzing → poll OpenAI response → personas.profile (ready) → job ready | failed
```

Status values:

| Table | Statuses |
| --- | --- |
| `research_jobs.status` | `scraping` → `analyzing` → `ready` \| `failed` |
| `connector_runs.status` | `running` → `ingesting` → `succeeded` \| `failed` |
| `personas.status` | `generating` → `ready` \| `failed` |
| `interviews.status` | `pending` → `active` → `done` \| `failed` |

Adding a source to an existing job (`POST /api/connectors/:platform` with `jobId`) sets the job back to
`scraping`; when the new runs finish, the persona is regenerated from all data.

## 5. Interview lifecycle

```
POST /api/personas/:id/interviews
  └─ ensureAgent: create (or update, if voice changed) a private ElevenLabs agent for this persona
       system prompt = agentSystemPrompt(profile)   (stays server-side, never sent to the browser)
  └─ get WebRTC token (returns conversation_id up front) or signed WebSocket URL
  └─ interviews row (pending, elevenlabs_conversation_id set)
  └─ response.session → browser: conversation.startSession(session)

Call ends ─► POST /api/webhooks/elevenlabs (HMAC-verified) ┐
Frontend  ─► GET /api/interviews/:id                         ┴─► transcript + analysis saved (done)
```

One agent per persona is stored in `personas.elevenlabs_agent_id`; it is deleted with the job.

## 6. API reference

Base URL: `http://localhost:4000` locally, the Netlify site URL in production.

**Auth:** every route except `/api/health`, `/api/connectors*` (GET) and webhooks requires
`Authorization: Bearer <Supabase access token>` (frontend: `(await supabase.auth.getSession()).data.session.access_token`).
Users only ever see their own rows.

**Errors** are always JSON `{ "error": string, "details"?: unknown }` with a proper status:
400 validation (details = zod tree), 401 auth, 404 not found / not yours, 409 wrong state, 502 upstream
(ElevenLabs) failure, 500 otherwise.

| Method & route | Body / query | Response |
| --- | --- | --- |
| `GET /api` | | Machine-readable index of every route (method, path, auth, body fields + example, response example) |
| `GET /docs` (page) | | Human docs: every route with curl examples. `/` redirects here |
| `GET /api/health` | | `{ ok, time }` |
| `GET /api/connectors` | | `{ connectors: [{ platform, label, targetHint, notes, actors: [{ actorId, role }] }] }` |
| `GET /api/connectors/:platform` | | `{ connector }` |
| `POST /api/connectors/:platform` | `{ target, maxPosts?, jobId?, subjectName? }` | 201 `{ job, runs }`. New job unless `jobId` given |
| `POST /api/research` | `{ subjectName, notes?, targets: [{ platform, target, maxPosts? (1-500, default 30) }] }` (1-20 targets) | 201 `{ job, runs }` |
| `GET /api/research` | `?limit=` (≤100) | `{ jobs: [job + personas(id, status, display_name, one_line_summary)] }` |
| `GET /api/research/:id` | | `{ job, runs, persona, itemCounts: { [platform]: { profile?, post?, comment? } } }`; **also advances the job** |
| `DELETE /api/research/:id` | | 204; deletes all data + the ElevenLabs agent |
| `GET /api/research/:id/items` | `?platform=&kind=profile\|post\|comment&limit=(≤200)&offset=&raw=1` | `{ items, total, limit, offset }` |
| `POST /api/research/:id/persona` | | 202 `{ persona }` (regenerate; 409 while scraping) |
| `GET /api/personas/:id` | | `{ persona }` (`persona.profile` is a `PersonaProfile`, see `src/lib/persona.ts`) |
| `POST /api/personas/:id/interviews` | `{ voiceId?, transport?: "webrtc" (default) \| "websocket" }` | 201 `{ interview, agentId, session: { conversationToken } \| { signedUrl } }` (409 if persona not ready) |
| `GET /api/personas/:id/interviews` | | `{ interviews }` |
| `GET /api/interviews/:id` | | `{ interview }` with `transcript: [{ role: "user"\|"agent", message, time_in_call_secs }]` |
| `POST /api/ai/chat` | `{ messages: [{ role: "user"\|"assistant", content }], jobId? }` | **Streamed `text/plain`**; `jobId` grounds answers in that persona |
| `POST /api/voice/tts` | `{ text (≤5000), voiceId?, modelId? }` | **Streamed `audio/mpeg`** |
| `POST /api/webhooks/apify?secret=…` | Apify webhook payload | Server-to-server only |
| `POST /api/webhooks/elevenlabs` | ElevenLabs post-call payload, `ElevenLabs-Signature` header | Server-to-server only |

**Platforms** (`platform` values): `instagram`, `tiktok`, `x`, `linkedin`, `youtube`, `facebook`,
`reddit`, `threads`, `pinterest`. `target` is a handle or a profile URL; each connector normalizes it.

### Frontend recipes

Polling a job (stop at `ready` or `failed`):

```ts
const res = await fetch(`${API}/api/research/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
const { job, runs, persona, itemCounts } = await res.json();
```

Or skip polling and subscribe with Supabase Realtime (tables `research_jobs`, `connector_runs`,
`personas`, `interviews` are published; RLS lets users read their own rows). Note: Realtime only fires on
changes, and changes only happen when something calls `advanceJob`; in production the webhooks do that,
locally you still need to poll.

Starting an interview (`@elevenlabs/react` v1 requires `<ConversationProvider>` around the hooks):

```ts
const { interview, session } = await (await fetch(`${API}/api/personas/${personaId}/interviews`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: "{}",
})).json();
await conversation.startSession(session);
```

Reading the chat stream:

```ts
const reader = res.body!.getReader();
const decoder = new TextDecoder();
for (let r; !(r = await reader.read()).done; ) append(decoder.decode(r.value, { stream: true }));
```

## 7. Data model (Supabase, `public` schema)

| Table | Key columns |
| --- | --- |
| `research_jobs` | `id`, `user_id`, `subject_name`, `notes`, `status`, `error` |
| `connector_runs` | `job_id`, `platform`, `target`, `actor_id`, `input`, `apify_run_id`, `dataset_id`, `status`, `item_count`, `error` |
| `scraped_items` | `job_id`, `run_id`, `platform`, `kind` (profile/post/comment), `external_id`, `url`, `author`, `text`, `posted_at`, `metrics` (jsonb numbers), `media` (url array), `data` (raw Apify item). Unique `(run_id, external_id)` |
| `personas` | `job_id` (unique), `status`, `model`, `openai_response_id`, `profile` (jsonb `PersonaProfile`), `voice_id`, `elevenlabs_agent_id` |
| `interviews` | `persona_id`, `elevenlabs_conversation_id` (unique), `status`, `transcript`, `analysis`, `duration_secs` |

- RLS: `authenticated` users can **select** their own rows. There are **no insert/update policies**: all
  writes go through the backend with the secret key (`db()` in `src/lib/supabase.ts`), which bypasses RLS,
  so **every backend query must filter by `user_id`** (or go through `getJob`/`getPersona`, which do).
- Schema changes: add a new file in `supabase/migrations/` (never edit an applied one) and apply it to the
  project. Never touch the hackathon tables (`teams`, `judges`, `submissions`, ...) in the same project.

## 8. Code map and conventions

```
src/
  proxy.ts                CORS for /api/* (origins from CORS_ORIGINS)
  connectors/
    types.ts              Connector / ActorSpec / NormalizedItem
    util.ts               get/str/num/date/metrics/mediaUrls, handle & URL parsing
    index.ts              registry: getConnector, getActor, listConnectors
    <platform>.ts         one file per platform
  lib/
    env.ts                zod-validated env, read lazily via env()
    http.ts               handle() wrapper, HttpError, readJson, must/maybe/check for Supabase results
    auth.ts               requireUser(req) → { id, email }
    research.ts           job lifecycle: createJob, startConnector, syncConnectorRun, advanceJob, generatePersona
    persona.ts            PersonaProfile schema, digest builder, OpenAI start/poll, agent system prompt
    interviews.ts         ensureAgent, startInterview, syncInterview
    elevenlabs.ts         REST client, TTS, webhook HMAC verification
    schemas.ts            zod request-body schemas (shared by routes and docs)
    api-catalog.ts        list of every route → GET /api and /docs
    apify.ts / openai.ts / supabase.ts   lazily created clients
  app/docs/               the /docs page
```

Conventions:

- **Every route is listed in `src/lib/api-catalog.ts`**, which powers `GET /api` and `/docs`. Adding or
  changing a route means updating its entry there. Request bodies live in `src/lib/schemas.ts`, shared by
  the route (validation) and the catalog (field docs), so add `.describe()` text to new fields.
- **Routes** are `export const GET = handle(async (req, ctx: RouteContext<"/api/...">) => ...)`. Call
  `requireUser(req)` first, validate bodies with `readJson(req, zodSchema)`, throw `HttpError` for
  expected failures. Don't catch and return errors by hand.
- **Supabase results**: `must(...)` when a row must exist, `maybe(...)` with `.maybeSingle()`,
  `check(...)` for writes whose result you don't use. Don't destructure `{ data, error }` manually.
- **Env**: add new variables to the schema in `src/lib/env.ts` **and** to `.env.example`. Never read
  `process.env` directly elsewhere (except `src/proxy.ts`). Secrets never go to the browser.
- **Verify before shipping**: `npm run typecheck`, `npm run lint`, `npm run build`.

### Adding or changing a platform connector

1. Create `src/connectors/<platform>.ts` exporting a `Connector` with one `ActorSpec` per actor (e.g. a
   profile actor + a posts actor). Register it in `src/connectors/index.ts`.
2. Check the actor's real input schema first: `curl -s https://api.apify.com/v2/acts/<user>~<name>` →
   latest build → `GET /v2/actor-builds/<id>` → `actorDefinition.input`. Don't guess field names.
3. `buildInput` must bound the result count; `maxItems` should return the same bound.
4. `normalize` must return `[]` for error/irrelevant items, emit profiles with
   `externalId: profileId(handle)` (deduped per run), and use `date()` for timestamps (it handles ISO,
   unix seconds/ms, X's format, RFC-2822; relative dates become null).
5. Never remove or rename an `actorId` that existing `connector_runs` rows reference without a migration
   plan: `getActor` looks runs up by `(platform, actor_id)`.

Every run is capped by `APIFY_MAX_CHARGE_USD_PER_RUN` (default $1).

## 9. Environment variables

See `.env.example` for the full list. Required: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `APIFY_TOKEN`,
`APIFY_WEBHOOK_SECRET` (≥16 chars), `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID`.
Production also needs `PUBLIC_API_URL` (turns on Apify webhooks), `ELEVENLABS_WEBHOOK_SECRET`, and
`CORS_ORIGINS` set to the frontend URL. Missing variables only fail at request time (`env()` is lazy), so
the build succeeds without them.

## 10. Known limitations and open work

- **No discovery step yet.** The API needs handles/URLs; it can't go from a person's *name* to their
  profiles. `docs/apify-integration.md` §5.1 lists candidate actors (Google Search scraper, social-links
  search). If you add it, require a user-confirmation step before scraping, since name matches are often the wrong person.
- **X** needs a paid Apify plan (free plan = demo mode, 10 items). **Facebook** works for pages, not
  personal profiles. **YouTube** channel listings can have relative dates (stored as null).
- **No caching** of scrapes across jobs yet: researching the same handle twice pays twice.
- No automated tests yet; connector normalizers are the best place to start (pure functions).
- Interviews use stock ElevenLabs voices. Don't add voice cloning of the real person without their consent.

## 11. Responsible use (keep these properties)

- Only public data; the persona prompt forbids inventing private facts (addresses, family, health, finances).
- The voice agent says it's an AI simulation if sincerely asked; keep that in `agentSystemPrompt`.
- Users can delete a job and everything derived from it (`DELETE /api/research/:id`).
