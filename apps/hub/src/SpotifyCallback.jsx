import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { requestToken } from "./spotify/spotifyAuth.js";
import { useGameStore } from "./store";

export default function SpotifyCallback() {
  const createRoom = useGameStore(s => s.createRoom);
  const navigate = useNavigate();
  const ran = useRef(false); 
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const data = await requestToken(); // exchanges ?code → tokens
        const pending = localStorage.getItem("pending_action");
        if (data && pending === "createRoom") {
          localStorage.removeItem("pending_action");
          await createRoom(); // server will push room:update → stage "lobby"
        }
      } catch (e) {
        console.error("Spotify token exchange failed:", e);
      } finally {
        navigate("/", { replace: true }); // leave /callback quickly
      }
    })();
  }, [createRoom, navigate]);

  return <div className="min-h-dvh grid place-items-center">Completing Spotify sign-in…</div>;
}