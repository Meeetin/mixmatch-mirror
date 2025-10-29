import { makeGameStore } from "../../../packages/shared/gameStore.js";

export const useGameStore = makeGameStore(import.meta.env.VITE_SERVER_URL);
