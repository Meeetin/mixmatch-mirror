import { useEffect, useRef, useState } from "react";

/*

 * Props:
 *  - cycleKey: number   (bump to trigger a cycle; ignored when staticOpen)
 *  - staticOpen: bool   (force open, no transitions/animation)
 *  - onCycleStart(): void
 *  - onCycleEnd(): void
 *  - edgePx: number     (visible edge when open)
 *  - topOffsetPx: number (leave room for a fixed header)
 *  - closeMs, openMs, pauseMs: timings
 *  - z: number          (z-index)
 */
export default function CurtainOverlay({
  cycleKey = -1,
  staticOpen = false,
  onCycleStart,
  onCycleEnd,
  edgePx = 72,
  topOffsetPx = 0,
  closeMs = 700,
  openMs = 900,
  pauseMs = 150,
  z = 150,
}) {
  const [pose, setPose] = useState("open"); // "open" | "closed"
  const timers = useRef([]);

  // Clear timers on unmount
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  // Force-open mode for lobby / non-question stages
  useEffect(() => {
    if (staticOpen) {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setPose("open");
      return;
    }
    if (cycleKey < 0) {
      setPose("open");
      return;
    }
    onCycleStart?.();
    setPose("closed");
    timers.current.push(setTimeout(() => {
      setPose("open");
      timers.current.push(setTimeout(() => onCycleEnd?.(), openMs + 20));
    }, closeMs + pauseMs));
  }, [cycleKey, staticOpen]);

  const transition = staticOpen ? "none" : `transform ${pose === "closed" ? closeMs : openMs}ms ease-in-out`;

  const commonPanelStyle = {
    position: "fixed",
    top: topOffsetPx,
    height: `calc(100dvh - ${topOffsetPx}px)`,
    width: "50vw",
    transition,
    willChange: staticOpen ? "auto" : "transform",
    pointerEvents: "none",
  };

  const leftStyle = {
    ...commonPanelStyle,
    left: 0,
    transform: pose === "open" ? `translateX(calc(-50vw + ${edgePx}px))` : "translateX(0)",
  };
  const rightStyle = {
    ...commonPanelStyle,
    right: 0,
    transform: pose === "open" ? `translateX(calc(50vw - ${edgePx}px))` : "translateX(0)",
  };

  return (
    <div className="pointer-events-none" style={{ position: "fixed", inset: 0, zIndex: z }}>
      <div style={leftStyle}><CurtainSVG side="left" /></div>
      <div style={rightStyle}><CurtainSVG side="right" /></div>
      {topOffsetPx > 0 && (
        <div
          style={{
            position: "fixed",
            left: 0, right: 0,
            top: topOffsetPx - 6,
            height: 6,
            background: "linear-gradient(to bottom, rgba(0,0,0,0.45), rgba(0,0,0,0))",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

function CurtainSVG({ side = "left" }) {
  const flip = side === "right";
  return (
    <svg
      viewBox="0 0 600 1200"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      style={{ display: "block" }}
      aria-hidden
    >
      <defs>
        <linearGradient id="velvet" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#4b0d15" />
          <stop offset="40%" stopColor="#7f1120" />
          <stop offset="60%" stopColor="#a41427" />
          <stop offset="100%" stopColor="#4b0d15" />
        </linearGradient>
        <linearGradient id="fold" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(0,0,0,0.35)" />
          <stop offset="50%" stopColor="rgba(0,0,0,0.05)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.25)" />
        </linearGradient>
        <linearGradient id="shine" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.0)" />
        </linearGradient>
        <linearGradient id="rope" x1="0" x2="1">
          <stop offset="0%" stopColor="#edc04b" />
          <stop offset="100%" stopColor="#b0872f" />
        </linearGradient>
        <linearGradient id="edgeburn" x1="0" x2="1">
          <stop offset="0%" stopColor="rgba(0,0,0,0.45)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.0)" />
        </linearGradient>
        <clipPath id="panelClip">
          <rect x="0" y="0" width="600" height="1200" rx="22" ry="22" />
        </clipPath>
      </defs>

      <g clipPath="url(#panelClip)" transform={flip ? "scale(-1,1) translate(-600,0)" : undefined}>
        <rect x="0" y="0" width="600" height="1200" fill="url(#velvet)" />
        {Array.from({ length: 10 }).map((_, i) => {
          const x = 20 + i * 55;
          return (
            <path
              key={i}
              d={`M ${x} 0 C ${x + 20} 200, ${x - 20} 400, ${x + 16} 600
                 S ${x - 18} 1000, ${x + 12} 1200 L ${x - 10} 1200
                 C ${x - 22} 900, ${x + 10} 600, ${x - 14} 300
                 S ${x + 6} 0, ${x} 0 z`}
              fill="url(#fold)"
              opacity="0.55"
            />
          );
        })}
        <path
          d="M0,0 C100,80 200,120 300,120 C400,120 500,80 600,0 L600,200 C520,160 440,140 360,140 C260,140 160,170 0,220 Z"
          fill="url(#shine)"
          opacity="0.55"
        />
        <rect x="0" y="0" width="40" height="1200" fill="url(#edgeburn)" />
        <rect x="560" y="0" width="40" height="1200" fill="url(#edgeburn)" transform="scale(-1,1) translate(-1200,0)" />
        <g transform="translate(0, 520)">
          <path d="M 15 0 Q 140 40 200 16" fill="none" stroke="url(#rope)" strokeWidth="16" strokeLinecap="round" opacity="0.7" />
          <circle cx="10" cy="0" r="9" fill="#b0872f" />
        </g>
      </g>
    </svg>
  );
}
