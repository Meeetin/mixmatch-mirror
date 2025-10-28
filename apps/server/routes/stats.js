import express from "express";
import { GameRound } from "../models/GameRound.js";

const router = express.Router();

// GET /api/stats/summary
router.get("/summary", async (_req, res) => {
  try {
    const rounds = await GameRound.find({})
      .sort({ endedAt: -1 })
      .limit(20)
      .lean();

    const results = rounds.map((r) => ({
      code: r.code,
      playerName: r.leaderboard?.[0]?.name || r.players?.[0]?.name || "Unknown",
      totalPoints: r.leaderboard?.[0]?.score || 0,
      totalQuestions: r.config?.maxQuestions || r.tracksPlayed?.length || 0,
      createdAt: r.endedAt || r.createdAt || new Date(),
    }));

    res.json({ ok: true, results });
  } catch (err) {
    console.error("[getGameSummary] Failed:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch stats" });
  }
});

export default router;
