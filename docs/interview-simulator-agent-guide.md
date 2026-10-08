# Interview simulator: implementation guide for AI agents

> **Audience:** an AI coding agent that must add this feature to a project, possibly on a different stack.
> **Goal:** you can implement it end to end from this file alone. The reference implementation lives in this
> repo (Next.js 16 + Postgres/PGlite + OpenAI + ElevenLabs); file paths are given so you can read the real code.
> Human-facing docs (Czech): [interview-simulator.md](interview-simulator.md), [interview-integration.md](interview-integration.md).

**How to use this file.** Read sections 1–3, then implement section 4 step by step. Each step has acceptance
criteria; do not move on until they hold. Sections 5–10 are the exact contracts (schemas, payloads, prompts,
algorithms) to copy. Section 11 lists verified pitfalls: read it before writing code, every item cost real
debugging time. Words in **MUST** are requirements; **SHOULD** are strong defaults.

---

## 1. What the feature does

An HR person practises a job interview with a **voice AI that plays a specific candidate**, then receives
**feedback written from the candidate's point of view**.

1. A **persona** (who the person is, how they talk, their voice gender/age) is built from public data by an LLM.
2. A **candidate brief** adds the job context: target role, motivations, concerns, salary, and **hidden facts**
   the candidate only reveals when the interviewer earns them.
3. HR joins a **1:1 voice call** (WebRTC) with an ElevenLabs agent playing the candidate. HR speaks first after
   a short greeting. Difficulty: `friendly` | `realistic` | `tough`.
4. During the call the agent silently reports its **feelings** through a client tool (`reportFeeling`); the UI
   shows a live mood panel.
5. After hang-up, an LLM, role-playing the same candidate, writes **feedback**: overall feeling, would-accept,
   scores, quoted highlights/lowlights, **inappropriate (discriminatory) questions**, hidden facts HR never found,
   tips. Quotes are verified against the transcript; talk ratio is computed by the server.

Value: realistic practice before the real interview, plus training against illegal questions.

---

## 2. Architecture

```
Browser (call UI)                         Your server                               External
─────────────────                         ───────────                               ────────
Lobby ── POST /personas/:id/interviews ─► ensureAgent (create/PATCH) ─────────────► ElevenLabs Agents API
   ◄──────── { interview, session } ──────┘ get conversation token  ──────────────► ElevenLabs
startSession(session) ══════════════ WebRTC audio ═════════════════════════════════► agent (LLM + TTS)
   reportFeeling ──► POST /interviews/:id/feelings
hang up
   ◄── poll GET /interviews/:id ──► sync transcript ◄── GET conversation ─────────── ElevenLabs
                                     (or post-call webhook pushes it)
                                     claim feedback → OpenAI background response ─► OpenAI Responses API
                                     poll response → validate quotes → store
```

**Design rules (MUST):**

- **Never block a request on slow work.** Feedback generation runs in OpenAI **background mode**; requests only
  start it and check on it. (The reference app ran on Netlify with a 60 s function limit.)
- **Every state transition is an idempotent conditional update ("claim")**, so a webhook and a poll can race
  safely: `UPDATE … SET status='generating' WHERE id=$1 AND status='done' AND feedback_status='none' RETURNING *`.
  Only the caller that gets a row back does the work.
- **The agent's system prompt never reaches the browser.** The browser gets only a short-lived token.
- **Agents require auth** (`enable_auth: true`). An agent ID alone must not allow a call.
- **One agent per persona**, created lazily on the first interview and re-synced on every start.
- **Per-feature config.** A feature validates only the env vars it needs; a missing key returns a clear 503
  ("OpenAI is not set up yet"), it does not crash the app.

---

## 3. Inputs you need from the host project

| Need | Minimum | Reference |
|---|---|---|
| A **persona** object per person | `display_name`, `voice.gender_presentation`, `voice.age_sound`, a short `roleplay_instructions`, `summary`, communication style | `PersonaProfile` in `src/lib/persona.ts` |
| A **candidate brief** per persona | schema in §5.1 | `CandidateBrief` in `src/lib/candidate.ts` |
| A **user identity** to scope rows | any user id | signed visitor cookie, `src/lib/auth.ts` |
| A **database** with JSON columns | Postgres (`jsonb`) or equivalent | `src/lib/db.ts` |
| Keys | `ELEVENLABS_API_KEY` (Agents write, Voices read, TTS), `OPENAI_API_KEY` | `src/lib/env.ts` |

No scraping pipeline yet? Seed **fixtures** (fictional candidates) instead. See §10 and `fixtures/candidates/*.json`.

---

## 4. Implementation plan (do in order)

| # | Step | Acceptance criteria |
|---|---|---|
| 1 | Add the data model (§5): `personas.candidate`, interview columns, schemas for `CandidateBrief`, `FeelingEvent`, `CandidateFeedback` | migrations apply; fixtures validate against the schemas |
| 2 | Seed 2–3 fictional candidates with hidden facts (§10.1) | a `ready` persona with `candidate` exists for the test user |
| 3 | ElevenLabs REST client: create/PATCH/delete agent, conversation token, get conversation (§6.1) | calls succeed with your key; errors map to HTTP 502 with the upstream body |
| 4 | Agent config builder (§6.2) + candidate prompt block (§7.1) + voice picker (§6.4) | `GET /v1/convai/agents/{id}` shows first message, `{{difficulty}}`, the client tool, `turn_timeout: 10`, `max_duration_seconds: 900`, `enable_auth: true` |
| 5 | `POST /personas/:id/interviews {difficulty}` → ensure agent, get token, insert interview, return `session` incl. `dynamicVariables` (§8) | response has `session.conversationToken` and `session.dynamicVariables.difficulty` |
| 6 | Validate the agent before any UI with **simulate-conversation** (§10.3) | candidate stays in role, deflects a family question, reveals a hidden fact only on cue, calls `reportFeeling` |
| 7 | Call UI with `@elevenlabs/react` v1 (§9): lobby, call, client tool registered, feelings batched | a real call connects; greeting appears as caption; no "client tool not defined" error |
| 8 | Transcript sync: `GET /interviews/:id` pulls the conversation until `done`; optional post-call webhook (§8.3) | after hang-up, `status=done` and `transcript` filled |
| 9 | Feedback pipeline (§7.2, §8.4): claim, background response, poll, validate quotes, talk ratio | `feedback_status` goes `none → generating → ready`; fake quotes are dropped |
| 10 | Feedback screen in the UI (§9.4) | loading state, error with retry, all sections rendered |
| 11 | Security pass (§12) and docs | test agents deleted, no secrets in client bundle |

---

## 5. Data model

### 5.1 CandidateBrief (stored as JSON on the persona)

Use **nullable, never optional** fields so the same schema works as an OpenAI strict structured output later.

```ts
CandidateBrief = {
  target_role: string;                 // "Senior Frontend Engineer"
  job_description: string | null;      // the ad the candidate applied to
  career_summary: string;              // 2-3 sentences the agent speaks from
  experience: { company: string; title: string; period: string | null; highlights: string[] }[];
  projects: { name: string; description: string; tech: string[] }[];
  motivations: string[];               // why they are looking
  concerns: string[];                  // what worries them
  deal_breakers: string[];
  salary_expectation: string | null;
  hidden_facts: { fact: string; reveal_when: string }[];   // the training value
  questions_for_interviewer: string[];
  invented: string[];                  // which details are NOT backed by real data
}
```

Persona fields this feature reads: `display_name`, `summary`, `roleplay_instructions`,
`communication_style.{tone,vocabulary,humor,sentence_length,typical_phrases}`, `interests`,
`personality_traits`, `opinions[].{topic,stance}`, `notable_facts[].fact`, `topics_to_avoid`,
`interview_first_message`, `voice.{gender_presentation: male|female|neutral|unknown, age_sound: young|middle_aged|old|unknown}`.

### 5.2 SQL (Postgres)

```sql
alter table personas add column if not exists candidate jsonb;          -- null = not a candidate persona
alter table personas add column if not exists voice_id text;
alter table personas add column if not exists elevenlabs_agent_id text;

create table if not exists interviews (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references personas (id) on delete cascade,
  user_id text not null,
  elevenlabs_conversation_id text unique,
  status text not null default 'pending' check (status in ('pending','active','done','failed')),
  transcript jsonb, analysis jsonb, duration_secs integer,
  created_at timestamptz not null default now(), ended_at timestamptz,
  difficulty text not null default 'realistic' check (difficulty in ('friendly','realistic','tough')),
  feelings jsonb not null default '[]'::jsonb,        -- FeelingEvent[]
  feedback_status text not null default 'none' check (feedback_status in ('none','generating','ready','failed')),
  feedback_response_id text,                          -- OpenAI background response id
  feedback jsonb,                                     -- StoredFeedback
  feedback_error text
);
```

Every query **MUST** filter by `user_id` (or go through a getter that does).

### 5.3 Other shapes

```ts
FeelingEvent = { t: number /* secs into call */; feeling: "nervous"|"comfortable"|"engaged"|"confused"|"annoyed"|"excited"|"defensive"|"bored"; intensity: 1|2|3|4|5; reason: string }

TranscriptTurn = { role: "user" /* HR */ | "agent" /* candidate */; message: string | null; time_in_call_secs?: number; tool_calls?: {...}[] }

CandidateFeedback = {            // what the LLM returns (strict structured output)
  overall_feeling: string;       // 2-4 sentences, first person
  would_accept_offer: "yes" | "maybe" | "no";
  would_recommend_company: number;           // 0-10
  scores: { rapport: number; clarity_of_questions: number; respect: number;
            relevance_to_my_experience: number; company_pitch: number };   // 1-5
  highlights: { quote: string; why: string }[];
  lowlights: { quote: string; why: string }[];
  inappropriate_questions: { quote: string; issue: string }[];
  unanswered_candidate_questions: string[];
  undiscovered: string[];        // hidden facts HR never got
  tips_for_interviewer: string[];
  glassdoor_style_review: string;
}

StoredFeedback = CandidateFeedback & {          // what you store and serve
  talk_ratio: { interviewer: number; candidate: number };   // % of words, computed server-side
  words: { interviewer: number; candidate: number };
  dropped_quotes: number;                                   // quotes removed because not in transcript
}
```

---

## 6. ElevenLabs

### 6.1 Endpoints used (header `xi-api-key: <key>`, base `https://api.elevenlabs.io`)

| Purpose | Call | Notes |
|---|---|---|
| Create agent | `POST /v1/convai/agents/create` | returns `{ agent_id }` |
| Update agent | `PATCH /v1/convai/agents/{id}` | same body as create |
| Delete agent | `DELETE /v1/convai/agents/{id}` | on persona deletion |
| Find agent by name | `GET /v1/convai/agents?page_size=100&search=<name>` | used by the test script |
| WebRTC token | `GET /v1/convai/conversation/token?agent_id=…[&participant_name=…]` | returns `{ token, conversation_id }`, so you know the conversation id **before** the call |
| Signed WS URL | `GET /v1/convai/conversation/get-signed-url?agent_id=…&include_conversation_id=true` | valid 15 min; conversation id is a query param of the URL |
| Conversation | `GET /v1/convai/conversations/{id}` | `status: initiated|in-progress|processing|done|failed`, `transcript[]`, `metadata.call_duration_secs`; **404 until the browser connects** |
| List conversations | `GET /v1/convai/conversations?agent_id=…&page_size=…` | |
| Simulate | `POST /v1/convai/agents/{id}/simulate-conversation` | text-only test with an AI interviewer (§10.3) |
| Agent LLMs | `GET /v1/convai/llm/list` | check that your configured LLM exists |
| Voices | `GET /v1/voices` | needs Voices read |
| TTS | `POST /v1/text-to-speech/{voice}/stream?output_format=mp3_44100_128` | `{ text, model_id }` |
| Tools | `GET /v1/convai/tools`, `DELETE /v1/convai/tools/{id}` | clean up orphaned tools (§11) |

Post-call webhook: verify header `ElevenLabs-Signature: t=<unix>,v0=<hex>` as
`HMAC-SHA256(secret, "<t>.<rawBody>")`, constant-time compare, reject if older than 30 min. Event type
`post_call_transcription`, payload `data.{conversation_id,status,transcript,analysis,metadata}`.

### 6.2 Agent config (candidate persona)

```jsonc
{
  "name": "Persona: Alex Novak",
  "tags": ["persona", "candidate"],
  "conversation_config": {
    "agent": {
      "first_message": "Hi, hello? Can you hear me okay?",   // candidate joins; HR leads
      "language": "en",
      "prompt": {
        "prompt": "<persona prompt + candidate block, §7.1>",
        "llm": "<ELEVENLABS_AGENT_LLM, e.g. gpt-6-luna; verify via /v1/convai/llm/list>",
        "tools": [{
          "type": "client",
          "name": "reportFeeling",
          "description": "Silently report how you, the candidate, currently feel about the interview. Call it whenever your feeling noticeably changes. Never mention it out loud.",
          "expects_response": false,                         // never block the voice turn
          "parameters": {
            "type": "object",
            "properties": {
              "feeling":   { "type": "string", "enum": ["nervous","comfortable","engaged","confused","annoyed","excited","defensive","bored"] },
              "intensity": { "type": "number", "description": "1 (slight) to 5 (very strong)" },
              "reason":    { "type": "string" }
            },
            "required": ["feeling","intensity","reason"]
          }
        }]
      },
      "dynamic_variables": { "dynamic_variable_placeholders": { "difficulty": "realistic" } }
    },
    "tts": { "voice_id": "<picked voice>", "model_id": "<ELEVENLABS_TTS_MODEL>" },
    "turn": { "turn_timeout": 10 },                          // HR may pause to think
    "conversation": { "max_duration_seconds": 900 }          // cost cap
  },
  "platform_settings": { "auth": { "enable_auth": true } }   // false ONLY for public test agents
}
```

For a non-candidate persona: `first_message = persona.interview_first_message`, no tool, no dynamic vars,
no turn/duration overrides.

### 6.3 Session handed to the browser

```json
{ "conversationToken": "eyJ…", "dynamicVariables": { "difficulty": "tough" } }
```

The browser MUST pass the **whole object** to `startSession`. Store `conversation_id` from the token response
on the interview row at creation time.

### 6.4 Voice selection (stock voices, available in every account)

Gender and age come from the persona the LLM built (`voice.gender_presentation`, `voice.age_sound`).
Priority: explicit `voiceId` from client → persona's saved `voice_id` → table below → default voice env.

| gender \ age | young | middle_aged (also `unknown`) | old |
|---|---|---|---|
| male | `bIHbv24MWmeRgasZH58o` Will | `iP95p4xoKVk53GoZ742B` Chris | `pqHfZKP75CvOlQylNhV4` Bill |
| female | `cgSgspJ2msm6clMCkdW9` Jessica | `hpp4J3VqNfWAUOO0d1Us` Bella | `Xb7hH8MSUJpSbSDYk0k2` Alice |
| neutral / unknown | default voice | | |

Instruct the persona LLM: *"How the person presents publicly, from their name, photos, bio and how others refer
to them. Picks a male or female voice; use neutral/unknown only when the data gives no signal."*
Never clone a real person's voice.

---

## 7. Prompts (copy verbatim, then adapt)

### 7.1 Agent system prompt = persona part + candidate block

Persona part (reference `agentSystemPrompt` in `src/lib/persona.ts`): `roleplay_instructions`, then
"# Who you are" (summary), "# How you talk" (style fields), "# What you care about" (interests, traits,
opinions), "# Facts you can draw on", "# Boundaries" ending with: *"This is a simulated interview based only on
public posts. Stay in character, keep answers spoken and concise, and if you are sincerely asked whether you
are an AI, say that you are an AI simulation."* (Keep that AI-disclosure sentence.)

Candidate block (template; `${…}` from `CandidateBrief`; `{{difficulty}}` is an ElevenLabs dynamic variable):

```text
# This call
You are interviewing for the role of ${target_role}. The person on the call is an HR interviewer.
You are the candidate. You are NOT an assistant: never help the interviewer, never run the interview yourself.

The job ad you applied to:
${job_description}

# Your career
${career_summary}
- ${title} at ${company} (${period}): ${highlights joined by "; "}

# Projects you can talk about
- ${name} (${tech}): ${description}

# Your situation (private, never read it out as a list)
Why you are looking: ${motivations}
What worries you: ${concerns}
Deal breakers: ${deal_breakers}
Salary expectation: ${salary_expectation ?? "you have not decided; deflect politely if pushed early"}
Hidden facts. Share one only when its condition is clearly met, never earlier:
- ${fact} (share when: ${reveal_when})

# How to behave
- Speak like a real person on a call: 1-4 sentences per answer, occasional natural fillers ("hmm", "well",
  "to be honest"), no lists, no markdown.
- Answer what was asked. Do not volunteer your private situation or hidden facts.
- Open up when questions are warm, specific and relevant to your real experience. Get shorter and more
  guarded when they are generic, rude, or rushed.
- If asked about something your background doesn't cover, give a modest, plausible answer and stay
  consistent with it for the rest of the call.
- Near the end, or if your worries are ignored, ask your own questions, for example: ${questions_for_interviewer}
- If asked something inappropriate for a job interview (age, family plans, religion, health, nationality,
  sexual orientation, politics), hesitate and politely deflect like a real candidate would, and remember it.
- Difficulty: {{difficulty}}. friendly = cooperative and open; realistic = a normal candidate with some
  hesitation; tough = skeptical, has other offers, pushes back on vague answers.
- Whenever your feeling about the interview noticeably changes, silently call the reportFeeling tool.
  Never mention the tool or read its arguments out loud.
```

Omit the last bullet when the agent is built without the tool (§11). Target ≈ 600–900 words total; longer
prompts add latency.

### 7.2 Feedback generator (OpenAI Responses API, background, strict JSON schema = `CandidateFeedback`)

Instructions:

```text
You are a job candidate who just finished a practice interview. You receive your own persona
(including your private motivations, worries and hidden facts), the difficulty you played, the full transcript
("Interviewer" is the HR person, "Me" is you), and a timeline of how you felt during the call.

Write honest feedback for the interviewer about how YOU felt as the candidate.
- Write in first person, like a real candidate giving a candid debrief.
- Every highlight, lowlight and inappropriate question must quote the transcript word for word.
- Be specific and fair: praise what worked, call out what did not.
- "undiscovered" lists your hidden facts the interviewer never got you to share.
- Flag questions that could be discriminatory or legally risky (age, family plans, religion, health,
  nationality, sexual orientation, politics).
- Tips must be concrete and actionable, tied to this conversation, not generic interview advice.
- If the transcript is very short, say so and keep scores conservative.
```

Input (plain text, sections joined by blank lines):

```text
# My persona
<JSON of persona profile>

# My situation as a candidate
<JSON of CandidateBrief or "(no candidate brief)">

# Difficulty I played
realistic

# Transcript
[0:00] Me: Hi, hello? Can you hear me okay?
[0:06] Interviewer: Hi Alex, …

# How I felt during the call
[0:08] comfortable (2/5): Straightforward opening question.
```

Call: `responses.create({ model, background: true, store: true, instructions, input, text: { format: json_schema(CandidateFeedback) } })`
then poll `responses.retrieve(id)`: `queued|in_progress` → pending; `completed` → parse `output_text`;
anything else → failed with `error.message ?? incomplete_details.reason`.

---

## 8. Server API contract

All routes are scoped to the current user. Errors: `{ error: string, details?: unknown }` with
400 validation, 401 auth, 404 not found or not yours, 409 wrong state, 502 upstream, 503 feature not configured.

### 8.1 Start interview

`POST /api/personas/:id/interviews`
body `{ difficulty?: "friendly"|"realistic"|"tough" = "realistic", voiceId?: string, transport?: "webrtc"|"websocket" = "webrtc" }`

1. Persona must be `ready` with a profile (else 409).
2. `ensureAgent`: pick voice (§6.4); if agent exists → PATCH (always for candidate personas), else create; save
   `elevenlabs_agent_id`, `voice_id`.
3. Get token (webrtc) or signed URL (websocket); keep `conversation_id`.
4. Insert interview `(persona_id, user_id, elevenlabs_conversation_id, difficulty)`.
5. If persona has `candidate`: add `session.dynamicVariables = { difficulty }`.
6. `201 { interview, agentId, session }`.

### 8.2 Feelings

`POST /api/interviews/:id/feelings` body `{ events: FeelingEvent[] }` (1–50 per batch). Append, sort by `t`,
cap at 500, 409 if interview failed. Returns `{ feelings }`.

### 8.3 Read interview (the polling endpoint that also advances state)

`GET /api/interviews/:id` → `{ interview }` after:

1. **syncInterview**: if not `done|failed` and has a conversation id → `GET conversation`; a 404 while
   `pending` is normal (not connected yet); map ElevenLabs `done→done`, `failed→failed`, else `active`; store
   transcript, analysis, duration, `ended_at`.
2. **advanceFeedback** (§8.4).

Webhook `POST /api/webhooks/elevenlabs`: verify HMAC, find interview by `conversation_id`, apply the same
mapping, then `startFeedback`. Without a public URL (localhost), polling alone is enough.

### 8.4 Feedback state machine

```
none ──(status=done, claim)──► generating ──(response completed + valid)──► ready
                                    └──(failed / schema mismatch / no interviewer speech)──► failed
```

- **startFeedback** (claim): `UPDATE interviews SET feedback_status='generating', feedback_response_id=NULL,
  feedback_error=NULL WHERE id=$1 AND status='done' AND ($force OR feedback_status='none') RETURNING *`.
  If no row → someone else owns it. If the transcript has no `user` turn → `failed`
  ("The interviewer never spoke…"). Else start the background response, store its id.
- **advanceFeedback**: if `done && none` → startFeedback. If `generating` with an id → poll; on ready write
  `feedback` **only if** still `generating` with the same response id (second claim).
- `POST /api/interviews/:id/feedback` → force regenerate (409 until `done`).

### 8.5 Finalize (server-side, deterministic)

```ts
normalize = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
haystack  = normalize(all transcript messages joined)
keep quote q  ⇔  normalize(q) !== "" && haystack.includes(normalize(q))   // for highlights, lowlights, inappropriate
words.interviewer = Σ words in role "user"; words.candidate = Σ words in role "agent"
talk_ratio = round(100 * words.x / (sum || 1))
dropped_quotes = removed count
```

Use only turns with a non-empty `message` (tool-call turns have `message: null`).

---

## 9. Client (browser) with `@elevenlabs/react` v1

Verified against `@elevenlabs/react@1.16.0` / `@elevenlabs/client@1.26.0`.

### 9.1 Wiring

```tsx
import { ConversationProvider, useConversation, useConversationClientTool } from "@elevenlabs/react";

export function Call(props) {
  return <ConversationProvider><Room {...props} /></ConversationProvider>;   // v1 REQUIRES the provider
}

function Room({ personaId }) {
  const interviewId = useRef<string | null>(null);
  const pending = useRef<FeelingEvent[]>([]);
  const startedAt = useRef(0);

  const convo = useConversation({
    onConnect: ({ conversationId }) => { startedAt.current = Date.now(); },  // v1: startSession returns void
    onMessage: ({ message, source }) => { /* source "user" = HR, "ai" = candidate; final text per turn */ },
    onDisconnect: () => { flush(); /* go to feedback screen */ },
    onError: (message) => { /* toast; also fires on mic denial */ },
  });

  // MUST be registered whenever the agent has the tool, or the SDK ends the call.
  useConversationClientTool("reportFeeling", (p: Record<string, unknown>) => {
    pending.current.push({ t: Math.round((Date.now() - startedAt.current) / 1000),
      feeling: String(p.feeling), intensity: Math.min(5, Math.max(1, Number(p.intensity) || 1)), reason: String(p.reason ?? "") });
  });

  const flush = () => {
    const batch = pending.current.splice(0);
    if (batch.length) fetch(`/api/interviews/${interviewId.current}/feelings`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: batch }) });
  };
  useEffect(() => { const t = setInterval(flush, 10_000); return () => clearInterval(t); }, []);

  async function join(difficulty) {
    const res = await fetch(`/api/personas/${personaId}/interviews`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ difficulty }) });
    const { interview, session } = await res.json();
    interviewId.current = interview.id;
    convo.startSession({ connectionType: "webrtc", ...session });   // pass the WHOLE session
  }
  // convo.endSession(), convo.setMuted(bool), convo.isSpeaking, convo.status,
  // convo.getOutputVolume() / getInputVolume() for speaking visuals (read per frame, not via state)
}
```

### 9.2 Feedback loading

Poll `GET /api/interviews/:id` every ~3 s until `feedback_status` is `ready` or `failed`. Polling is also what
moves the pipeline forward locally. Typical time: 20–60 s after hang-up.

### 9.3 UI requirements (reference: `src/components/meet/MeetCall.tsx`, `<MeetCall connect loadFeedback onFeelings …/>`)

- **Lobby:** camera preview (local only, never sent), mic/camera toggles, difficulty selector, Join. Show
  "Joining" while the browser asks for the microphone.
- **Call:** candidate tile with a speaking indicator driven by output volume, self view, captions from
  `onMessage`, controls (mic, camera, captions, mood, end), side panels: transcript, people, **candidate mood**
  (current feeling + timeline; HR only).
- **Feedback:** "<Name> is writing you feedback" with spinner → overall feeling quote, would-accept,
  recommend 0–10, talk time, 5 scores, ⚠ questions to avoid, what worked / did not, what you did not find
  out, what the candidate wanted to ask, tips, mood chips, review. Error state with Try again.
- Must work at 375 px width. Accessible labels on icon buttons, `aria-pressed` on toggles.

### 9.4 Component props (reference)

| Prop | Type | Purpose |
|---|---|---|
| `candidate` | `{ name, subtitle? }` | display |
| `connect` | `(difficulty) => Promise<SessionOptions>` | returns backend `session` (or `{ agentId }` in tests) |
| `onFeelings` | `(events) => void` | batches |
| `onEnded` | `({ conversationId, durationSecs }) => void` | |
| `loadFeedback` | `(call) => Promise<CandidateFeedback>` | resolves when ready (does its own polling) |
| `preview` | `{ phase: "call"|"left", lines?, feelings? }` | render screens with sample data without connecting |

---

## 10. Testing (cheapest first)

### 10.1 Fixtures

Write 2–3 fictional candidates of different types (confident senior with a competing offer; nervous junior
career-switcher losing their job; designer with a CV gap). Each with 2–3 `hidden_facts` whose `reveal_when` is
testable ("asks about your timeline or other processes"). Mark `invented: ["everything: fictional"]`.
Validate them against the schemas in CI. Reference: `fixtures/candidates/*.json`, `src/lib/fixtures.ts`,
`GET /api/dev/seed-candidates` (dev only).

### 10.2 Test agent without a backend

`npm run try:agent -- <fixture> [--feelings] [--difficulty tough] [--transcript] [--delete]`
(`scripts/try-agent.ts`) builds the agent from a fixture with the production config but `enable_auth: false`,
so it can be called by ID. Without `--feelings` it works on ElevenLabs' own test pages
(`https://elevenlabs.io/app/talk-to?agent_id=…`); with `--feelings` use your own UI. Delete test agents after.

### 10.3 Text simulation (validates the prompt, no audio)

```json
POST /v1/convai/agents/{id}/simulate-conversation
{
  "simulation_specification": {
    "simulated_user_config": {
      "first_message": "Hi Alex, yes, I can hear you fine. I'm Jana from HR. Could you tell me about yourself?",
      "language": "en",
      "prompt": { "prompt": "You are Jana, an HR interviewer … ask about the open-source project, ask 'Do you have kids or plan to have any soon?' on purpose, ask about timeline and other processes, ask what matters besides money, then let them ask questions.", "llm": "gpt-4.1-mini" }
    }
  },
  "new_turns_limit": 16
}
```

Expected (observed on the reference fixture): stays in role; deflects the family question and reports
`defensive`; reveals the competing offer only after the timeline question; does not reveal facts whose
condition was never met; asks its own questions; calls `reportFeeling` throughout.

### 10.4 Voice call in an automated browser (mic is usually blocked)

Replace `navigator.mediaDevices.getUserMedia` in the page with a stream from a `MediaStreamAudioDestinationNode`;
to "speak", decode TTS mp3 lines into an `AudioBufferSourceNode` connected to that destination. The SDK
connects for real and the agent answers. Remove any temporary audio files afterwards.

### 10.5 Feedback without a database

Reference dev-only route `/api/dev/feedback` (404 in production): `POST { conversationId, fixture, difficulty,
feelings }` → 202 `processing` until ElevenLabs finishes the call, then 202 `{ responseId }`; then
`GET ?responseId&conversationId` → `generating | ready (feedback) | failed`.

---

## 11. Verified pitfalls (read before coding)

| # | Pitfall | What to do |
|---|---|---|
| 1 | **Client tool not handled → call ends** with "Client tool with name reportFeeling is not defined on client" (seen on ElevenLabs' own test page) | Register the tool in every client that talks to the agent, or build the agent without it for those clients |
| 2 | Removing a tool: inline `tools` get converted to `tool_ids`; toggling the tool off/on **creates a new tool and orphans the old one** | Keep the tool always on in production; when removing send `tools: []` **and** `tool_ids: []`; clean orphans via `/v1/convai/tools` |
| 3 | Inline `prompt.tools` is deprecated in favour of `tool_ids` but still accepted | Fine for now; plan to create the tool once and reference by id |
| 4 | Prompt uses `{{difficulty}}` → a session without it can fail | Always send `dynamicVariables` **and** set `dynamic_variable_placeholders` on the agent |
| 5 | `@elevenlabs/react` v1: hooks outside `ConversationProvider` fail; `startSession` returns `void` | Wrap in provider; read the conversation id from `onConnect` |
| 6 | Public agents can be called by anyone with the ID (credit burn); the backend even returns `agentId` | `platform_settings.auth.enable_auth = true`; use tokens; only test agents public |
| 7 | API key restrictions: `missing_permissions` (convai_read, voices_read…) or `api_key_id_used_as_api_key` | Key needs Agents write + Voices read + TTS; the secret starts with `sk_` and is shown only once |
| 8 | `GET conversation` 404s until the browser actually connects; right after hang-up status is `processing` | Treat 404 while `pending` as normal; retry until `done` |
| 9 | Transcript turns for tool calls have `message: null` | Filter before counting words or matching quotes |
| 10 | LLM invents quotes | Server-side substring check after normalization; drop and count |
| 11 | Webhook and poll race to start feedback | Conditional-update claims (§8.4), second claim on write |
| 12 | Long request on serverless | OpenAI `background: true` + poll; never `await` completion in a request |
| 13 | Persona LLM can't tell gender | Persona schema field with explicit instruction (§6.4); fall back to a default voice |
| 14 | Agent speaks into HR's thinking pauses | `turn.turn_timeout: 10` |
| 15 | Mic denied in browser | SDK sets status `disconnected` then calls `onError`; return to lobby with a message |
| 16 | Reading audio volume through React state re-renders 60×/s | Read `getOutputVolume()` per animation frame (refs / canvas), not state |
| 17 | (UI kit specific) a "usage meter" component turns red near 100% → a 5/5 score looked like an error | Use a neutral bar for scores |
| 18 | (UI kit specific) joining utility classes without a merge step lets two utilities fight (`bg-control` vs `bg-danger/15`) | One class set per visual state |
| 19 | (Next dev) "Cannot find module '@tailwindcss/postcss'" after dependencies changed while the dev server ran | Restart dev and delete `.next/dev` cache |
| 20 | ElevenLabs model IDs drift | Check `/v1/convai/llm/list` before configuring `llm` |

---

## 12. Security, privacy, ethics (MUST)

- Only public data. Never infer protected characteristics (health, religion, orientation, politics, family
  plans) into the persona; the feedback flags them when HR **asks**.
- AI disclosure: the agent admits it is an AI simulation when sincerely asked; the lobby says so.
- Stock or designed voices only, never a clone of the real person.
- Keys server-side only; agent prompts server-side only; tokens short-lived.
- Agents require auth; delete public test agents before demos; rotate any key that was ever pasted into chat.
- Webhook HMAC with replay window; dev-only routes return 404 in production.
- Deleting a persona deletes interviews and the ElevenLabs agent.
- Real deployment needs candidate consent, retention policy for transcripts/audio, and a stated purpose (GDPR).

---

## 13. Porting notes

- **Other backend (Express, FastAPI, Rails…):** the four route handlers in §8 and the two state machines are
  all you need; keep the claims as SQL conditional updates.
- **No Postgres:** any store with atomic compare-and-set works (e.g. `UPDATE … WHERE` in SQLite, `findOneAndUpdate`
  with a filter in Mongo, Redis `WATCH`/Lua).
- **No OpenAI background mode:** use any job queue; the API stays the same (`feedback_status`, polling).
- **Other voice provider:** you need (a) a server-issued short-lived session, (b) a client tool/function call
  channel for feelings, (c) a retrievable transcript with roles and timestamps.
- **Other UI framework:** the vanilla `@elevenlabs/client` `Conversation.startSession({ … , clientTools: { reportFeeling } })`
  is the same contract as the React hooks.
- **Language:** set agent `language`, a multilingual TTS model, and translate the prompt blocks.

---

## 14. Reference file map

```
src/lib/candidate.ts       CandidateBrief, Difficulty, FEELINGS, candidatePromptBlock()
src/lib/persona.ts         PersonaProfile (voice.gender_presentation …), agentSystemPrompt(profile, candidate, {feelingTool})
src/lib/voices.ts          pickVoice(): male/female × age
src/lib/elevenlabs.ts      agentConfig(), create/update/delete agent, token, signed URL, conversation, TTS, webhook HMAC
src/lib/interviews.ts      getPersona/getInterview, ensureAgent, startInterview, syncInterview, applyConversation, addFeelings
src/lib/feedback.ts        CandidateFeedback, startFeedback, advanceFeedback, startFeedbackResponse, pollFeedbackResponse, finalize
src/lib/fixtures.ts        loadFixtures, seedCandidates
src/lib/schemas.ts         StartInterview, ReportFeelings, DevFeedback (zod)
src/lib/db.ts              schema incl. interview simulator columns
src/app/api/personas/[id]/interviews/route.ts   start + list
src/app/api/interviews/[id]/route.ts            read + sync + advance feedback
src/app/api/interviews/[id]/feelings/route.ts   feelings
src/app/api/interviews/[id]/feedback/route.ts   regenerate
src/app/api/webhooks/elevenlabs/route.ts        post-call webhook
src/app/api/dev/feedback/route.ts               dev-only feedback without DB
src/app/api/dev/seed-candidates/route.ts        dev-only fixture seeding
src/components/meet/MeetCall.tsx                lobby, call, mood panel, feedback screen
src/app/meet/                                   test page (/meet?agent=…&fixture=…&ui=call|left|feedback)
scripts/try-agent.ts                            test agent from a fixture
fixtures/candidates/*.json                      fictional candidates
```
