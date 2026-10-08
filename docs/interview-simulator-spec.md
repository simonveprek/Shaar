# Interview Simulator: specifikace a implementační plán

> Část projektu **projstalker**: z nascrapovaných dat vytvoří profil kandidáta, z profilu udělá hlasovou AI personu (ElevenLabs Agents) a HR si s ní nanečisto vyzkouší pohovor. Po pohovoru dá „kandidát“ zpětnou vazbu, jak se u pohovoru cítil.

| | |
|---|---|
| **Stack** | Node.js (backend), Next.js (frontend), Apify (scraping), ElevenLabs Agents Platform (hlas), OpenAI API (profil, persona, feedback) |
| **Jazyk pohovoru** | angličtina |
| **Režim** | HR (člověk) ↔ AI simulace kandidáta |
| **Výstup po pohovoru** | zpětná vazba kandidáta: jak se cítil, co bylo dobré, co nepříjemné a co by HR mělo dělat jinak |

---

## 1. Cíl a hodnota pro demo

1. HR otevře profil kandidáta, který vznikl ze scrapingu (LinkedIn, GitHub, Instagram, …).
2. Klikne na **„Start practice interview“** a mluví s hlasovou AI, která se chová jako ten konkrétní kandidát: zná svoji kariéru, projekty a koníčky, má vlastní motivace a obavy a nevyklopí všechno hned.
3. Během hovoru vidí HR živý přepis a **„měřák pocitů“** kandidáta (stretch, ale na demu působí velmi dobře).
4. Po skončení dostane HR **candidate experience feedback** napsaný v první osobě („Felt rushed when you asked about…“), skóre, citace konkrétních momentů a seznam věcí, které **nezjistil**, i když je mohl.

Pointa pro porotu: *„Trénuj pohovor na digitálním dvojčeti skutečného kandidáta, dřív než s ním budeš mluvit doopravdy.“*

---

## 2. Architektura

```
┌───────────────┐   raw data    ┌──────────────────────┐
│ Scraper (tým) │──────────────▶│ POST /candidates     │
│ Apify actors  │               │ (Node backend)       │
└───────────────┘               └──────────┬───────────┘
                                           │ OpenAI (structured output)
                                           ▼
                                ┌──────────────────────┐
                                │ CandidateProfile     │  ← co o kandidátovi víme (fakta + zdroje)
                                └──────────┬───────────┘
                                           │ OpenAI
                                           ▼
                                ┌──────────────────────┐
                                │ CandidatePersona     │  ← jak mluví a co cítí + skryté info
                                └──────────┬───────────┘
                                           │
     ┌─────────────────────────────────────┼───────────────────────────────┐
     │ Next.js                             │                               │
     │  /candidates/[id]  ──POST /sessions─┘                               │
     │                     ◀── { signedUrl, dynamicVariables, voiceId }    │
     │                                                                     │
     │  @elevenlabs/react useConversation ◀═══ WebRTC/WS ═══▶ ElevenLabs   │
     │   - živý přepis (onMessage)                         Agent (LLM=OpenAI)
     │   - client tool reportFeeling → „mood meter“                        │
     │                                                                     │
     │  konec hovoru ──POST /sessions/:id/finish──▶ backend                │
     └─────────────────────────────────────────────────────────────────────┘
                                           │ GET /v1/convai/conversations/{id}
                                           ▼
                                ┌──────────────────────┐
                                │ Transcript           │
                                └──────────┬───────────┘
                                           │ OpenAI (persona + transcript)
                                           ▼
                                ┌──────────────────────┐
                                │ CandidateFeedback    │ → /sessions/[id]/feedback
                                └──────────────────────┘   (volitelně přečteno hlasem kandidáta, ElevenLabs TTS)
```

**Klíčová rozhodnutí**

- **Jeden základní agent v ElevenLabs** (vytvoří se jednou skriptem). Persona se do něj vkládá při každém spuštění přes **dynamic variables**. Hlas se mění per kandidát přes **override `tts.voiceId`**. Nevytváříme tedy agenta pro každého kandidáta, což je rychlejší a nic se nemusí uklízet.
- **API klíč ElevenLabs nikdy na frontendu.** Backend vydá **signed URL** (`GET /v1/convai/conversation/get-signed-url?agent_id=…`, platí 15 minut) a frontend s ní spustí session.
- **LLM uvnitř agenta je OpenAI.** Buď vybereme OpenAI model ze seznamu LLM v nastavení agenta (nejjednodušší), nebo použijeme *Custom LLM* s vlastním OpenAI klíčem. Profil, personu i feedback generuje backend přímo přes OpenAI API.
- **Agent mluví až jako druhý.** Na pohovoru začíná HR, proto má agent prázdný `first_message` a čeká, až HR promluví.

---

## 3. Datový kontrakt se scraper týmem

Tohle si musíme odsouhlasit jako první, aby obě části mohly běžet paralelně. Scraper pošle syrová data, normalizaci a interpretaci dělá moje část.

```ts
// POST /candidates  (body)
type ScrapedCandidateInput = {
  fullName: string;
  targetRole?: string;              // na jakou pozici se hlásí (zadá HR)
  jobDescription?: string;          // volitelně text inzerátu
  sources: {
    linkedin?: unknown;             // raw dataset item z Apify actoru
    github?: unknown;               // profil + repos (+ README top repozitářů)
    instagram?: unknown;            // bio + posledních N postů (caption, datum)
    other?: { url: string; text: string }[];
  };
};
```

Na co se scraper tým zeptat:
- Které Apify actory přesně (kvůli tvaru JSON). Na začátek stačí **jeden ukázkový JSON od každého zdroje**, nad ním postavím parser a prompty.
- Volá backend Apify sám (`apify-client`), nebo dostanu hotová data? **Návrh:** scraping řeší jejich modul, já dostanu výsledek přes `POST /candidates` nebo přes sdílenou funkci.

---

## 4. Datové modely

### 4.1 CandidateProfile (fakta, generuje OpenAI ze scrapingu)

```ts
type CandidateProfile = {
  id: string;
  fullName: string;
  headline: string;                     // "Senior Frontend Engineer @ X"
  location?: string;
  summary: string;                      // 3–5 vět
  experience: { company: string; title: string; from?: string; to?: string; highlights: string[] }[];
  education: { school: string; degree?: string; year?: string }[];
  skills: { name: string; evidence: string; source: "linkedin" | "github" | "instagram" | "other" }[];
  projects: { name: string; description: string; tech: string[]; url?: string }[];   // hlavně GitHub
  interests: string[];                  // hlavně Instagram
  communicationStyle: string;           // odvozeno z textů: formální / ležérní / technický …
  notableFacts: { fact: string; source: string }[];
  gapsAndQuestions: string[];           // mezery v CV, krátké úvazky, nejasnosti → témata k pohovoru
  confidence: "low" | "medium" | "high";
};
```

> Každé tvrzení musí mít **zdroj**. Halucinace v profilu jsou největší riziko celého projektu, proto prompt explicitně říká: „pokud to v datech není, nevymýšlej“.

### 4.2 CandidatePersona (pro simulaci)

Profil = co víme. Persona = **jak se kandidát chová**, plus doplněné věci, které ze scrapingu vědět nemůžeme. Všechno doplněné je označené jako `invented`.

```ts
type CandidatePersona = {
  candidateId: string;
  displayName: string;
  voice: { gender: "male" | "female" | "neutral"; ageRange: string; accent?: string; voiceId: string };
  speakingStyle: string;          // "short answers, nervous at start, warms up when talking about Rust"
  personality: { openness: 1|2|3|4|5; confidence: 1|2|3|4|5; talkativeness: 1|2|3|4|5 };
  motivations: string[];          // proč hledá práci
  concerns: string[];             // čeho se bojí (remote policy, overtime, tech debt…)
  dealBreakers: string[];
  salaryExpectation: string;      // invented, pokud není známo
  hiddenFacts: { fact: string; revealWhen: string }[];   // co prozradí jen při dobré otázce / dobrém rapportu
  sensitiveTopics: string[];      // kde se cítí nekomfortně
  invented: string[];             // seznam polí/tvrzení, která nejsou ze scrapingu
  difficulty: "friendly" | "realistic" | "tough";
};
```

`hiddenFacts` + `revealWhen` jsou jádro tréninkové hodnoty: dobrý interviewer je z kandidáta dostane, špatný ne. Feedback pak ukáže, co zůstalo neodhaleno.

### 4.3 InterviewSession

```ts
type InterviewSession = {
  id: string;
  candidateId: string;
  elevenConversationId?: string;
  status: "created" | "live" | "finished" | "feedback_ready" | "failed";
  difficulty: CandidatePersona["difficulty"];
  startedAt?: string; endedAt?: string;
  transcript?: { role: "interviewer" | "candidate"; text: string; timeInCallSecs?: number }[];
  feelingTimeline?: { t: number; feeling: string; intensity: number; reason: string }[];
  feedback?: CandidateFeedback;
};
```

### 4.4 CandidateFeedback (hlavní výstup)

```ts
type CandidateFeedback = {
  overallFeeling: string;               // 2–4 věty v 1. osobě: "Honestly, I felt…"
  wouldAcceptOffer: "yes" | "maybe" | "no";
  wouldRecommendCompany: number;        // 0–10 (candidate NPS)
  scores: {                             // 1–5
    rapport: number; clarityOfQuestions: number; respect: number;
    relevanceToMyExperience: number;    // ptal se na moje skutečné projekty?
    companyPitch: number;               // dozvěděl jsem se, proč tam chtít pracovat?
  };
  highlights: { quote: string; why: string }[];      // momenty, které kandidát ocenil (citace z přepisu)
  lowlights: { quote: string; why: string }[];       // momenty, kdy byl nekomfortně / zmatený / odrazený
  inappropriateQuestions: { quote: string; issue: string }[];  // věk, rodina, zdraví, náboženství… (diskriminační riziko)
  unansweredCandidateQuestions: string[];             // na co se kandidát chtěl zeptat a nedostal prostor
  undiscovered: string[];                             // hiddenFacts, které HR nevytáhlo
  talkRatio: { interviewer: number; candidate: number };  // spočítá se deterministicky z přepisu, ne LLM
  tipsForInterviewer: string[];                       // 3–5 konkrétních, akčních tipů
  glassdoorStyleReview: string;                       // "Co bych napsal kamarádům" (vtipné na demo)
};
```

---

## 5. Backend (Node.js)

**Doporučení:** Express nebo Fastify + TypeScript, `openai`, `zod` (validace a structured outputs), úložiště na hackathon klidně SQLite (`better-sqlite3`) nebo JSON soubory. ElevenLabs volat přímo přes REST (`fetch`) nebo `@elevenlabs/elevenlabs-js`.

### 5.1 Endpointy

| Metoda | Cesta | Popis |
|---|---|---|
| `POST` | `/candidates` | Přijme `ScrapedCandidateInput` → vygeneruje `CandidateProfile` → uloží → vrátí `id` |
| `GET` | `/candidates/:id` | Profil + persona (pokud existuje) |
| `POST` | `/candidates/:id/persona` | Body `{ difficulty }` → vygeneruje / přegeneruje `CandidatePersona` vč. výběru hlasu |
| `POST` | `/sessions` | Body `{ candidateId, difficulty }` → vytvoří session, vrátí `{ sessionId, signedUrl, dynamicVariables, overrides }` |
| `POST` | `/sessions/:id/events` | (volitelné) uložení `feelingTimeline` událostí z client toolu |
| `POST` | `/sessions/:id/finish` | Body `{ conversationId }` → stáhne přepis z ElevenLabs → spustí generování feedbacku |
| `GET` | `/sessions/:id` | Stav + přepis + feedback (frontend polluje, dokud není `feedback_ready`) |
| `GET` | `/sessions/:id/feedback/audio` | (stretch) feedback namluvený hlasem kandidáta přes ElevenLabs TTS |

### 5.2 `POST /sessions`: jádro integrace

```ts
// pseudo-kód
const persona = await db.getPersona(candidateId);
const profile = await db.getProfile(candidateId);

const res = await fetch(
  `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${process.env.ELEVENLABS_AGENT_ID}`,
  { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! } }
);
const { signed_url } = await res.json();

return {
  sessionId,
  signedUrl: signed_url,
  dynamicVariables: {
    candidate_name: persona.displayName,
    target_role: profile.targetRole ?? "the open position",
    persona_block: renderPersonaBlock(profile, persona),   // celý popis persony jako text
    difficulty: persona.difficulty,
  },
  overrides: { tts: { voiceId: persona.voice.voiceId } },
};
```

### 5.3 `POST /sessions/:id/finish`

1. `GET https://api.elevenlabs.io/v1/convai/conversations/{conversationId}` (header `xi-api-key`) → `transcript[]` (role `user` = HR, `agent` = kandidát). Přepis bývá dostupný až chvíli po skončení hovoru, proto při prázdné odpovědi nebo stavu `processing` zkusit znovu po 1–2 s, maximálně ~10×.
2. Namapovat roli `user` na `interviewer` a `agent` na `candidate`, deterministicky spočítat `talkRatio`.
3. Zavolat OpenAI s promptem z kapitoly 7.3 (structured output podle `CandidateFeedback` zod schématu).
4. Uložit a nastavit `status = feedback_ready`.

> Alternativa k pollování: **post-call webhook** v ElevenLabs. Na hackathon je ale jednodušší, když frontend po `onDisconnect` zavolá `/finish`, protože odpadá veřejná URL a ngrok.

### 5.4 Env proměnné

```
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
APIFY_TOKEN=            # pokud backend volá Apify
```

---

## 6. ElevenLabs agent: konfigurace

Vytvoří se **jednou** skriptem `scripts/create-agent.ts` (`POST /v1/convai/agents/create`) nebo ručně v dashboardu. ID agenta pak patří do `.env`.

| Nastavení | Hodnota | Proč |
|---|---|---|
| Language | `en` | pohovor v angličtině |
| First message | *prázdné* | začíná HR, agent čeká |
| LLM | OpenAI model ze seznamu (nebo Custom LLM → OpenAI) | požadavek stacku |
| Temperature | ~0.7–0.8 | přirozenější, méně robotické odpovědi |
| TTS model | low-latency / conversational model | latence je pro realistický hovor nejdůležitější |
| Default voice | neutrální; per session se přepíše | |
| Interruptions | **zapnuté** | HR musí jít kandidátovi skočit do řeči |
| Turn timeout | delší (~10 s) | kandidát nesmí po 3 s ticha začít sám od sebe |
| Max duration | ~15 min | ochrana kreditů |
| **Security → Overrides** | povolit jen `tts.voiceId` | per-kandidát hlas; nic jiného klient měnit nesmí |
| Client tool | `reportFeeling` (viz 6.2) | mood meter |

### 6.1 Výběr hlasu

- **MVP:** předpřipravená mapa ~6 hlasů z ElevenLabs Voice Library (muž/žena × mladý/střední/starší), persona builder vybere podle `voice.gender` a `voice.ageRange`.
- **Stretch:** *Voice Design* (text → hlas) z popisu persony, např. „calm male voice, early 30s, slight Czech accent“. Pro demo „wow“ efekt, ale stojí to čas a kredity, proto až nakonec.

### 6.2 Client tool `reportFeeling` (stretch, doporučeno)

Tool definovaný v agentovi jako **client tool**, aby se volal na frontendu a nešel přes server. Nastavit tak, aby **agent nečekal na odpověď**, jinak roste latence.

```json
{
  "name": "reportFeeling",
  "description": "Silently report how you (the candidate) currently feel about the interview. Call it whenever your feeling noticeably changes. Never mention this tool out loud.",
  "parameters": {
    "feeling": "string, one of: nervous, comfortable, engaged, confused, annoyed, excited, defensive, bored",
    "intensity": "number 1-5",
    "reason": "string, short, e.g. 'interviewer asked about my open-source project'"
  }
}
```

Frontend si události uloží do `feelingTimeline`. Při generování feedbacku se pošlou s přepisem, takže feedback je konzistentní s tím, co HR vidělo naživo.

---

## 7. Prompty

### 7.1 Profile builder (OpenAI, structured output → `CandidateProfile`)

```
You are an HR research analyst. You receive raw scraped data about one person
from LinkedIn, GitHub and Instagram. Build a factual candidate profile.

Rules:
- Use ONLY information present in the data. If something is unknown, leave it empty.
- Every skill and notable fact must reference its source.
- Infer communication style only from texts the person wrote themselves (posts, READMEs, bios).
- Ignore information about third parties (friends, family in photos, etc.).
- Do not infer or include protected characteristics (religion, health, ethnicity,
  sexual orientation, political views, family plans), even if present in the data.
- List gaps and unclear points in the career as neutral interview topics.
```

### 7.2 Systémový prompt agenta (s dynamic variables)

```
You are {{candidate_name}}, a real job candidate interviewing for the role of
{{target_role}}. You are on a live voice call with an HR interviewer.
You are NOT an assistant. Never say you are an AI. Never help the interviewer.

# Who you are
{{persona_block}}

# How to behave
- Speak like a real person on a call: short to medium answers (1–4 sentences),
  natural fillers occasionally ("hmm", "well", "to be honest"), no lists, no markdown.
- Answer only what was asked. Do not volunteer your hidden facts. Reveal a hidden
  fact only when its "reveal when" condition is clearly met.
- Your openness depends on how you are treated: warm, specific, relevant questions
  make you open up; generic, rude, or rushed questions make you shorter and more guarded.
- Stay consistent with your profile. If asked about something not in it, give a
  plausible, modest answer and stay consistent with it for the rest of the call.
- You may ask the interviewer your own questions (about the team, remote policy,
  salary range, growth), especially near the end, or if your concerns are not addressed.
- If the interviewer asks an inappropriate question (age, family plans, religion,
  health, nationality…), react like a real person would: hesitate, deflect politely,
  and remember it.
- Difficulty level: {{difficulty}}.
  friendly = cooperative and open; realistic = normal candidate with some hesitations;
  tough = skeptical, has other offers, pushes back on vague answers.
- When your feeling about the interview changes, silently call the reportFeeling tool.
- Wait for the interviewer to start the conversation.
```

`renderPersonaBlock()` vyrenderuje profil a personu jako čitelný text (kariéra, projekty, zájmy, motivace, obavy, `hiddenFacts` s `revealWhen`, mluvní styl). **Pozor na délku:** delší prompt zvyšuje latenci, proto cílit na ~600–900 slov.

### 7.3 Feedback generator (OpenAI, structured output → `CandidateFeedback`)

```
You are {{candidate_name}}. You just finished a job interview. Below is your
persona (including your private motivations, concerns and hidden facts),
the full transcript, and a timeline of how you felt during the call.

Write honest feedback for the interviewer about how YOU felt as the candidate.
- Write in first person, like a real candidate giving a candid debrief.
- Ground every highlight/lowlight in an exact quote from the transcript.
- Be specific and fair: praise what worked, call out what did not.
- List hidden facts the interviewer never uncovered.
- Flag any questions that could be discriminatory or legally risky.
- Tips must be concrete and actionable ("Ask about my Rust CLI project before
  asking about salary"), not generic.
Return JSON matching the schema.
```

`talkRatio` a citace se po vygenerování **ověří proti přepisu**: citace, která v přepisu není, se zahodí. Chrání to proti halucinacím.

---

## 8. Frontend (Next.js, App Router)

### 8.1 Stránky

| Route | Obsah |
|---|---|
| `/candidates/[id]` | Profilová karta: headline, zkušenosti, projekty, skills se zdroji, „gaps & questions“. Výběr obtížnosti + tlačítko **Start practice interview** |
| `/interview/[sessionId]` | Hovor: avatar kandidáta + animace, kdo mluví, živý přepis, mood meter, tlačítko **End interview**, časomíra |
| `/sessions/[id]/feedback` | Výsledky: overall feeling (citát nahoře), skóre (radar nebo bary), timeline pocitů nad přepisem, highlights/lowlights s citacemi, ⚠️ inappropriate questions, „What you didn't find out“, tipy, Glassdoor-style review, ▶️ přehrát feedback hlasem kandidáta |

### 8.2 Hovor: `@elevenlabs/react`

```tsx
"use client";
import { useConversation } from "@elevenlabs/react";

const conversation = useConversation({
  onMessage: ({ message, source }) => appendTranscript(source, message), // source: "user" | "ai"
  onDisconnect: () => finishSession(),
  onError: (e) => setError(String(e)),
  clientTools: {
    reportFeeling: async ({ feeling, intensity, reason }) => {
      pushFeeling({ t: elapsed(), feeling, intensity, reason });
      return "ok";
    },
  },
});

async function start() {
  await navigator.mediaDevices.getUserMedia({ audio: true });
  const s = await api.post("/sessions", { candidateId, difficulty });
  const conversationId = await conversation.startSession({
    signedUrl: s.signedUrl,
    dynamicVariables: s.dynamicVariables,
    overrides: s.overrides,
  });
  setConversationId(conversationId);
}
```

- `conversation.status` a `conversation.isSpeaking` slouží pro UI (pulzující avatar, když kandidát mluví).
- `conversationId` z `startSession` se pošle do `/sessions/:id/finish`.
- `conversation.endSession()` na tlačítko End.

> Tvary přesných callback payloadů (`onMessage`) a options si ověřit proti aktuální verzi SDK při `npm i`. API se mezi verzemi měnilo, vzory výše odpovídají současné dokumentaci.

---

## 9. Implementační plán (pořadí pro hackathon)

| # | Krok | Výstup | Odhad |
|---|---|---|---|
| 0 | Odsouhlasit datový kontrakt se scraper týmem, získat ukázková JSON data | `fixtures/*.json` | 30 min |
| 1 | Založit agenta v ElevenLabs (dashboard), nastavit prompt s `{{…}}`, povolit voice override, otestovat v dashboardu s ručně napsanou personou | agent ID, ověřená kvalita hlasu a latence | 1 h |
| 2 | Backend skeleton: `/sessions` se signed URL + hardcoded persona | funkční end-to-end hovor | 1 h |
| 3 | Next.js stránka `/interview/[id]` s `useConversation`, živým přepisem a End | **první demovatelný milník** | 1–1.5 h |
| 4 | `/sessions/:id/finish` → stažení přepisu → feedback přes OpenAI → stránka feedbacku | **druhý milník: celý loop** | 1.5 h |
| 5 | Profile builder + persona builder z fixtures → `/candidates/[id]` | napojení na scraping | 1.5 h |
| 6 | Napojení na reálný výstup scraperu | celý produkt | 0.5–1 h |
| 7 | Stretch: `reportFeeling` + mood meter + timeline ve feedbacku | wow efekt | 1 h |
| 8 | Stretch: feedback namluvený hlasem kandidáta (TTS), Voice Design | wow efekt | 1 h |
| 9 | Demo příprava: 1–2 „hero“ kandidáti s předgenerovaným profilem (cache), nacvičený scénář | spolehlivé demo | 1 h |

**Závislost na scraperu je až v kroku 5–6.** Do té doby jedu nad fixtures, takže týmy na sebe nečekají.

### Struktura repa (návrh)

```
apps/
  web/                    # Next.js
    app/candidates/[id]/page.tsx
    app/interview/[sessionId]/page.tsx
    app/sessions/[id]/feedback/page.tsx
  api/                    # Node backend
    src/routes/{candidates,sessions}.ts
    src/services/{profileBuilder,personaBuilder,feedback,elevenlabs}.ts
    src/schemas/*.ts      # zod: CandidateProfile, CandidatePersona, CandidateFeedback
    scripts/create-agent.ts
fixtures/                 # ukázková scraped data
docs/
```

---

## 10. Rizika a jak je řešit

| Riziko | Mitigace |
|---|---|
| **Latence hovoru** (nerealistické pauzy) | rychlý OpenAI model v agentovi, kratší persona prompt, low-latency TTS model, WebRTC spojení |
| **Halucinace v profilu nebo personě** | zdroje u každého faktu, pole `invented`, validace citací ve feedbacku |
| **Agent „vypadne z role“** a začne pomáhat jako asistent | tvrdé instrukce v promptu, `tough` obtížnost otestovat; případně pár příkladových odpovědí v promptu |
| Přepis po hovoru ještě není k dispozici | retry s backoffem v `/finish` |
| Kredity ElevenLabs | max duration hovoru, na vývoj krátké testy |
| **Právní a etický rozměr** (GDPR, scraping osobních dat, Instagram) | v pitchi zmínit: jen veřejná data, žádné citlivé kategorie (prompt je explicitně vynechává), mazání dat, souhlas kandidáta v reálném nasazení. Feedback zároveň učí HR **neklást** diskriminační otázky, a to je silný argument pro porotu |
| Demo v hlučném prostředí | sluchátka s mikrofonem, záložní nahrávka demo hovoru |

---

## 11. Otevřené otázky

1. Kdo volá Apify: scraper modul samostatně, nebo můj backend? Jaký přesný tvar dat dostanu?
2. Zadává HR k pohovoru i **job description**? Persona by pak reagovala na konkrétní pozici (doporučuji, je to levné a výrazně to zlepší realističnost).
3. Úložiště: stačí SQLite nebo JSON, nebo tým plánuje sdílenou DB (Supabase apod.)?
4. Monorepo s `apps/web` + `apps/api`, nebo backend jen jako Next.js API routes? Stack říká Node backend zvlášť, takže počítám se samostatnou službou.
5. Chceme ukládat audio nahrávku hovoru pro přehrání ve feedbacku? ElevenLabs ji umí vrátit přes Conversations API.
