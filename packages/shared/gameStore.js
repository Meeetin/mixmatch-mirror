import { create } from "zustand";
import { getSocket } from "./socket.js";

export const makeGameStore = (serverUrl) => {
  const s = getSocket(serverUrl);

  return create((set, get) => {
    // ---------- state ----------
    const init = {
      code: "",
      players: [],
      hostId: "",
      firstPlayerId: null,     // first player can Start/Continue
      selfId: s.connected ? s.id : null, // set immediately if already connected
      stage: "idle",           // idle | lobby | question | reveal | result | gameover | locked (player-only)
      question: null,          // { id, prompt, options[], correctIndex? }
      seconds: 0,
      deadline: null,
      revealUntil: null,
      resultUntil: null,
      progress: { answered: 0, total: 0 },
      perOptionCounts: [],
      leaderboard: [],
      media: null,             // { audioUrl } (hub-only)
      joinError: null,         // e.g., ROOM_LOCKED, NO_SUCH_ROOM
      lstTracks: [],

      // -------- Simple Game Settings (from server) --------
      config: { maxQuestions: 10, defaultDurationMs: 20000, selectedPlaylistIDs: [] },
    };

    const secondsFrom = (ts, fallback = 0) =>
      ts ? Math.max(0, Math.ceil((ts - Date.now()) / 1000)) : fallback;

    // ---------- socket events ----------
    s.on("connect", () => set({ selfId: s.id }));

    s.on("room:update", ({ code, players, hostId, firstPlayerId, config }) =>
      set((st) => ({
        code,
        players,
        hostId,
        firstPlayerId: firstPlayerId ?? st.firstPlayerId,
        config: { ...(st.config || init.config), ...(config || {}) },
        stage: code ? (st.stage === "idle" ? "lobby" : st.stage) : "idle",
      }))
    );

    s.on("room:closed", () =>
      set({ ...init, selfId: s.connected ? s.id : null })
    );

    s.on("game:lobby", () => {
      set({
        stage: "lobby",
        question: null,
        seconds: 0,
        revealUntil: null,
        resultUntil: null,
        perOptionCounts: [],
        leaderboard: [],
        media: null,
      });
    });

    s.on("question:new", (q) => {
      const seconds = Math.round((q.durationMs || 0) / 1000);
      set({
        stage: "question",
        question: q,
        seconds,
        deadline: q.deadline ?? (q.durationMs ? Date.now() + q.durationMs : null),
        revealUntil: null,
        resultUntil: null,
        perOptionCounts: [],
        leaderboard: [],
        progress: { answered: 0, total: get().players.length || 0 },
        media: null,
      });
    });

    s.on("question:next", (q) => {
      const seconds = Math.round((q.durationMs || 0) / 1000);
      set({
        stage: "question",
        question: q,
        seconds,
        deadline: q.deadline ?? (q.durationMs ? Date.now() + q.durationMs : null),
        revealUntil: null,
        resultUntil: null,
        perOptionCounts: [],
        leaderboard: [],
        progress: { answered: 0, total: get().players.length || 0 },
        media: null,
      });
    });

    s.on("question:tick", ({ seconds }) => set({ seconds }));
    s.on("progress:update", ({ answered, total }) =>
      set({ progress: { answered, total } })
    );
    s.on("question:hubMedia", (media) => set({ media }));

    s.on("question:reveal", ({ correctIndex, perOptionCounts = [], revealUntil }) =>
      set((st) => ({
        stage: "reveal",
        question: st.question ? { ...st.question, correctIndex } : st.question,
        perOptionCounts,
        revealUntil: revealUntil ?? null,
        seconds: secondsFrom(revealUntil, st.seconds),
      }))
    );

    s.on("question:result", ({ leaderboard = [], resultUntil }) =>
      set((st) => ({
        stage: "result",
        leaderboard,
        resultUntil: resultUntil ?? null,
        seconds: secondsFrom(resultUntil, st.seconds),
      }))
    );

    s.on("game:end", ({ leaderboard = [] }) =>
      set({ stage: "gameover", leaderboard })
    );

    // ---------- actions ----------
    return {
      ...init,

      // HOST: create a room
      createRoom: () => s.emit("host:createRoom"),
      // in actions return {...}, add:
      seedTracks: (tracks, metaOrCb, maybeCb) => {
      const code = get().code;
      const [meta, cb] =
          typeof metaOrCb === "function"
            ? [undefined, metaOrCb]
            : [metaOrCb, (typeof maybeCb === "function" ? maybeCb : undefined)];

        const payload = {
          code,
          tracks,
          ...(meta && typeof meta === "object" ? { meta } : {}),
        };

        s.emit("game:seedTracks", payload, (res) => cb?.(res));
      },

      // PLAYER: join (no auto-rejoin, no storage; always manual)
      joinRoom: (code, name, cb) => {
        const c = (code || "").trim().toUpperCase();
        const n = (name || "").trim() || "Player";
        if (!c) return;

        s.emit("player:joinRoom", { code: c, name: n }, (res) => {
          if (!res?.ok) {
            set({ joinError: res?.error || "JOIN_FAILED" });
          } else {
            set({
              joinError: null,
              code: c,
              stage: "lobby",
            });
          }
          cb?.(res);
        });
      },

      // gives current config
      getConfig: () => get().config,
      // updates tracklist
      setTrackList: (newLstTracks) => {set({ lstTracks: newLstTracks });},
      // host OR first player can start the game
      startGame: (cb) =>
        s.emit("game:startGame", { code: get().code, lstTracks: get().lstTracks }, cb),

      // backward-compat alias
      startRound: () => s.emit("game:startGame", { code: get().code }),

      // skip timers in reveal/result
      advance: () => s.emit("game:advance", { code: get().code }),
      requestStartViaHub: (cb) =>
          s.emit("game:requestStart", { code: get().code }, cb),

      // game over controls
      playAgain: (arg1, arg2, arg3) => {
        const code = get().code;
        const [tracks, meta, cb] = Array.isArray(arg1)
          ? [
              arg1,
              typeof arg2 === "function" ? undefined : arg2,
              typeof arg2 === "function" ? arg2 : (typeof arg3 === "function" ? arg3 : undefined),
            ]
          : typeof arg1 === "function"
            ? [undefined, undefined, arg1]
            : [
                undefined,
                arg1,
                typeof arg2 === "function" ? arg2 : undefined,
              ];

        const payload = {
          code,
          ...(tracks ? { tracks } : {}),
          ...(meta ? { meta } : {}),
        };

        s.emit("game:playAgain", payload, (res) => cb?.(res));
    },
      
      toLobby: () =>
        s.emit("game:toLobby", { code: get().code }, (res) => {
          if (res?.ok) {
            // Optimistic flip
            set({
              stage: "lobby",
              question: null,
              seconds: 0,
              revealUntil: null,
              resultUntil: null,
              perOptionCounts: [],
              leaderboard: [],
            });
          }
        }),

      // optional manual reveal trigger (host)
      reveal: () => s.emit("game:reveal", { code: get().code }),

      // PLAYER: submit an answer (locks locally)
      submitAnswer: (answerIndex) => {
        const q = get().question;
        if (!q) return;
        s.emit("answer:submit", {
          code: get().code,
          questionId: q.id,
          answerIndex,
        });
        set({ stage: "locked" });
      },
      // PLAYER: submit a free-text answer (for "track-recognition")
      submitTextAnswer: (text) => {
        const q = get().question;
        if (!q) return;
        const value = (text ?? "").toString();
        s.emit("answer:submit", {
          code: get().code,
          questionId: q.id,
          text: value,
        });
        set({ stage: "locked" });
      },

      // -------- Simple Game Settings (host-only) --------
      updateConfig: (partial, cb) => {
        const { code } = get();
        s.emit("game:updateConfig", { code, ...partial }, (res) => {
          if (res?.ok && res.config) set({ config: res.config });
          cb?.(res);
      });
      },
    };
  });
};