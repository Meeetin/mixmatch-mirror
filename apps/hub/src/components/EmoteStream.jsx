import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import s from "../socket.js";

// timings and limits
const DUR_MIN = 5500;
const DUR_MAX = 9000;
const MAX_ITEMS = 24;

export default function EmoteStream() {
  const [items, setItems] = useState([]);
  const idSet = useRef(new Set());
  const [mountNode, setMountNode] = useState(null);

  useEffect(() => setMountNode(document.body), []);

  useEffect(() => {
    const onConnect = () => console.debug("[Hub EmoteStream] connected", s.id);
    const onNew = (payload) => {
      if (!payload?.id || idSet.current.has(payload.id)) return;
      idSet.current.add(payload.id);

      const size = randInt(72, 144);
      const left = Math.random() * 80 + 10;      // 10–90%
      const drift = (Math.random() - 0.5) * 20;  // ±20px
      const dur = randInt(DUR_MIN, DUR_MAX);

      const item = { ...payload, size, left, drift, dur, born: Date.now() };

      setItems((prev) => {
        const next = [...prev, item];
        return next.length > MAX_ITEMS ? next.slice(next.length - MAX_ITEMS) : next;
      });

      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== payload.id));
        setTimeout(() => idSet.current.delete(payload.id), 10_000);
      }, dur + 150);
    };

    s.on("connect", onConnect);
    s.on("emote:new", onNew);
    return () => {
      s.off("connect", onConnect);
      s.off("emote:new", onNew);
    };
  }, []);

  if (!mountNode) return null;

  return createPortal(
    <>
      <style>{`
        @keyframes emote-rise {
          0%   { transform: translate(-50%, 20vh) scale(0.95); opacity: 0; }
          10%  { opacity: 1; }
          100% { transform: translate(-50%, -40vh) scale(1); opacity: 0; }
        }
      `}</style>

      <div className="pointer-events-none fixed inset-0 z-[999999]">
        {items.map((it) => (
          <Emote key={it.id} item={it} />
        ))}
      </div>
    </>,
    mountNode
  );
}

function Emote({ item }) {
  return (
    <div
      className="absolute will-change-transform"
      style={{
        left: `${item.left}%`,
        bottom: `-8vh`,
        animation: `emote-rise ${item.dur}ms linear forwards`,
      }}
    >
      <img
        src={item.image}
        alt={`${item.name}'s emote`}
        width={item.size}
        height={item.size}
        className="block rounded-xl"
        style={{ transform: `translateX(${item.drift}px)` }}
      />
      <div
        className="mt-1 text-center text-sm text-mist-200 drop-shadow"
        style={{ transform: `translateX(${item.drift}px)` }}
      >
        {item.name}
      </div>
    </div>
  );
}


function randInt(a, b) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}
