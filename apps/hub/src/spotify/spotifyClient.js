// apps/hub/src/spotify/spotifyClient.js
import {
  getAccessToken,
  getPlaylistData,
  getPreferredDeviceId,
  setPreferredDeviceId,
} from "./spotifyAuth.js";

// ---- Spotify Web API wrapper ----
async function api(path, init = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error("No Spotify token");

  const resp = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

  if (resp.status === 204) return null;

  const ct = resp.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const body = isJson
    ? await resp.json().catch(() => null)
    : await resp.text().catch(() => "");

  if (resp.ok) return body;

  const snippet =
    typeof body === "string"
      ? ` - ${body.slice(0, 180)}`
      : body
      ? ` - ${JSON.stringify(body).slice(0, 180)}`
      : "";
  const e = new Error(`Spotify API ${resp.status}: ${resp.statusText}${snippet}`);
  e.status = resp.status;
  throw e;
}


export async function listDevices() {
  const data = await api("/me/player/devices");
  return data?.devices || [];
}

function pickBestDevice(devices) {
  if (!Array.isArray(devices) || devices.length === 0) return null;
  const byType = (t) => devices.find(d => (d.type || "").toLowerCase() === t);
  return (
    devices.find(d => d.is_active) ||  // active first
    byType("computer") ||              // prefer desktop app
    devices[0]                         // otherwise first available
  );
}

async function ensureDeviceId(candidate = null) {
  const existing = candidate || getPreferredDeviceId();
  if (existing) return existing;

  const devices = await listDevices();
  const best = pickBestDevice(devices);
  if (!best) {
    // User must open Spotify once so the device appears in /me/player/devices
    throw new Error("Open Spotify on your computer once to activate it.");
  }
  setPreferredDeviceId(best.id);
  return best.id;
}


/** Accept plain id, spotify:playlist:URI, or open.spotify.com URL. */
function normPlaylistId(input) {
  const s = String(input || "").trim();
  if (s.startsWith("spotify:playlist:")) return s.split(":").pop();
  const m = s.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]{22})/);
  return m ? m[1] : s;
}

function normalizeTrack(t) {
  if (!t || !t.id) return null;
  const artists = (t.artists || []).map(a => a?.name).filter(Boolean);
  return {
    id: t.id,
    title: t.name || "",
    artist: artists.join(", "),
    uri: t.uri || null,
    previewUrl: t.preview_url || null,
  };
}

export async function getPlaylistTracksLow(playlistId, { limit = 100 } = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error("No Spotify token");
  const id = normPlaylistId(playlistId);
  const raw = await getPlaylistData(token, id);
  const out = raw.map(normalizeTrack).filter(Boolean);
  return out.slice(0, limit);
}

export async function collectTracksFromPlaylists(   
// We use let only inside the Fisher–Yates shuffle to keep it O(n) time.
// These let indices are local to the loop and never mutate shared application state.

  playlistIds, 
  { perList = 100, maxTotal = 200, shuffle = true } = {}
) {
  const ids = Array.from(new Set((playlistIds || []).map(normPlaylistId)));
  let bag = [];
  for (const id of ids) {
    try {
      const chunk = await getPlaylistTracksLow(id, { limit: perList });
      bag.push(...chunk);
    } catch (e) {
      console.warn("playlist fetch failed", id, e);
    }
  }
  // de-dup by track id
  const seen = new Set();
  const dedup = bag.filter(t => (t.id && !seen.has(t.id)) ? (seen.add(t.id), true) : false);

  if (shuffle) {
    for (let i = dedup.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [dedup[i], dedup[j]] = [dedup[j], dedup[i]];
    }
  }
  return dedup.slice(0, maxTotal);
}

export async function getPlaybackState() {
  try {
    // returns { is_playing, item, device, ... } or null
    const st = await api("/me/player");
    return st || null;
  } catch {
    return null;
  }
}
export async function startPlayback({ uris, position_ms = 0, device_id = null }) {
  if (!Array.isArray(uris) || uris.length === 0) {
    throw new Error("startPlayback: uris[] required");
  }

  const id = await ensureDeviceId(device_id);
  const q = `?device_id=${encodeURIComponent(id)}`;

  try {
    await api(`/me/player/play${q}`, {
      method: "PUT",
      body: JSON.stringify({ uris, position_ms }),
    });
    return;
  } catch (e) {
    try {
      await api("/me/player", {
        method: "PUT",
        body: JSON.stringify({ device_ids: [id], play: false }),
      });
      await api(`/me/player/play${q}`, {
        method: "PUT",
        body: JSON.stringify({ uris, position_ms }),
      });
      return;
    } catch (e2) {
      console.error("startPlayback failed after transfer attempt", e, e2);
      throw e2;
    }
  }
}

export async function pausePlayback() {
  try {
    const st = await getPlaybackState().catch(() => null);
    if (!st?.is_playing) return;
    await api(`/me/player/pause`, { method: "PUT" });
  } catch (e) {
    if (e?.status !== 403 && e?.status !== 404) console.warn("pausePlayback", e);
  }
}


export async function transferPlaybackTo(device_id, { play = false } = {}) {
  if (!device_id) throw new Error("transferPlaybackTo: device_id required");
  setPreferredDeviceId(device_id);
  await api("/me/player", {
    method: "PUT",
    body: JSON.stringify({ device_ids: [device_id], play: !!play }),
  });
}


export function attachPlaybackController(useGame) {
  const select = (s) => ({
    stage: s.stage,
    qid: s.question?.id || null,
    uri: s.media?.spotifyUri || null,
  });
  const same = (a, b) => a.stage === b.stage && a.qid === b.qid && a.uri === b.uri;

  const ref = {
    last: select(useGame.getState()),
    lastQ: null,
    playedThisQ: false,
    keepAlive: null,
  };

  // Only resume if it's the SAME track and currently paused.
  async function resumeIfPausedSameTrack(targetUri) {
    try {
      const st = await getPlaybackState().catch(() => null);
      const sameTrack = !!(st?.item?.uri && targetUri && st.item.uri === targetUri);
      if (!sameTrack) return;     // never start a different track here
      if (st?.is_playing) return; // already playing → nothing to do
      await api(`/me/player/play`, { method: "PUT", body: JSON.stringify({}) });
    } catch {
      // keepAlive shouldn't hard-reset anything even if this fails
    }
  }

  async function onEnterQuestion(uri) {
    ref.playedThisQ = false;

    if (ref.keepAlive) { clearInterval(ref.keepAlive); ref.keepAlive = null; }

    if (uri) {
      try {
        await startPlayback({ uris: [uri], position_ms: 0 });
        ref.playedThisQ = true;
      } catch (e) {
        console.warn("[ctrl] initial play failed", e);
      }
    }

    ref.keepAlive = setInterval(() => {
      const st = select(useGame.getState());
      if (st.stage === "question" && st.qid === ref.lastQ && st.uri) {
        // resume only if paused on the SAME uri
        resumeIfPausedSameTrack(st.uri);
      }
    }, 800);
  }

  async function react(curr, prev) {
    const { stage, qid, uri } = curr;
    const entering = stage === "question" && qid && qid !== ref.lastQ;
    const leavingQuestion = prev.stage === "question" && stage !== "question";

    if (entering) {
      ref.lastQ = qid;
      await onEnterQuestion(uri);
      return;
    }

    if (leavingQuestion) {
      if (ref.keepAlive) { clearInterval(ref.keepAlive); ref.keepAlive = null; }
      return;
    }

    const uriArrived =
      stage === "question" && qid === ref.lastQ && !ref.playedThisQ && !!uri && prev.uri !== uri;

    if (uriArrived) {
      try {
        await startPlayback({ uris: [uri], position_ms: 0 });
        ref.playedThisQ = true;
      } catch (e) {
        console.warn("[ctrl] late media play failed", e);
      }
    }

    if (stage === "gameover") {
      if (ref.keepAlive) { clearInterval(ref.keepAlive); ref.keepAlive = null; }
      try { await pausePlayback(); } catch {}
    }
  }

  react(ref.last, ref.last);

  const unsub = useGame.subscribe(() => {
    const curr = select(useGame.getState());
    if (same(curr, ref.last)) return;
    const prev = ref.last; ref.last = curr;
    react(curr, prev);
  });

  if (typeof window !== "undefined") {
    try { window.__mm_playback_unsub?.(); } catch {}
    window.__mm_playback_unsub = unsub;
  }

  // cleanup
  return () => {
    try { unsub(); } catch {}
    if (ref.keepAlive) { clearInterval(ref.keepAlive); ref.keepAlive = null; }
    if (typeof window !== "undefined" && window.__mm_playback_unsub === unsub) {
      window.__mm_playback_unsub = null;
    }
  };
}


