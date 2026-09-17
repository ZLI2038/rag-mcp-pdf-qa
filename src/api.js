export const API_URL = (process.env.REACT_APP_API_URL || "http://localhost:5001").replace(/\/$/, "");
let memorySession;
export function sessionHeaders() {
  let id;
  try { id = sessionStorage.getItem("agentai-session"); } catch {}
  if (!id) {
    if (!memorySession) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      memorySession = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
    }
    id = memorySession;
    try { sessionStorage.setItem("agentai-session", id); } catch {}
  }
  return { "X-Session-Id": id };
}
