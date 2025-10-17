// Game engine that runs a quiz over a list of tracks, one per round.
import crypto from "node:crypto";
import { generateQuestion } from "./questionEngine.js"; // question/gemini plumbing
import { createTrackRecognitionQuestion } from "./questionEngine.js";

export function registerGameEngine(io, mediaDir) {
  const rooms = new Map();

  /** ------------------ Track source (hardcoded fallback) ------------------ */
  // Provide at least { id, title, artist, previewUrl?, uri? }.
  const HARDCODED_TRACKS = [
    { id: "t1",  title: "Billie Jean",                 artist: "Michael Jackson" },
    { id: "t2",  title: "Smells Like Teen Spirit",     artist: "Nirvana" },
    { id: "t3",  title: "One More Time",               artist: "Daft Punk" },
    { id: "t4",  title: "Dancing Queen",               artist: "ABBA" },
    { id: "t5",  title: "Blinding Lights",             artist: "The Weeknd" },
    { id: "t6",  title: "Shake It Off",                artist: "Taylor Swift" },
    { id: "t7",  title: "Hey Ya!",                     artist: "OutKast" },
    { id: "t8",  title: "HUMBLE.",                     artist: "Kendrick Lamar" },
    { id: "t9",  title: "Poker Face",                  artist: "Lady Gaga" },
    { id: "t10", title: "Take On Me",                  artist: "a-ha" },
  ];

  /** ------------------ helpers ------------------ */
  function newCode() {
    return crypto.randomBytes(2).toString("hex").toUpperCase(); // e.g., A9F2
  }
  function uniqueName(room, base) {
    const lower = base.toLowerCase();
    const existing = new Set(Array.from(room.players.values()).map(p => p.name.toLowerCase()));
    if (!existing.has(lower)) return base;
    let i = 2;
    while (existing.has(`${lower} (${i})`)) i++;
    return `${base} (${i})`;
  }
  function roomPlayersArray(room) {
    return Array.from(room.players.values());
  }
  function emitRoomUpdate(code) {
    const room = rooms.get(code);
    if (!room) return;
    io.to(code).emit("room:update", {
      code: room.code,
      hostId: room.hostId,
      players: roomPlayersArray(room),
      firstPlayerId: room.firstPlayerId || null,
      config: room.config,
      remaining: Math.max(0, room.tracks.length - room.trackIdx),
    });
  }
  function clearTimers(room) {
    if (!room?.timers) return;
    const { tick, reveal, result } = room.timers;
    if (tick) clearInterval(tick);
    if (reveal) clearTimeout(reveal);
    if (result) clearTimeout(result);
    room.timers = { tick: null, reveal: null, result: null };
  }
  function stopAllAndClose(room) {
    clearTimers(room);
    io.to(room.code).emit("room:closed");
    io.in(room.code).socketsLeave(room.code);
    rooms.delete(room.code);
  }
  function progressCounts(room) {
    const connected = new Set(Array.from(room.players.values()).map(p => p.name.toLowerCase()));
    let answered = 0;
    for (const key of room.answersByName.keys()) {
      if (connected.has(key)) answered++;
    }
    return { answered, total: room.players.size };
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function ensureTracksSeeded(room) {
  if (!room.tracks || room.tracks.length === 0) {
    seedTracks(room);
    room.tracksSeeded = true; // optional flag if you want to know it happened
    }
  }

  function coinFlip() { return Math.random() < 0.5; }

  function normalizeText(s) {
    return String(s || "")
      .toLowerCase()
      // remove content in parentheses/brackets like "(Remastered)" for leniency
      .replace(/\([^)]*\)/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  /** ------------------ round engine ------------------ */
  async function startQuestion(room) {
    clearTimers(room);
    ensureTracksSeeded(room);
    if (room.qCount >= room.config.maxQuestions) return gameEnd(room);
    if (room.trackIdx >= room.tracks.length) return gameEnd(room);

    const track = room.tracks[room.trackIdx];

    let q;
    try {
        const useTrackRecognition = track.previewUrl ? coinFlip() : false;
        if (useTrackRecognition) {
          // build the free-text question that plays the current track
          q = createTrackRecognitionQuestion(track);
        } else {
          //multiple-choice question (Gemini)
          q = await generateQuestion(track);
        }
      } catch (err) {
      console.error("Question generation failed; using fallback:", err);
      // Fallback: simple artist question
      q = {
        id: crypto.randomUUID(),
        type: "multiple-choice",
        prompt: `Who is the artist of "${track.title}"?`,
        options: [track.artist, "Drake", "Taylor Swift", "ABBA"],
        correctIndex: 0,
        media: track.previewUrl ? { audioUrl: track.previewUrl } : undefined,
      };
    }

    room.trackIdx += 1;

    room.stage = "question";
    room.q = q;
    room.answersByName = new Map();
    room.perOptionCounts = q.type === "multiple-choice" && Array.isArray(q.options)
      ? Array(q.options.length).fill(0)
      : [];  

    const durationMs = room.config.defaultDurationMs ?? 20000;
    room.deadline = Date.now() + durationMs;
    room.revealUntil = null;
    room.resultUntil = null;
    room.qCount += 1;

    io.to(room.code).emit("question:new", {
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: q.options, // undefined for track-recognition; client should branch by type
      durationMs,
      deadline: room.deadline,
      round: room.qCount,
      totalRounds: room.config.maxQuestions,
      remaining: Math.max(0, room.tracks.length - room.trackIdx),
      trackMeta: { title: track.title, artist: track.artist },
    });

    // Prefer sending Spotify URI to the Hub; fall back to preview audio if available.
    if ((q.media?.audioUrl) || track.uri) {
      io.to(room.hostId).emit("question:hubMedia", {
        id: q.id,
        audioUrl: q.media?.audioUrl || null,
        spotifyUri: track.uri || null,
        durationMs,
      });
    }

    emitTick(room);
    const { answered, total } = progressCounts(room);
    io.to(room.code).emit("progress:update", { answered, total });

    room.timers.tick = setInterval(() => {
      emitTick(room);
      if (Date.now() >= room.deadline) {
        clearInterval(room.timers.tick);
        reveal(room);
      }
    }, 1000);
  }

  function emitTick(room) {
    const seconds = Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000));
    io.to(room.code).emit("question:tick", { seconds });
  }

  function submitAnswer(room, socketId, answerIndex, text) {
    if (room.stage !== "question" || !room.q) return;
    if (Date.now() >= room.deadline) return;

    const player = room.players.get(socketId);
    if (!player) return;
    const key = player.name.toLowerCase();

    if (room.answersByName.has(key)) return;

    if (room.q.type === "multiple-choice") {
      const choice = Number(answerIndex);
      room.answersByName.set(key, choice);
      if (Number.isInteger(choice) && choice >= 0 && choice < room.perOptionCounts.length) {
        room.perOptionCounts[choice]++;
      }
    } else {
      // track-recognition: store free-text
      const value = typeof text === "string" ? text : String(answerIndex ?? "").trim();
      room.answersByName.set(key, value);
      // no perOptionCounts for this type
    }

    const { answered, total } = progressCounts(room);
    io.to(room.code).emit("progress:update", { answered, total });

    if (answered >= total) {
      clearInterval(room.timers.tick);
      reveal(room);
    }
  }

  function reveal(room) {
    if (room.stage !== "question" || !room.q) return;
    room.stage = "reveal";
    room.revealUntil = Date.now() + 15000;

    io.to(room.code).emit("question:reveal", {
      correctIndex: room.q.type === "multiple-choice" ? (room.q.correctIndex ?? 0) : null,
      perOptionCounts: room.q.type === "multiple-choice" ? (room.perOptionCounts || []) : [],
      revealUntil: room.revealUntil,
    });

    room.timers.reveal = setTimeout(() => result(room), 15000);
  }

  function result(room) {
    if (!room.q) return;

    room.stage = "result";

    const correct = room.q.correctIndex ?? 0;
    for (const p of room.players.values()) {
      const idx = room.answersByName.get(p.name.toLowerCase());
      if (idx === correct) p.score = (p.score || 0) + 1;
    }

    const track = room.tracks[Math.max(0, room.trackIdx - 1)];
    if (room.q.type === "multiple-choice") {
      const correct = room.q.correctIndex ?? 0;
      for (const p of room.players.values()) {
        const idx = room.answersByName.get(p.name.toLowerCase());
        if (idx === correct) p.score = (p.score || 0) + 1;
      }
    } else {
      const target = normalizeText(track?.title);
      for (const p of room.players.values()) {
        const typed = room.answersByName.get(p.name.toLowerCase());
        if (!typed) continue;
        const guess = normalizeText(typed);
        if (guess && target && guess === target) {
          p.score = (p.score || 0) + 1;
          }
      }
    }

    const leaderboard = [...room.players.values()]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .map((p) => ({ id: p.id, name: p.name, score: p.score || 0 }));

    room.resultUntil = Date.now() + 8000;

    io.to(room.code).emit("question:result", {
      leaderboard,
      resultUntil: room.resultUntil,
      remaining: Math.max(0, room.tracks.length - room.trackIdx),
    });

    emitRoomUpdate(room.code);

    room.timers.result = setTimeout(() => {
      if (room.qCount >= room.config.maxQuestions) gameEnd(room);
      else startQuestion(room);
    }, 8000);
  }

  function gameEnd(room) {
    clearTimers(room);
    room.stage = "gameover";

    const leaderboard = [...room.players.values()]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .map((p) => ({ id: p.id, name: p.name, score: p.score || 0 }));

    io.to(room.code).emit("game:end", {
      leaderboard,
      totalRounds: room.config.maxQuestions,
    });
  }

  /** Allow skipping timers by host or first player (not during question) */
  function canControl(socket, room) {
    return socket.id === room.hostId || socket.id === room.firstPlayerId;
  }
  function advance(room) {
    if (room.stage === "reveal") {
      clearTimeout(room.timers.reveal);
      result(room);
    } else if (room.stage === "result") {
      clearTimeout(room.timers.result);
      if (room.qCount >= room.config.maxQuestions) gameEnd(room);
      else startQuestion(room);
    }
  }

  /** Reset scores & start again */
  function playAgain(room) {
    clearTimers(room);

    for (const p of room.players.values()) p.score = 0;
    // reset round pointers
    room.qCount = 0;
    room.trackIdx =0;
    room.tracks = []
    room.stage = "lobby";
    // re-seed tracks (respect config.randomizeOnStart and spotifyTracks)
    seedTracks(room);

    emitRoomUpdate(room.code);
    // start a new question immediately
    startQuestion(room);
  }

  /** Back to lobby */
  function toLobby(room) {
    clearTimers(room);

    room.stage = "lobby";
    for (const p of room.players.values()) p.score = 0;

    room.q = null;
    room.answersByName = new Map();
    room.answers = new Map();
    room.perOptionCounts = [];
    room.deadline = null;
    room.revealUntil = null;
    room.resultUntil = null;
    room.qCount = 0;
    room.trackIdx =0;
    room.tracks = []

    room.whitelistNames = null;
    room.reclaimByName = new Map();
    room.emoteCooldownByName = new Map(); // keep emote cooldowns clean between runs

    emitRoomUpdate(room.code);
    io.to(room.code).emit("game:lobby");
  }

  /**
   * Seed the room's tracks from the host-provided Spotify list (if any),
   * otherwise fall back to the hardcoded demo list.
   */
  function seedTracks(room) {
  const source =
    (Array.isArray(room.spotifyTracks) && room.spotifyTracks.length)
      ? room.spotifyTracks
      : (Array.isArray(room.lstTracks) && room.lstTracks.length) ? room.lstTracks : HARDCODED_TRACKS;
       
  const base = source.slice(); // clone
  const list = room.config.randomizeOnStart ? shuffle(base) : base;

  room.tracks = list;
  room.trackIdx = 0;

  // Clamp maxQuestions to what's actually available
  const available = list.length;
  const desired = Number(room.config.maxQuestions || available);
  room.config.maxQuestions = Math.min(desired, available);
}

  /** ------------------ socket logic ------------------ */
  io.on("connection", (socket) => {
    socket.data.role = null; // "host" | "player"
    socket.data.code = null;

    /** Host creates a room */
    socket.on("host:createRoom", (_payload, cb) => {
      try {
        if (socket.data.code) socket.leave(socket.data.code);

        let code = newCode();
        while (rooms.has(code)) code = newCode();

        const room = {
          code,
          hostId: socket.id,
          stage: "lobby",
          players: new Map(),
          firstPlayerId: null,
          reclaimByName: new Map(),
          whitelistNames: null, // set at game start
          lstTracks: [],
          config: {
            maxQuestions: HARDCODED_TRACKS.length,   // default to tracklist length (will re-clamp on seed)
            defaultDurationMs: 20000,                // 20s per question
            randomizeOnStart: true,                  // shuffle track order at start
          },
          q: null,
          answersByName: new Map(),
          perOptionCounts: [],
          deadline: null,
          revealUntil: null,
          resultUntil: null,
          timers: { tick: null, reveal: null, result: null },
          // track playlist state
          tracks: [],
          trackIdx: 0,
          // NEW: host-provided Spotify tracks (normalized)
          spotifyTracks: null,
          // counters
          qCount: 0,
          manualLock: false,
          // emotes
          emoteCooldownByName: new Map(),
        };

        rooms.set(code, room);
        socket.join(code);
        socket.data.role = "host";
        socket.data.code = code;

        emitRoomUpdate(code);
        cb?.({ ok: true, code });
      } catch (err) {
        console.error("host:createRoom error", err);
        cb?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    /** Player joins a room (strict: only whitelisted names can rejoin after start) */
    socket.on("player:joinRoom", ({ code, name }, cb) => {
      try {
        const room = rooms.get((code || "").toUpperCase());
        if (!room) return cb?.({ ok: false, error: "NO_SUCH_ROOM" });

        const desired = (name?.trim() || "Player");
        const key = desired.toLowerCase();

        const joiningDuringGame = room.stage !== "lobby";
        const connectedNames = new Set(
          Array.from(room.players.values()).map(p => p.name.toLowerCase())
        );

        let finalName = desired;
        let startScore = 0;
        let isReclaim = false;

        if (joiningDuringGame) {
          if (!room.whitelistNames?.has(key)) {
            return cb?.({ ok: false, error: "ROOM_LOCKED" });
          }
          if (room.reclaimByName.has(key) && !connectedNames.has(key)) {
            const saved = room.reclaimByName.get(key);
            finalName = saved.name;
            startScore = saved.score || 0;
            isReclaim = true;
            room.reclaimByName.delete(key);
          } else {
            return cb?.({ ok: false, error: "ROOM_LOCKED" });
          }
        } else {
          if (room.reclaimByName.has(key) && !connectedNames.has(key)) {
            const saved = room.reclaimByName.get(key);
            finalName = saved.name;
            startScore = saved.score || 0;
            isReclaim = true;
            room.reclaimByName.delete(key);
          } else {
            finalName = uniqueName(room, desired);
          }
        }

        socket.join(room.code);
        socket.data.role = "player";
        socket.data.code = room.code;

        const player = { id: socket.id, name: finalName, score: startScore };
        room.players.set(socket.id, player);

        if (!room.firstPlayerId) room.firstPlayerId = socket.id; // first joiner gets control

        // Stage sync to this socket only
        if (room.stage === "question" && room.q) {
          const nowLeft = Math.max(0, (room.deadline ?? Date.now()) - Date.now());
          socket.emit("question:new", {
            id: room.q.id,
            prompt: room.q.prompt,
            options: room.q.options,
            durationMs: nowLeft || room.config.defaultDurationMs,
            deadline: room.deadline,
            round: room.qCount,
            totalRounds: room.config.maxQuestions,
            remaining: Math.max(0, room.tracks.length - room.trackIdx),
          });
          const { answered, total } = progressCounts(room);
          socket.emit("progress:update", { answered, total });
        } else if (room.stage === "reveal") {
          socket.emit("question:reveal", {
            correctIndex: room.q?.correctIndex ?? 0,
            perOptionCounts: room.perOptionCounts || [],
            revealUntil: room.revealUntil || Date.now(),
          });
        } else if (room.stage === "result") {
          const leaderboard = [...room.players.values()]
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .map((p) => ({ id: p.id, name: p.name, score: p.score || 0 }));
          socket.emit("question:result", {
            leaderboard,
            resultUntil: room.resultUntil || Date.now(),
          });
        } else if (room.stage === "gameover") {
          const leaderboard = [...room.players.values()]
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .map((p) => ({ id: p.id, name: p.name, score: p.score || 0 }));
          socket.emit("game:end", { leaderboard, totalRounds: room.config.maxQuestions });
        }

        emitRoomUpdate(room.code);
        cb?.({ ok: true, reclaimed: isReclaim, name: finalName, score: startScore });
      } catch (err) {
        console.error("player:joinRoom error", err);
        cb?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    /** Start game (host OR first player) */
    socket.on("game:startGame", ({ code, lstTracks }, cb) => {
      try {
        const room = rooms.get(code || socket.data.code);
        if (!room) return cb?.({ ok: false, error: "NO_SUCH_ROOM" });
        if (!(socket.id === room.hostId || socket.id === room.firstPlayerId)) {
          return cb?.({ ok: false, error: "NOT_ALLOWED" });
        }
        if (room.stage !== "lobby") return cb?.({ ok: false, error: "ALREADY_STARTED" });

        // freeze whitelist of names at game start
        room.whitelistNames = new Set(
          Array.from(room.players.values()).map(p => p.name.toLowerCase())
        );

        room.lstTracks = lstTracks;

        //reset counters
        // re-seed and reset counters (seedTracks will prefer spotifyTracks if present)
        seedTracks(room);
        room.qCount = 0;

        startQuestion(room);
        cb?.({ ok: true, questionId: room.q?.id });
      } catch (err) {
        console.error("game:startGame error", err);
        cb?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    /** Backwards compat: startRound actually starts the game */
    socket.on("game:startRound", ({ code }, cb) => {
      try {
        const room = rooms.get(code || socket.data.code);
        if (!room) return cb?.({ ok: false, error: "NO_SUCH_ROOM" });

        const allowed = socket.id === room.hostId || socket.id === room.firstPlayerId;
        if (!allowed) return cb?.({ ok: false, error: "NOT_ALLOWED" });
        if (room.stage !== "lobby") return cb?.({ ok: false, error: "ALREADY_STARTED" });

        room.whitelistNames = new Set(
          Array.from(room.players.values()).map(p => p.name.toLowerCase())
        );

        room.qCount = 0;

        startQuestion(room);
        cb?.({ ok: true, questionId: room.q?.id });
      } catch (err) {
        console.error("game:startRound error", err);
        cb?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    /** Player submits an answer */
    socket.on("answer:submit", ({ code, questionId, answerIndex, text }, cb) => {
      try {
        const room = rooms.get(code || socket.data.code);
        if (!room) return cb?.({ ok: false, error: "NO_SUCH_ROOM" });
        if (!room.q || room.q.id !== questionId) return cb?.({ ok: false, error: "NO_ACTIVE_QUESTION" });

        submitAnswer(room, socket.id, answerIndex, text);
        cb?.({ ok: true });
      } catch (err) {
        console.error("answer:submit error", err);
        cb?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    /** Manual reveal (host only) */
    socket.on("game:reveal", ({ code }, cb) => {
      try {
        const room = rooms.get(code || socket.data.code);
        if (!room) return cb?.({ ok: false, error: "NO_SUCH_ROOM" });
        if (room.hostId !== socket.id) return cb?.({ ok: false, error: "NOT_HOST" });

        clearInterval(room.timers.tick);
        reveal(room);
        cb?.({ ok: true });
      } catch (err) {
        console.error("game:reveal error", err);
        cb?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    /** Continue (skip timers) – host or first player; only in reveal/result */
    socket.on("game:advance", ({ code }, cb) => {
      try {
        const room = rooms.get(code || socket.data.code);
        if (!room) return cb?.({ ok: false, error: "NO_SUCH_ROOM" });
        if (!canControl(socket, room)) return cb?.({ ok: false, error: "NOT_ALLOWED" });
        if (!["reveal", "result"].includes(room.stage)) {
          return cb?.({ ok: false, error: "BAD_STAGE" });
        }
        advance(room);
        cb?.({ ok: true });
      } catch (err) {
        console.error("game:advance error", err);
        cb?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    /** Play again (reset scores + start immediately) */
    socket.on("game:playAgain", ({ code }, cb) => {
      try {
        const room = rooms.get(code || socket.data.code);
        if (!room) return cb?.({ ok: false, error: "NO_SUCH_ROOM" });
        if (!canControl(socket, room)) return cb?.({ ok: false, error: "NOT_ALLOWED" });
        room.qCount = 0;
        playAgain(room);
        cb?.({ ok: true });
      } catch (err) {
        console.error("game:playAgain error", err);
        cb?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    /** Back to lobby */
    socket.on("game:toLobby", ({ code }, cb) => {
      try {
        const room = rooms.get(code || socket.data.code);
        if (!room) return cb?.({ ok: false, error: "NO_SUCH_ROOM" });
        if (!canControl(socket, room)) return cb?.({ ok: false, error: "NOT_ALLOWED" });
        toLobby(room);
        cb?.({ ok: true });
      } catch (err) {
        console.error("game:toLobby error", err);
        cb?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    /**
     * Simple Game Settings (host-only, lobby-only)
     * Loosened maxQuestions upper bound (now up to 100);
     * seedTracks() will clamp to the number of available tracks at start.
     */
    socket.on("game:updateConfig", (payload, cb) => {
      try {
        const code = payload?.code || socket.data?.code;
        const room = rooms.get(code);
        if (!room) return cb?.({ ok: false, error: "NO_SUCH_ROOM" });
        if (socket.id !== room.hostId) return cb?.({ ok: false, error: "NOT_HOST" });
        if (room.stage !== "lobby") return cb?.({ ok: false, error: "ALREADY_STARTED" });

        const clamp = (n, lo, hi, fallback) =>
          Number.isFinite(Number(n)) ? Math.max(lo, Math.min(hi, Number(n))) : fallback;

        // previously limited by HARDCODED_TRACKS.length (10). Allow up to 100.
        const maxQuestions = clamp(payload?.maxQuestions, 1, 100, room.config.maxQuestions);
        const defaultDurationMs = clamp(payload?.durationMs, 5000, 120000, room.config.defaultDurationMs);
        const randomizeOnStart = Boolean(payload?.randomizeOnStart ?? room.config.randomizeOnStart);
        const selectedPlaylistIDs = Array.isArray(payload?.selectedPlaylistIDs)
          ? Array.from(new Set(payload.selectedPlaylistIDs.filter((x) => typeof x === "string")))
          : (room.config.selectedPlaylistIDs || []);

        room.config.maxQuestions = maxQuestions;
        room.config.defaultDurationMs = defaultDurationMs;
        room.config.randomizeOnStart = randomizeOnStart;
        room.config.selectedPlaylistIDs = selectedPlaylistIDs;

        emitRoomUpdate(room.code);
        cb?.({ ok: true, config: room.config });
      } catch (err) {
        console.error("game:updateConfig error", err);
        cb?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    /** ------------------ NEW: Host seeds Spotify tracks before starting ------------------ */
    socket.on("game:seedTracks", ({ code, tracks }, cb) => {
      try {
        const room = rooms.get(code || socket.data.code);
        if (!room) return cb?.({ ok: false, error: "NO_SUCH_ROOM" });
        if (socket.id !== room.hostId) return cb?.({ ok: false, error: "NOT_HOST" });
        if (room.stage !== "lobby") return cb?.({ ok: false, error: "ALREADY_STARTED" });

        // Minimal normalization + validation; uri is optional but recommended for Spotify Connect
        const norm = (Array.isArray(tracks) ? tracks : [])
          .map(t => ({
            id: String(t.id || ""),
            title: String(t.title || t.name || ""),
            artist: String(t.artist || ""),
            previewUrl: t.previewUrl || null,
            uri: t.uri ? String(t.uri) : null,
          }))
          .filter(t => t.title && t.artist);

        // de-duplicate by track id
        const seen = new Set();
        const dedup = norm.filter(t => (t.id && !seen.has(t.id)) ? (seen.add(t.id), true) : false);

        if (!dedup.length) return cb?.({ ok: false, error: "NO_VALID_TRACKS" });

        room.spotifyTracks = dedup;
        // re-seed immediately so the UI's "remaining" counter updates
        seedTracks(room);
        emitRoomUpdate(room.code);

        cb?.({ ok: true, count: dedup.length });
      } catch (err) {
        console.error("game:seedTracks error", err);
        cb?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    /** ------------------ EMOTES (kept from your old index.js) ------------------ */
    socket.on("emote:send", ({ code, image }, cb = () => {}) => {
      try {
        const room = rooms.get((code || socket.data.code || "").toUpperCase());
        if (!room) {
          console.warn("emote:send NO_SUCH_ROOM", code);
          return cb({ ok: false, error: "NO_SUCH_ROOM" });
        }

        const player = room.players.get(socket.id);
        const isHost = socket.id === room.hostId;
        if (!player && !isHost) {
          console.warn("emote:send NOT_IN_ROOM", { socket: socket.id, room: room.code });
          return cb({ ok: false, error: "NOT_IN_ROOM" });
        }

        if (typeof image !== "string" || !image.startsWith("data:image/png;base64,")) {
          console.warn("emote:send BAD_IMAGE");
          return cb({ ok: false, error: "BAD_IMAGE" });
        }
        if (image.length > 250_000) {
          console.warn("emote:send IMAGE_TOO_LARGE", image.length);
          return cb({ ok: false, error: "IMAGE_TOO_LARGE" });
        }

        if (!room.emoteCooldownByName) room.emoteCooldownByName = new Map();
        const displayName = player?.name ?? "Host";
        const key = displayName.toLowerCase();

        const now = Date.now();
        const last = room.emoteCooldownByName.get(key) || 0;
        const COOLDOWN_MS = 5000;
        if (now - last < COOLDOWN_MS) {
          const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
          console.warn("emote:send COOLDOWN", { name: displayName, wait });
          return cb({ ok: false, error: "COOLDOWN", wait });
        }
        room.emoteCooldownByName.set(key, now);

        const payload = {
          id: `${now}-${socket.id}`,
          name: displayName,
          image,
          at: now,
        };

        io.to(room.code).emit("emote:new", payload);
        console.log("emote:send -> emote:new", { room: room.code, from: displayName, size: image.length });
        cb({ ok: true });
      } catch (err) {
        console.error("emote:send error", err);
        cb({ ok: false, error: "SERVER_ERROR" });
      }
    });

    /** Disconnect handling */
    socket.on("disconnect", () => {
      const code = socket.data.code;
      if (!code) return;

      const room = rooms.get(code);
      if (!room) return;

      if (socket.id === room.hostId) {
        // Host left: close the room
        stopAllAndClose(room);
      } else {
        // Save for reclaim (only matters after start; harmless in lobby)
        const leaving = room.players.get(socket.id);
        if (leaving) {
          room.reclaimByName.set(
            leaving.name.toLowerCase(),
            { name: leaving.name, score: leaving.score || 0 }
          );
        }

        const wasFirst = socket.id === room.firstPlayerId;
        room.players.delete(socket.id);

        if (wasFirst) {
          room.firstPlayerId = room.players.size ? roomPlayersArray(room)[0].id : null;
        }

        if (room.stage === "question" && room.q) {
          const { answered, total } = progressCounts(room);
          if (answered >= total) {
            clearInterval(room.timers.tick);
            reveal(room);
          }
        }

        emitRoomUpdate(code);
      }
    });
  });
}
