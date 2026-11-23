/**
 * Makes the app behave like a native app on phones, especially iPhone:
 * - the app is sized to the visible area (--app-height / --app-top), so the header and the composer stay on screen
 *   when Safari's bars or the keyboard come and go;
 * - pinch zoom is blocked (iOS ignores user-scalable=no);
 * - the class "kb" on <html> says the on-screen keyboard is open.
 */
export function setupViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;

  const update = () => {
    const height = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    root.style.setProperty("--app-height", `${Math.round(height)}px`);
    root.style.setProperty("--app-top", `${Math.round(top)}px`);
    root.classList.toggle("kb", window.innerHeight - height > 120);
  };
  update();
  vv?.addEventListener("resize", update);
  vv?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", () => window.setTimeout(update, 300));

  // iOS Safari zooms with two fingers even with user-scalable=no.
  const block = (e: Event) => e.preventDefault();
  for (const name of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(name, block, { passive: false });
  document.addEventListener("touchmove", (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // When the keyboard closes, iOS can leave the page shifted up: put it back.
  document.addEventListener("focusout", () => window.setTimeout(() => {
    const el = document.activeElement;
    if (!el || !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) window.scrollTo(0, 0);
  }, 100));
}
