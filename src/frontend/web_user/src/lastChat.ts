/** The last chat I opened (kept on this device, also when the app or the server restarts): the list of Chats shows it
 *  on top, to go back to it with one tap. */
const KEY = "lastChat";

export function lastChat(): number | null {
  try {
    return Number(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

export function rememberChat(id: number) {
  try {
    localStorage.setItem(KEY, String(id));
  } catch {
    /* per-device preference */
  }
}
