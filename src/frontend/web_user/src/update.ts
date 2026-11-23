/**
 * Keeps an open or installed app on the latest version: an app added to the iPhone's home screen keeps the page it
 * loaded in memory for days, so when it comes back to the foreground (and every few minutes) it compares its own
 * script with the one the server serves now and reloads if a new version has been published.
 */
function currentScript(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return el ? new URL(el.src, location.href).pathname : null;
}

async function check() {
  const mine = currentScript();
  if (!mine) return;
  try {
    const res = await fetch(`/app/?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const html = await res.text();
    const served = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1];
    if (!served || new URL(served, location.href).pathname === mine) return;
    // do not lose what someone is typing: wait until nothing is focused
    const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (typing) return;
    location.reload();
  } catch {
    /* offline: try again later */
  }
}

export function setupAutoUpdate() {
  if (import.meta.env.DEV) return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
  window.addEventListener("pageshow", () => void check());
  window.setInterval(() => {
    if (document.visibilityState === "visible") void check();
  }, 5 * 60 * 1000);
  void check();
}
