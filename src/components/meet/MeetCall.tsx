"use client";

import { ConversationProvider, useConversation, useConversationClientTool, type HookOptions } from "@elevenlabs/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert02Icon,
  CallEnd01Icon,
  Cancel01Icon,
  ClosedCaptionIcon,
  Message01Icon,
  Mic01Icon,
  MicOff01Icon,
  SmileIcon,
  UserGroupIcon,
  Video01Icon,
  VideoOffIcon,
} from "@hugeicons/core-free-icons";
import { Stat, Status } from "@/components/bits";
import { Aura, type AuraColors } from "@/components/fragms";
import { Logo } from "@/components/logo";
import { Avatar, Button, cx, Icon, IconButton, Panel, Segmented, Spinner, toast, type IconData } from "@/components/ui";
import { BRAND } from "./brand";

/*
 * 1:1 call for practice interviews with a candidate agent: lobby, call room, then the candidate's feedback.
 * Laid out like a video call, drawn in the Shaar look with the Fragms kit. Where the session comes from is up to
 * the caller: `connect` returns options for `startSession`, either the backend's `session` from
 * POST /api/personas/:id/interviews or `{ agentId }` for tests.
 */

export type Difficulty = "friendly" | "realistic" | "tough";
export type FeelingEvent = { t: number; feeling: string; intensity: number; reason: string };
export type Line = { id: number; who: "you" | "candidate"; text: string; t: number };
type Phase = "lobby" | "connecting" | "call" | "left";
type PanelName = "people" | "chat" | "mood" | null;

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

const CAPTION = "text-[11px] font-medium tracking-[0.22em] text-muted uppercase";
const ASH: AuraColors = ["#c8c8cc", "#5c5c63", "#9a9aa1", "#3a3a40"];
const FLUSH_EVERY_MS = 10_000;

/*
 * Call controls. One class set per state, so no two utilities fight over a property: off reads as a state in the
 * danger tone, on flips to the primary pill like a pressed key, end is the one red action.
 */
const CALL_TONES = {
  idle: "bg-control text-foreground hover:bg-control-hover",
  glass: "bg-background/60 text-foreground backdrop-blur-md hover:bg-background/80",
  on: "bg-primary text-primary-ink hover:opacity-90",
  off: "bg-danger/15 text-danger hover:bg-danger/25",
  end: "w-16 bg-danger text-white hover:opacity-90",
} as const;

function CallButton(props: {
  label: string;
  icon: IconData;
  tone: keyof typeof CALL_TONES;
  pressed?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.pressed}
      onClick={props.onClick}
      className={cx(
        "grid size-12 shrink-0 cursor-pointer place-items-center rounded-full transition-[background-color,color,opacity,transform] duration-150 ease-out select-none active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
        CALL_TONES[props.tone],
        props.className,
      )}
    >
      <Icon icon={props.icon} size={20} />
    </button>
  );
}

const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: "friendly", label: "Friendly" },
  { id: "realistic", label: "Realistic" },
  { id: "tough", label: "Tough" },
];

export function MeetCall(props: MeetCallProps) {
  return (
    <ConversationProvider>
      <Meet {...props} />
    </ConversationProvider>
  );
}

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
  const [panel, setPanel] = useState<PanelName>(null);
  const [lines, setLines] = useState<Line[]>(preview?.lines ?? []);
  const [feelings, setFeelings] = useState<FeelingEvent[]>(preview?.feelings ?? []);
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
  const lineId = useRef(0);

  const elapsed = () => (startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0);

  const flushFeelings = useCallback(() => {
    const batch = pendingFeelings.current.splice(0);
    if (batch.length && onFeelings) void Promise.resolve(onFeelings(batch)).catch(() => {});
  }, [onFeelings]);

  const feelingsRef = useRef(feelings);
  useEffect(() => {
    feelingsRef.current = feelings;
  }, [feelings]);

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
      setLines((l) => [
        ...l,
        { id: ++lineId.current, who: source === "user" ? "you" : "candidate", text: message, t: elapsed() },
      ]);
    },
    onError: (message) => toast.error(typeof message === "string" ? message : "Something went wrong with the call"),
  });
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

  // Aura reads these every frame, so voice levels never re-render React.
  const agentLevel = useCallback(
    () => (isPreview ? 0.12 : Math.min(1, convoRef.current.getOutputVolume() * 2.5)),
    [isPreview],
  );
  const selfLevel = useCallback(
    () => (isPreview || !micOn ? 0 : Math.min(1, convoRef.current.getInputVolume() * 2.5)),
    [isPreview, micOn],
  );

  async function join() {
    setPhase("connecting");
    setLines([]);
    setFeelings([]);
    try {
      const options = await connect(difficulty);
      convo.startSession({ connectionType: "webrtc", ...options } as HookOptions);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the call");
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
      />
    );
  }

  if (phase === "left" && loadFeedback) {
    return (
      <FeedbackScreen candidate={candidate} ended={ended} load={loadFeedback} onRejoin={() => setPhase("lobby")} />
    );
  }

  if (phase === "left") {
    return (
      <Shell>
        <div className="grid min-h-[calc(100svh-3.5rem)] place-items-center px-5 text-center">
          <div className="flex flex-col items-center">
            <p className={CAPTION}>Call ended</p>
            <h1 className="mt-4 text-title">You left the call</h1>
            <p className="mt-3 text-body text-muted">
              Interview with {candidate.name} · {clock(ended.durationSecs)}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={() => setPhase("lobby")}>
                Rejoin
              </Button>
              {feedbackHref ? (
                <Button variant="primary" href={feedbackHref} arrow>
                  See the feedback
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  const lastLine = lines.at(-1);
  const currentFeeling = feelings.at(-1);
  const togglePanel = (name: Exclude<PanelName, null>) => setPanel((p) => (p === name ? null : name));

  return (
    <main className="dark flex h-svh flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 gap-4 p-3 sm:p-4">
        <div className="relative min-w-0 flex-1">
          <section
            aria-label={candidate.name}
            className="absolute inset-0 grid place-items-center overflow-hidden rounded-stage border border-border bg-card"
          >
            <Aura level={agentLevel} palette={ASH} intensity={1.4} className="rounded-full">
              <div className="grid size-36 place-items-center rounded-full bg-control text-[44px] font-medium tracking-[-0.03em] sm:size-44 sm:text-[52px]">
                {initials(candidate.name)}
              </div>
            </Aura>
            <div className="absolute top-4 left-4 flex items-center gap-2">
              <Logo className="h-4 w-auto text-muted" />
              <span className={CAPTION}>
                {BRAND.name} {BRAND.product}
              </span>
            </div>
            {convo.isSpeaking ? <span className={cx(CAPTION, "shimmer absolute top-4 right-4")}>Speaking</span> : null}
            <div className="absolute bottom-4 left-4 text-label font-medium">{candidate.name}</div>
          </section>

          {/* Aura positions itself relative, so the placement lives on a wrapper. */}
          <div className="absolute right-3 bottom-3 aspect-video w-[38%] max-w-[260px] min-w-[132px] sm:right-4 sm:bottom-4">
            <Aura level={selfLevel} palette={ASH} intensity={0.8} className="h-full w-full rounded-panel">
              <section
                aria-label="You"
                className="relative h-full w-full overflow-hidden rounded-panel border border-border bg-well shadow-float"
              >
                {camOn && camera ? (
                  <video
                    className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
                    autoPlay
                    muted
                    playsInline
                    ref={(el) => attach(el, camera)}
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center">
                    <Avatar name={you} size="md" />
                  </div>
                )}
                {!micOn ? (
                  <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-background/70 text-danger">
                    <Icon icon={MicOff01Icon} size={13} />
                  </span>
                ) : null}
                <span className="absolute bottom-2 left-2.5 text-caption font-medium">You</span>
              </section>
            </Aura>
          </div>

          {captionsOn && lastLine ? (
            <div
              key={lastLine.id}
              className="absolute right-3 bottom-[calc(min(38vw,260px)*0.5625+1.5rem)] left-3 mx-auto max-w-[680px] rounded-panel border border-border bg-background/80 px-4 py-3 backdrop-blur-md sm:right-[calc(min(38%,260px)+2rem)] sm:bottom-12 sm:left-4"
            >
              <p className={CAPTION}>{lastLine.who === "you" ? "You" : candidate.name}</p>
              <p className="mt-1 line-clamp-3 text-body">{lastLine.text}</p>
            </div>
          ) : null}
        </div>

        {panel ? (
          <Panel
            padded={false}
            className="fixed inset-x-3 top-3 bottom-24 z-10 flex flex-col overflow-hidden sm:static sm:w-[340px] sm:shrink-0"
          >
            <div className="flex items-center justify-between border-b border-border py-3 pr-3 pl-5">
              <h2 className="text-[15px] font-medium">
                {panel === "people" ? "People" : panel === "chat" ? "Transcript" : "Candidate mood"}
              </h2>
              <IconButton label="Close" icon={Cancel01Icon} onClick={() => setPanel(null)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {panel === "people" ? (
                <div className="flex flex-col gap-4">
                  <p className={CAPTION}>In the call · 2</p>
                  <Person name={you} note="Interviewer, you" muted={!micOn} />
                  <Person name={candidate.name} note={candidate.subtitle ?? "Candidate"} muted={false} />
                </div>
              ) : panel === "chat" ? (
                <div className="flex flex-col gap-5">
                  <p className="text-caption text-muted">Only you can see the transcript.</p>
                  {lines.map((l) => (
                    <div key={l.id}>
                      <p className="flex items-baseline gap-2 text-label">
                        <span className="font-medium">{l.who === "you" ? "You" : candidate.name}</span>
                        <span className="text-caption text-muted tabular-nums">{clock(l.t)}</span>
                      </p>
                      <p className="mt-1 text-label text-muted">{l.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="text-caption text-muted">How the candidate feels right now. Only you can see it.</p>
                  {currentFeeling ? (
                    <div className="rounded-field border border-border bg-well p-4">
                      <p className="text-heading capitalize">{currentFeeling.feeling}</p>
                      <Dots value={currentFeeling.intensity} className="mt-2" />
                      <p className="mt-2 text-label text-muted">{currentFeeling.reason}</p>
                    </div>
                  ) : (
                    <p className="text-label text-muted">No signal yet.</p>
                  )}
                  {[...feelings]
                    .reverse()
                    .slice(1)
                    .map((f, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-[2.5rem_1fr] gap-x-3 border-t border-border pt-3 text-label"
                      >
                        <span className="text-caption text-muted tabular-nums">{clock(f.t)}</span>
                        <span className="flex items-center gap-2">
                          <span className="font-medium capitalize">{f.feeling}</span>
                          <Dots value={f.intensity} />
                        </span>
                        <span className="col-start-2 mt-0.5 text-caption text-muted">{f.reason}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </Panel>
        ) : null}
      </div>

      <footer className="grid h-20 shrink-0 grid-cols-1 items-center px-4 sm:grid-cols-[1fr_auto_1fr] sm:px-6">
        <div className={cx(CAPTION, "hidden items-center gap-2 tabular-nums sm:flex")}>
          <Clock />
          <span aria-hidden>·</span>
          <span>{meetingCode(candidate.name)}</span>
        </div>
        <div className="flex items-center justify-center gap-2">
          <CallButton
            label={micOn ? "Turn off the microphone" : "Turn on the microphone"}
            icon={micOn ? Mic01Icon : MicOff01Icon}
            tone={micOn ? "idle" : "off"}
            onClick={() => setMicOn((m) => !m)}
          />
          <CallButton
            label={camOn ? "Turn off the camera" : "Turn on the camera"}
            icon={camOn ? Video01Icon : VideoOffIcon}
            tone={camOn ? "idle" : "off"}
            onClick={() => setCamOn((c) => !c)}
          />
          <CallButton
            label={captionsOn ? "Hide captions" : "Show captions"}
            icon={ClosedCaptionIcon}
            tone={captionsOn ? "on" : "idle"}
            pressed={captionsOn}
            onClick={() => setCaptionsOn((c) => !c)}
          />
          <CallButton
            label="Candidate mood"
            icon={SmileIcon}
            tone={panel === "mood" ? "on" : "idle"}
            pressed={panel === "mood"}
            onClick={() => togglePanel("mood")}
          />
          <CallButton
            label="Transcript"
            icon={Message01Icon}
            tone={panel === "chat" ? "on" : "idle"}
            pressed={panel === "chat"}
            className="sm:hidden"
            onClick={() => togglePanel("chat")}
          />
          <CallButton label="Leave the call" icon={CallEnd01Icon} tone="end" onClick={() => convo.endSession()} />
        </div>
        <div className="hidden justify-end gap-1 sm:flex">
          <IconButton
            size="md"
            label="People"
            icon={UserGroupIcon}
            active={panel === "people"}
            onClick={() => togglePanel("people")}
          />
          <IconButton
            size="md"
            label="Transcript"
            icon={Message01Icon}
            active={panel === "chat"}
            onClick={() => togglePanel("chat")}
          />
        </div>
      </footer>
    </main>
  );
}

/** Dark page with the Shaar header, for the lobby, the end and the feedback. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="dark min-h-svh bg-background text-foreground selection:bg-foreground selection:text-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[1180px] items-center gap-3 px-5 sm:px-8">
          <Link href="/" aria-label="Shaar" className="flex items-center gap-2.5 text-[15px] font-medium">
            <Logo className="h-5 w-auto" />
            {BRAND.name}
          </Link>
          <span className={cx(CAPTION, "hidden sm:inline")}>{BRAND.product}</span>
          <div className="ml-auto">
            <Status tone="strong">Simulation</Status>
          </div>
        </div>
      </header>
      {children}
    </main>
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
}) {
  const { candidate, camera, micOn, camOn, joining } = props;
  return (
    <Shell>
      <div className="mx-auto grid min-h-[calc(100svh-3.5rem)] w-full max-w-[1180px] items-center gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[1.5fr_1fr] lg:gap-14">
        <div className="relative aspect-video w-full overflow-hidden rounded-stage border border-border bg-well shadow-card">
          {camOn && camera ? (
            <video
              className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
              autoPlay
              muted
              playsInline
              ref={(el) => attach(el, camera)}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center">
              <p className={CAPTION}>Camera is off</p>
            </div>
          )}
          <span className="absolute top-4 left-4 text-label font-medium">{props.you}</span>
          <div className="absolute inset-x-0 bottom-4 flex justify-center gap-3">
            <CallButton
              label={micOn ? "Turn off the microphone" : "Turn on the microphone"}
              icon={micOn ? Mic01Icon : MicOff01Icon}
              tone={micOn ? "glass" : "off"}
              onClick={() => props.setMicOn(!micOn)}
            />
            <CallButton
              label={camOn ? "Turn off the camera" : "Turn on the camera"}
              icon={camOn ? Video01Icon : VideoOffIcon}
              tone={camOn ? "glass" : "off"}
              onClick={() => props.setCamOn(!camOn)}
            />
          </div>
        </div>

        <div className="flex flex-col items-start">
          <p className={CAPTION}>Practice interview</p>
          <h1 className="mt-4 text-title">Ready to join?</h1>
          <div className="mt-5 flex items-center gap-3">
            <Avatar name={candidate.name} size="md" />
            <div>
              <p className="text-[15px] font-medium">{candidate.name}</p>
              <p className="text-label text-muted">
                {candidate.subtitle ? `${candidate.subtitle} · waiting` : "Waiting"}
              </p>
            </div>
          </div>
          <p className={cx(CAPTION, "mt-8")}>Difficulty</p>
          <Segmented
            className="mt-3"
            label="Interview difficulty"
            value={props.difficulty}
            onChange={props.setDifficulty}
            options={DIFFICULTIES}
          />
          <Button variant="primary" size="lg" className="mt-8 min-w-40" onClick={props.onJoin} disabled={joining}>
            {joining ? <Spinner size="sm" label="Joining" /> : null}
            {joining ? "Joining" : "Join now"}
          </Button>
          <p className="mt-4 max-w-[38ch] text-caption text-muted">
            The candidate is an AI simulation built from public profile data.
          </p>
        </div>
      </div>
    </Shell>
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
  const { candidate, ended } = props;
  const [state, setState] = useState<{ feedback?: CandidateFeedback; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  const first = candidate.name.split(/\s+/)[0] || candidate.name;

  // Parents often pass an inline function; keep the latest without restarting the (polling) load.
  const loadRef = useRef(props.load);
  useEffect(() => {
    loadRef.current = props.load;
  }, [props.load]);

  useEffect(() => {
    let active = true;
    loadRef.current(ended).then(
      (feedback) => active && setState({ feedback }),
      (err: unknown) =>
        active && setState({ error: err instanceof Error ? err.message : "Could not load the feedback" }),
    );
    return () => {
      active = false;
    };
  }, [ended, attempt]);

  const f = state.feedback;
  return (
    <Shell>
      <div className="mx-auto w-full max-w-[920px] px-5 pt-10 pb-24 sm:px-8 sm:pt-14">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className={CAPTION}>Feedback from the candidate</p>
            <h1 className="mt-4 text-title">Interview with {candidate.name}</h1>
            <p className="mt-3 text-label text-muted">
              {clock(ended.durationSecs)} · {cap(ended.difficulty)} difficulty
              {candidate.subtitle ? ` · ${candidate.subtitle}` : ""}
            </p>
          </div>
          <Button variant="outline" onClick={props.onRejoin}>
            Rejoin
          </Button>
        </div>

        {!f && !state.error ? (
          <Panel className="mt-8 flex items-center gap-4">
            <Spinner label="Writing the feedback" />
            <div>
              <p className="shimmer text-[15px] font-medium">{first} is writing you feedback</p>
              <p className="mt-0.5 text-label text-muted">This usually takes 20 to 60 seconds after the call ends.</p>
            </div>
          </Panel>
        ) : null}

        {state.error ? (
          <Panel className="mt-8 flex flex-wrap items-center gap-3">
            <span className="text-danger">
              <Icon icon={Alert02Icon} size={18} />
            </span>
            <p className="min-w-0 flex-1 text-label">{state.error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setState({});
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </Button>
          </Panel>
        ) : null}

        {f ? (
          <div className="mt-8 flex flex-col gap-4">
            <Panel className="flex gap-4">
              <Avatar name={candidate.name} size="lg" />
              <div>
                <p className={CAPTION}>How {first} felt</p>
                <blockquote className="mt-3 text-heading leading-[1.45]">{f.overall_feeling}</blockquote>
              </div>
            </Panel>

            <div className="grid gap-4 sm:grid-cols-3">
              <Stat
                label="Would accept an offer"
                value={
                  <span
                    className={
                      f.would_accept_offer === "yes"
                        ? "text-success"
                        : f.would_accept_offer === "no"
                          ? "text-danger"
                          : undefined
                    }
                  >
                    {OFFER_LABEL[f.would_accept_offer]}
                  </span>
                }
              />
              <Stat label="Would recommend applying" value={`${Math.round(f.would_recommend_company)}/10`} />
              <Stat
                label="Your share of talk time"
                value={`${f.talk_ratio.interviewer}%`}
                hint={`${first} spoke ${f.talk_ratio.candidate}% of the words`}
              >
                <Bar value={f.talk_ratio.interviewer} max={100} />
              </Stat>
            </div>

            <Panel>
              <p className={CAPTION}>Scores</p>
              <div className="mt-4 flex flex-col gap-3">
                {SCORE_LABELS.map(([key, label]) => (
                  <div
                    key={key}
                    className="grid grid-cols-[1fr_5rem_2rem] items-center gap-4 text-label sm:grid-cols-[1fr_10rem_2rem]"
                  >
                    <span>{label}</span>
                    <Bar value={Math.round(f.scores[key])} max={5} />
                    <span className="text-right text-muted tabular-nums">{Math.round(f.scores[key])}/5</span>
                  </div>
                ))}
              </div>
            </Panel>

            {f.inappropriate_questions.length ? (
              <Panel className="border-danger/40">
                <p className={cx(CAPTION, "flex items-center gap-2 text-danger")}>
                  <Icon icon={Alert02Icon} size={14} /> Questions to avoid
                </p>
                <Quotes items={f.inappropriate_questions.map((q) => ({ quote: q.quote, why: q.issue }))} />
              </Panel>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Panel>
                <p className={CAPTION}>What worked</p>
                {f.highlights.length ? <Quotes items={f.highlights} /> : <Quiet>Nothing stood out.</Quiet>}
              </Panel>
              <Panel>
                <p className={CAPTION}>What did not</p>
                {f.lowlights.length ? <Quotes items={f.lowlights} /> : <Quiet>Nothing went badly.</Quiet>}
              </Panel>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Panel>
                <p className={CAPTION}>What you did not find out</p>
                <Bullets items={f.undiscovered} empty="You found out everything." />
              </Panel>
              <Panel>
                <p className={CAPTION}>What {first} wanted to ask</p>
                <Bullets items={f.unanswered_candidate_questions} empty="Every question got an answer." />
              </Panel>
            </div>

            <Panel>
              <p className={CAPTION}>Tips for next time</p>
              <ol className="mt-4 flex list-decimal flex-col gap-2 pl-5 text-label marker:text-muted">
                {f.tips_for_interviewer.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
            </Panel>

            {ended.feelings.length ? (
              <Panel>
                <p className={CAPTION}>Mood during the call</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {ended.feelings.map((e, i) => (
                    <span
                      key={i}
                      title={e.reason}
                      className="inline-flex items-center gap-2 rounded-full bg-control px-3 py-1 text-label"
                    >
                      <span className="text-caption text-muted tabular-nums">{clock(e.t)}</span>
                      <span className="capitalize">{e.feeling}</span>
                    </span>
                  ))}
                </div>
              </Panel>
            ) : null}

            <Panel>
              <p className={CAPTION}>If {first} wrote a review</p>
              <p className="mt-3 text-body italic">“{f.glassdoor_style_review}”</p>
            </Panel>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}

function Quotes({ items }: { items: { quote: string; why: string }[] }) {
  return (
    <div className="mt-4 flex flex-col gap-4">
      {items.map((h, i) => (
        <div key={i} className="text-label">
          <q className="block italic">{h.quote}</q>
          <p className="mt-1 text-muted">{h.why}</p>
        </div>
      ))}
    </div>
  );
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <Quiet>{empty}</Quiet>;
  return (
    <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-label marker:text-muted">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-label text-muted">{children}</p>;
}

function Person({ name, note, muted }: { name: string; note: string; muted: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-label font-medium">{name}</p>
        <p className="text-caption text-muted">{note}</p>
      </div>
      <span className={muted ? "text-danger" : "text-muted"}>
        <Icon icon={muted ? MicOff01Icon : Mic01Icon} size={16} />
      </span>
    </div>
  );
}

/** A plain filled bar. Not the kit's Meter, which turns red near full, because a high score is good here. */
function Bar({ value, max }: { value: number; max: number }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-control" role="presentation">
      <div className="h-full rounded-full bg-foreground" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

function Dots({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cx("inline-flex gap-1", className)} aria-label={`Intensity ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cx("h-1.5 w-3.5 rounded-full", i <= value ? "bg-foreground" : "bg-control")} />
      ))}
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

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Stable meeting-style code (abc-defg-hij) per candidate, purely cosmetic. */
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
