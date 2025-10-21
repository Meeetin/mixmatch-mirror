import crypto from "node:crypto";
import { createQuestionFromTrack } from "./geminiClient.js";

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) { //Pure function: mutation is confined and does not affect external state
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sanitizeOption(s) {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

function finalizeOptionsFromNewShape({ correctAnswer, distractors }) {
  const opts = [correctAnswer, ...distractors].map(sanitizeOption);
  // Dedupe while preserving order
  const seen = new Set();
  const unique = [];
  for (const o of opts) {
    const k = o.toLowerCase();
    if (o && !seen.has(k)) {
      seen.add(k);
      unique.push(o);
    }
  }
  // If items lost to dedupe, pad with safe fillers
  while (unique.length < 4) unique.push("I don't know");
  return unique.slice(0, 4);
}


//Create question payload for the game round
export function createTrackRecognitionQuestion(track) {
  return {
    id: crypto.randomUUID(),
    type: "track-recognition",
    prompt: "Name this track",
    media: track.previewUrl ? { audioUrl: track.previewUrl } : undefined,
  };
}

export async function generateQuestion(track) {
  const r = await createQuestionFromTrack(track);

  // If Gemini returned the old finished-shape, validate and forward
  if (Array.isArray(r?.options) && Number.isInteger(r?.correctIndex)) {
    const options = r.options.map(sanitizeOption).slice(0, 4);
    if (options.length === 4) {
      // Shuffle but keep correctness
      const pairs = options.map((opt, idx) => ({ opt, correct: idx === r.correctIndex }));
      shuffleInPlace(pairs);
      const shuffled = pairs.map(p => p.opt);
      const correctIndex = pairs.findIndex(p => p.correct);
      return {
        id: crypto.randomUUID(),
        type: "multiple-choice",
        prompt: String(r.prompt ?? "").trim(),
        media: track.previewUrl ? { audioUrl: track.previewUrl } : undefined,
        options: shuffled,
        correctIndex,
      };
    }
  }

  // New shape (preferred)
  const options = finalizeOptionsFromNewShape(r);
  const answer = sanitizeOption(r.correctAnswer ?? "");

  // Shuffle + compute index
  const pairs = options.map(o => ({ opt: o, correct: o.toLowerCase() === answer.toLowerCase() }));
  shuffleInPlace(pairs);

  // If Gemini gave an answer that got deduped out, force-correct one slot
  if (!pairs.some(p => p.correct)) {
    pairs[0].opt = answer || options[0];
    pairs[0].correct = true;
    shuffleInPlace(pairs);
  }

  const finalOptions = pairs.map(p => p.opt);
  const correctIndex = pairs.findIndex(p => p.correct);

  return {
    id: crypto.randomUUID(),
    type: "multiple-choice",
    prompt: String(r.prompt ?? `Question about "${track.title}" by ${track.artist}`).trim(),
    media: track.previewUrl ? { audioUrl: track.previewUrl } : undefined,
    options: finalOptions,
    correctIndex,
  };
}
