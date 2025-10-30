// apps/server/routes/stats.js
import express from "express";
import { getGameHistorySummary } from "../../../packages/shared/serverGameStore.js";

const router = express.Router();

router.get("/summary", async (_req, res) => {
  try {
    const results = await getGameHistorySummary(20);
    res.json({ ok: true, results });
  } catch (err) {
    console.error("[getGameSummary] Failed:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch stats" });
  }
});

export default router;
