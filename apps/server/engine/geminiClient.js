
import { GoogleGenAI } from "@google/genai";

// Read key at call-time so dotenv order doesnt matter
function getApiKey() {
  return process.env.GEMINI_API_KEY
}

// Preferred/allowed models 
const PREFERRED_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-flash-lite-latest",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
].filter(Boolean);

// Extract first valid JSON object from a string (tolerates fences/noise)
function extractFirstJsonObject(text) {
  const t = String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try { return JSON.parse(t); } catch {}

  let start = -1, depth = 0, inStr = false, esc = false; // mutation is confined and function remains pure
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === "{") { if (depth === 0) start = i; depth++; }
      else if (c === "}") {
        depth--;
        if (depth === 0 && start !== -1) {
          const candidate = t.slice(start, i + 1);
          try { return JSON.parse(candidate); } catch {}
          start = -1;
        }
      }
    }
  }
  throw new Error("No valid JSON object found");
}

/**
 * Ask Gemini for one multiple-choice trivia question (+3 distractors)
 * Preferred shape:
 *   { prompt, correctAnswer, distractors: [a,b,c] }
 * Back-compat accepted:
 *   { prompt, options: [..4], correctIndex }
 */
export async function createQuestionFromTrack(track) {
  const apiKey = getApiKey();

  // Fallback if no key configured
  if (!apiKey) {
    return {
      prompt: `No API key "${track?.title ?? "this track"}"?`,
      correctAnswer: track?.artist ?? "Unknown Artist",
      distractors: ["Drake", "Taylor Swift", "ABBA"],
    };
  }

  const ai = new GoogleGenAI({ apiKey });

  const title = String(track?.title ?? "").trim();
  const artist = String(track?.artist ?? "").trim();

  const system = `
You are a music-quiz generator. Given a track title and artist, output ONE multiple-choice question about either the artist OR their music (not both).

Rules:
- Use concrete trivia: release/recording year, producer, featured artist, birthplace, famous pet (e.g., Bubbles for Michael Jackson), etc.
- Avoid yes/no or ambiguous questions.
- Avoid mentioning the TITLE of the GIVEN TRACK.
- Provide 4 options total: 1 correct + 3 plausible distractors. Similar type/length; no jokes; no "All of the above"/"None".
- Keep facts mainstream/known.

Output MUST be a single JSON object and nothing else, in this exact shape:
{"prompt":"...","correctAnswer":"...","distractors":["...","...","..."]}
`.trim();

  const user = `Title: ${title}\nArtist: ${artist}`;

  // Try preferred models in order stop on first success, mutation is confined to this scope
  let lastError = null;
  for (const model of PREFERRED_MODELS) {
    try {
      const resp = await ai.models.generateContent({
        model,
        contents: [
          { role: "user", parts: [{ text: system }] },
          { role: "user", parts: [{ text: user }] },
        ],
      });

      const raw = resp.text || "";
      if (process.env.LOG_GEMINI === "1") {
        const prev = raw.length > 1500 ? raw.slice(0, 1500) + "…[truncated]" : raw;
        console.log(`[Gemini][${model}] raw:`, prev);
      }

      if (!raw) throw new Error("Empty response text");

      // Parse structured JSON
      const parsed = extractFirstJsonObject(raw);

      // Preferred shape
      if (
        typeof parsed?.prompt === "string" &&
        typeof parsed?.correctAnswer === "string" &&
        Array.isArray(parsed?.distractors) &&
        parsed.distractors.length === 3
      ) {
        return parsed;
      }

      // Back-compat shape
      if (
        typeof parsed?.prompt === "string" &&
        Array.isArray(parsed?.options) &&
        Number.isInteger(parsed?.correctIndex) &&
        parsed.options.length === 4 &&
        parsed.correctIndex >= 0 &&
        parsed.correctIndex < 4
      ) {
        return parsed;
      }

      throw new Error("Unexpected JSON shape");

    } catch (e) {
      lastError = e;
      if (process.env.LOG_GEMINI === "1") {
        console.log(`[Gemini] model "${model}" failed:`, e?.status || "", e?.message || e);
      }
      // On 404/ApiError the SDK throws with status; just try next model.
      continue;
    }
  }

  // Final graceful fallback
  if (process.env.LOG_GEMINI === "1" && lastError) {
    console.log("[Gemini] all models failed; using fallback:", lastError?.message || lastError);
  }
  return {
    prompt: `All models failed "${title || "this track"}"?`,
    correctAnswer: artist || "Unknown Artist",
    distractors: ["Drake", "Taylor Swift", "ABBA"],
  };
}
