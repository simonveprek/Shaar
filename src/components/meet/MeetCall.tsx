"use client";

import {
  ConversationProvider,
  useConversation,
  useConversationClientTool,
  type HookOptions,
} from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Roboto } from "next/font/google";
import { BRAND } from "./brand";
import { ICONS, type IconName } from "./icons";
import styles from "./meet.module.css";

/*
 * 1:1 video-call UI (Google Meet style) for practice interviews with a candidate agent.
 * Framework-agnostic about where the session comes from: `connect` returns options for
 * `startSession` — the backend's `session` from POST /api/personas/:id/interviews, or `{ agentId }` for tests.
 */

const roboto = Roboto({ subsets: ["latin", "latin-ext"], weight: ["400", "500"], variable: "--font-roboto" });

export type Difficulty = "friendly" | "realistic" | "tough";
export type FeelingEvent = { t: number; feeling: string; intensity: number; reason: string };
export type Line = { id: number; who: "you" | "candidate"; text: string; t: number };
type Phase = "lobby" | "connecting" | "call" | "left";
type Panel = "people" | "chat" | "mood" | null;

/** Candidate feedback as returned by the API (`interview.feedback`). */
export type CandidateFeedback = {
  overall_feeling: string;
  would_accept_offer: "yes" | "maybe" | "no";
  would_recommend_company: number;
  scores: {
    rapport: number;
    clarity_of_questions: number;
    respect: number;
    relevance_to_my_experience: number;
    company_pitch: number;
  };
  highlights: { quote: string; why: string }[];
  lowlights: { quote: string; why: string }[];
  inappropriate_questions: { quote: string; issue: string }[];
  unanswered_candidate_questions: string[];
  undiscovered: string[];
  tips_for_interviewer: string[];
  glassdoor_style_review: string;
  talk_ratio: { interviewer: number; candidate: number };
};

/** What the call knows when it ends; passed to `loadFeedback`. */
export type EndedCall = {
  conversationId: string | null;
  durationSecs: number;
  feelings: FeelingEvent[];
  difficulty: Difficulty;
};

export type MeetCallProps = {
  candidate: { name: string; subtitle?: string };
  /** Interviewer's display name. */
  you?: string;
  connect: (difficulty: Difficulty) => Promise<HookOptions>;
  /** Batches of the agent's `reportFeeling` calls (every ~10 s and when the call ends). */
  onFeelings?: (events: FeelingEvent[]) => void | Promise<void>;
  onEnded?: (info: { conversationId: string | null; durationSecs: number }) => void;
  /** Shown as the main action after the call, e.g. the feedback page. Ignored when `loadFeedback` is set. */
  feedbackHref?: string;
  /**
   * Shows the candidate's feedback right after the call. Resolve once the feedback is ready (poll inside);
   * reject to show an error with a retry button.
   */
  loadFeedback?: (call: EndedCall) => Promise<CandidateFeedback>;
  defaultDifficulty?: Difficulty;
  /** Design preview: render a screen with sample data, without connecting. */
  preview?: { phase: "call" | "left"; lines?: Line[]; feelings?: FeelingEvent[] };
};

export function MeetCall(props: MeetCallProps) {
  return (
    <ConversationProvider>
      <div className={roboto.variable}>
        <Meet {...props} />
      </div>
    </ConversationProvider>
  );
}

const FLUSH_EVERY_MS = 10_000;

function Meet({
  candidate,
  you = "You",
  connect,
  onFeelings,
  onEnded,
  feedbackHref,
  loadFeedback,
  defaultDifficulty = "realistic",
  preview,
}: MeetCallProps) {
  const isPreview = Boolean(preview);
  const [phase, setPhase] = useState<Phase>(preview?.phase ?? "lobby");
  const [difficulty, setDifficulty] = useState<Difficulty>(defaultDifficulty);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [lines, setLines] = useState<Line[]>(preview?.lines ?? []);
  const [feelings, setFeelings] = useState<FeelingEvent[]>(preview?.feelings ?? []);
  const [toast, setToast] = useState<string | null>(null);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [ended, setEnded] = useState<EndedCall>({
    conversationId: null,
    durationSecs: preview ? 372 : 0,
    feelings: preview?.feelings ?? [],
    difficulty: defaultDifficulty,
  });

  const startedAt = useRef<number | null>(null);
  const connected = useRef(false);
  const conversationId = useRef<string | null>(null);
  const pendingFeelings = useRef<FeelingEvent[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const lineId = useRef(0);

  const elapsed = () => (startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0);

  const flushFeelings = useCallback(() => {
    const batch = pendingFeelings.current.splice(0);
    if (batch.length && onFeelings) void Promise.resolve(onFeelings(batch)).catch(() => {});
  }, [onFeelings]);

  const convo = useConversation({
    onConnect: ({ conversationId: id }) => {
      connected.current = true;
      conversationId.current = id;
      startedAt.current = Date.now();
      setPhase("call");
    },
    onDisconnect: () => {
      if (!connected.current) {
        setPhase("lobby");
        return;
      }
      connected.current = false;
      flushFeelings();
      const durationSecs = elapsed();
      setEnded({ conversationId: conversationId.current, durationSecs, feelings: feelingsRef.current, difficulty });
      setPhase("left");
      onEnded?.({ conversationId: conversationId.current, durationSecs });
    },
    onMessage: ({ message, source }) => {
      if (!message?.trim()) return;
      setLines((l) => [...l, { id: ++lineId.current, who: source === "user" ? "you" : "candidate", text: message, t: elapsed() }]);
    },
    onError: (message) => setToast(typeof message === "string" ? message : "Something went wrong with the call"),
  });
  const feelingsRef = useRef(feelings);
  useEffect(() => {
    feelingsRef.current = feelings;
  }, [feelings]);
  const convoRef = useRef(convo);
  useEffect(() => {
    convoRef.current = convo;
  });

  useConversationClientTool("reportFeeling", (params: Record<string, unknown>) => {
    const event: FeelingEvent = {
      t: elapsed(),
      feeling: String(params.feeling ?? "neutral"),
      intensity: Math.min(5, Math.max(1, Number(params.intensity) || 1)),
      reason: String(params.reason ?? ""),
    };
    setFeelings((f) => [...f, event]);
    pendingFeelings.current.push(event);
  });

  // Mic mute follows the toggle, also before the call (applied once connected).
  useEffect(() => {
    if (convo.status === "connected") convo.setMuted(!micOn);
  }, [micOn, convo.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Local camera preview: only for the interviewer's own tile, never sent anywhere.
  useEffect(() => {
    if (!camOn || phase === "left") return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 1280, height: 720 } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        setCamera(s);
      })
      .catch(() => setCamOn(false));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      setCamera(null);
    };
  }, [camOn, phase]);

  // Send feelings in batches while the call runs.
  useEffect(() => {
    if (phase !== "call") return;
    const timer = setInterval(flushFeelings, FLUSH_EVERY_MS);
    return () => clearInterval(timer);
  }, [phase, flushFeelings]);

  // Drive the speaking rings from audio levels without re-rendering.
  useEffect(() => {
    if (phase !== "call" || isPreview) return;
    let frame = 0;
    const tick = () => {
      const el = stageRef.current;
      if (el) {
        el.style.setProperty("--agent-vol", String(Math.min(1, convoRef.current.getOutputVolume() * 2.5)));
        el.style.setProperty("--self-vol", String(micOn ? Math.min(1, convoRef.current.getInputVolume() * 2.5) : 0));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, micOn, isPreview]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function join() {
    setPhase("connecting");
    setLines([]);
    setFeelings([]);
    try {
      const options = await connect(difficulty);
      convo.startSession({ connectionType: "webrtc", ...options } as HookOptions);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Could not start the call");
      setPhase("lobby");
    }
  }

  if (phase === "lobby" || phase === "connecting") {
    return (
      <Lobby
        candidate={candidate}
        you={you}
        camera={camera}
        micOn={micOn}
        camOn={camOn}
        setMicOn={setMicOn}
        setCamOn={setCamOn}
        difficulty={difficulty}
        setDifficulty={setDifficulty}
        joining={phase === "connecting"}
        onJoin={join}
        toast={toast}
      />
    );
  }

  if (phase === "left" && loadFeedback) {
    return (
      <FeedbackScreen
        candidate={candidate}
        ended={ended}
        load={loadFeedback}
        onRejoin={() => setPhase("lobby")}
      />
    );
  }

  if (phase === "left") {
    return (
      <div className={styles.light}>
        <Header />
        <main className={styles.leftScreen}>
          <h1 className={styles.leftTitle}>You left the meeting</h1>
          <p className={styles.muted}>
            Interview with {candidate.name} · {clock(ended.durationSecs)}
          </p>
          <div className={styles.leftActions}>
            <button className={styles.outlineBtn} onClick={() => setPhase("lobby")}>
              Rejoin
            </button>
            {feedbackHref ? (
              <a className={styles.primaryBtn} href={feedbackHref}>
                View candidate feedback
              </a>
            ) : null}
          </div>
        </main>
      </div>
    );
  }

  const lastLine = lines.at(-1);
  const currentFeeling = feelings.at(-1);

  return (
    <div className={styles.dark}>
      <div className={styles.room}>
        <div className={styles.stage} ref={stageRef}>
          <section className={`${styles.tile} ${styles.mainTile}`} aria-label={candidate.name}>
            <div className={`${styles.avatarWrap} ${convo.isSpeaking ? styles.speaking : ""}`}>
              <div className={styles.avatarRing} />
              <Avatar name={candidate.name} size={160} />
            </div>
            <div className={styles.speakingBadge} data-active={convo.isSpeaking}>
              <span />
              <span />
              <span />
            </div>
            <div className={styles.nameTag}>{candidate.name}</div>
          </section>

          <section className={`${styles.tile} ${styles.selfTile}`} aria-label="You">
            {camOn && camera ? (
              <video className={styles.video} autoPlay muted playsInline ref={(el) => attach(el, camera)} />
            ) : (
              <div className={styles.selfAvatar}>
                <Avatar name={you} size={48} />
              </div>
            )}
            {!micOn ? (
              <span className={styles.mutedBadge}>
                <Icon name="mic_off" size={16} />
              </span>
            ) : null}
            <div className={styles.nameTag}>You</div>
          </section>

          {captionsOn && lastLine ? (
            <div className={styles.captions} key={lastLine.id}>
              <Avatar name={lastLine.who === "you" ? you : candidate.name} size={28} />
              <div>
                <div className={styles.captionName}>{lastLine.who === "you" ? "You" : candidate.name}</div>
                <div className={styles.captionText}>{lastLine.text}</div>
              </div>
            </div>
          ) : null}
        </div>

        {panel ? (
          <aside className={styles.panel}>
            <div className={styles.panelHead}>
              <h2>{panel === "people" ? "People" : panel === "chat" ? "Transcript" : "Candidate mood"}</h2>
              <IconButton icon="close" label="Close" onClick={() => setPanel(null)} light />
            </div>
            {panel === "people" ? (
              <div className={styles.panelBody}>
                <div className={styles.panelLabel}>In call · 2</div>
                <Person name={you} note="Interviewer (you)" muted={!micOn} />
                <Person name={candidate.name} note={candidate.subtitle ?? "Candidate"} muted={false} />
              </div>
            ) : panel === "chat" ? (
              <div className={styles.panelBody}>
                <p className={styles.panelHint}>Live transcript of the call. Only you can see it.</p>
                {lines.map((l) => (
                  <div key={l.id} className={styles.msg}>
                    <div className={styles.msgHead}>
                      <b>{l.who === "you" ? "You" : candidate.name}</b>
                      <span>{clock(l.t)}</span>
                    </div>
                    <div>{l.text}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.panelBody}>
                <p className={styles.panelHint}>How the candidate feels right now. Only you can see it.</p>
                {currentFeeling ? (
                  <div className={styles.moodNow}>
                    <span className={styles.moodWord}>{currentFeeling.feeling}</span>
                    <Intensity value={currentFeeling.intensity} />
                    <span className={styles.muted}>{currentFeeling.reason}</span>
                  </div>
                ) : (
                  <p className={styles.muted}>No signal yet.</p>
                )}
                {[...feelings].reverse().slice(1).map((f, i) => (
                  <div key={i} className={styles.moodRow}>
                    <span className={styles.moodTime}>{clock(f.t)}</span>
                    <b>{f.feeling}</b>
                    <Intensity value={f.intensity} />
                    <span className={styles.muted}>{f.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </aside>
        ) : null}
      </div>

      <footer className={styles.bar}>
        <div className={styles.barLeft}>
          <Clock /> <span className={styles.sep}>|</span> <span>{meetingCode(candidate.name)}</span>
        </div>
        <div className={styles.barCenter}>
          <IconButton
            icon={micOn ? "mic" : "mic_off"}
            label={micOn ? "Turn off microphone" : "Turn on microphone"}
            danger={!micOn}
            onClick={() => setMicOn((m) => !m)}
          />
          <IconButton
            icon={camOn ? "videocam" : "videocam_off"}
            label={camOn ? "Turn off camera" : "Turn on camera"}
            danger={!camOn}
            onClick={() => setCamOn((c) => !c)}
          />
          <IconButton
            icon="closed_caption"
            label={captionsOn ? "Turn off captions" : "Turn on captions"}
            active={captionsOn}
            onClick={() => setCaptionsOn((c) => !c)}
          />
          <IconButton icon="mood" label="Candidate mood" active={panel === "mood"} onClick={() => setPanel((p) => (p === "mood" ? null : "mood"))} />
          <button className={styles.hangUp} aria-label="Leave call" title="Leave call" onClick={() => convo.endSession()}>
            <Icon name="call_end" />
          </button>
        </div>
        <div className={styles.barRight}>
          <IconButton icon="group" label="People" plain active={panel === "people"} onClick={() => setPanel((p) => (p === "people" ? null : "people"))} />
          <IconButton icon="chat" label="Transcript" plain active={panel === "chat"} onClick={() => setPanel((p) => (p === "chat" ? null : "chat"))} />
        </div>
      </footer>

      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </div>
  );
}

const SCORE_LABELS: [keyof CandidateFeedback["scores"], string][] = [
  ["rapport", "Rapport"],
  ["clarity_of_questions", "Clarity of questions"],
  ["respect", "Respect"],
  ["relevance_to_my_experience", "Relevance to my experience"],
  ["company_pitch", "Company pitch"],
];

const OFFER_LABEL = { yes: "Yes", maybe: "Maybe", no: "No" } as const;

function FeedbackScreen(props: {
  candidate: MeetCallProps["candidate"];
  ended: EndedCall;
  load: (call: EndedCall) => Promise<CandidateFeedback>;
  onRejoin: () => void;
}) {
  const { candidate, ended, load } = props;
  const [state, setState] = useState<{ feedback?: CandidateFeedback; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  const first = candidate.name.split(/\s+/)[0] || candidate.name;

  // Parents often pass an inline function; keep the latest without restarting the (polling) load.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    let active = true;
    loadRef.current(ended).then(
      (feedback) => active && setState({ feedback }),
      (err: unknown) => active && setState({ error: err instanceof Error ? err.message : "Could not load feedback" }),
    );
    return () => {
      active = false;
    };
  }, [ended, attempt]);

  const f = state.feedback;
  return (
    <div className={styles.light}>
      <Header />
      <main className={styles.fbPage}>
        <div className={styles.fbTop}>
          <div>
            <h1 className={styles.fbTitle}>Interview with {candidate.name}</h1>
            <p className={styles.muted}>
              {clock(ended.durationSecs)} · {ended.difficulty[0].toUpperCase() + ended.difficulty.slice(1)} difficulty
              {candidate.subtitle ? ` · ${candidate.subtitle}` : ""}
            </p>
          </div>
          <button className={styles.outlineBtn} onClick={props.onRejoin}>
            Rejoin
          </button>
        </div>

        {!f && !state.error ? (
          <div className={styles.fbWaiting} role="status">
            <span className={styles.spinner} aria-hidden />
            <div>
              <div className={styles.fbWaitingTitle}>{first} is writing you feedback…</div>
              <div className={styles.muted}>This usually takes 20–60 seconds after the call ends.</div>
            </div>
          </div>
        ) : null}

        {state.error ? (
          <div className={styles.fbError} role="alert">
            <Icon name="warning" size={20} />
            <span>{state.error}</span>
            <button
              className={styles.outlineBtn}
              onClick={() => {
                setState({});
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : null}

        {f ? (
          <>
            <section className={styles.fbHero}>
              <Avatar name={candidate.name} size={48} />
              <div>
                <div className={styles.fbLabel}>How {first} felt</div>
                <blockquote className={styles.fbQuote}>{f.overall_feeling}</blockquote>
              </div>
            </section>

            <section className={styles.fbStats}>
              <div className={styles.fbStat}>
                <div className={styles.fbLabel}>Would accept an offer</div>
                <div className={styles.fbStatValue} data-tone={f.would_accept_offer}>
                  {OFFER_LABEL[f.would_accept_offer]}
                </div>
              </div>
              <div className={styles.fbStat}>
                <div className={styles.fbLabel}>Would recommend applying</div>
                <div className={styles.fbStatValue}>
                  {Math.round(f.would_recommend_company)}
                  <small>/10</small>
                </div>
              </div>
              <div className={styles.fbStat}>
                <div className={styles.fbLabel}>Talk time</div>
                <div className={styles.talkBar} aria-label={`You ${f.talk_ratio.interviewer}%, ${first} ${f.talk_ratio.candidate}%`}>
                  <span style={{ width: `${f.talk_ratio.interviewer}%` }} />
                </div>
                <div className={styles.talkLegend}>
                  <span>You {f.talk_ratio.interviewer}%</span>
                  <span>
                    {first} {f.talk_ratio.candidate}%
                  </span>
                </div>
              </div>
            </section>

            <section className={styles.fbCard}>
              <h2 className={styles.fbH2}>Scores</h2>
              {SCORE_LABELS.map(([key, label]) => (
                <div key={key} className={styles.scoreRow}>
                  <span>{label}</span>
                  <Intensity value={Math.round(f.scores[key])} />
                  <span className={styles.muted}>{Math.round(f.scores[key])}/5</span>
                </div>
              ))}
            </section>

            {f.inappropriate_questions.length ? (
              <section className={`${styles.fbCard} ${styles.fbWarn}`}>
                <h2 className={styles.fbH2}>
                  <Icon name="warning" size={20} /> Questions to avoid
                </h2>
                {f.inappropriate_questions.map((q, i) => (
                  <div key={i} className={styles.fbItem}>
                    <q>{q.quote}</q>
                    <p>{q.issue}</p>
                  </div>
                ))}
              </section>
            ) : null}

            <div className={styles.fbCols}>
              <QuoteList title="What worked" items={f.highlights} empty="Nothing stood out." />
              <QuoteList title="What didn't" items={f.lowlights} empty="Nothing went badly." />
            </div>

            <div className={styles.fbCols}>
              <TextList title="What you didn't find out" items={f.undiscovered} empty="You found out everything." />
              <TextList title={`What ${first} wanted to ask`} items={f.unanswered_candidate_questions} empty="All questions answered." />
            </div>

            <section className={styles.fbCard}>
              <h2 className={styles.fbH2}>Tips for next time</h2>
              <ol className={styles.fbTips}>
                {f.tips_for_interviewer.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
            </section>

            {ended.feelings.length ? (
              <section className={styles.fbCard}>
                <h2 className={styles.fbH2}>Mood during the call</h2>
                <div className={styles.moodLine}>
                  {ended.feelings.map((e, i) => (
                    <span key={i} className={styles.moodChip} title={e.reason}>
                      <span className={styles.moodTime}>{clock(e.t)}</span> {e.feeling}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            <section className={`${styles.fbCard} ${styles.fbReview}`}>
              <h2 className={styles.fbH2}>If {first} wrote a review</h2>
              <p>“{f.glassdoor_style_review}”</p>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

function QuoteList({ title, items, empty }: { title: string; items: { quote: string; why: string }[]; empty: string }) {
  return (
    <section className={styles.fbCard}>
      <h2 className={styles.fbH2}>{title}</h2>
      {items.length ? (
        items.map((h, i) => (
          <div key={i} className={styles.fbItem}>
            <q>{h.quote}</q>
            <p>{h.why}</p>
          </div>
        ))
      ) : (
        <p className={styles.muted}>{empty}</p>
      )}
    </section>
  );
}

function TextList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section className={styles.fbCard}>
      <h2 className={styles.fbH2}>{title}</h2>
      {items.length ? (
        <ul className={styles.fbList}>
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>{empty}</p>
      )}
    </section>
  );
}

function Lobby(props: {
  candidate: MeetCallProps["candidate"];
  you: string;
  camera: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  setMicOn: (on: boolean) => void;
  setCamOn: (on: boolean) => void;
  difficulty: Difficulty;
  setDifficulty: (d: Difficulty) => void;
  joining: boolean;
  onJoin: () => void;
  toast: string | null;
}) {
  const { candidate, camera, micOn, camOn, joining } = props;
  return (
    <div className={styles.light}>
      <Header />
      <main className={styles.lobby}>
        <div className={styles.preview}>
          {camOn && camera ? (
            <video className={styles.video} autoPlay muted playsInline ref={(el) => attach(el, camera)} />
          ) : (
            <div className={styles.previewOff}>Camera is off</div>
          )}
          <div className={styles.previewName}>{props.you}</div>
          <div className={styles.previewControls}>
            <RoundToggle on={micOn} icon={micOn ? "mic" : "mic_off"} label="microphone" onClick={() => props.setMicOn(!micOn)} />
            <RoundToggle on={camOn} icon={camOn ? "videocam" : "videocam_off"} label="camera" onClick={() => props.setCamOn(!camOn)} />
          </div>
        </div>

        <div className={styles.joinCol}>
          <h1 className={styles.joinTitle}>Ready to join?</h1>
          <div className={styles.waiting}>
            <Avatar name={candidate.name} size={28} />
            <span>
              {candidate.name}
              {candidate.subtitle ? ` · ${candidate.subtitle}` : ""} is waiting
            </span>
          </div>
          <div className={styles.difficulty} role="radiogroup" aria-label="Interview difficulty">
            {(["friendly", "realistic", "tough"] as const).map((d) => (
              <button
                key={d}
                role="radio"
                aria-checked={props.difficulty === d}
                className={props.difficulty === d ? styles.chipOn : styles.chip}
                onClick={() => props.setDifficulty(d)}
              >
                {props.difficulty === d ? <Icon name="check" size={18} /> : null}
                {d[0].toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
          <button className={styles.joinBtn} onClick={props.onJoin} disabled={joining}>
            {joining ? "Joining…" : "Join now"}
          </button>
          <p className={styles.mutedSmall}>The candidate is an AI simulation built from public profile data.</p>
        </div>
      </main>
      {props.toast ? <div className={styles.toast}>{props.toast}</div> : null}
    </div>
  );
}

function Header() {
  return (
    <header className={styles.header}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static logo, any format */}
      <img src={BRAND.logo} alt="" width={40} height={40} />
      <span className={styles.brandName}>{BRAND.name}</span>
      <span className={styles.brandProduct}>{BRAND.product}</span>
    </header>
  );
}

function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg className={styles.icon} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d={ICONS[name]} fill="currentColor" />
    </svg>
  );
}

function IconButton(props: {
  icon: IconName;
  label: string;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
  plain?: boolean;
  light?: boolean;
}) {
  const cls = [
    styles.ctrl,
    props.danger && styles.ctrlDanger,
    props.active && styles.ctrlActive,
    props.plain && styles.ctrlPlain,
    props.light && styles.ctrlLight,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} aria-label={props.label} title={props.label} aria-pressed={props.active} onClick={props.onClick}>
      <Icon name={props.icon} />
    </button>
  );
}

function RoundToggle({ on, icon, label, onClick }: { on: boolean; icon: IconName; label: string; onClick: () => void }) {
  return (
    <button
      className={on ? styles.round : styles.roundOff}
      aria-label={`${on ? "Turn off" : "Turn on"} ${label}`}
      title={`${on ? "Turn off" : "Turn on"} ${label}`}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

function Person({ name, note, muted }: { name: string; note: string; muted: boolean }) {
  return (
    <div className={styles.person}>
      <Avatar name={name} size={32} />
      <div className={styles.personText}>
        <div>{name}</div>
        <div className={styles.mutedSmall}>{note}</div>
      </div>
      <Icon name={muted ? "mic_off" : "mic"} size={20} />
    </div>
  );
}

function Intensity({ value }: { value: number }) {
  return (
    <span className={styles.intensity} aria-label={`intensity ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} data-on={i <= value} />
      ))}
    </span>
  );
}

const AVATAR_COLORS = ["#1e8e3e", "#d93025", "#7b1fa2", "#e37400", "#1a73e8", "#c2185b", "#00796b", "#5f6368"];

function Avatar({ name, size }: { name: string; size: number }): ReactNode {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, fontSize: size * 0.42, background: AVATAR_COLORS[hash(name) % AVATAR_COLORS.length] }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

function Clock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    update();
    const timer = setInterval(update, 10_000);
    return () => clearInterval(timer);
  }, []);
  return <span>{now}</span>;
}

function attach(el: HTMLVideoElement | null, stream: MediaStream) {
  if (el && el.srcObject !== stream) el.srcObject = stream;
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Stable Meet-style code (abc-defg-hij) per candidate, purely cosmetic. */
function meetingCode(name: string): string {
  let h = hash(name) || 1;
  const letters = Array.from({ length: 10 }, () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return String.fromCharCode(97 + (h % 26));
  }).join("");
  return `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}`;
}

function clock(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
