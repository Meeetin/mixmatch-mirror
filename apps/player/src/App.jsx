import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { makeGameStore } from "../../../packages/shared/gameStore.js";
import EmoteDrawer, { EmoteOpener } from "./components/EmoteDrawer.jsx";

const useGame = makeGameStore(import.meta.env.VITE_SERVER_URL);

// Match Hub animation delay (curtain + flicker)
const QUESTION_WAIT_MS = 1600;

export default function Player() {
  const {
    code, stage, question, seconds, players,
    joinRoom, submitAnswer, joinError, submitTextAnswer,
    selfId, firstPlayerId,
    advance, playAgain, toLobby,
    getConfig,
  } = useGame();

  const [room, setRoom] = useState("");
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  // Free-text answer state
  const [guess, setGuess] = useState("");
  const [submittedGuess, setSubmittedGuess] = useState(false);

  // Reset when a new question arrives
  useEffect(() => {
    setGuess("");
    setSubmittedGuess(false);
  }, [question?.id]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const prefCode = params.get("code");
      const prefName = params.get("name");
      if (prefCode) setRoom(prefCode.toUpperCase());
      if (prefName) setName(prefName);
    } catch {}
  }, []);

  const [emoteOpen, setEmoteOpen] = useState(false);

  // Fallback: if firstPlayerId not set yet, treat the first listed player as first
  const computedFirst = firstPlayerId || (players?.length ? players[0]?.id : null);
  const isFirst = selfId && computedFirst && selfId === computedFirst;

  /* ---------- Question visibility ---------- */
  const prevStageRef = useRef(stage);
  const gateRef = useRef(false);
  const gateTimerRef = useRef(null);
  const [, forceTick] = useState(0);

  const questionKey = useMemo(
    () => (question?.id != null ? `q:${question.id}` : `stage:${stage}`),
    [question?.id, stage]
  );

  const justEnteredQuestion =
    stage === "question" && prevStageRef.current !== "question";

  if (justEnteredQuestion) {
    gateRef.current = true;
  }

  useEffect(() => {
    clearTimeout(gateTimerRef.current);

    if (stage === "question") {
      gateTimerRef.current = setTimeout(() => {
        gateRef.current = false;
        forceTick((n) => n + 1);
      }, QUESTION_WAIT_MS);
    } else {
      gateRef.current = false;
    }

    prevStageRef.current = stage;
    return () => clearTimeout(gateTimerRef.current);
  }, [stage, questionKey]);

  /* ---------- Start from Player: reuse playAgain path (Hub reseeds via Spotify) NEEDS TO BE FIXED---------- */
  const hasPick = !!(getConfig()?.selectedPlaylistIDs?.length);
  const canStart = stage === "lobby" && hasPick;

  const onStartFromPlayer = useCallback(() => {
    playAgain((res) => {
      if (!res?.ok) console.warn("[Player] playAgain(start) failed:", res);
    });
  }, [playAgain]);

  const [picked, setPicked] = useState(null);
  useEffect(() => {
    if (stage !== "question") setPicked(null);
  }, [stage, questionKey]);

  /* ========================= Stage router ========================= */
  /* ========================= Stage router ========================= */
// Host-only continue flag
const showContinue = isFirst && (stage === "reveal" || stage === "result");

const renderMain = () => {
  // --- Join screen ---
  if (!code) {
    const onSubmit = (e) => {
      e.preventDefault();
      const c = room.trim().toUpperCase();
      const n = (name || "").trim() || "Player";
      if (!c) return;
      setJoining(true);
      joinRoom(c, n, () => setJoining(false));
    };

    return (
      <Screen>
        <div className="mb-6">
          <Logo size="lg" />
        </div>
        <Card className="w-full max-w-sm mx-auto">
          <h1 className="text-2xl font-semibold mb-3 font-display">Join game</h1>
          <form onSubmit={onSubmit} className="space-y-3">
            <Input
              placeholder="ROOM CODE"
              value={room}
              onChange={(e) => setRoom(e.target.value.toUpperCase())}
            />
            <Input
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {joinError && (
              <div className="text-sm text-crimson-400/90">
                {friendlyJoinError(joinError)}
              </div>
            )}
            <PrimaryButton disabled={joining || !room.trim()} className="w-full">
              {joining ? "Joining…" : "Join"}
            </PrimaryButton>
          </form>
        </Card>
      </Screen>
    );
  }

  // --- Lobby ---
  if (stage === "lobby") {
    return (
      <Screen>
        <Header
          title={
            <span className="inline-flex items-baseline gap-2">
              <span className="uppercase text-xs tracking-widest text-mist-300">Room</span>
              <code className="font-mono tracking-widest text-2xl">{code}</code>
            </span>
          }
          right={<StageBadge stage={stage} />}
        />
        <div className="grid gap-3 mt-3">
          <Card title={`Players (${players.length})`}>
            <PlayerList players={players} hostId={computedFirst} />
            {players.length === 0 && <Muted>No players yet…</Muted>}
          </Card>

          {/* Start-from-player UI (optional)
          {isFirst ? (
            <PrimaryButton
              onClick={onStartFromPlayer}
              disabled={!(stage === "lobby" && !!getConfig()?.selectedPlaylistIDs?.length)}
              className="w-full py-3 text-lg"
            >
              Start game
            </PrimaryButton>
          ) : (
            <Muted className="text-center">Waiting for the first player…</Muted>
          )} */}
        </div>
      </Screen>
    );
  }

  // --- Game over ---
  if (stage === "gameover") {
    return (
      <Screen>
        <Header
          title={<code className="font-mono tracking-widest text-xl">{code}</code>}
          right={<StageBadge stage={stage} />}
        />
        <Card title="Scores">
          <Leaderboard leaderboardHint="Final" />
        </Card>
        <div className="flex gap-2">
          {isFirst ? (
            <>
              {/* <PrimaryButton onClick={onStartFromPlayer} className="flex-1">
                Play again
              </PrimaryButton> */}
              <SecondaryButton onClick={toLobby} className="flex-1">
                Back to lobby
              </SecondaryButton>
            </>
          ) : (
            <Muted className="text-center w-full">Waiting for next steps…</Muted>
          )}
        </div>
      </Screen>
    );
  }

  // --- In-game (question / reveal / result) ---
  const opts = question?.options ?? [];
  const isText = question?.type === "track-recognition";
  const canAnswer = stage === "question";
  const hide = stage === "question" && gateRef.current;

  if (stage === "question") {
    return (
      <Screen>
        <Header
          title={<code className="font-mono tracking-widest text-xl">{code}</code>}
          right={<StageBadge stage={stage} seconds={seconds} />}
        />
        <Card title="Question">
          {hide ? (
            <div className="text-sm text-mist-300 text-center">Preparing question…</div>
          ) : (
            <>
              <div className="font-display text-lg leading-snug text-center text-balance mb-3">
                {question?.prompt ?? "—"}
              </div>

              {isText ? (
                <div className="flex items-stretch gap-2">
                  <input
                    type="text"
                    value={guess}
                    onChange={(e) => setGuess(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (!submittedGuess && canAnswer && guess.trim()) {
                          submitTextAnswer(guess);
                          setSubmittedGuess(true);
                        }
                      }
                    }}
                    disabled={!canAnswer || submittedGuess}
                    placeholder="Type the song title…"
                    className="flex-1 rounded-lg bg-ink-800/80 px-3 py-3 outline-none disabled:opacity-50"
                  />
                  <button
                    onClick={() => {
                      if (!submittedGuess && canAnswer && guess.trim()) {
                        submitTextAnswer(guess);
                        setSubmittedGuess(true);
                      }
                    }}
                    disabled={!canAnswer || submittedGuess || !guess.trim()}
                    className="rounded-lg px-4 py-3 bg-gold-500 font-medium hover:bg-gold-400 disabled:opacity-50"
                  >
                    Submit
                  </button>
                </div>
              ) : (
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                  {opts.map((opt, i) => {
                    const disabled = !canAnswer || picked != null;
                    const pickedThis = picked === i;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          if (disabled) return;
                          setPicked(i);
                          submitAnswer(i);
                        }}
                        disabled={disabled}
                        className={[
                          "rounded-lg px-3 py-3 text-left",
                          "bg-ink-800/80 hover:bg-ink-700/80 disabled:opacity-50",
                          pickedThis ? "outline outline-2 outline-gold-400" : "",
                        ].join(" ")}
                      >
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-ink-700 font-medium">
                            {String.fromCharCode(65 + i)}
                          </span>
                          <span className="leading-snug break-words">{opt}</span>
                        </div>
                      </button>
                    );
                  })}
                  {opts.length === 0 && <Muted>Waiting for the host…</Muted>}
                </div>
              )}
            </>
          )}
        </Card>

        {code && (
          <>
            <EmoteOpener onOpen={() => setEmoteOpen(true)} />
            <EmoteDrawer code={code} open={emoteOpen} onClose={() => setEmoteOpen(false)} />
          </>
        )}
      </Screen>
    );
  }

  if (stage === "reveal") {
    const isMCQ = question?.correctIndex != null && !isText;
    return (
      <Screen>
        <Header
          title={<code className="font-mono tracking-widest text-xl">{code}</code>}
          right={<StageBadge stage={stage} seconds={seconds} />}
        />
        {isMCQ ? (
          <Card title="Correct answer">
            <RevealBars question={question} />
          </Card>
        ) : (
          (() => {
            const targetTitle = question?.trackMeta?.title || "";
            const targetArtist = question?.trackMeta?.artist || "";
            const answered = !!(submittedGuess || (guess && guess.trim()));
            const correct = answered && isCloseEnough(guess || "", targetTitle || "");
            return (
              <Card title={correct ? "Correct!" : answered ? "Incorrect!" : "Time's up"}>
                <div className="text-center space-y-2">
                  {answered ? (
                    <div className="text-mist-400">
                      Your answer: <span className="font-medium text-mist-200">{guess || "—"}</span>
                    </div>
                  ) : (
                    <div className="text-mist-400">You didn’t answer.</div>
                  )}
                  <div className="font-display text-xl">
                    Correct: <span className="font-semibold">{targetTitle || "—"}</span>
                    {targetArtist ? <span className="text-mist-300"> — {targetArtist}</span> : null}
                  </div>
                  {correct ? (
                    <div className="inline-block mt-1 rounded-md bg-emerald-700/30 px-3 py-1 text-emerald-300 text-sm">
                      +1 point
                    </div>
                  ) : answered ? (
                    <div className="inline-block mt-1 rounded-md bg-crimson-700/30 px-3 py-1 text-rose-300 text-sm">
                      Close, but not correct
                    </div>
                  ) : null}
                </div>
              </Card>
            );
          })()
        )}
        {showContinue && (
          <PrimaryButton onClick={advance} className="w-full mt-2">Continue</PrimaryButton>
        )}
        {code && (
          <>
            <EmoteOpener onOpen={() => setEmoteOpen(true)} />
            <EmoteDrawer code={code} open={emoteOpen} onClose={() => setEmoteOpen(false)} />
          </>
        )}
      </Screen>
    );
  }

  if (stage === "result") {
    return (
      <Screen>
        <Header
          title={<code className="font-mono tracking-widest text-xl">{code}</code>}
          right={<StageBadge stage={stage} seconds={seconds} />}
        />
        <Card title="Scores">
          <Leaderboard />
        </Card>
        {showContinue && (
          <PrimaryButton onClick={advance} className="w-full mt-2">Continue</PrimaryButton>
        )}
        {code && (
          <>
            <EmoteOpener onOpen={() => setEmoteOpen(true)} />
            <EmoteDrawer code={code} open={emoteOpen} onClose={() => setEmoteOpen(false)} />
          </>
        )}
      </Screen>
    );
  }

  // Fallback
  return (
    <Screen>
      <Header
        title={<code className="font-mono tracking-widest text-xl">{code || "—"}</code>}
        right={<StageBadge stage={stage} seconds={seconds} />}
      />
      <Card>Unknown stage.</Card>
    </Screen>
  );
};


  //const showContinue = isFirst && (stage === "reveal" || stage === "result");

  return (
    <>
      {renderMain()}
      {/* {showContinue && (
        <PrimaryButton onClick={advance} className="w-full mt-2">Continue</PrimaryButton>
      )} */}
    </>
  );
}

/* ==================== UI bits ==================== */

function Screen({ children }) {
  return (
    <div className="min-h-dvh bg-ink-950 text-mist-100 px-4 sm:px-6 py-5 font-sans">
      <div className="mx-auto w-full max-w-[780px] grid gap-3">{children}</div>
    </div>
  );
}

function Header({ title, right }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <h1 className="text-2xl md:text-3xl font-semibold">{title}</h1>
      <div className="absolute left-1/2 -translate-x-1/2">
        <Logo size="sm" onClick={() => window.location.reload()} />
      </div>
      <div className="shrink-0">{right}</div>
    </header>
  );
}

function StageBadge({ stage, seconds }) {
  return (
    <span className="text-sm text-mist-300 inline-flex items-center gap-2">
      <span className="hidden sm:inline">Stage:</span>
      <b className="text-mist-100">{stage}</b>
      {Number.isFinite(seconds) && seconds > 0 && (
        <span className="px-2 py-1 rounded-full bg-black/40 ring-1 ring-white/10">
          <span className="font-mono tabular-nums">{seconds}s</span>
        </span>
      )}
    </span>
  );
}

function Card({ title, children, className = "" }) {
  return (
    <section className={["rounded-xl bg-ink-900/70 p-4", className].join(" ")}>
      {title && (
        <div className="text-xs uppercase tracking-wide text-mist-400 mb-2">{title}</div>
      )}
      {children}
    </section>
  );
}

function Input(props) {
  return (
    <input
      {...props}
      className="w-full rounded-lg bg-ink-800/80 px-3 py-2 placeholder:text-mist-300/70"
    />
  );
}

function PrimaryButton({ className = "", ...props }) {
  return (
    <button
      {...props}
      className={[
        "px-3 py-2 rounded-lg",
        "bg-gold-500 hover:bg-crimson-400 disabled:opacity-40",
        "text-mist-100 transition-colors",
        className,
      ].join(" ")}
    />
  );
}

function SecondaryButton({ className = "", ...props }) {
  return (
    <button
      {...props}
      className={[
        "px-3 py-2 rounded-lg",
        "bg-ink-800/70 hover:bg-ink-700/70",
        "text-mist-100 transition-colors",
        className,
      ].join(" ")}
    />
  );
}

function Muted({ children, className = "" }) {
  return <div className={["text-mist-400", className].join(" ")}>{children}</div>;
}

function PlayerList({ players, hostId }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {players.map((p) => (
        <li
          key={p.id}
          className="rounded-lg bg-ink-800/80 px-3 py-2 flex items-center justify-between"
        >
          <span className="truncate max-w-[18ch]" title={p.name}>
            {p.name}{p.id === hostId ? " (first)" : ""}
          </span>
          <span className="text-mist-300 font-mono tabular-nums">{p.score ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}

function RevealBars({ question }) {
  const correct = question?.correctIndex;
  const counts = question?.perOptionCounts ?? [];
  const total = counts.reduce((a, b) => a + (b || 0), 0);

  return (
    <ol className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {(question?.options ?? []).map((opt, i) => {
        const count = counts[i] ?? 0;
        const pct = total ? Math.round((100 * count) / total) : 0;
        const isCorrect = i === correct;
        return (
          <li
            key={i}
            className={[
              "rounded-lg px-3 py-2",
              isCorrect
                ? "bg-emerald-700/40 outline outline-2 outline-emerald-500/70"
                : "bg-ink-800/70",
            ].join(" ")}
          >
            <div className="font-medium">
              {String.fromCharCode(65 + i)}. {opt}
            </div>
            <div className="mt-2 h-1.5 rounded bg-ink-700/70 overflow-hidden">
              <div
                className={["h-full", isCorrect ? "bg-emerald-500" : "bg-crimson-500"].join(" ")}
                style={{ width: pct + "%" }}
              />
            </div>
            <div className="text-xs text-mist-400 mt-1">
              {count} picks{total ? ` (${pct}%)` : ""}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Leaderboard({ leaderboardHint = "" }) {
  const { players = [] } = useGame();
  const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  return (
    <div className="w-full rounded-xl bg-ink-800/70">
      {sorted.length === 0 && (
        <div className="p-4 text-mist-400 text-center">No scores yet…</div>
      )}
      {sorted.map((p, idx) => (
        <div
          key={p.id}
          className="p-3 flex items-center justify-between border-b border-ink-700/60 last:border-b-0"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-6 text-right opacity-70">{idx + 1}.</span>
            <span className="font-semibold truncate max-w-[18ch]" title={p.name}>
              {p.name}
            </span>
          </div>
          <span
            className="inline-flex items-center justify-center rounded bg-ink-700/70 font-mono tabular-nums min-w-[3.75rem] px-3 py-1"
            title={`${p.score ?? 0}`}
          >
            {p.score ?? 0}
          </span>
        </div>
      ))}
    </div>
  );
}

const LOGO_SRC = "/images/mixmatch-logo.png";

function Logo({ size = "lg", onClick }) {
  const w = size === "lg" ? "w-40 md:w-56" : "w-24 md:w-28";
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

/* ==================== Helpers ==================== */

function friendlyJoinError(code) {
  switch (code) {
    case "ROOM_LOCKED": return "The game already started. Try again for the next round.";
    case "NO_SUCH_ROOM": return "No room with that code. Double-check it.";
    case "SERVER_ERROR": return "Server error. Please try again.";
    default: return "Couldn’t join. Please try again.";
  }
}

function stripDiacritics(s) {
  try { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  catch { return String(s || ""); }
}

function normalizeTitle(s) {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\b(feat|featuring|ft)\.?\s+[a-z0-9\s]+$/i, "")
    .replace(/\b(remaster(?:ed)?|version|edit|mix|radio|mono|stereo)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j); //Pure function: no external state is read/modified, arguments are never mutated
  for (let i = 1; i <= m; i++) {
    const ai = a.charCodeAt(i - 1);
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

function isCloseEnough(guessRaw, targetRaw, { maxEditFrac = 0.2, minJaccard = 0.6 } = {}) {
  const guess = normalizeTitle(guessRaw);
  const target = normalizeTitle(targetRaw);
  if (!guess || !target) return false;
  if (guess === target) return true;

  const d = levenshtein(guess, target);
  const allowed = Math.max(1, Math.floor(Math.max(guess.length, target.length) * maxEditFrac));
  if (d <= allowed) return true;

  const gs = new Set(guess.split(" ").filter(Boolean));
  const ts = new Set(target.split(" ").filter(Boolean));
  let inter = 0; for (const t of gs) if (ts.has(t)) inter++; //mutation is confined
  const union = gs.size + ts.size - inter;
  const jacc = union ? inter / union : 0;
  return jacc >= minJaccard;
}
