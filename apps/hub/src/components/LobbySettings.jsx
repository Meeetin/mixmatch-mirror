import { useEffect, useMemo, useRef, useState } from "react";
import { useGameStore } from "../store";

import dictPlaylistID from "../../../../packages/shared/PlayListIDs.js";


const GENRE_LABELS = {
  plRock: "Rock",
  plClassicRock: "Classic Rock",
  plHipHop: "Hip-Hop",
  plPop: "Pop",
  plFunkandSoul: "Funk & Soul",
  plClassicJazz: "Classic Jazz",
  plJazz: "Jazz",
  plHeavyMetal: "Heavy Metal",
  plCountry: "Country",
};
const GENRE_KEYS = Object.keys(GENRE_LABELS);

const DECADE_KEYS = ["pl60s", "pl70s", "pl80s", "pl90s", "pl00s", "pl10s"];

function buildGenres() {
  const rows = GENRE_KEYS
    .map((key) => ({ key, id: dictPlaylistID[key], label: GENRE_LABELS[key] }))
    .filter((r) => !!r.id);

  const byId = new Map();
  for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
  return Array.from(byId.values());
}

function buildDecades() {
  return DECADE_KEYS
    .map((key) => {
      const id = dictPlaylistID[key];
      if (!id) return null;
      return { key, id, label: key.replace(/^pl/, "") };
    })
    .filter(Boolean);
}

/** Tiny helper: debounce a callback */
function useDebouncedCallback(fn, delay) {
  const fnRef = useRef(fn);
  const tRef = useRef(null);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);
  return (...args) => {
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => fnRef.current(...args), delay);
  };
}

export default function LobbySettings() {
  const { stage, hostId, config, updateConfig } = useGameStore((s) => ({
    stage: s.stage,
    hostId: s.hostId,
    config: s.config,
    updateConfig: s.updateConfig,
  }));
  if (stage !== "lobby") return null;

  const isHost = true;
  const disabled = !isHost;

  const genres = useMemo(buildGenres, []);
  const decades = useMemo(buildDecades, []);

  const [maxQuestions, setMaxQuestions] = useState(config.maxQuestions);

  const [durationSec, setDurationSec] = useState(
    Math.round((config.defaultDurationMs ?? 20000) / 1000)
  );

  const inConfig = Array.isArray(config?.selectedPlaylistIDs) ? config.selectedPlaylistIDs : [];
  const [selGenres, setSelGenres] = useState(
    inConfig.filter((id) => genres.some((g) => g.id === id))
  );
  const [selDecades, setSelDecades] = useState(
    inConfig.filter((id) => decades.some((d) => d.id === id))
  );

  const [saving, setSaving] = useState(false);

  // Auto-save payload builder (with clamps + conversions)
  const buildPayload = () => {
    const q = Math.max(1, Math.min(50, Number(maxQuestions) || 10));
    const sec = Math.max(5, Math.min(120, Number(durationSec) || 20));
    const durationMs = sec * 1000;
    const combined = Array.from(new Set([...selGenres, ...selDecades]));
    return { maxQuestions: q, durationMs, selectedPlaylistIDs: combined };
  };

  // Avoid redundant calls: only send if payload changed
  const lastSentRef = useRef("");
  const firstRunRef = useRef(true);

  const doSave = useDebouncedCallback(() => {
    const payload = buildPayload();
    const key = JSON.stringify(payload);
    if (firstRunRef.current) {
      firstRunRef.current = false;
      lastSentRef.current = key;
      return;
    }
    if (key === lastSentRef.current) return;

    setSaving(true);
    updateConfig(payload, (res) => {
      setSaving(false);
      if (res?.ok) lastSentRef.current = key;
    });
  }, 350);

  // Auto-save whenever inputs/selections change
  useEffect(() => {
    doSave();
  }, [maxQuestions, durationSec, selGenres, selDecades]);

  const toggle = (id, setter) =>
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectAll = (list, setter) => setter(list.map((r) => r.id));
  const clearAll = (setter) => setter([]);

  return (
    <div className="w-full max-w-md space-y-4">
      <div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          <label className="block">
            <span className="text-sm text-mist-300 block min-h-[40px]">
              Number of questions (1–50)
            </span>
            <div className="mt-1 flex items-stretch h-10 rounded-xl bg-ink-900 ring-1 ring-ink-700/70 focus-within:ring-ink-500">
              <input
                type="number"
                min={1}
                max={50}
                className="w-full rounded-l-xl px-3 py-2 bg-transparent text-mist-100 outline-none"
                value={maxQuestions}
                onChange={(e) => setMaxQuestions(e.target.value)}
                disabled={disabled}
              />
              <span className="px-3 py-2 text-mist-300 rounded-r-xl select-none opacity-0">s</span>
            </div>
          </label>

          <label className="block">
            <span className="text-sm text-mist-300 block min-h-[40px]">
              Default question length (seconds, 5–120)
            </span>
            <div className="mt-1 flex items-stretch h-10 rounded-xl bg-ink-900 ring-1 ring-ink-700/70 focus-within:ring-ink-500">
              <input
                type="number"
                min={5}
                max={120}
                step={1}
                className="w-full rounded-l-xl px-3 py-2 bg-transparent text-mist-100 outline-none"
                value={durationSec}
                onChange={(e) => setDurationSec(e.target.value)}
                disabled={disabled}
              />
              <span className="px-3 py-2 text-mist-300 rounded-r-xl select-none">s</span>
            </div>
          </label>
        </div>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm text-mist-300">Genres</h3>
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => selectAll(genres, setSelGenres)}

              className="px-2 py-1 rounded bg-ink-800/70 hover:bg-ink-700/70"
            >
              Select all
            </button>
            <button
              onClick={() => clearAll(setSelGenres)}

              className="px-2 py-1 rounded bg-ink-800/70 hover:bg-ink-700/70"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {genres.map((g) => {
            const checked = selGenres.includes(g.id);
            return (
              <label
                key={g.id}
                className={
                  "flex items-center gap-2 rounded-xl px-3 py-2 ring-1 " +
                  (checked ? "ring-crimson-500 bg-ink-800/70" : "ring-ink-700/70 bg-ink-900")
                }
              >
                <input
                  type="checkbox"
                  className="accent-crimson-500"
                  checked={checked}
                  onChange={() => toggle(g.id, setSelGenres)}
                  disabled={saving}
                />
                <span className="text-sm">{g.label}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm text-mist-300">Decades</h3>
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => selectAll(decades, setSelDecades)}
              disabled={saving}
              className="px-2 py-1 rounded bg-ink-800/70 hover:bg-ink-700/70"
            >
              Select all
            </button>
            <button
              onClick={() => clearAll(setSelDecades)}
              disabled={saving}
              className="px-2 py-1 rounded bg-ink-800/70 hover:bg-ink-700/70"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {decades.map((d) => {
            const checked = selDecades.includes(d.id);
            return (
              <label
                key={d.id}
                className={
                  "flex items-center justify-center gap-2 rounded-xl px-2 py-2 ring-1 text-sm " +
                  (checked ? "ring-gold-400 bg-ink-800/70" : "ring-ink-700/70 bg-ink-900")
                }
              >
                <input
                  type="checkbox"
                  className="accent-gold-400 mr-1"
                  checked={checked}
                  onChange={() => toggle(d.id, setSelDecades)}
                  disabled={saving}
                />
                <span>{d.label}</span>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}
