import { getSocket } from "../../../packages/shared/socket.js";
const s = getSocket(import.meta.env.VITE_SERVER_URL);
export default s;
