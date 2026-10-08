# Interview Simulator: specifikace a implementační plán

> **Pozn. (později):** Supabase byl nahrazen lokální databází (PGlite v `src/lib/db.ts`) a návštěvníci se prokazují visitor cookie místo Supabase tokenu. Zmínky o Supabase níže jsou historie plánu. Aktuální postup je v `docs/interview-integration.md`.

> Moje část projektu **projstalker**: HR si nanečisto vyzkouší pohovor s hlasovou AI, která hraje konkrétního kandidáta (persona ze scrapingu), a po hovoru dostane od „kandidáta“ zpětnou vazbu, jak se u pohovoru cítil.
>
> Plán navazuje na existující backend (viz [`be.md`](../be.md)). **Počítá s tím, že scraping a tvorba persony ještě nejsou hotové.** Celá moje část proto zatím jede nad ručně připravenými kandidáty (fixtures) a na reálná data se napojí až nakonec.

| | |
|---|---|
| **Backend** | tohle repo: Next.js 16, jen API routes, Netlify (**limit 60 s na request**), Supabase |
| **Frontend** | samostatná Next.js aplikace (port 3000), mluví s API přes `Authorization: Bearer <supabase token>` |
| **Hlas** | ElevenLabs Agents, prohlížeč přes `@elevenlabs/react` v1 (`<ConversationProvider>`) |
| **LLM** | OpenAI Responses API, dlouhé úlohy v **background mode** |
| **Jazyk pohovoru** | angličtina |
| **Režim** | HR (člověk) ↔ AI simulace kandidáta |

---

## Stav implementace (první verze, větev `feature/interview-simulator`)

| Co | Stav |
|---|---|
| Migrace (`personas.candidate`, sloupce feedbacku v `interviews`) | ✅ napsaná, ⏳ **nespuštěná** |
| `CandidateBrief` + HR-mode prompt (`src/lib/candidate.ts`, `agentSystemPrompt`) | ✅ |
| Agent: první věta, `reportFeeling` client tool, `{{difficulty}}`, turn timeout 10 s, max 15 min | ✅ (ověřit na živém agentovi) |
| `difficulty` v `POST /api/personas/:id/interviews` + `session.dynamicVariables` | ✅ |
| Feedback (`src/lib/feedback.ts`): background OpenAI, validace citací, talk ratio | ✅ |
| `POST /api/interviews/:id/feelings`, `POST /api/interviews/:id/feedback` | ✅ |
| 3 fiktivní kandidáti + `npm run seed:candidates` | ✅ (`--check` prošel) |
| `api-catalog.ts`, `be.md`, README | ✅ |
| `typecheck`, `lint`, `build` | ✅ |
| Výběr hlasu podle persony (`voices.ts`) | ✅ stock hlasy podle pohlaví a věku |
| Call UI ve stylu Google Meet (`src/components/meet/`, test na `/meet`) | ✅ lobby, hovor, titulky, přepis, nálada kandidáta, obrazovka po odchodu |
| Agenti chránění tokenem (`enable_auth`), testovací agenti veřejní | ✅ |
| Hlasový test s agentem (`npm run try:agent`) + textová simulace | ✅ ověřeno na Alexi Novákovi |
| Návod na nasazení a napojení | ✅ [interview-integration.md](interview-integration.md) |
| Hodnocení od kandidáta v Meet UI po zavěšení (`loadFeedback`) | ✅ + lokální `/api/dev/feedback` pro test bez databáze |
| Hlas striktně muž/žena podle `voice.gender_presentation` z OpenAI | ✅ |
| Kompletní dokumentace feature | ✅ [interview-simulator.md](interview-simulator.md) |
| Napojení na scraping (generování `candidate` z dat) | ❌ až bude data stack hotový |

**Jak to rozjet:** spustit migraci → `npm run seed:candidates -- --user <email>` → `POST /api/personas/:id/interviews` s `{ "difficulty": "realistic" }` → hovor → `GET /api/interviews/:id`, dokud `feedback_status` není `ready`.

---

## 1. Co už existuje a co přidávám

### Už hotové (nesahat, jen použít)

| Co | Kde |
|---|---|
| Research job → Apify → `scraped_items` → OpenAI persona (`PersonaProfile`) | `src/lib/research.ts`, `src/lib/persona.ts` |
| Agent v ElevenLabs pro každou personu (systémový prompt zůstává na serveru) | `ensureAgent` v `src/lib/interviews.ts`, `agentConfig` v `src/lib/elevenlabs.ts` |
| `POST /api/personas/:id/interviews` vrací `{ interview, session: { conversationToken } }` | WebRTC, `conversation_id` je známé hned |
| Přepis po hovoru přes webhook i polling | `POST /api/webhooks/elevenlabs`, `GET /api/interviews/:id` → `syncInterview` |
| TTS | `POST /api/voice/tts` (použiju pro namluvený feedback) |
| Katalog API a docs | `src/lib/api-catalog.ts` → `GET /api`, `/docs` |

### Co přidávám

1. **Kandidátská vrstva persony**: cílová pozice, motivace, obavy, skrytá fakta a další věci, které z persony udělají *kandidáta na pohovoru*.
2. **Fixtures a seed**: 2–3 ručně připravení kandidáti, aby šlo vyvíjet a demovat bez scrapingu.
3. **Úpravy agenta**: HR mode prompt, obtížnost jako dynamic variable, client tool `reportFeeling`.
4. **Feedback kandidáta po hovoru**: OpenAI v background mode, uložení k `interviews`.
5. **Mood timeline**: ukládání pocitů kandidáta z hovoru.
6. **Frontend stránky** pro hovor a feedback.

---

## 2. Tok dat

```
             (dnes)                                  (až bude scraping ready)
  fixtures/candidates/*.json                    POST /api/research + candidate krok
            │ npm run seed:candidates                     │ Apify → OpenAI
            ▼                                             ▼
  research_jobs (ready) + personas (ready, personas.candidate vyplněné)
            │
            ▼
  POST /api/personas/:id/interviews { difficulty, voiceId? }
     └─ ensureAgent (HR-mode prompt + reportFeeling tool)
     └─ { interview, session: { conversationToken, dynamicVariables: { difficulty } } }
            │
            ▼  prohlížeč: conversation.startSession(session)   ◀══ WebRTC ══▶ ElevenLabs
            │    clientTools.reportFeeling → POST /api/interviews/:id/feelings
            │
  hovor skončí → webhook / GET /api/interviews/:id → status done
            │   claim feedback_status none→generating → OpenAI background response
            ▼
  GET /api/interviews/:id (polling) → poll OpenAI → validace citací → feedback (ready)
```

Klíčové pravidlo z `be.md` platí i pro mě: **žádný request nesmí čekat na pomalou práci.** Generování feedbacku proto běží v OpenAI background mode a posouvá ho `GET /api/interviews/:id` a webhook. Přechody stavů dělám přes podmíněný update („claim“).

---

## 3. Datový model

### 3.1 Kandidátská vrstva: `personas.candidate`

**Rozhodnuto:** kandidátská vrstva je samostatný sloupec `personas.candidate` (jsonb, schéma `CandidateBrief` v `src/lib/candidate.ts`), **ne** součást `PersonaProfile`. Persona pipeline kolegy tak zůstává beze změny. Pole jsou `nullable`, ne `optional`, aby šlo schéma později použít i jako OpenAI structured output. Zatím ho plní fixtures. Až bude scraping hotový, vyplní ho OpenAI.

```ts
CandidateBrief = z.object({
  target_role: z.string(),                 // "Senior Frontend Engineer"
  job_description: z.string().nullable(),
  career_summary: z.string(),              // 2–3 věty, ze kterých agent mluví o kariéře
  experience: z.array(z.object({ company: z.string(), title: z.string(), period: z.string().nullable(), highlights: z.array(z.string()) })),
  projects: z.array(z.object({ name: z.string(), description: z.string(), tech: z.array(z.string()) })),
  motivations: z.array(z.string()),        // proč hledá práci
  concerns: z.array(z.string()),           // remote, přesčasy, tech debt…
  deal_breakers: z.array(z.string()),
  salary_expectation: z.string().nullable(),
  hidden_facts: z.array(z.object({         // prozradí jen při dobré otázce nebo dobrém rapportu
    fact: z.string(),
    reveal_when: z.string(),
  })),
  questions_for_interviewer: z.array(z.string()),
  invented: z.array(z.string()),           // co není podložené daty (u fixtures všechno označené)
})
```

`hidden_facts` jsou jádro tréninkové hodnoty: dobrý interviewer je z kandidáta dostane, špatný ne. Feedback pak ukáže, co zůstalo neodhaleno.

### 3.2 Migrace `supabase/migrations/20261009000000_interview_simulator.sql`

Nová migrace, žádnou existující neupravuju. **Zatím není spuštěná** proti sdílenému Supabase projektu.

```sql
alter table public.personas
  add column candidate jsonb;

alter table public.interviews
  add column difficulty text not null default 'realistic'
    check (difficulty in ('friendly', 'realistic', 'tough')),
  add column feelings jsonb not null default '[]'::jsonb,   -- [{ t, feeling, intensity, reason }]
  -- none -> generating -> ready | failed
  add column feedback_status text not null default 'none'
    check (feedback_status in ('none', 'generating', 'ready', 'failed')),
  add column feedback_response_id text,
  add column feedback jsonb,
  add column feedback_error text;
```

`interviews` je už v Realtime publikaci, takže frontend se může na feedback přihlásit odběrem a nemusí pollovat. Lokálně ale polling stejně potřeba je, protože ten feedback posouvá.

### 3.3 `CandidateFeedback` (nový soubor `src/lib/feedback.ts`)

```ts
export const CandidateFeedback = z.object({
  overall_feeling: z.string(),                       // 2–4 věty v 1. osobě
  would_accept_offer: z.enum(["yes", "maybe", "no"]),
  would_recommend_company: z.number(),               // 0–10, candidate NPS
  scores: z.object({                                 // 1–5
    rapport: z.number(), clarity_of_questions: z.number(), respect: z.number(),
    relevance_to_my_experience: z.number(), company_pitch: z.number(),
  }),
  highlights: z.array(z.object({ quote: z.string(), why: z.string() })),
  lowlights: z.array(z.object({ quote: z.string(), why: z.string() })),
  inappropriate_questions: z.array(z.object({ quote: z.string(), issue: z.string() })),
  unanswered_candidate_questions: z.array(z.string()),
  undiscovered: z.array(z.string()),                 // hidden_facts, které HR nevytáhlo
  tips_for_interviewer: z.array(z.string()),
  glassdoor_style_review: z.string(),
});
// Deterministicky dopočítáno serverem (ne LLM): talk_ratio { interviewer, candidate }, word counts.
```

---

## 4. Backend: změny po souborech

| Soubor | Změna |
|---|---|
| `supabase/migrations/2026100900…_interview_feedback.sql` | nové sloupce (3.2) |
| `src/lib/candidate.ts` *(nový)* | `CandidateBrief`, `Difficulty`, HR-mode blok promptu (kap. 5) |
| `src/lib/persona.ts` | `agentSystemPrompt(profile, candidate?)` přidá HR-mode blok; `PersonaProfile` ani `SYSTEM_PROMPT` se nemění |
| `src/lib/elevenlabs.ts` | `agentConfig`: client tool `reportFeeling`, delší turn timeout, max délka hovoru |
| `src/lib/interviews.ts` | `startInterview` přijme `difficulty`, uloží ho a vrátí `session.dynamicVariables`. `syncInterview` po `done` zavolá `advanceFeedback` |
| `src/lib/feedback.ts` *(nový)* | `CandidateFeedback`, `startFeedback` (claim + background response), `advanceFeedback` (poll + validace citací + talk ratio) |
| `src/lib/schemas.ts` | `StartInterview.difficulty`, `ReportFeelings` |
| `src/app/api/interviews/[id]/feelings/route.ts` *(nový)* | `POST` uloží dávku pocitů |
| `src/app/api/interviews/[id]/feedback/route.ts` *(nový)* | `POST` vynutí přegenerování feedbacku |
| `src/app/api/webhooks/elevenlabs/route.ts` | po `applyConversation` spustí `startFeedback` |
| `src/lib/voices.ts` *(nový)* | mapa ~6 stock hlasů podle `profile.voice` (pohlaví × věk), použije se, když frontend nepošle `voiceId` |
| `src/lib/api-catalog.ts` | záznamy pro nové a změněné routes |
| `src/lib/env.ts` + `.env.example` | `OPENAI_FEEDBACK_MODEL` (default = persona model) |
| `fixtures/candidates/*.json` + `scripts/seed-candidates.ts` + `package.json` script | seed bez scrapingu (kap. 6) |

### 4.1 API: nové a změněné routes

| Metoda | Cesta | Změna |
|---|---|---|
| `POST` | `/api/personas/:id/interviews` | body navíc `difficulty?: "friendly" \| "realistic" \| "tough"`; `session` navíc `dynamicVariables: { difficulty }` |
| `GET` | `/api/interviews/:id` | navíc posouvá feedback; vrací `feelings`, `feedback_status`, `feedback` |
| `POST` | `/api/interviews/:id/feelings` | `{ events: [{ t, feeling, intensity, reason }] }` (frontend posílá v dávkách po ~10 s a při konci) |
| `POST` | `/api/interviews/:id/feedback` | přegeneruje feedback (409, dokud hovor není `done`) |

### 4.2 Životní cyklus feedbacku (idempotentní)

```
interviews.status = done  &&  feedback_status = none
  → claim: update set feedback_status='generating' where id=? and feedback_status='none'
  → vítěz claimu: openai.responses.create({ background: true, text: zodTextFormat(CandidateFeedback) })
                  → uloží feedback_response_id
GET /api/interviews/:id  (feedback_status = generating)
  → responses.retrieve(id) → completed?
      → parse + validace (citace musí být v přepisu, jinak se položka zahodí)
      → dopočítat talk_ratio z transcriptu
      → feedback_status='ready'  |  'failed' + feedback_error
```

Vstup do OpenAI tvoří `profile` (včetně `candidate.hidden_facts`), `transcript` (role `user` = HR, `agent` = kandidát), `feelings` a `difficulty`.

---

## 5. ElevenLabs agent: úpravy

Agent už existuje pro každou personu a `ensureAgent` ho vytvoří nebo aktualizuje. Měním jen jeho konfiguraci a prompt.

| Nastavení | Hodnota | Proč |
|---|---|---|
| `first_message` | krátké „Hi, hello? Can you hear me okay?“ (z `interview_first_message`) | realistický vstup do hovoru, otázky pak klade HR |
| prompt | `agentSystemPrompt` + HR-mode blok (níže), proměnná `{{difficulty}}` | |
| client tool `reportFeeling` | `{ feeling, intensity 1–5, reason }`, nečeká na odpověď | mood meter |
| turn timeout | delší (~10 s) | kandidát nesmí po krátkém tichu začít mluvit sám |
| max duration | ~15 min | ochrana kreditů |
| interruptions | zapnuté | HR musí jít skočit do řeči |

> **Pozor:** když prompt obsahuje `{{difficulty}}`, musí ho dostat každý `startSession`. Jinak hovor spadne. Proto ho backend vrací rovnou v `session.dynamicVariables` a frontend jen předá celý objekt `session`. Přesné názvy polí pro client tool v `conversation_config.agent.prompt.tools` (hlavně „nečekat na odpověď“) ověřit proti aktuální API dokumentaci ElevenLabs.

**HR-mode blok promptu** (přidá se, když `personas.candidate` existuje):

```
# This call
You are interviewing for the role of {target_role}. The person on the call is an HR interviewer.
You are the candidate. You are NOT an assistant: never help the interviewer or run the interview.

# Your situation (private, never read out as a list)
Motivations: … | Concerns: … | Deal breakers: … | Salary expectation: …
Hidden facts (reveal only when the condition is clearly met):
- {fact} (reveal when: {reveal_when})

# Behaviour
- Short to medium spoken answers (1–4 sentences), occasional natural fillers, no lists.
- Answer what was asked; don't volunteer hidden facts.
- Open up when questions are warm, specific and relevant to your real experience;
  get shorter and more guarded when they are generic, rude or rushed.
- Near the end, or if your concerns are ignored, ask your own questions: {questions_for_interviewer}.
- If asked something inappropriate (age, family plans, religion, health, nationality…),
  hesitate and politely deflect, like a real person would.
- Difficulty: {{difficulty}}. friendly = cooperative; realistic = normal hesitations;
  tough = skeptical, has other offers, pushes back on vague answers.
- When your feeling about the interview changes, silently call reportFeeling. Never mention it.
```

Stávající pravidla zůstávají: agent na upřímný dotaz přizná, že je AI simulace, a nevymýšlí soukromá fakta.

---

## 6. Práce bez scrapovaných dat (fixtures a seed)

Dokud persona pipeline nevrací kandidáty, vytvářím je ručně:

- `fixtures/candidates/<slug>.json` obsahuje `{ subjectName, notes, profile: PersonaProfile, candidate: CandidateBrief }`. Připravím 2–3 **fiktivní** kandidáty s různými typy (sebevědomý senior, nervózní junior, kandidát s mezerou v CV). Hodí se zároveň jako „hero“ data pro demo.
- `scripts/seed-candidates.ts` (`npm run seed:candidates -- --user <email>`) dohledá uživatele v Supabase a pro každou fixture vloží:
  - `research_jobs` (`status: 'ready'`, v `notes` značka `[fixture:<slug>]`, takže opakované spuštění kandidáty aktualizuje a neduplikuje)
  - `personas` (`status: 'ready'`, `model: 'fixture'`, `profile`, `candidate`)

  Bez `connector_runs` a `scraped_items`. Schéma to dovoluje a zbytek API (`GET /api/personas/:id`, interviews, chat) pak funguje stejně jako u reálné persony.
- Seed validuje fixtures přes `PersonaProfile` a `CandidateBrief`. `npm run seed:candidates -- --check` je jen zkontroluje a do databáze nesahá.
- `DELETE /api/research/:id` smaže seed i s agentem, takže úklid funguje bez další práce.

**Napojení na reálná data (pozdější krok):** HR zadá cílovou pozici a job description. Po vygenerování persony pak proběhne další OpenAI krok v background mode, který z persony a scrapovaných dat vyplní `personas.candidate` (fakta jen z dat, doplněné věci zapsat do `invented`). Od toho okamžiku vytváří kandidáty scraping a fixtures zůstanou jen pro demo a testy.

---

## 7. Frontend (samostatná Next.js app)

| Route | Obsah |
|---|---|
| `/candidates/[personaId]` | profil (`GET /api/personas/:id`): summary, zkušenosti, projekty, styl komunikace. Výběr obtížnosti a hlasu, tlačítko **Start practice interview** |
| `/interview/[interviewId]` | hovor: avatar s animací, kdo mluví, živý přepis, mood meter, časomíra, **End interview** |
| `/interviews/[id]/feedback` | `overall_feeling` jako citát nahoře, skóre, timeline pocitů nad přepisem, highlights/lowlights s citacemi, ⚠️ nevhodné otázky, „What you didn't find out“, tipy, Glassdoor-style review, ▶️ přehrát feedback hlasem kandidáta (`POST /api/voice/tts` s `persona.voice_id`) |

```tsx
// uvnitř <ConversationProvider> (@elevenlabs/react v1)
const conversation = useConversation({
  onMessage: ({ message, source }) => appendTranscript(source, message),
  onDisconnect: () => router.push(`/interviews/${interview.id}/feedback`),
  clientTools: {
    reportFeeling: async (e: { feeling: string; intensity: number; reason: string }) => {
      queueFeeling({ t: elapsedSecs(), ...e }); // flush na POST /api/interviews/:id/feelings
      return "ok";
    },
  },
});

const { interview, session } = await api.post(`/api/personas/${personaId}/interviews`, { difficulty });
await conversation.startSession(session); // { conversationToken, dynamicVariables }
```

Feedback stránka polluje `GET /api/interviews/:id` každé ~3 s, dokud `feedback_status` není `ready` nebo `failed`. Polling zároveň posouvá generování.

> Přesný tvar `onMessage` payloadu a options ověřit proti nainstalované verzi `@elevenlabs/react`.

---

## 8. Implementační plán

Všechny kroky 1–7 jdou udělat **bez scrapingu**. Na data stack se čeká až v kroku 8.

| # | Krok | Výstup | Odhad |
|---|---|---|---|
| 1 | ~~Umístění kandidátské vrstvy~~ → samostatný sloupec `personas.candidate` | ✅ | |
| 2 | ✅ `CandidateBrief`, 3 fixtures a seed skript | kandidáti v DB bez scrapingu | 1.5 h |
| 3 | ✅ HR-mode prompt v `agentSystemPrompt`, `difficulty` (migrace, schéma, `dynamicVariables`), úprava `agentConfig` | **hovor s kandidátem funguje** (otestovat přes `/docs` a ElevenLabs dashboard) | 1–1.5 h |
| 4 | Frontend `/candidates/[id]` + `/interview/[id]` s živým přepisem | **první demovatelný milník** | 1.5 h |
| 5 | ✅ `feedback.ts` + migrace + napojení na `syncInterview` a webhook + validace citací | feedback v DB | 1.5–2 h |
| 6 | Frontend `/interviews/[id]/feedback` | **druhý milník: celý loop** | 1–1.5 h |
| 7 | Stretch: `reportFeeling` + `/feelings` + mood meter + timeline; namluvený feedback přes TTS; `voices.ts` | wow efekt | 1.5 h |
| 8 | Napojení na scraping: cílová pozice od HR + OpenAI krok, který vyplní `personas.candidate` | reální kandidáti | 1 h |
| 9 | Demo: hero kandidát z fixtures (spolehlivý) + jeden reálný ze scrapingu, nacvičený scénář | demo | 1 h |

Po každém kroku: `npm run typecheck && npm run lint && npm run build` a aktualizace `api-catalog.ts`.

---

## 9. Rizika

| Riziko | Mitigace |
|---|---|
| Latence hovoru | rychlý `ELEVENLABS_AGENT_LLM`, turbo TTS, prompt do ~900 slov, WebRTC |
| Agent vypadne z role kandidáta | tvrdé instrukce v HR bloku, otestovat obtížnost `tough` |
| Chybějící `{{difficulty}}` shodí hovor | backend ho vrací vždy v `session.dynamicVariables` |
| Netlify 60 s | feedback přes OpenAI background mode + polling, stejně jako persona |
| Halucinace ve feedbacku | citace se ověřují proti přepisu, talk ratio počítá server |
| Konflikt se společným `persona.ts` | vyřešeno samostatným sloupcem `personas.candidate` |
| Webhook lokálně nedorazí | `GET /api/interviews/:id` posune hovor i feedback sám |
| GDPR a etika | jen veřejná data, žádné citlivé kategorie, fixtures jsou fiktivní lidé, stock hlasy bez klonování. Feedback zároveň učí HR **neklást** diskriminační otázky (silný argument do pitche) |

---

## 10. Otevřené otázky

2. Frontend: kde je repo a kdo dělá které stránky? Počítám s tím, že `/interview` a `/feedback` jsou moje.
3. Má HR zadávat `jobDescription` už při startu research jobu, nebo až před pohovorem?
4. Má mít jeden kandidát (persona) víc pohovorů s různou obtížností a mezi nimi srovnání zlepšení? Data na to schéma už má.
