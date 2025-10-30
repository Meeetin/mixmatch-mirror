// packages/serverGameStore/index.js
import { GameRound } from "../../apps/server/models/GameRound.js";

/**
 * Fetch recent game history summary from MongoDB
 */
export async function getGameHistorySummary(limit = 20) {
  const rounds = await GameRound.find({})
    .sort({ endedAt: -1 })
    .limit(limit)
    .lean();

  return rounds.map((r) => ({
    code: r.code,
    playerName: r.leaderboard?.[0]?.name || r.players?.[0]?.name || "Unknown",
    totalPoints: r.leaderboard?.[0]?.score || 0,
    totalQuestions: r.config?.maxQuestions || r.tracksPlayed?.length || 0,
    createdAt: r.endedAt || r.createdAt || new Date(),
  }));
}
