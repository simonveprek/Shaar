# Projstalker API

Backend for the Projstalker social media deep research app. It scrapes a person's public profiles with
**Apify**, builds a persona of them with **OpenAI**, and lets users hold a simulated voice interview with
that persona through **ElevenLabs** Agents. Data lives in **Supabase**; the app deploys to **Netlify**.

It is a Next.js 16 app that serves only API routes (`src/app/api`), so it runs as a separate service
next to the Next.js frontend.

## How a research job flows

```
POST /api/research ──► one Apify actor run per platform target (takes minutes)
                          │
        Apify webhook ────┤  or the frontend polling GET /api/research/:id
                          ▼
              finished datasets are normalized into `scraped_items`
                          │  once every run is done
                          ▼
              OpenAI builds the persona in background mode (structured JSON)
                          │
                          ▼
POST /api/personas/:id/interviews ──► ElevenLabs agent plays the persona; browser talks to it directly
                          │
        ElevenLabs post-call webhook / GET /api/interviews/:id ──► transcript saved
```

Netlify stops a normal function after 60 seconds, so no request waits on slow work. Apify and OpenAI run in
the background, and each step is idempotent. `GET /api/research/:id` moves the job forward, as do the
webhooks. Locally, without a public URL for webhooks, polling alone is enough.

Job status: `scraping` → `analyzing` → `ready` (or `failed`).

## API

All routes except webhooks need `Authorization: Bearer <supabase access token>`
(from `supabase.auth.getSession()` on the frontend).

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| GET | `/api/connectors` | Available platforms and what to enter for each |
| GET | `/api/connectors/:platform` | One connector's details |
| POST | `/api/connectors/:platform` | Run one connector: `{ target, maxPosts?, jobId?, subjectName? }`. With `jobId` it adds the source to an existing job and rebuilds the persona |
| POST | `/api/research` | Start a job: `{ subjectName, notes?, targets: [{ platform, target, maxPosts? }] }` |
| GET | `/api/research` | List my jobs |
| GET | `/api/research/:id` | Job, runs, persona, item counts. Poll every ~5 s while not `ready`/`failed` |
| DELETE | `/api/research/:id` | Delete a job and its data |
| GET | `/api/research/:id/items` | Scraped profiles/posts: `?platform=&kind=profile\|post&limit=&offset=&raw=1` |
| POST | `/api/research/:id/persona` | Regenerate the persona |
| GET | `/api/personas/:id` | Persona profile |
| POST | `/api/personas/:id/interviews` | Start an interview: `{ voiceId?, transport?: "webrtc" \| "websocket" }` |
| GET | `/api/personas/:id/interviews` | Past interviews |
| GET | `/api/interviews/:id` | Interview transcript and analysis |
| POST | `/api/ai/chat` | Streamed chat (plain text): `{ messages: [{ role, content }], jobId? }` |
| POST | `/api/voice/tts` | Text to speech (`audio/mpeg`): `{ text, voiceId?, modelId? }` |
| POST | `/api/webhooks/apify` | Apify run finished (secret in query string) |
| POST | `/api/webhooks/elevenlabs` | ElevenLabs post-call transcript (HMAC signed) |

### Starting an interview from the frontend

```tsx
import { ConversationProvider, useConversation } from "@elevenlabs/react";

const res = await fetch(`${API}/api/personas/${personaId}/interviews`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
const { interview, session } = await res.json();
await conversation.startSession(session); // { conversationToken } for WebRTC
// Afterwards: GET /api/interviews/:interview.id for the transcript
```

The frontend can also read its own rows directly with the Supabase client (RLS allows reading your own
data) and subscribe to Realtime changes on `research_jobs`, `connector_runs`, `personas` and `interviews`,
so it doesn't need to poll.

## Connectors

Each platform is one file in `src/connectors/`. A connector names its Apify actor, builds the actor input
from a handle or URL, and normalizes the actor's output into profile and post items. To add a platform,
add a file and register it in `src/connectors/index.ts`.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in.
3. Apply the database schema in `supabase/migrations/` (Supabase dashboard SQL editor, or `supabase db push`).
4. `npm run dev` starts the API on http://localhost:4000, so the frontend keeps port 3000.

### Deploying to Netlify

Netlify detects Next.js automatically; no `netlify.toml` is needed. Set the env vars from `.env.example`
and set `PUBLIC_API_URL` to the site URL so Apify can call the webhook. In ElevenLabs, add a post-call
webhook pointing to `https://<site>/api/webhooks/elevenlabs` and put its secret in `ELEVENLABS_WEBHOOK_SECRET`.

## Responsible use

Personas come only from public posts, and the voice agent tells users it is an AI simulation if they
sincerely ask. Use stock or designed voices. Don't clone a real person's voice without their consent.
