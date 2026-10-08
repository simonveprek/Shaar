# Interview simulator: nasazení a napojení

Návod, jak dostat interview simulátor (hlasový pohovor HR ↔ AI kandidát a feedback od kandidáta) z větve `feature/interview-simulator` do reálného projektu a napojit na něj frontend.

Kompletní popis feature je v [interview-simulator.md](interview-simulator.md), původní návrh v [interview-simulator-spec.md](interview-simulator-spec.md) a obecný popis backendu v [be.md](../be.md).

```
Frontend (Next.js, :3000)                Backend API (tohle repo, Netlify)            Externí služby
─────────────────────────                ─────────────────────────────────            ──────────────
MeetCall UI ── POST /personas/:id/interviews ──► agent + token ──────────────────────► ElevenLabs
     │ ◄──────────────── { interview, session } ─┘
     │ startSession(session) ═════════════ WebRTC hlas ═════════════════════════════► ElevenLabs agent
     │ reportFeeling ──► POST /interviews/:id/feelings
     │ konec hovoru                                  ◄── post-call webhook (přepis) ── ElevenLabs
     └─ polling ──► GET /interviews/:id ──► feedback (OpenAI, na pozadí) ────────────► OpenAI
                                                     ▲
                                    lokální Postgres v aplikaci (PGlite, .data/shaar)
```

---

## 1. Nasazení backendu

### 1.1 Kód

Sloučit větev `feature/interview-simulator` do `main` přes PR. Netlify nasadí automaticky. Před sloučením spustit `npm run typecheck && npm run lint && npm run build`.

### 1.2 Databáze (lokální)

Supabase už se nepoužívá. Databáze je PGlite (Postgres ve WebAssembly) přímo v serveru, uložená v `.data/shaar`.
Schéma je v `SCHEMA` v [`src/lib/db.ts`](../src/lib/db.ts) a použije se při startu, takže **není co migrovat**.

- Sloupce simulátoru (`personas.candidate`, v `interviews` `difficulty`, `feelings` a `feedback*`) se přidají přes `add column if not exists`, takže se starší lokální databáze sama doplní.
- `rm -rf .data` začne s prázdnou databází.
- Běží v jednom procesu serveru, takže je to řešení pro localhost, ne pro Netlify.

### 1.3 Proměnné prostředí (Netlify → Site configuration → Environment variables)

| Proměnná | Povinná | Poznámka |
|---|---|---|
| `ELEVENLABS_API_KEY` | ✅ | Oprávnění: **Agents: Write**, **Voices: Read**, **Text to Speech**. Musí začínat na `sk_`, ne ID klíče |
| `ELEVENLABS_DEFAULT_VOICE_ID` | ✅ | Záložní hlas. Kandidáti mají hlas podle persony (`src/lib/voices.ts`) |
| `ELEVENLABS_AGENT_LLM` | – | Default `gpt-6-luna` (ověřeno, ElevenLabs ho nabízí) |
| `ELEVENLABS_WEBHOOK_SECRET` | ✅ v produkci | Secret z post-call webhooku (1.4) |
| `OPENAI_API_KEY` | ✅ | Feedback a persony |
| `OPENAI_FEEDBACK_MODEL` | – | Default = `OPENAI_PERSONA_MODEL` |
| `CORS_ORIGINS` | ✅ | URL frontendu, např. `https://projstalker.netlify.app` (víc hodnot oddělit čárkou) |
| `PUBLIC_API_URL` | ✅ v produkci | URL backendu (Apify webhooky) |
| `APIFY_TOKEN` | – | Jen pro hledání a sběr dat. Interview ho nepotřebuje |
| `APIFY_WEBHOOK_SECRET` | – | Jen s `PUBLIC_API_URL` |

### 1.4 ElevenLabs post-call webhook

1. ElevenLabs → **Agents → Settings → Webhooks** → přidat **post-call webhook** na `https://<backend>/api/webhooks/elevenlabs`.
2. Secret, který ElevenLabs vygeneruje, uložit do `ELEVENLABS_WEBHOOK_SECRET`.

Webhook není nutný, ale zrychlí výsledky. Bez něj si přepis stáhne polling `GET /api/interviews/:id`, takže lokálně to funguje i bez něj.

### 1.5 Kandidáti

Dokud scraping neplní `personas.candidate`, nahrát fiktivní kandidáty. Návštěvníci nemají účty, patří jim to,
co vytvoří pod svou visitor cookie. Proto se kandidáti nahrávají v prohlížeči, ve kterém se bude demovat: se spuštěným
`npm run dev` otevřít

```
http://localhost:4000/api/dev/seed-candidates
```

Odpověď vrátí `personaId` pro každého kandidáta. Tohle ID frontend použije ve všech voláních. Opakované otevření
kandidáty aktualizuje a neduplikuje. `npm run seed:candidates -- --check` jen zkontroluje fixtures.

> Persona **bez** `candidate` se chová jako obecná persona: mluví první, nemá obtížnost ani hlášení pocitů. HR mode se zapne jen u person s kandidátskou vrstvou.

### 1.6 Bezpečnost agentů

Produkční agenti mají v ElevenLabs zapnuté ověření (`enable_auth`). Hovor jde zahájit **jen s tokenem z backendu**, takže samotné `agent_id` nikomu nestačí. Výjimkou jsou testovací agenti ze `npm run try:agent`, kteří jsou záměrně veřejní. Před demem je smazat:

```bash
npm run try:agent -- alex-novak --delete
```

---

## 2. Napojení frontendu

### 2.1 Kde UI je

Frontend (aplikace **Shaar**) je ve **stejném repu** jako API, takže se nic nekopíruje. Hovor je hotová komponenta `src/components/meet/MeetCall.tsx` s logem Shaar (`@/components/logo`). Název produktu se mění v `src/components/meet/brand.ts`. Závislost `@elevenlabs/react@1.16.0` už je v `package.json`.

> Meet UI má rozložení Google Meet, ale je nakreslené v design systému Fragms podle `AGENTS.md`: kit, Tailwind tokeny, tmavý Shaar a `Aura` jako mluvící koule.

Kdyby někdy vznikl oddělený frontend, zkopíruje se `src/components/meet/` a `src/components/logo.tsx`, k tomu sada Fragms podle návodu v `AGENTS.md` (sekce UI), a nainstaluje se `@elevenlabs/react`.

### 2.2 Autentizace

Prohlížeč volá API na stejném originu přes helper `api()` ze `src/lib/client.ts`. Návštěvník se nikde nepřihlašuje. Server mu při prvním spuštění hledání nebo jobu dá náhodné ID v podepsané httpOnly cookie `shaar_visitor` (`src/lib/auth.ts`) a podle něj ho pozná.

```ts
import { api, ApiError } from "@/lib/client";

const { persona } = await api<{ persona: Persona }>(`/api/personas/${personaId}`);
// chyba → throw ApiError(status, message), 5xx s obecnou hláškou pro uživatele
```

Kandidáti nahraní přes `seed:candidates` patří konkrétnímu uživateli. Pro demo s visitor cookie je potřeba nahrát je pod ID návštěvníka, nebo použít Bearer token uživatele, pod kterým se nahrály.

Chyby mají vždy tvar `{ error: string, details?: unknown }` se správným HTTP statusem:

| Status | Význam |
|---|---|
| 401 | neznámý návštěvník nebo neplatný token |
| 404 | záznam neexistuje nebo patří jinému uživateli |
| 409 | špatný stav, např. persona ještě není `ready` |
| 502 | chyba ElevenLabs |

### 2.3 Stránka kandidáta

`GET /api/personas/:personaId` → `{ persona }`

Pro UI se používá:
- `persona.profile.display_name`, `persona.profile.one_line_summary`, `persona.profile.summary`
- `persona.candidate.target_role`, `persona.candidate.career_summary`, `persona.candidate.experience[]`, `persona.candidate.projects[]`
- **Nezobrazovat** `persona.candidate.hidden_facts`. Jsou to skrytá fakta, která má HR během pohovoru zjistit samo, a ukáží se až ve feedbacku.

### 2.4 Hovor: stránka `/interview/[personaId]`

```tsx
"use client";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { MeetCall, type CandidateFeedback, type FeelingEvent } from "@/components/meet/MeetCall";

export function InterviewRoom({ personaId, name, role }: { personaId: string; name: string; role?: string }) {
  const router = useRouter();
  const interviewId = useRef<string | null>(null);

  return (
    <MeetCall
      candidate={{ name, subtitle: role }}
      connect={async (difficulty) => {
        const { interview, session } = await api<{ interview: { id: string }; session: Record<string, unknown> }>(
          `/api/personas/${personaId}/interviews`,
          { method: "POST", body: JSON.stringify({ difficulty }) },
        );
        interviewId.current = interview.id;
        return session; // { conversationToken, dynamicVariables }: předat CELÉ
      }}
      onFeelings={(events: FeelingEvent[]) =>
        api(`/api/interviews/${interviewId.current}/feelings`, {
          method: "POST",
          body: JSON.stringify({ events }),
        })
      }
      // Hodnocení se ukáže přímo v UI po zavěšení (polling viz 2.5):
      loadFeedback={() => waitForFeedback(interviewId.current!).then((i) => i.feedback as CandidateFeedback)}
      // …nebo místo toho přesměrovat na vlastní stránku:
      // onEnded={() => router.push(`/interviews/${interviewId.current}/feedback`)}
    />
  );
}
```

Co komponenta `MeetCall` dělá sama:

| Funkce | Jak |
|---|---|
| Lobby „Ready to join?“ | náhled kamery, mikrofon a kamera, volba obtížnosti, tlačítko Join now |
| Spuštění hovoru | `startSession({ connectionType: "webrtc", ...session })` |
| **`reportFeeling`** | zaregistrovaný přes `useConversationClientTool`. Bez něj by SDK hovor ukončilo chybou „Client tool … is not defined on client“ |
| Dávkování pocitů | `onFeelings` se volá každých ~10 s a jednou na konci hovoru |
| Živé titulky a přepis | z `onMessage` (`source: "user"` = HR, `"ai"` = kandidát) |
| Indikace mluvení | podle `isSpeaking` a hlasitosti výstupu |
| Ztlumení | `setMuted` |
| Konec hovoru | `endSession()` a callback `onEnded` |
| Hodnocení po hovoru | s `loadFeedback` ukáže „<Jméno> is writing you feedback…“ a pak celé hodnocení (skóre, citace, nevhodné otázky, co HR nezjistilo, tipy, nálada). Bez něj obrazovku „You left the meeting“ |

Kamera HR je jen lokální náhled, nikam se neposílá. Pohovor je hlasový.

Pokud frontend nechce použít `MeetCall`, minimum s `@elevenlabs/react` v1 vypadá takhle:

```tsx
<ConversationProvider>
  <Room />
</ConversationProvider>;

function Room() {
  const convo = useConversation({
    onConnect: ({ conversationId }) => {}, // v1: startSession vrací void, ID přijde tady
    onMessage: ({ message, source }) => {},
    onDisconnect: () => {},
  });
  useConversationClientTool("reportFeeling", (p) => {
    /* uložit a poslat na /feelings */
  });
  // convo.startSession({ connectionType: "webrtc", ...session });
}
```

### 2.5 Feedback: data pro `loadFeedback` nebo vlastní stránku

Hodnocení umí zobrazit přímo `MeetCall` přes `loadFeedback` (2.4). Vlastní stránka je potřeba, jen pokud chcete jiný layout. V obou případech pollovat `GET /api/interviews/:id` každé ~3 s, dokud `feedback_status` není `ready` nebo `failed`. Polling zároveň **posouvá** zpracování: stáhne přepis z ElevenLabs a spustí a vyzvedne feedback z OpenAI.

```ts
async function waitForFeedback(id: string) {
  for (;;) {
    const { interview } = await api<{ interview: Interview }>(`/api/interviews/${id}`);
    if (interview.feedback_status === "ready") return interview;
    if (interview.feedback_status === "failed") throw new Error(interview.feedback_error);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
```

Stavy, které má UI ukázat:

| `status` | `feedback_status` | Co zobrazit |
|---|---|---|
| `pending` nebo `active` | `none` | „Zpracováváme hovor…“ |
| `done` | `generating` | „Kandidát píše zpětnou vazbu…“ (typicky 20–60 s) |
| `done` | `ready` | feedback |
| `failed` nebo `done` | `failed` | chyba + tlačítko „Zkusit znovu“, které volá `POST /api/interviews/:id/feedback` |

Tvar `interview.feedback`:

```ts
type Feedback = {
  overall_feeling: string; // 1. osoba, hlavní citát nahoře
  would_accept_offer: "yes" | "maybe" | "no";
  would_recommend_company: number; // 0–10
  scores: { rapport: number; clarity_of_questions: number; respect: number;
            relevance_to_my_experience: number; company_pitch: number }; // 1–5
  highlights: { quote: string; why: string }[];          // citace jsou ověřené proti přepisu
  lowlights: { quote: string; why: string }[];
  inappropriate_questions: { quote: string; issue: string }[]; // zvýraznit ⚠️
  unanswered_candidate_questions: string[];
  undiscovered: string[];          // „Co jste nezjistili“
  tips_for_interviewer: string[];
  glassdoor_style_review: string;
  talk_ratio: { interviewer: number; candidate: number }; // % slov, počítá server
  words: { interviewer: number; candidate: number };
  dropped_quotes: number;          // kolik vymyšlených citací server zahodil
};
```

K tomu jsou k dispozici:
- `interview.transcript`: pole `[{ role: "user" | "agent", message, time_in_call_secs }]`, kde `user` je HR
- `interview.feelings`: pole `[{ t, feeling, intensity, reason }]`, hodí se na časovou osu nálady nad přepisem
- `interview.duration_secs` a `interview.difficulty`

**Feedback namluvený hlasem kandidáta (volitelné):**

```ts
// TTS vrací audio, ne JSON, takže tady fetch místo api():
const audio = await fetch("/api/voice/tts", {
  method: "POST",
  credentials: "same-origin",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: feedback.overall_feeling, voiceId: persona.voice_id }),
});
new Audio(URL.createObjectURL(await audio.blob())).play();
```

### 2.6 Historie pohovorů

`GET /api/personas/:id/interviews` vrátí seznam pohovorů s danou personou. Hodí se na srovnání zlepšení napříč obtížnostmi.

Výsledky se získávají pollingem. Lokálně ho nic nenahradí, protože webhooky se na localhost nedostanou.

---

## 3. Lokální vývoj a testování

| Co | Jak |
|---|---|
| Backend | `npm run dev`, běží na http://localhost:4000, dokumentace API na `/docs` |
| Rychlý test hlasu **bez databáze a OpenAI** | `npm run try:agent -- alex-novak --feelings` a pak otevřít `http://localhost:4000/meet?agent=<agent_id>&name=Alex%20Novak&role=Senior%20Frontend%20Engineer` |
| Přepis posledního testovacího hovoru | `npm run try:agent -- alex-novak --transcript` |
| Náhled obrazovek bez hovoru | k URL `/meet` přidat `&ui=call` nebo `&ui=left` |
| Test na stránce ElevenLabs | `npm run try:agent -- alex-novak` (bez `--feelings`, ta stránka client tool neumí) |
| Kontrola fixtures | `npm run seed:candidates -- --check` |

`/meet` v tomhle repu je jen testovací stránka. V produkci se UI používá ve frontendu přes `connect` s backendovým `session`.

---

## 4. Řešení problémů

| Příznak | Příčina | Řešení |
|---|---|---|
| „Client tool with name reportFeeling is not defined on client“ | klient neobsluhuje `reportFeeling` | použít `MeetCall` nebo zaregistrovat `useConversationClientTool("reportFeeling", …)` |
| Hovor se nespojí, žádná úvodní věta | mikrofon zablokovaný v prohlížeči | povolit mikrofon (ikona zámku v adresním řádku). Na produkci je nutné HTTPS |
| 409 „Persona is not ready yet“ | persona se ještě generuje | počkat na `status: ready` |
| ElevenLabs 401 `missing_permissions` | klíč nemá oprávnění | doplnit Agents Write, Voices Read, TTS |
| ElevenLabs 401 `api_key_id_used_as_api_key` | v env je ID klíče, ne klíč | vložit hodnotu `sk_…` |
| `feedback_status` zůstává `none` | hovor ještě není `done` (přepis se zpracovává) | pollovat dál. Na produkci pomůže webhook |
| `feedback_status: failed`, „The interviewer never spoke“ | hovor bez slov HR | normální stav, žádný feedback nevznikne |
| 500 „column … does not exist“ | chybí migrace | spustit migraci (1.2) |
| Agent nečeká na HR a mluví do ticha | krátký `turn_timeout` | v `agentConfig` je 10 s, případně zvýšit |
| CORS chyba ve frontendu | origin chybí v `CORS_ORIGINS` | doplnit URL frontendu |

---

## 5. Checklist před demem

- [ ] Migrace spuštěná, kód nasazený, env vyplněné (1.2, 1.3)
- [ ] Post-call webhook nastavený (1.4)
- [ ] Kandidáti nahraní pod demo účet (1.5)
- [ ] Kandidáti nahraní pod uživatele, se kterým se demuje (visitor nebo Bearer, viz 2.2)
- [ ] Testovací agenti ze `try:agent` smazaní, API klíče zrotované (ten z chatu!)
- [ ] Zkušební hovor na produkční URL přes HTTPS: lobby → hovor → feedback do 1 minuty
- [ ] Sluchátka s mikrofonem, ať kandidát neslyší sám sebe
