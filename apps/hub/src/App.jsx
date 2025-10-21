import { BrowserRouter, Routes, Route, Link } from "react-router-dom"; // Router
import SpotifyCallback from "./SpotifyCallback";                  // Handles token exchange
import { useEffect, useRef, useState, useCallback } from "react";
import { makeTrackList } from "./spotify/mediaEngine";
import { redirectToAuth, hasSpotifyToken } from "./spotify/spotifyAuth.js";
import { attachPlaybackController } from "./spotify/spotifyClient.js"; // pruned to what's used
import dictPlaylistID from "../../../packages/shared/PlayListIDs.js";
import { useGameStore } from "./store";
import { getSocket } from "../../../packages/shared/socket.js";

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
    seedTracks, setTrackList,
  } = useGame();

  /* ---------------- Audio  ---------------- */
  const audioRef = useRef(null);
  const [autoplayReady, setAutoplayReady] = useState(false);

  useEffect(() => {
    const unsub = attachPlaybackController(useGame);
    return unsub;
  }, []);
    const goHomeHard = useCallback(() => {
    window.location.assign("/");
    }, []);
  // Create room, but bounce to Spotify auth if needed
  const onCreate = useCallback(() => {
    if (!hasSpotifyToken()) {
      localStorage.setItem("pending_action", "createRoom");
      redirectToAuth();
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
  }, [getConfig, seedTracks, startGame]);

  const onPlayAgain = useCallback(async () => {
    const cfg = getConfig();
    const keyOrId = cfg?.selectedPlaylistIDs?.[0];
    const mapped = (dictPlaylistID && dictPlaylistID[keyOrId]) || keyOrId || "";
    const playlistId = (String(mapped).match(/[A-Za-z0-9]{22}/) || [])[0];
    const numTracks = Math.max(1, Number(cfg?.maxQuestions || 10));

    const tracks = await makeTrackList(playlistId, numTracks);
    seedTracks(tracks, { playlistId, numTracks });
    startGame();
  }, [getConfig, seedTracks, startGame]);

  useEffect(() => {
    const s = getSocket();

    async function onRequestReseed({ source }) {
      try {
        const tracks = await makeTrackList(source.playlistId, source.numTracks);
        useGame.getState().playAgain(tracks, {
          playlistId: source.playlistId,
          numTracks: source.numTracks,
        });
        setTrackList(tracks);
      } catch (e) {
        console.error("[Hub] requestReseed failed:", e);
      }
    }

    s.on("server:requestReseed", onRequestReseed);
    return () => s.off("server:requestReseed", onRequestReseed);
  }, [setTrackList]);

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

  const [curtainKey, setCurtainKey] = useState(0);
  const [curtainRunning, setCurtainRunning] = useState(false);
  const [allowFlicker, setAllowFlicker] = useState(false);

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

  const lastStageRef = useRef(stage);
  const justEnteredQuestion =
    lastStageRef.current !== "question" && stage === "question";
  useEffect(() => {
    lastStageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    if (stage === "idle") {
      setSpotlightActive(false);
      setSpotlightEverSettled(false);
      setAllowFlicker(false);
      setCurtainRunning(false);
      return;
    }

    if (stage === "lobby") {
      setSpotlightActive(false);
      setAllowFlicker(false);
      setCurtainRunning(false);
      return;
    }

    if (stage === "question") {
      setSpotlightActive(true);
      setSpotlightEverSettled(false);

      if (curtainsEnabled) {
        setAllowFlicker(false);
        setCurtainRunning(true);
        setCurtainKey((k) => k + 1);
      } else {
        setCurtainRunning(false);
        setAllowFlicker(true);
      }
      return;
    }

    if (stage === "reveal" || stage === "result" || stage === "gameover") {
      setSpotlightActive(true);
      setAllowFlicker(false);
      return;
    }
  }, [stage, question?.id, curtainsEnabled]);

  const isFlicker = stage === "question" && !spotlightEverSettled && allowFlicker;

  const settledForRender = !justEnteredQuestion && spotlightEverSettled;
  const questionStageHidden =
    stage === "question" && (curtainRunning || !settledForRender);

  /* ---------------- Stage router ---------------- */
  const renderMain = (s) => {
    if (s === "idle") {
      return <Landing onCreate={onCreate} />;
    }

    if (s === "lobby") {
      const hasPick = !!(getConfig()?.selectedPlaylistIDs?.length);
      return (
        <TheaterBackground bgUrl={THEATRE_BG}>
          <Shell
            wide
            title={
              <span className="inline-flex items-baseline gap-2">
                <span className="uppercase text-xs tracking-widest text-mist-400">Room Code</span>
                <code className="font-mono tracking-widest text-3xl md:text-4xl">{code || "—"}</code>
              </span>
            }
            headerRight={<StageBadge stage={s} />}
            headerCenter={<Logo size="sm" onClick={goHomeHard} />}
          >
            <div className="flex flex-col min-h-[70dvh]">
              <div className="grow">
                <div className="mx-auto w-full max-w-[900px] grid gap-2 items-start grid-cols-1 md:grid-cols-2">
                  <Card title={`Players (${players.length})`}>
                    <PlayerGrid players={players} hostId={hostId} />
                    {players.length === 0 && <EmptyNote>No players yet…</EmptyNote>}
                  </Card>
                  <Card title="Game settings">
                    <div className="space-y-4 w-full">
                      <LobbySettings />
                    </div>
                  </Card>
                </div>
              </div>

              <div className="mt-4">
                <div className="w-full flex justify-center">
                  <PrimaryButton
                    onClick={onStart}
                    disabled={!(code && players.length >= 1 && getConfig()?.selectedPlaylistIDs?.length)}
                    className="text-2xl md:text-3xl px-8 md:px-10 py-4 md:py-5 rounded-3xl shadow-xl shadow-black/30"
                  >
                    Start game
                  </PrimaryButton>
                </div>

                <div className="w-full mt-2">
                  <GameHistory />
                </div>
              </div>
            </div>
          </Shell>
        </TheaterBackground>
      );
    }

    if (s === "question") {
      const shouldAnimateCurtains = curtainRunning;
      const curtainCycleKey = shouldAnimateCurtains ? curtainKey : -1;

      return (
        <TheaterBackground bgUrl={THEATRE_BG}>
          {curtainsEnabled && (
            <CurtainOverlay
              cycleKey={curtainCycleKey}
              topOffsetPx={0}
              edgePx={72}
              onCycleStart={() => setCurtainRunning(true)}
              onCycleEnd={() => {
                setCurtainRunning(false);
                setAllowFlicker(true);
              }}
            />
          )}

          <SpotlightOverlay
            active={spotlightActive}
            flicker={isFlicker}
            onSettled={() => {
              setSpotlightEverSettled(true);
              setAllowFlicker(false);
            }}
            holdOpacity={0.6}
            center={[0.5, 0.5]}
            duration={1.6}
            exitDuration={0.8}
          />

          <Shell
            title={<code className="font-mono tracking-widest text-xl md:text-2xl">{code || "—"}</code>}
            headerRight={<StageBadge stage={s} seconds={seconds} />}
            headerCenter={<Logo size="sm" onClick={goHomeHard} />}
            bodyHidden={questionStageHidden}
          >
            <StageCenter>
              {settledForRender ? (
                <>
                  <QuestionBlock question={question} showOptionsDimmed />
                </>
              ) : (
                <Card>
                  <div className="opacity-60">Preparing question…</div>
                </Card>
              )}
              <Card className="text-center">
                <div className="text-base md:text-lg text-mist-200">
                  Answers:{" "}
                  <span className="font-mono tabular-nums">
                    {progress.answered}/{progress.total}
                  </span>
                </div>
              </Card>
            </StageCenter>
          </Shell>
        </TheaterBackground>
      );
    }

    if (s === "reveal") {
      return (
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
            headerRight={<StageBadge stage={s} seconds={seconds} label="Reveal ends in" />}
            headerCenter={<Logo size="sm" onClick={goHomeHard} />}
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
    }

    if (s === "result") {
      return (
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
            headerRight={<StageBadge stage={s} seconds={seconds} label="Next question in" />}
            headerCenter={<Logo size="sm" onClick={goHomeHard} />}
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
    }

    if (s === "gameover") {
      return (
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
            headerRight={<StageBadge stage={s} />}
            headerCenter={<Logo size="sm" onClick={goHomeHard} />}
          >
            <StageCenter>
              <LeaderboardBlock leaderboard={leaderboard} />
              <div className="flex flex-wrap items-center justify-center gap-2">
                <SecondaryButton onClick={toLobby}>Back to lobby</SecondaryButton>
              </div>
            </StageCenter>
          </Shell>
        </TheaterBackground>
      );
    }

    return (
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
          title={<>{s || "Hub"}</>}
          headerRight={<StageBadge stage={s} seconds={seconds} />}
          headerCenter={<Logo size="sm" onClick={goHomeHard} />}
        >
          <StageCenter>
            <Card>Unknown stage.</Card>
          </StageCenter>
        </Shell>
      </TheaterBackground>
    );
  };

  return (
    <div className="relative">
      {renderMain(stage)}
      <EmoteStream />
    </div>
  );
}

/* ================== UI Building Blocks ================== */

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

          {headerCenter && (
            <div className="absolute left-1/2 -translate-x-1/2">{headerCenter}</div>
          )}

          <div className="shrink-0">{headerRight}</div>
        </header>

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
  // Where to send players (localhost or deployed URL temporarily hardcoded here)
  const playerUrl = "http://localhost:5174/";
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
          <header className="flex items-center justify-between gap-4"></header>

          <section className="w-full text-center">
            <Logo size="lg" />
          </section>

          <section className="w-full max-w-sm mx-auto grid gap-2">
            <SecondaryButton
              onClick={goToPlayer}
              aria-label="Go to player to join a room"
              className="w-full text-lg px-5 py-3"
            >
              Join room
            </SecondaryButton>
          </section>

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

          <section className="grid gap-2 w-full text-center mb-4 mx-auto max-w-md">
            <p className="text-mist-300 max-w-prose text-balance mx-auto">
              Host a music quiz. Friends join from their phones or desktop via the player.
              <b> Spotify account and app required for host.</b>
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
                    (isCorrect ? "bg-emerald-500" : "bg-crimson-700")
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
      <div className="font-display leading-tight text-[clamp(1.8rem,5.5vw,3.4rem)]">
        <span className="bg-gradient-to-r from-gold-400 to-crimson-500 bg-clip-text text-transparent drop-shadow-[0_0_14px_rgba(255,215,0,.25)]">
          {title}
        </span>
      </div>

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
