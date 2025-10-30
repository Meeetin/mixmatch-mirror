import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

export default function GameHistory() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

useEffect(() => {
  // Use environment variable or fallback to your production backend
  const API_BASE =
    import.meta.env.VITE_API_URL || "https://mixmatch-mirror-server.onrender.com";

  fetch(`${API_BASE}/api/stats/summary`)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (data.ok && Array.isArray(data.results)) {
        setResults(data.results);
      } else {
        console.warn("Unexpected data format:", data);
      }
    })
    .catch((err) => console.error("Failed to fetch stats:", err))
    .finally(() => setLoading(false));
}, []);

  if (loading) {
    return (
      <div className="text-mist-400 text-sm text-center mt-2">
        Loading history…
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="text-mist-400 text-sm text-center mt-2">
        No previous games.
      </div>
    );
  }

  const items = results.map((r, i) => {
    const date = r?.createdAt
      ? new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : "—";

    const genre = "-" //add genre lookup later
     

    return {
      key: `gh-${i}`,
      player: r.playerName ?? "Unknown",
      points: Number.isFinite(r.totalPoints) ? r.totalPoints : 0,
      questions: Number.isFinite(r.totalQuestions) ? r.totalQuestions : "—",
      date,
      genre,
    };
  });

  return (
    <div className="mt-4 p-3 text-mist-100">
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-2 text-mist-200">
        Previous Games
      </h3>
      <LoopingRow items={items} />
    </div>
  );
}


function LoopingRow({ items }) {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const [contentWidth, setContentWidth] = useState(0);

  const SPEED = 10; // px/s 
  const duration = contentWidth > 0 ? contentWidth / SPEED : 10;

  useEffect(() => {
    const measure = () => {
      if (!contentRef.current) return;
      setContentWidth(contentRef.current.getBoundingClientRect().width || 0);
    };
    measure();

    const ro = new ResizeObserver(measure);
    if (contentRef.current) ro.observe(contentRef.current);
    if (viewportRef.current) ro.observe(viewportRef.current);
    window.addEventListener("orientationchange", measure);

    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", measure);
    };
  }, [items.length]);

  return (
    <div
      ref={viewportRef}
      className="relative w-full overflow-hidden py-2"
      style={{
        maskImage:
          "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
      }}
    >
      <div className="perspective-[1000px]">
        <motion.div
          key={contentWidth}
          className="will-change-transform flex gap-3 sm:gap-4"
          animate={{ x: contentWidth ? [0, -contentWidth] : [0, 0] }}
          transition={{ duration, ease: "linear", repeat: Infinity }}
        >
          
          <div ref={contentRef} className="flex gap-3 sm:gap-4">
            {items.map((it) => (
              <HistoryCard key={`A-${it.key}`} item={it} />
            ))}
          </div>
          
          <div className="flex gap-3 sm:gap-4" aria-hidden="true">
            {items.map((it) => (
              <HistoryCard key={`B-${it.key}`} item={it} />
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* --------------------------- Cards & badges --------------------------- */

function HistoryCard({ item }) {
  return (
    <div
      className="shrink-0 rounded-2xl bg-transparent border border-white/15
                 px-3 sm:px-4 py-2 sm:py-2.5 text-white/90 shadow-sm backdrop-blur-0
                 min-w-[240px] max-w-[300px]"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-white/60">{item.date}</span>
        <span
          className="text-[11px] uppercase tracking-wide text-white/60 truncate max-w-[45%]"
          title={item.genre}
        >
          {item.genre}
        </span>
      </div>

      <div
        className="mt-1 text-sm sm:text-base font-semibold leading-tight break-words"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
        title={item.player}
      >
        {item.player}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Stat label="Points" value={item.points} />
        <Stat label="Questions" value={item.questions} />
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div
      className="inline-flex items-baseline gap-1 rounded-full border border-white/15 bg-white/5
                 px-2 py-0.5"
      aria-label={`${label}: ${value}`}
    >
      <span className="text-[10px] uppercase tracking-wide text-white/70">{label}</span>
      <span className="text-xs font-mono tabular-nums text-white/90">{value}</span>
    </div>
  );
}
