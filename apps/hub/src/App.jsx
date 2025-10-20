import { BrowserRouter, Routes, Route } from "react-router-dom"; // Router
import SpotifyCallback from "./SpotifyCallback";                  // Handles token exchange
import { useEffect, useRef, useState, useCallback } from "react";
import { makeTrackList } from "./spotify/mediaEngine";
import { redirectToAuth, hasSpotifyToken } from "./spotify/spotifyAuth.js";
import { collectTracksFromPlaylists, startPlayback, pausePlayback, attachPlaybackController  } from "./spotify/spotifyClient.js"; // Spotify API helpers
import dictPlaylistID from "../../../packages/shared/PlayListIDs.js"; // adjust path if needed
import { useGameStore } from "./store";
//import { useGame } from "../../../packages/shared/gameStore.js";
import { getSocket } from "../../../packages/shared/socket.js";

// If you published the shared package with this name (recommended):
// import { makeGameStore } from "@mixmatch/shared/gameStore";
// Temporary relative imports (keep your own paths)
import TheaterBackground from "./components/TheaterBackground.jsx";
import GameHistory from "./components/GameHistory.jsx";
import SpotlightOverlay from "./components/SpotlightOverlay.jsx";
import CurtainOverlay from "./components/CurtainOverlay.jsx";
import LobbySettings from "./components/LobbySettings.jsx";
import EmoteStream from "./components/EmoteStream.jsx";

const THEATRE_BG = "/images/theatre-lobby.png";
const useGame = useGameStore;

// ---- responsive thresholds for curtains (tweak to taste) ----
const MIN_W_FOR_CURTAINS = 992;
const MIN_H_FOR_CURTAINS = 650;

function Hub() {
  const {
    code, players, hostId, stage, question, seconds, media, config, lstTracks,
    progress = { answered: 0, total: 0 },
    perOptionCounts = [],
    leaderboard = [],
    createRoom, startGame, nextQuestion, playAgain, toLobby, getConfig,
    seedTracks, setTrackList, // NEW (add this action in your store to emit game:seedTracks)
  } = useGame();

  /* ---------------- Audio  ---------------- */
const audioRef = useRef(null);
const [autoplayReady, setAutoplayReady] = useState(false); // ← add this

// Mount a tiny playback controller that reacts to VM changes.
// It starts when stage enters "question" and pauses as soon as it enters "reveal" (curtain starts to close).
useEffect(() => {
  const unsub = attachPlaybackController(useGame);
  return unsub;
}, []);


// Create room, but bounce to Spotify auth if needed
const onCreate = useCallback(() => {
  if (!hasSpotifyToken()) {
    localStorage.setItem("pending_action", "createRoom");
    redirectToAuth(); // navigates away
    return;
  }
  createRoom();
}, [createRoom]);

const onStart = useCallback(async () => {
  const cfg = getConfig();
  const keyOrId = cfg?.selectedPlaylistIDs?.[0];
  const mapped = (dictPlaylistID && dictPlaylistID[keyOrId]) || keyOrId || "";
  const playlistId = (String(mapped).match(/[A-Za-z0-9]{22}/) || [])[0];
  const numTracks = Math.max(1, Number(cfg?.maxQuestions || 10));

  const tracks = await makeTrackList(playlistId, numTracks);

  // pass meta so the server remembers playlist + count
  seedTracks(tracks, { playlistId, numTracks });
  startGame();
}, []);


const onPlayAgain = useCallback(async () => {
  const cfg = getConfig();
  const keyOrId = cfg?.selectedPlaylistIDs?.[0];
  const mapped = (dictPlaylistID && dictPlaylistID[keyOrId]) || keyOrId || "";
  const playlistId = (String(mapped).match(/[A-Za-z0-9]{22}/) || [])[0];
  const numTracks = Math.max(1, Number(cfg?.maxQuestions || 10));

  const tracks = await makeTrackList(playlistId, numTracks);
  seedTracks(tracks, { playlistId, numTracks });
  // restart with a fresh set, keep the same settings
  startGame();
  //playAgain(tracks, { playlistId, numTracks });
  //setTrackList(tracks);
}, []);



useEffect(() => {
  const s = getSocket();

  async function onRequestReseed({ source }) {
    try {
      const tracks = await makeTrackList(source.playlistId, source.numTracks);
      // restart on server with these tracks + remember the source
      useGame.getState().playAgain(tracks, {
        playlistId: source.playlistId,
        numTracks: source.numTracks,
      });
      // keep any Hub-side UI lists in sync
      setTrackList(tracks);
    } catch (e) {
      console.error("[Hub] requestReseed failed:", e);
      // optional: toast/alert here
    }
  }

  s.on("server:requestReseed", onRequestReseed);
  return () => s.off("server:requestReseed", onRequestReseed);
}, []);
// After /callback: if pending_action was "createRoom" and we now have token → create the room
useEffect(() => {
  const pending = localStorage.getItem("pending_action");
  if (pending === "createRoom" && hasSpotifyToken()) {
    localStorage.removeItem("pending_action");
    createRoom();
  }
}, [createRoom]);

  /* ---------------- Spotlight + Curtains orchestration ---------------- */
  const [spotlightActive, setSpotlightActive] = useState(false);
  const [spotlightEverSettled, setSpotlightEverSettled] = useState(false);

  // Curtains cycle control (close→open before each question)
  const [curtainKey, setCurtainKey] = useState(0);
  const [curtainRunning, setCurtainRunning] = useState(false);
  const [allowFlicker, setAllowFlicker] = useState(false);

  // Responsive: disable curtains if window is small / not “full-ish”
  const [curtainsEnabled, setCurtainsEnabled] = useState(true);
  useEffect(() => {
    const compute = () =>
      window.innerWidth >= MIN_W_FOR_CURTAINS &&
      window.innerHeight >= MIN_H_FOR_CURTAINS;
    const sync = () => setCurtainsEnabled(compute());
    sync();
    window.addEventListener("resize", sync);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
      document.removeEventListener("fullscreenchange", sync);
    };
  }, []);

  // Track previous stage to avoid 1-frame flash on first question render
  const lastStageRef = useRef(stage);
  const justEnteredQuestion = lastStageRef.current !== "question" && stage === "question";
  useEffect(() => {
    lastStageRef.current = stage;
  }, [stage]);

  // Drive stage transitions (NOTE: intentionally NOT dependent on curtainsEnabled)
  useEffect(() => {
    if (stage === "idle") {
      setSpotlightActive(false);
      setSpotlightEverSettled(false);
      setAllowFlicker(false);
      setCurtainRunning(false);
      return;
    }

    if (stage === "lobby") {
      // No curtain animation in lobby; no spotlight either.
      setSpotlightActive(false);
      setAllowFlicker(false);
      setCurtainRunning(false);
      return;
    }

    if (stage === "question") {
      // Prepare: reset spotlight and decide how to kick the sequence
      setSpotlightActive(true);
      setSpotlightEverSettled(false);

      if (curtainsEnabled /* snapshot only; not a dependency */) {
        setAllowFlicker(false);      // enable flicker after curtains open
        setCurtainRunning(true);
        setCurtainKey((k) => k + 1); // trigger per-question cycle (one time)
      } else {
        // No curtains mounted → start flicker immediately
        setCurtainRunning(false);
        setAllowFlicker(true);
      }
      return;
    }

    if (stage === "reveal" || stage === "result" || stage === "gameover") {
      // Keep steady light on non-question stages
      setSpotlightActive(true);
      setAllowFlicker(false);
      return;
    }
  }, [stage, question?.id]); // <-- IMPORTANT: no curtainsEnabled here

  // “Flicker is running” helper
  const isFlicker = stage === "question" && !spotlightEverSettled && allowFlicker;

  // --- Visibility logic with synchronous guard against 1-frame flash ---
  const settledForRender = !justEnteredQuestion && spotlightEverSettled;
  const questionStageHidden = stage === "question" && (curtainRunning || !settledForRender);

  /* ---------------- Stage router -> assemble into `content` ---------------- */
  let content = null;

  if (stage === "idle") {
    content = <Landing onCreate={onCreate} />;
  } else if (stage === "lobby") {
    const hasPick = !!(getConfig()?.selectedPlaylistIDs?.length);
    const canStart = !!code && players.length >= 1 && hasPick;
    content = (
      <TheaterBackground bgUrl={THEATRE_BG}>
        {/* No curtains in lobby per your preference */}
        <Shell
          wide
          title={
            <span className="inline-flex items-baseline gap-2">
              <span className="uppercase text-xs tracking-widest text-mist-400">Room Code</span>
              <code className="font-mono tracking-widest text-3xl md:text-4xl">
                {code || "—"}
              </code>
            </span>
          }
          headerRight={<StageBadge stage={stage} />}
          headerCenter={<Logo size="sm" onClick={() => window.location.reload()} />}
        >
          <div className="mx-auto w-full max-w-[900px] grid gap-2 items-start grid-cols-1 md:grid-cols-2">
            <Card title={`Players (${players.length})`}>
              <PlayerGrid players={players} hostId={hostId} />
              {players.length === 0 && <EmptyNote>No players yet…</EmptyNote>}
              <div className="mt-3 pt-2 border-t border-ink-700/50">
                <GameHistory compact />
              </div>
            </Card>

            <Card title="Game settings">
              <div className="space-y-4 w-full">
                <LobbySettings />
                <PrimaryButton
                  onClick={onStart}
                  disabled={!canStart}
                  aria-label="Start game"
                  className="w-full text-lg px-5 py-3"
                >
                  Start game
                </PrimaryButton>
              </div>
            </Card>
          </div>
        </Shell>
      </TheaterBackground>
    );
  } else if (stage === "question") {
    // Only animate curtains if we explicitly started a cycle this round.
    const shouldAnimateCurtains = curtainRunning;
    const curtainCycleKey = shouldAnimateCurtains ? curtainKey : -1;

    content = (
      <TheaterBackground bgUrl={THEATRE_BG}>
        {/* Curtains: animate only when curtainRunning === true.
            On resize (mount/unmount), we pass -1 to keep them statically open-at-edges. */}
        {curtainsEnabled && (
          <CurtainOverlay
            cycleKey={curtainCycleKey}
            topOffsetPx={0}
            edgePx={72}
            onCycleStart={() => setCurtainRunning(true)}
            onCycleEnd={() => {
              setCurtainRunning(false);
              setAllowFlicker(true);           // spotlight flicker starts now
            }}
          />
        )}

        {/* Spotlight controls reveal timing; perfect circle handled inside */}
        <SpotlightOverlay
          active={spotlightActive}
          flicker={isFlicker}
          onSettled={() => {
            setSpotlightEverSettled(true);
            setAllowFlicker(false);            // lock into steady beam after settling
          }}
          holdOpacity={0.6}
          center={[0.5, 0.5]}
          duration={1.6}
          exitDuration={0.8}
        />

        {/* Keep header visible; hide body while curtains run OR until settle (synchronously guarded) */}
        <Shell
          title={<code className="font-mono tracking-widest text-xl md:text-2xl">{code || "—"}</code>}
          headerRight={<StageBadge stage={stage} seconds={seconds} />}
          headerCenter={<Logo size="sm" onClick={() => window.location.reload()} />}
          bodyHidden={questionStageHidden}
        >
          <StageCenter>
            {settledForRender ? (
              <>
                <QuestionBlock question={question} showOptionsDimmed />
                
              </>
            ) : (
              <Card><div className="opacity-60">Preparing question…</div></Card>
            )}
            <Card className="text-center">
              <div className="text-base md:text-lg text-mist-200">
                Answers: <span className="font-mono tabular-nums">{progress.answered}/{progress.total}</span>
            </div>
          </Card>

          </StageCenter>
        </Shell>
      </TheaterBackground>
    );
  } else if (stage === "reveal") {
    content = (
      <TheaterBackground bgUrl={THEATRE_BG}>
        {/* Curtains hidden on small screens automatically; static open otherwise */}
        {curtainsEnabled && <CurtainOverlay cycleKey={-1} topOffsetPx={0} edgePx={72} />}
        <SpotlightOverlay
          active={spotlightActive}
          flicker={false}
          holdOpacity={0.6}
          center={[0.5, 0.5]}
          duration={1.6}
          exitDuration={0.8}
        />
        <Shell
          title={<code className="font-mono tracking-widest text-xl md:text-2xl">{code || "—"}</code>}
          headerRight={<StageBadge stage={stage} seconds={seconds} label="Reveal ends in" />}
          headerCenter={<Logo size="sm" onClick={() => window.location.reload()} />}
        >
          <StageCenter>
            {question?.type === "track-recognition" ? (
            <FreeTextReveal question={question} />
            ) : (
            <RevealBlock question={question} perOptionCounts={perOptionCounts} />
            )}

          </StageCenter>
        </Shell>
      </TheaterBackground>
    );
  } else if (stage === "result") {
    content = (
      <TheaterBackground bgUrl={THEATRE_BG}>
        {curtainsEnabled && <CurtainOverlay cycleKey={-1} topOffsetPx={0} edgePx={72} />}
        <SpotlightOverlay
          active={spotlightActive}
          flicker={false}
          holdOpacity={0.6}
          center={[0.5, 0.5]}
          duration={1.6}
          exitDuration={0.8}
        />
        <Shell
          title={<code className="font-mono tracking-widest text-xl md:text-2xl">{code || "—"}</code>}
          headerRight={<StageBadge stage={stage} seconds={seconds} label="Next question in" />}
          headerCenter={<Logo size="sm" onClick={() => window.location.reload()} />}
        >
          <StageCenter>
            <LeaderboardBlock leaderboard={leaderboard} compact />
            {typeof nextQuestion === "function" && (
              <div className="mt-2">
                <SecondaryButton onClick={nextQuestion}>Next now</SecondaryButton>
              </div>
            )}
          </StageCenter>
        </Shell>
      </TheaterBackground>
    );
  } else if (stage === "gameover") {
    content = (
      <TheaterBackground bgUrl={THEATRE_BG}>
        {curtainsEnabled && <CurtainOverlay cycleKey={-1} topOffsetPx={0} edgePx={72} />}
        <SpotlightOverlay
          active={spotlightActive}
          flicker={false}
          holdOpacity={0.6}
          center={[0.5, 0.5]}
          duration={1.6}
          exitDuration={0.8}
        />
        <Shell
          title={<code className="font-mono tracking-widest text-xl md:text-2xl">{code || "—"}</code>}
          headerRight={<StageBadge stage={stage} />}
          headerCenter={<Logo size="sm" onClick={() => window.location.reload()} />}
        >
          <StageCenter>
            <LeaderboardBlock leaderboard={leaderboard} />
            <div className="flex flex-wrap items-center justify-center gap-2">
              {/* <PrimaryButton onClick={onPlayAgain}>Play again</PrimaryButton> */}
              <SecondaryButton onClick={toLobby}>Back to lobby</SecondaryButton>
            </div>
          </StageCenter>
        </Shell>
      </TheaterBackground>
    );
  } else {
    // Fallback
    content = (
      <TheaterBackground bgUrl={THEATRE_BG}>
        {curtainsEnabled && <CurtainOverlay cycleKey={-1} topOffsetPx={0} edgePx={72} />}
        <SpotlightOverlay
          active={spotlightActive}
          flicker={false}
          holdOpacity={0.6}
          center={[0.5, 0.5]}
          duration={1.6}
          exitDuration={0.8}
        />
        <Shell
          title={<>{stage || "Hub"}</>}
          headerRight={<StageBadge stage={stage} seconds={seconds} />}
          headerCenter={<Logo size="sm" onClick={() => window.location.reload()} />}
        >
          <StageCenter>
            <Card>Unknown stage.</Card>
          </StageCenter>
        </Shell>
      </TheaterBackground>
    );
  }

  // --- Mount EmoteStream ONCE so it never resets on stage changes ---
  return (
    <div className="relative">
      {content}
      <EmoteStream />
    </div>
  );
}

/* ================== UI Building Blocks ================== */

// import Logo only if you want to hardcode it here; otherwise inject via prop
// import Logo from "../components/ui/Logo.jsx";

function Shell({
  children,
  headerRight,
  wide = false,
  title = <>Hub</>,
  bodyHidden = false,
  headerCenter = null,         
}) {
  return (
    <div className="relative z-10 min-h-dvh text-mist-100 font-sans px-4 sm:px-6 lg:px-8 py-6">
      <div
        className={
          (wide ? "mx-auto max-w-[920px]" : "mx-auto max-w-[900px]") +
          " space-y-4 relative overflow-hidden"
        }
      >
        <header className="relative flex items-center justify-between gap-4">
          <h1 className="tracking-wide text-balance text-2xl md:text-3xl font-semibold">
            {title}
          </h1>

          {/* Center slot (absolute) */}
          {headerCenter && (
            <div className="absolute left-1/2 -translate-x-1/2">
              {headerCenter}
            </div>
          )}

          <div className="shrink-0">{headerRight}</div>
        </header>

        {/* Only the body gets hidden during curtains/settling */}
        <div className={bodyHidden ? "opacity-0 pointer-events-none select-none" : ""}>
          {children}
        </div>
      </div>
    </div>
  );
}


function StageCenter({ children }) {
  return (
    <div className="min-h-[80dvh] grid place-items-center px-2 sm:px-4">
      <div className="w-full max-w-[1200px] mx-auto flex flex-col items-stretch gap-5 md:gap-6">
        {children}
      </div>
    </div>
  );
}

function Landing({ onCreate }) {
  // Where to send players
  const playerUrl =
    (import.meta && import.meta.env && import.meta.env.VITE_PLAYER_URL) ||
    `${window.location.origin.replace(/\/$/, "")}/player`;

  const goToPlayer = () => window.open(playerUrl, "_self");

  const [copied, setCopied] = useState(false);
  const copyJoinLink = async () => {
    try {
      await navigator.clipboard.writeText(playerUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  return (
    <TheaterBackground bgUrl={THEATRE_BG}>
      <div className="relative z-10 min-h-dvh text-mist-100 px-4 sm:px-6 lg:px-8 py-10">
        <div className="mx-auto max-w-[900px] space-y-8">
          {/* Header */}
          <header className="flex items-center justify-between gap-4">
            {/* keep empty or your header content */}
          </header>

        

          {/* Logo above Join */}
          <section className="w-full text-center">
            <Logo size="lg" />
          </section>

          {/* Join first */}
          <section className="w-full max-w-sm mx-auto grid gap-2">
            <SecondaryButton
              onClick={goToPlayer}
              aria-label="Go to player to join a room"
              className="w-full text-lg px-5 py-3"
            >
              Join room
            </SecondaryButton>
          </section>

          {/* Then create */}
          <section className="w-full max-w-sm mx-auto">
            <div className="text-xs uppercase tracking-wide text-mist-400 mt-8 mb-2">
              Or host a new game
            </div>
            <PrimaryButton
              onClick={onCreate}
              aria-label="Create a new room"
              className="w-full text-lg px-5 py-3"
            >
              Create room
            </PrimaryButton>
          </section>
            {/* Description */}
          <section className="grid gap-2 w-full text-center mb-4 mx-auto max-w-md">
            <p className="text-mist-300 max-w-prose text-balance mx-auto">
              Host a music quiz. Friends join from their phones or desktop via the player.
            </p>
          </section>
        </div>
      </div>
    </TheaterBackground>
  );
}

function StageBadge({ stage, seconds, label = "Time left" }) {
  return (
    <span className="text-sm text-mist-300 inline-flex items-center gap-2">
      <span className="hidden sm:inline">Stage:</span>
      <b className="text-mist-100">{stage}</b>
      {Number.isFinite(seconds) && seconds > 0 && (
        <span className="px-2 py-1 rounded-full bg-black/40 ring-1 ring-white/10">
          <span className="opacity-70 mr-1 hidden md:inline">{label}</span>
          <span className="font-mono tabular-nums">{seconds}s</span>
        </span>
      )}
    </span>
  );
}

function Card({ title, children, className = "" }) {
  return (
    <div className={className}>
      {title && (
        <div className="text-xs uppercase tracking-wide text-mist-400 mb-2">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function EmptyNote({ children }) {
  return <div className="text-mist-400">{children}</div>;
}

function PrimaryButton({ children, className = "", ...props }) {
  return (
    <button
      {...props}
      className={[
        "px-3 py-2 rounded-lg",
        "bg-crimson-500 hover:bg-crimson-400 disabled:opacity-40",
        "text-mist-100",
        "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400",
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, className = "", ...props }) {
  return (
    <button
      {...props}
      className={[
        "px-3 py-2 rounded-lg",
        "bg-ink-800/70 hover:bg-ink-700/70",
        "text-mist-100",
        "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400",
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
}



/* ============ Question / Reveal / Leaderboard ============ */

function QuestionBlock({ question, showOptionsDimmed = false }) {
  return (
    <div className="px-1 sm:px-2">
      <div className="font-display text-center leading-tight text-[clamp(1.5rem,4.5vw,3.5rem)] mb-5">
        <span className="bg-gradient-to-r from-gold-400 to-crimson-500 bg-clip-text text-transparent drop-shadow-[0_0_14px_rgba(255,215,0,.25)]">
          {question?.prompt ?? "—"}
        </span>
      </div>

      <ol
        className={[
          "grid gap-3 md:gap-4",
          "grid-cols-1 md:grid-cols-2",
          showOptionsDimmed ? "opacity-70" : "",
        ].join(" ")}
      >
        {(question?.options ?? []).map((opt, i) => (
          <li
            key={i}
            className="rounded-xl px-4 py-3 md:px-5 md:py-4 bg-ink-800/80 ring-1 ring-white/10 shadow-md shadow-black/30"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-8 w-8 md:h-9 md:w-9 shrink-0 items-center justify-center rounded-md bg-ink-700 font-semibold">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="leading-snug text-lg md:text-xl">{opt}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}



function RevealBlock({ question, perOptionCounts }) {
  const correct = question?.correctIndex;
  const total = (perOptionCounts ?? []).reduce((a, b) => a + (b || 0), 0);

  return (
    <div className="px-1 sm:px-2">
      {/* Prompt on bare background */}
      <div className="font-display text-center leading-tight text-[clamp(1.5rem,4.5vw,3.5rem)] mb-5">
        <span className="bg-gradient-to-r from-gold-400 to-crimson-500 bg-clip-text text-transparent drop-shadow-[0_0_14px_rgba(255,215,0,.25)]">
          {question?.prompt ?? "—"}
        </span>
      </div>

      <ol className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        {(question?.options ?? []).map((opt, i) => {
          const count = perOptionCounts?.[i] ?? 0;
          const pct = total ? Math.round((100 * count) / total) : 0;
          const isCorrect = i === correct;

          return (
            <li
              key={i}
              className={[
                "rounded-xl px-4 py-3 md:px-5 md:py-4 ring-1 shadow-md",
                isCorrect
                  ? "bg-emerald-800/40 ring-emerald-500/50 shadow-emerald-900/30"
                  : "bg-ink-800/80 ring-white/10 shadow-black/30",
              ].join(" ")}
            >
              <div className="font-medium text-lg md:text-xl">
                {String.fromCharCode(65 + i)}. {opt}
              </div>

              <div className="mt-3 h-2 rounded bg-ink-700/70 overflow-hidden">
                <div
                  className={
                    "h-full transition-[width] duration-700 " +
                    (isCorrect ? "bg-emerald-500" : "bg-crimson-500")
                  }
                  style={{ width: pct + "%" }}
                />
              </div>

              <div className="text-xs text-mist-300 mt-1">
                {count} picks{total ? ` (${pct}%)` : ""}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}


function FreeTextReveal({ question }) {
  const meta = question?.trackMeta || {};
  const title =
    meta.title || meta.name || "Unknown title";
  const artistName =
    meta.artist ||
    (Array.isArray(meta.artists) ? meta.artists.filter(Boolean).join(", ") : "") ||
    "";

  return (
    <div className="px-1 sm:px-2 text-center">
      {/* Title (bigger) */}
      <div className="font-display leading-tight text-[clamp(1.8rem,5.5vw,3.4rem)]">
        <span className="bg-gradient-to-r from-gold-400 to-crimson-500 bg-clip-text text-transparent drop-shadow-[0_0_14px_rgba(255,215,0,.25)]">
          {title}
        </span>
      </div>

      {/* Artist (smaller) */}
      {artistName ? (
        <div className="mt-1 font-display leading-tight text-[clamp(1rem,3.5vw,2rem)] text-mist-200">
          {artistName}
        </div>
      ) : null}

      <div className="mt-2 text-mist-300">
        Players who typed the exact title get a point.
      </div>
    </div>
  );
}



function LeaderboardBlock({ leaderboard, compact = false }) {
  const wrap = compact
    ? "w-full max-w-[560px] mx-auto rounded-xl bg-ink-800/70"
    : "w-full rounded-xl bg-ink-800/70";

  return (
    <Card>
      <div
        className={
          compact
            ? "text-center font-display text-2xl md:text-3xl mb-3"
            : "text-xs uppercase tracking-wide text-mist-400 mb-2"
        }
      >
        Scores
      </div>

      <div className={wrap}>
        {leaderboard.length === 0 && (
          <div className="p-4 text-mist-400 text-center">No scores yet…</div>
        )}
        {leaderboard.map((p, idx) => (
          <div
            key={p.id}
            className={
              (compact ? "p-2" : "p-3") +
              " flex items-center justify-between border-b border-ink-700/60 last:border-b-0"
            }
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-6 text-right opacity-70">{idx + 1}.</span>
              <span
                className={
                  "font-semibold truncate " +
                  (compact ? "max-w-[12ch]" : "max-w-[18ch] md:max-w-none")
                }
                title={p.name}
              >
                {p.name}
              </span>
            </div>
            <span
              className={
                "inline-flex items-center justify-center rounded " +
                "bg-ink-700/70 font-mono tabular-nums " +
                (compact ? "text-sm min-w-[3.25rem] px-2 py-0.5" : "min-w-[3.75rem] px-3 py-1")
              }
              title={`${p.score}`}
            >
              {p.score}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
/* === Shared small component === */
const LOGO_SRC = "/images/mixmatch-logo.png";

function Logo({ size = "lg", onClick }) {
  const w = size === "lg" ? "w-74 md:w-90" : "w-24 md:w-28";
  return (
    <img
      src={LOGO_SRC}
      alt="MixMatch"
      onClick={onClick}
      className={`${w} mx-auto select-none ${onClick ? "cursor-pointer" : ""}`}
      draggable={false}
    />
  );
}

/* ============ Player list ============ */

function PlayerGrid({ players, hostId }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
      {players.map((p) => (
        <li
          key={p.id}
          className="rounded-lg bg-ink-800/80 px-3 py-2 flex items-center justify-between"
        >
          <span className="truncate max-w-[20ch] md:max-w-none">
            {p.name}
            {p.id === hostId ? " (host)" : ""}
          </span>
          <span className="text-mist-300 font-mono tabular-nums">{p.score ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Hub />} />
        <Route path="/callback" element={<SpotifyCallback />} />
      </Routes>
    </BrowserRouter>
  );
}
