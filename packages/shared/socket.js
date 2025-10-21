import { io } from "socket.io-client";

let s;

export function getSocket(url) {
  if (typeof window !== "undefined" && window.__MIXMATCH_SOCKET__) {
    s = window.__MIXMATCH_SOCKET__;
    return s;
  }
  if (s) return s;

  // Same-origin by default (so Vite proxy kicks in).
  // If a URL is provided (e.g., from the Player in another setup), use it.
  const opts = {
    path: "/socket.io",
    transports: ["websocket", "polling"], // allow polling fallback behind proxies
    withCredentials: true,
    autoConnect: true,
  };

  s = url ? io(url, opts) : io(opts);

  if (typeof window !== "undefined") {
    window.__MIXMATCH_SOCKET__ = s;
  }
  return s;
}

export function resetSocket() {
  if (s) {
    try { s.disconnect(); } catch {}
    if (typeof window !== "undefined") delete window.__MIXMATCH_SOCKET__;
    s = null;
  }
}
