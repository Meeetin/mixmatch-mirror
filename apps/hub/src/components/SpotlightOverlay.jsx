import { AnimatePresence, motion } from "framer-motion";

export default function SpotlightOverlay({
  active,
  onSettled,
  flicker = true,        // only true for your first question
  duration = 1.05,       // flicker duration
  holdOpacity = 0.6,     // final opacity of the beam
  center = [0.5, 0.5],   // [cx, cy] in 0..1
  r = "50%",             // circle radius; "percent" auto-converts to vmin
  tint = "255,238,200",  // warm white (r,g,b)
  exitDuration = 0.6,    // fade-out
}) {
  const circleSize = normalizeCircleSize(r); 

  const beam = `radial-gradient(circle ${circleSize} at ${center[0] * 100}% ${center[1] * 100}%,
    rgba(${tint},0.80) 0%,
    rgba(${tint},0.35) 45%,
    rgba(${tint},0.00) 70%)`;

  const bloom = `radial-gradient(circle ${circleSize} at ${center[0] * 100}% ${center[1] * 100}%,
    rgba(255,255,255,0.18) 0%,
    rgba(255,255,255,0.06) 38%,
    rgba(255,255,255,0.00) 70%)`;

  const flickerKeys = [0, 1, 0.18, 1, 0.42, 0.92, 0.28, holdOpacity];
  const flickerTimes = [0, 0.18, 0.30, 0.48, 0.62, 0.78, 0.88, 1];

  const steadyKeys = [0, holdOpacity];
  const steadyTimes = [0, 1];

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="spot"
          className="pointer-events-none absolute inset-0 z-[5]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, exit: { duration: exitDuration, ease: "easeOut" } }}
        >
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: flicker ? flickerKeys : steadyKeys }}
            transition={{
              duration: flicker ? duration : 0.35,
              times: flicker ? flickerTimes : steadyTimes,
              ease: "easeInOut",
            }}
            onAnimationComplete={onSettled}
            style={{ background: beam, mixBlendMode: "screen", willChange: "opacity" }}
          />

          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: (flicker ? flickerKeys : steadyKeys).map(v => v * 0.28) }}
            transition={{
              duration: flicker ? duration : 0.35,
              times: flicker ? flickerTimes : steadyTimes,
              ease: "easeInOut",
            }}
            style={{
              background: bloom,
              mixBlendMode: "screen",
              filter: "blur(1px)",
              willChange: "opacity",
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function normalizeCircleSize(r) {
  if (typeof r !== "string") return "40vmin";
  const s = r.trim().toLowerCase();
  if (s.endsWith("vmin") || s.endsWith("px") || s.endsWith("rem")) return s;
  if (s.endsWith("%")) {
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return "40vmin";
    return `${n}vmin`;
  }
  return "40vmin";
}
