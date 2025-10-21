import { getPlaylistData, getAccessToken } from "./spotifyAuth.js";


export async function makeTrackList(playlistID, n) {
    // Shuffle to get n amount of random tracks from the list
    function shuffle(a) {
        for (let i = a.length - 1; i > 0; i--) { //Pure function: mutation is confined and does not affect external state
          const j = (Math.random() * (i + 1)) | 0;
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // Saves the correct track info
    function saveCorrectInfoCB(trackObject, i) {
        return {
            id: trackObject.id,// `t${i+1}`,
            title: trackObject.name,
            artist: trackObject.artists[0].name,
            previewUrl: trackObject.preview_url || null,
            uri: trackObject.uri || null,
        };
    }
    const token = await getAccessToken();
    const dataPL = await getPlaylistData(token, playlistID);
    const tracks = shuffle(dataPL).slice(0, n).map(saveCorrectInfoCB);
    return tracks;
}