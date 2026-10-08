# Interview simulator

> HR si nanečisto vyzkouší pohovor s **digitálním dvojčetem skutečného kandidáta**. Hlasová AI hraje kandidáta podle dat ze sociálních sítí a po hovoru dá HR zpětnou vazbu **z pohledu kandidáta**: jak se cítil, co bylo dobré, co nepříjemné a co HR nezjistilo.

Tento dokument popisuje celou feature: jak funguje, z čeho se skládá a jak ji testovat a rozvíjet.

| Dokument | Kdy ho číst |
|---|---|
| **tento soubor** | přehled a referenční popis feature |
| [interview-integration.md](interview-integration.md) | nasazení a napojení frontendu krok za krokem |
| [interview-simulator-agent-guide.md](interview-simulator-agent-guide.md) | **pro AI agenty** (anglicky): jak feature implementovat i v jiném projektu nebo stacku, kontrakty, prompty, ověřené pasti |
| [interview-simulator-spec.md](interview-simulator-spec.md) | původní návrh, rozhodnutí a stav implementace |
| [be.md](../be.md) | obecná pravidla backendu (Netlify 60 s, claimy, RLS) |

---

## Obsah

1. [Co feature dělá](#1-co-feature-dělá)
2. [Průchod pro HR](#2-průchod-pro-hr)
3. [Architektura](#3-architektura)
4. [Kandidát: data, pohlaví a hlas](#4-kandidát-data-pohlaví-a-hlas)
5. [Hlasový agent](#5-hlasový-agent)
6. [Hodnocení od kandidáta](#6-hodnocení-od-kandidáta)
7. [Call UI](#7-call-ui)
8. [API](#8-api)
9. [Datový model](#9-datový-model)
10. [Testování](#10-testování)
11. [Bezpečnost, soukromí a etika](#11-bezpečnost-soukromí-a-etika)
12. [Omezení a další kroky](#12-omezení-a-další-kroky)
13. [Mapa souborů](#13-mapa-souborů)

---

## 1. Co feature dělá

| Krok | Co se děje | Technologie |
|---|---|---|
| Scraping | Veřejné profily kandidáta (LinkedIn, GitHub, Instagram, …) | Apify |
| Persona | Kdo kandidát je, jak mluví, co ho zajímá, **jakého je pohlaví a věku** (podle toho se vybere hlas) | OpenAI |
| Kandidátská vrstva | Na jakou pozici se hlásí, motivace, obavy, plat, **skrytá fakta** | fixtures, později OpenAI |
| Pohovor | HR mluví s hlasovým agentem v UI ve stylu Google Meet | ElevenLabs Agents, WebRTC |
| Nálada | Agent během hovoru tiše hlásí, jak se cítí. HR to vidí živě | ElevenLabs client tool |
| Hodnocení | Po hovoru kandidát napíše zpětnou vazbu se skóre a citacemi | OpenAI (na pozadí) |

**Proč to dává smysl:** HR si nacvičí pohovor dřív, než mluví se skutečným člověkem. Zjistí, jestli pokládá dobré otázky a jestli z kandidáta dostane podstatné informace. Feedback zároveň upozorní na **diskriminační otázky** (věk, rodina, zdraví…), takže nástroj učí i férový nábor.

---

## 2. Průchod pro HR

```
Profil kandidáta ─► Lobby „Ready to join?“ ─► Hovor ─► Zavěšení ─► Hodnocení od kandidáta
                    (obtížnost, mikrofon,      (titulky,             („Alex is writing you
                     kamera)                    přepis, nálada)        feedback…“ → výsledky)
```

1. **Profil:** HR vidí, co o kandidátovi víme: shrnutí, kariéru a projekty. Skrytá fakta nevidí, ta má zjistit sám.
2. **Lobby:** náhled kamery, přepínač mikrofonu a kamery a volba obtížnosti:
   - `friendly`: kandidát spolupracuje a mluví otevřeně
   - `realistic`: běžný kandidát s občasným zaváháním
   - `tough`: skeptický kandidát s jinými nabídkami, který tlačí na konkrétní odpovědi
3. **Hovor:** kandidát se ozve „Hi, hello? Can you hear me okay?“ a dál vede pohovor HR, v angličtině. HR může:
   - zapnout živé titulky (CC)
   - otevřít panel **Transcript** (celý přepis) a **People**
   - otevřít panel **Candidate mood**, kde vidí, jak se kandidát právě cítí a proč
4. **Zavěšení** ukončí hovor a zobrazí obrazovku s hodnocením. Feedback se generuje 20–60 s.
5. **Hodnocení:** citát „jak jsem se cítil“, jestli by kandidát přijal nabídku, skóre, poměr mluvení, co fungovalo a co ne, ⚠️ nevhodné otázky, **co HR nezjistilo**, na co se kandidát nestihl zeptat, tipy na příště, časová osa nálady a „recenze jako na Glassdooru“.

---

## 3. Architektura

```
┌──────────────── Frontend (Next.js) ────────────────┐
│  MeetCall UI (src/components/meet)                 │
│   lobby → hovor → hodnocení                        │
└──┬──────────────┬──────────────┬───────────────┬───┘
   │ POST         │ WebRTC hlas  │ POST          │ GET (polling)
   │ /personas/   │              │ /interviews/  │ /interviews/:id
   │ :id/interviews│             │ :id/feelings  │
┌──▼──────────────┼──────────────▼───────────────▼───┐        ┌─────────────┐
│ Backend API (Next.js API routes, Netlify)          │◄───────┤ ElevenLabs  │
│  ensureAgent → token        feedback (background)  │webhook │  Agents     │
└──┬──────────────┼───────────────────────┬──────────┘        └──────▲──────┘
   │              └───────────────────────┼──────────────────────────┘
   │ lokální Postgres (personas, interviews)      │ OpenAI Responses API (background mode)
```

### Klíčová pravidla

- **Žádný request nečeká na pomalou práci** (Netlify končí po 60 s). Generování feedbacku běží v OpenAI **background mode**. Posouvá ho polling `GET /api/interviews/:id` a ElevenLabs webhook.
- **Každý přechod stavu je idempotentní** přes podmíněný update („claim“):
  `update … set feedback_status='generating' where id=? and status='done' and feedback_status='none'`. Zpracování spustí jen ten, kdo claim vyhraje, takže webhook a polling ho nespustí dvakrát.
- **Systémový prompt agenta zůstává na serveru.** Prohlížeč dostane jen token pro hovor.
- **Každá služba kontroluje jen svoje proměnné** (`envVar()` v `src/lib/env.ts`). Hlasový test proto funguje i jen s ElevenLabs klíčem.

### Životní cyklus pohovoru

```
POST /api/personas/:id/interviews {difficulty}
  └ ensureAgent: vytvoří nebo aktualizuje agenta persony (u kandidátů vždy, aby sedělo zadání)
  └ conversation token (WebRTC) → interviews řádek (pending)
  └ { interview, session: { conversationToken, dynamicVariables: { difficulty } } }

prohlížeč: startSession(session) ══ hovor ══
  reportFeeling → POST /api/interviews/:id/feelings (dávky po ~10 s)

konec hovoru:
  ElevenLabs post-call webhook ─┐
  GET /api/interviews/:id ──────┴► přepis uložen, status=done
                                   └► claim feedback_status none→generating → OpenAI (background)
  GET /api/interviews/:id ─► poll OpenAI → validace → feedback_status=ready | failed
```

---

## 4. Kandidát: data, pohlaví a hlas

Kandidát se skládá ze dvou částí v tabulce `personas`:

| Část | Sloupec | Kdo ji vytváří | Obsah |
|---|---|---|---|
| **Persona** | `profile` (`PersonaProfile`) | OpenAI ze scrapingu (`src/lib/persona.ts`) | kdo to je, styl komunikace, názory s důkazy, zájmy, **hlas (pohlaví, věk, přízvuk)** |
| **Kandidátská vrstva** | `candidate` (`CandidateBrief`) | zatím fixtures, později OpenAI | pozice, inzerát, kariéra, projekty, motivace, obavy, deal breakery, plat, **skrytá fakta**, otázky na HR, seznam vymyšlených údajů |

Kandidátská vrstva je samostatný sloupec, aby se nemusel měnit společný prompt pro tvorbu persony. Persona bez `candidate` se chová jako obecná persona: mluví první, nemá obtížnost ani hlášení nálady.

### Pohlaví a výběr hlasu

Pohlaví **určuje OpenAI** při tvorbě persony. Výsledek je v poli `profile.voice.gender_presentation` (`male` / `female` / `neutral` / `unknown`). Model ho odvozuje ze jména, fotek, bia a toho, jak o člověku mluví ostatní. Pokud data nedávají žádný signál, má vrátit `neutral` nebo `unknown`.

Výběr hlasu (`src/lib/voices.ts`) je rozdělený striktně na mužské a ženské hlasy:

| `gender_presentation` | `age_sound` → hlas |
|---|---|
| `male` | `young` → Will · `middle_aged` → Chris · `old` → Bill |
| `female` | `young` → Jessica · `middle_aged` → Bella · `old` → Alice |
| `neutral` / `unknown` | `ELEVENLABS_DEFAULT_VOICE_ID` |

- `age_sound: unknown` se počítá jako `middle_aged`.
- Pořadí priority: **`voiceId` z frontendu** → hlas, který persona už má (`personas.voice_id`) → výběr podle pohlaví a věku → výchozí hlas.
- Všechny hlasy jsou předpřipravené hlasy ElevenLabs, dostupné v každém účtu. **Hlas skutečného člověka se neklonuje.**

### Skrytá fakta

`candidate.hidden_facts` mají podobu `{ fact, reveal_when }`. Agent fakt prozradí, **jen když HR splní podmínku**: zeptá se správně nebo si vybuduje důvěru. Tím vzniká tréninková hodnota. Feedback pak v sekci „What you didn't find out“ ukáže, co zůstalo nezjištěno.

V testu se to potvrdilo: Alex prozradil konkurenční nabídku až na otázku na svůj časový plán. O vyhoření se nikdo nezeptal, a tak ho neprozradil.

---

## 5. Hlasový agent

Pro každou personu existuje jeden agent v ElevenLabs (`personas.elevenlabs_agent_id`). Konfiguraci staví `agentConfig` v `src/lib/elevenlabs.ts`.

| Nastavení | Kandidát | Obecná persona |
|---|---|---|
| První věta | „Hi, hello? Can you hear me okay?“ | `profile.interview_first_message` |
| Jazyk | `en` | `en` |
| LLM | `ELEVENLABS_AGENT_LLM` (default `gpt-6-luna`) | stejné |
| Prompt | persona + **HR-mode blok** s `{{difficulty}}` | persona |
| Client tool `reportFeeling` | ano (`expects_response: false`) | ne |
| Turn timeout | 10 s (HR má čas přemýšlet) | výchozí |
| Max délka | 900 s | výchozí |
| Ověření | `enable_auth: true` (jen s tokenem z backendu) | stejné |

### Prompt

Prompt se skládá z `roleplay_instructions` persony, HR-mode bloku (`candidatePromptBlock` v `src/lib/candidate.ts`) a popisu persony. HR-mode blok:

- **role:** „Jsi kandidát, ne asistent. Nikdy nepomáhej interviewerovi.“
- **kariéra a projekty**, o kterých smí mluvit
- **soukromá situace** (motivace, obavy, plat, skrytá fakta s podmínkou), kterou nesmí přečíst jako seznam
- **chování:**
  - odpovídá 1–4 větami a mluví jako člověk na hovoru
  - neprozrazuje víc, než se ho HR ptá
  - otevře se, když HR klade vřelé a konkrétní otázky, a stáhne se, když jsou obecné nebo hrubé
  - na nevhodné otázky (věk, rodina, zdraví, náboženství…) reaguje jako skutečný kandidát: zaváhá a zdvořile se vyhne odpovědi
  - na konci se ptá na vlastní otázky
- **obtížnost** `{{difficulty}}`
- **`reportFeeling`:** tiše ho volá vždy, když se změní jeho pocit, a nikdy o něm nemluví

Prompt má kolem 830 slov. Delší prompt zvyšuje latenci hovoru.

### Dynamická proměnná `difficulty`

Prompt obsahuje `{{difficulty}}`, takže ji musí dostat **každý** `startSession`. Backend ji vrací v `session.dynamicVariables`. Agent má navíc výchozí hodnotu `realistic` (`dynamic_variable_placeholders`), pokud by chyběla.

### Client tool `reportFeeling`

Parametry nástroje:
- `feeling`: `nervous | comfortable | engaged | confused | annoyed | excited | defensive | bored`
- `intensity`: 1–5
- `reason`

Agent na odpověď nečeká, takže hovor nezdržuje. **Klient ho musí obsloužit**, jinak SDK hovor ukončí s chybou „Client tool … is not defined on client“. `MeetCall` ho registruje sám.

### Synchronizace a úklid

- **Agenti kandidátů se při každém startu pohovoru aktualizují**, aby změny v zadání nebo promptu hned platily.
- Aktualizace se stejným nástrojem nevytváří duplikáty. Vypnutí a zapnutí nástroje ale v ElevenLabs vytvoří nový tool a starý zůstane osiřelý. Testovací skript to umí, v produkci se to neděje.
- `DELETE /api/research/:id` smaže agenta i se všemi daty.

---

## 6. Hodnocení od kandidáta

### Pipeline (`src/lib/feedback.ts`)

1. **Start** (`startFeedback`): po `status=done` claim `feedback_status none→generating`. Pak `startFeedbackResponse()` spustí OpenAI v režimu `background: true` se structured outputem `CandidateFeedback`.
2. **Vstup pro model:**
   - persona a kandidátská vrstva **včetně skrytých faktů**
   - obtížnost
   - přepis s časy (`Interviewer:` / `Me:`)
   - časová osa nálady
3. **Polling** (`advanceFeedback` → `pollFeedbackResponse()`): po dokončení server:
   - **zahodí citace, které v přepisu nejsou** (porovnává normalizovaný text). Počet zahozených uvádí `dropped_quotes`.
   - **spočítá poměr mluvení** z počtu slov. Ten počítá server, ne model.
4. **Výsledek** uloží do `interviews.feedback`, stav je `ready`. Při chybě je stav `failed` s popisem ve `feedback_error`.
5. **Ruční přegenerování:** `POST /api/interviews/:id/feedback`.

### Pravidla pro model

- Píše **v první osobě** jako skutečný kandidát.
- Každý highlight, lowlight a nevhodnou otázku **cituje doslova** z přepisu.
- Je konkrétní a férový: chválí, co fungovalo, a pojmenuje, co ne.
- `undiscovered` obsahuje skrytá fakta, ke kterým se HR nedostal.
- Označí diskriminační a právně riskantní otázky.
- Tipy jsou akční a vázané na tenhle hovor, ne obecné rady.
- Při velmi krátkém hovoru to řekne a skóre drží nízko.

### Výstup

| Pole | Typ | V UI |
|---|---|---|
| `overall_feeling` | text, 1. osoba | hlavní citát |
| `would_accept_offer` | `yes` / `maybe` / `no` | dlaždice (barevně) |
| `would_recommend_company` | 0–10 | dlaždice |
| `scores` | rapport, clarity_of_questions, respect, relevance_to_my_experience, company_pitch (1–5) | proužky |
| `talk_ratio`, `words` | % a počty slov (server) | proužek „Talk time“ |
| `highlights`, `lowlights` | citace + proč | „What worked / What didn't“ |
| `inappropriate_questions` | citace + problém | ⚠️ „Questions to avoid“ |
| `undiscovered` | seznam | „What you didn't find out“ |
| `unanswered_candidate_questions` | seznam | „What Alex wanted to ask“ |
| `tips_for_interviewer` | seznam | „Tips for next time“ |
| `glassdoor_style_review` | text | „If Alex wrote a review“ |
| `dropped_quotes` | číslo | (ladění) |

Stavy `feedback_status`:

| Stav | Význam |
|---|---|
| `none` | čeká na konec hovoru |
| `generating` | OpenAI pracuje |
| `ready` | hotovo |
| `failed` | chyba, viz `feedback_error` |

Pokud HR za celý hovor nepromluvil, stav je `failed` s chybou „The interviewer never spoke“.

---

## 7. Call UI

`src/components/meet/MeetCall.tsx` je hovor 1:1 rozvržený jako Google Meet a nakreslený ve stylu **Shaar** podle pravidel v `AGENTS.md`:
- komponenty z kitu Fragms (`Button`, `IconButton`, `Panel`, `Segmented`, `Avatar`, `Spinner`, `toast`, `Stat`, `Status`) a Tailwind jen s tokeny
- tmavé povrchy (`dark`), písmo Geist, popisky v rozpaleném uppercase
- logo `@/components/logo` a ikony Hugeicons
- **`Aura`** z Fragms jako mluvící koule kolem kandidáta i kolem vlastního náhledu

Žádné vlastní CSS soubory.

### Obrazovky

| Obrazovka | Obsah |
|---|---|
| **Lobby** | hlavička Shaar se štítkem Simulation, náhled kamery s přepínači mikrofonu a kamery, „Practice interview“ a „Ready to join?“, kandidát, obtížnost (`Segmented`), **Join now** |
| **Hovor** | dlaždice kandidáta (iniciály v kruhu se zářící `Aura` podle hlasitosti, „Speaking“), vlastní náhled vpravo dole (také s `Aura`), titulky, spodní lišta (čas a kód, mikrofon, kamera, CC, nálada, zavěšení, People, Transcript), boční panely |
| **Hodnocení** | „<Jméno> is writing you feedback“ a pak výsledky (viz kapitola 6). Při chybě tlačítko Try again. Vždy tlačítko Rejoin |
| **Po odchodu** (bez `loadFeedback`) | „You left the call“, Rejoin, případně odkaz `feedbackHref` |

### Props

| Prop | Typ | Popis |
|---|---|---|
| `candidate` | `{ name, subtitle? }` | jméno a pozice |
| `you` | `string` | jméno HR (avatar) |
| `connect` | `(difficulty) => Promise<HookOptions>` | vrátí `session` z backendu (nebo `{ agentId }` v testu) |
| `onFeelings` | `(events) => void` | dávky `reportFeeling` (~10 s a na konci) |
| `onEnded` | `({ conversationId, durationSecs }) => void` | konec hovoru |
| `loadFeedback` | `(call: EndedCall) => Promise<CandidateFeedback>` | zobrazí hodnocení. Funkce si polling řeší sama |
| `feedbackHref` | `string` | odkaz po odchodu, pokud není `loadFeedback` |
| `defaultDifficulty` | `Difficulty` | výchozí obtížnost v lobby |
| `preview` | `{ phase, lines?, feelings? }` | náhled obrazovky s ukázkovými daty bez připojení |

### Technické poznámky

- **SDK:** `@elevenlabs/react` v1. Používá `ConversationProvider`, `useConversation` (ID konverzace přichází v `onConnect`, `startSession` vrací `void`) a `useConversationClientTool("reportFeeling")`.
- **Kamera** je jen lokální náhled pro HR a nikam se neposílá. Pohovor je čistě hlasový.
- **Mluvení:** `Aura` čte hlasitost (`getOutputVolume` a `getInputVolume`) přes funkci každý snímek, takže nezpůsobuje překreslování Reactu.
- **Ovládání hovoru** je malá komponenta `CallButton`. Každý stav má jednu sadu tříd, aby se nehádaly dvě utility o stejnou vlastnost (`cx` jen spojuje třídy):
  - `idle`
  - `on` (primary pilulka jako stisknutá klávesa)
  - `off` (tón danger, je to stav)
  - `end` (jediná červená akce)
- **Skóre** kreslí neutrální proužek `Bar`, ne `Meter` z `bits.tsx`. `Meter` totiž nad 90 % zčervená, a tady je vysoké skóre dobře.
- **Přístupnost:** tlačítka mají `aria-label` i `title`, přepínače `aria-pressed`, obtížnost je `radiogroup` a fokus je viditelný.
- **Responzivita:** funguje na 375 px. Lobby se skládá pod sebe, panely přecházejí přes celou obrazovku, Transcript je na mobilu v liště a hodnocení je v jednom sloupci.

---

## 8. API

Všechny routy kromě webhooků a `/api/dev/*` vyžadují uživatele. Prohlížeč se prokazuje visitor cookie (volání přes `api()` ze `src/lib/client.ts`). Úplný a vždy aktuální přehled je na `GET /api` a `/docs`.

| Metoda | Cesta | Popis |
|---|---|---|
| `GET` | `/api/personas/:id` | persona včetně `candidate` |
| `POST` | `/api/personas/:id/interviews` | start pohovoru. Body `{ difficulty?, voiceId?, transport? }`, odpověď `{ interview, agentId, session }` |
| `GET` | `/api/personas/:id/interviews` | historie pohovorů |
| `GET` | `/api/interviews/:id` | přepis, nálada a feedback. **Zároveň posouvá zpracování.** Pollovat ~3 s |
| `POST` | `/api/interviews/:id/feelings` | `{ events: [{ t, feeling, intensity, reason }] }` (1–50 na dávku, max 500 celkem) |
| `POST` | `/api/interviews/:id/feedback` | přegenerovat feedback (409, dokud hovor není `done`) |
| `POST` | `/api/webhooks/elevenlabs` | post-call webhook (HMAC). Uloží přepis a spustí feedback |
| `POST` / `GET` | `/api/dev/feedback` | **jen `next dev`:** feedback pro testovací hovor bez databáze (kapitola 10) |
| `POST` | `/api/voice/tts` | text na řeč, např. feedback namluvený hlasem kandidáta |

Chyby mají tvar `{ error, details? }`:

| Status | Význam |
|---|---|
| 400 | validace |
| 401 | autentizace |
| 404 | nenalezeno nebo patří jinému uživateli |
| 409 | špatný stav |
| 502 | chyba ElevenLabs |

---

## 9. Datový model

Schéma: `SCHEMA` v `src/lib/db.ts` (sloupce se přidají samy při startu)

| Tabulka.sloupec | Typ | Popis |
|---|---|---|
| `personas.candidate` | jsonb, nullable | `CandidateBrief` |
| `interviews.difficulty` | text | `friendly` / `realistic` / `tough` |
| `interviews.feelings` | jsonb | `[{ t, feeling, intensity, reason }]` |
| `interviews.feedback_status` | text | `none` → `generating` → `ready` / `failed` |
| `interviews.feedback_response_id` | text | ID OpenAI background response |
| `interviews.feedback` | jsonb | `StoredFeedback` |
| `interviews.feedback_error` | text | důvod selhání |

Platí pravidla z `be.md`:
- RLS dovoluje uživatelům číst jen vlastní řádky.
- Zapisuje jen backend se secret klíčem, takže **každý dotaz musí filtrovat `user_id`**.
- Tabulka `interviews` je v Realtime publikaci.

---

## 10. Testování

Od nejlevnějšího k úplnému:

| Úroveň | Příkaz nebo URL | Potřebuje |
|---|---|---|
| Kontrola fixtures | `npm run seed:candidates -- --check` | nic |
| Typy, lint, build | `npm run typecheck && npm run lint && npm run build` | nic |
| Náhled obrazovek | `/meet?agent=x&name=Alex%20Novak&ui=call` (nebo `ui=left`, `ui=feedback`) | `npm run dev` |
| Textová simulace pohovoru | ElevenLabs `simulate-conversation` (AI v roli HR vede pohovor) | ElevenLabs klíč |
| **Hlasový test v Meet UI** | `npm run try:agent -- alex-novak --feelings` a pak otevřít vypsanou URL | ElevenLabs klíč |
| **+ hodnocení po hovoru** | stejná URL s `&fixture=alex-novak` (skript ji vypíše) | + `OPENAI_API_KEY` |
| Přepis posledního hovoru | `npm run try:agent -- alex-novak --transcript` | ElevenLabs klíč |
| Test na stránce ElevenLabs | `npm run try:agent -- alex-novak` (bez `--feelings`) | ElevenLabs klíč |
| Celý průchod | `npm run dev` → `/api/dev/seed-candidates` v prohlížeči → frontend přes visitor cookie | vše |

### Testovací agent (`scripts/try-agent.ts`)

Skript postaví agenta z fixture **se stejnou konfigurací jako backend**:
- agent je ale veřejný (`publicAccess`), aby šel volat bez tokenu
- `--feelings` zapne `reportFeeling`
- `--difficulty tough` nastaví výchozí obtížnost
- `--transcript` vypíše přepis posledního hovoru
- `--delete` agenta smaže

Agenta najde podle jména, takže opakované spuštění ho aktualizuje a nevytváří nového.

### Testovací feedback (`/api/dev/feedback`)

Endpoint je bezstavový:
1. `POST { conversationId, fixture, difficulty, feelings }` vrací 202 `processing`, dokud ElevenLabs hovor nezpracuje. Pak 202 `{ responseId }`.
2. `GET ?responseId&conversationId` vrací `generating`, `ready` (s `feedback`) nebo `failed`.

V produkčním buildu vrací 404, protože je bez autentizace a spotřebovává kredity.

### Fiktivní kandidáti (`fixtures/candidates/`)

| Fixture | Pozice | Typ | Hlas |
|---|---|---|---|
| `alex-novak` | Senior Frontend Engineer | sebevědomý senior s konkurenční nabídkou | muž, střední věk |
| `tereza-mala` | Junior Data Analyst | nervózní juniorka, která mění obor a přichází o práci | žena, mladá |
| `martin-krejci` | Senior Product Designer | designér s mezerou v CV po neúspěšném startupu | muž, střední věk |

### Ověřeno

- Konfigurace agenta se v ElevenLabs uloží celá: první věta, nástroj, výchozí obtížnost, turn timeout, maximální délka a ověření.
- Textová simulace (16 výměn) potvrdila:
  - agent se drží role kandidáta
  - zdvořile se vyhne otázce na děti a nahlásí pocit `defensive`
  - skrytá fakta prozradí jen při splněné podmínce
  - pocity hlásí průběžně
- Meet UI funguje na desktopu i na mobilu.
- Testovací endpoint validuje vstup a odmítá path traversal.

---

## 11. Bezpečnost, soukromí a etika

- **Jen veřejná data.** Prompt persony zakazuje vymýšlet soukromá fakta. Kandidátská vrstva označuje vymyšlené údaje v `invented`.
- **Žádné citlivé kategorie** (zdraví, náboženství, orientace, politika, rodinné plány) v profilu. Feedback naopak **upozorní, když se na ně HR zeptá**.
- **AI transparentnost:** na upřímný dotaz agent řekne, že je AI simulace. Lobby to uvádí taky.
- **Hlasy:** jen předpřipravené hlasy, žádné klonování skutečného člověka.
- **Agenti chránění tokenem** (`enable_auth`). Samotné `agent_id` nestačí. Veřejní jsou jen testovací agenti, které je potřeba před nasazením smazat.
- **Sekrety jen na serveru.** API klíče nikdy nejdou do prohlížeče a `.env*` je v `.gitignore`.
- **Webhook** se ověřuje přes HMAC (`ElevenLabs-Signature`) s ochranou proti replay (30 min).
- **Mazání:** `DELETE /api/research/:id` smaže data, personu, pohovory i agenta.
- **GDPR (reálné nasazení):** chybí souhlas kandidáta se zpracováním, retenční politika přepisů a určení účelu. Do pitche to patří jako známé omezení.

---

## 12. Omezení a další kroky

| Oblast | Stav | Další krok |
|---|---|---|
| Kandidátská vrstva ze scrapingu | zatím jen fixtures | OpenAI krok po tvorbě persony: cílová pozice od HR, fakta z dat, doplněné údaje do `invented` |
| Frontend | komponenta hotová, stránky ve frontend repu chybí | zapojit podle [interview-integration.md](interview-integration.md) |
| Odhad pohlaví | závisí na kvalitě dat. Při `neutral`/`unknown` se použije výchozí hlas | HR může hlas přepsat (`voiceId`). Případně přidat volbu hlasu do lobby |
| Jazyk | jen angličtina | `language` + vícejazyčný TTS model + jazyk v promptu |
| Latence | závisí na LLM a délce promptu | měřit, případně rychlejší LLM nebo kratší prompt |
| Srovnání pohovorů | data jsou (`GET /personas/:id/interviews`) | graf zlepšení skóre napříč pohovory |
| Testy | ručně + simulace | unit testy `finalize` (validace citací, poměr mluvení), regresní simulace promptu |
| Osiřelé tooly | jen při přepínání `--feelings` v testech | úklid ve skriptu |

---

## 13. Mapa souborů

```
src/lib/
  candidate.ts        CandidateBrief, Difficulty, HR-mode blok promptu, název client toolu
  persona.ts          PersonaProfile (vč. voice.gender_presentation), agentSystemPrompt(profile, candidate)
  voices.ts           výběr hlasu: muž/žena × věk z dat OpenAI
  elevenlabs.ts       agentConfig (tool, dynamic vars, turn timeout, enable_auth), REST klient
  interviews.ts       ensureAgent, startInterview (difficulty, dynamicVariables), feelings
  feedback.ts         CandidateFeedback, start/poll v background mode, validace citací, talk ratio
  env.ts              env() (vše) a envVar(key) (jedna proměnná)
  schemas.ts          StartInterview.difficulty, ReportFeelings, DevFeedback
  api-catalog.ts      dokumentace rout pro GET /api a /docs
src/app/api/
  personas/[id]/interviews/route.ts     start pohovoru
  interviews/[id]/route.ts              přepis + posun feedbacku
  interviews/[id]/feelings/route.ts     nálada
  interviews/[id]/feedback/route.ts     přegenerování
  webhooks/elevenlabs/route.ts          přepis + start feedbacku
  dev/feedback/route.ts                 lokální testovací feedback
src/components/meet/
  MeetCall.tsx        lobby, hovor, hodnocení, po odchodu
  brand.ts            název produktu (logo je @/components/logo)
src/app/meet/         testovací stránka (/meet?agent=…&fixture=…)
fixtures/candidates/  3 fiktivní kandidáti
scripts/
  seed-candidates.ts  kontrola fixtures (nahrání: /api/dev/seed-candidates)
  try-agent.ts        testovací agent v ElevenLabs
src/lib/fixtures.ts  nahrání fixtures do lokální databáze
docs/
  interview-simulator.md        tento dokument
  interview-integration.md      nasazení a napojení
  interview-simulator-spec.md   návrh a stav
```
