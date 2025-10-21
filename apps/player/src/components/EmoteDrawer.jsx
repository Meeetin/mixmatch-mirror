import { useEffect, useRef, useState } from "react";
import { getSocket } from "../../../../packages/shared/socket.js";

const s = getSocket(import.meta.env.VITE_SERVER_URL);

const CANVAS_SIZE = 160;
const BRUSH = 6;
const COLORS = ["#F04452" , "#F1C40F", "#22D3EE"];
const COOLDOWN_MS = 5000;
const ACK_TIMEOUT_MS = 6000;

export default function EmoteDrawer({ code, open, onClose }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const [color, setColor] = useState(COLORS[0]);
  const [sending, setSending] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);

  // init canvas on open
  useEffect(() => {
    if (!open) return;
    const el = canvasRef.current;
    if (!el) return;
    el.width = CANVAS_SIZE;
    el.height = CANVAS_SIZE;
    const ctx = el.getContext("2d");
    ctxRef.current = ctx;
    clearCanvas();
  }, [open]);

  function clearCanvas() {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }

  // drawing
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  function posFromEvent(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const p = "touches" in e ? e.touches[0] : e;
    return {
      x: ((p.clientX - rect.left) / rect.width) * CANVAS_SIZE,
      y: ((p.clientY - rect.top) / rect.height) * CANVAS_SIZE,
    };
  }

  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    last.current = posFromEvent(e);
  };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    const p = posFromEvent(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = BRUSH;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const end = () => (drawing.current = false);

  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  const disabled = sending || cooldownLeft > 0 || !code;

  function send() {
    if (disabled) return;
    try {
      setSending(true);
      const el = canvasRef.current;
      if (!el) {
        setSending(false);
        return;
      }
      const dataUrl = el.toDataURL("image/png", 0.8);

      const doSend = () => {
        const timer = setTimeout(() => {
          setSending(false);
          console.warn("emote:send ack timed out");
        }, ACK_TIMEOUT_MS);

        s.emit("emote:send", { code, image: dataUrl }, (res) => {
          clearTimeout(timer);
          setSending(false);
          if (res?.ok) {
            clearCanvas();
            setCooldownUntil(Date.now() + COOLDOWN_MS);
            onClose?.();
          } else if (res?.error === "COOLDOWN" && res.wait) {
            setCooldownUntil(Date.now() + res.wait * 1000);
          } else if (res?.error) {
            console.warn("emote:send failed:", res.error);
          }
        });
      };

      if (s.connected) {
        doSend();
      } else {
        const onConnect = () => {
          s.off("connect", onConnect);
          doSend();
        };
        s.on("connect", onConnect);
        s.connect();
      }
    } catch (e) {
      console.warn("emote:send exception", e);
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-sm flex items-center justify-center">
      <div className="relative w-[min(90vw,420px)] rounded-2xl bg-ink-900/90 p-4 ring-1 ring-white/10 text-mist-100">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 px-2 py-1 rounded bg-ink-800 hover:bg-ink-700"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="text-center text-lg font-display mb-3">Draw an emote</div>

        <div className="mx-auto w-64 h-64 rounded-xl bg-ink-800/70 overflow-hidden touch-none">
          <canvas
            ref={canvasRef}
            className="w-full h-full block"
            onMouseDown={start}
            onMouseMove={move}
            onMouseUp={end}
            onMouseLeave={end}
            onTouchStart={start}
            onTouchMove={move}
            onTouchEnd={end}
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Brush ${c}`}
                onClick={() => setColor(c)}
                className={[
                  "h-7 w-7 rounded-full ring-2",
                  color === c ? "ring-gold-400" : "ring-white/10",
                ].join(" ")}
                style={{ background: c }}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={clearCanvas}
              className="px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700"
            >
              Reset
            </button>
            <button
              onClick={send}
              disabled={disabled}
              className={[
                "px-3 py-1.5 rounded",
                disabled
                  ? "bg-crimson-500/40 cursor-not-allowed"
                  : "bg-crimson-500 hover:bg-crimson-400",
              ].join(" ")}
            >
              {cooldownLeft > 0 ? `Wait ${cooldownLeft}s` : sending ? "Sending…" : "Send emote"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function EmoteOpener({ onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="fixed right-4 bottom-4 z-[998] rounded-full p-3 bg-ink-900/80 ring-1 ring-white/10 hover:bg-ink-800"
      aria-label="Open emote drawer"
      title="Send an emote"
    >
      <span className="text-2xl">🎨</span>
    </button>
  );
}
