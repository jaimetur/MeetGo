/**
 * Makes the app behave like a native app on phones, especially iPhone:
 * - the app fills the screen, and while the on-screen keyboard is open it is sized to the visible area
 *   (--app-height / --app-top), so the header and the composer stay above the keyboard;
 * - pinch zoom is blocked (iOS ignores user-scalable=no);
 * - the class "kb" on <html> says the on-screen keyboard is open.
 */
export function setupViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;

  const update = () => {
    const height = vv ? vv.height : window.innerHeight;
    const el = document.activeElement;
    const typing = !!el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    const keyboard = typing && window.innerHeight - height > 120;
    root.classList.toggle("kb", keyboard);
    if (keyboard) {
      // Only with the keyboard open: fit the app above it, so the header and the composer stay visible.
      root.style.setProperty("--app-height", `${Math.round(height)}px`);
      root.style.setProperty("--app-top", `${Math.round(vv ? vv.offsetTop : 0)}px`);
    } else {
      // Otherwise the app fills the whole screen, also the strip under Safari's own bottom bar.
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-top");
    }
  };
  update();
  vv?.addEventListener("resize", update);
  vv?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  document.addEventListener("focusin", () => window.setTimeout(update, 300));
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
    update();
  }, 100));
}
