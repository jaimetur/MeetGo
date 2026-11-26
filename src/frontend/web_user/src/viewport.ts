/**
 * Makes the app behave like a native app on phones, especially iPhone:
 * - the app fills the screen, and while the on-screen keyboard is open it is sized to the visible area
 *   (--app-height / --app-top), so the header and the composer stay above the keyboard;
 * - pinch zoom is blocked (iOS ignores user-scalable=no);
 * - the class "kb" on <html> says the on-screen keyboard is open.
 */
// Installed on the iPhone's or iPad's home screen (an app installed on Android resizes itself with the keyboard).
// A web app added to the Mac's Dock also says `standalone`, but its window is not the whole screen: a Mac has no
// touch screen, an iPhone or iPad does.
const iosStandalone = () => (navigator as any).standalone === true && navigator.maxTouchPoints > 0;

export function setupViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const coarse = window.matchMedia("(pointer: coarse)");
  // The tallest visible area seen with nothing focused: on Android the whole page shrinks with the keyboard, so the
  // keyboard shows as the visible area being much shorter than that.
  let tallest = 0;

  const update = () => {
    const height = vv ? vv.height : window.innerHeight;
    // the screen's height as JavaScript measures it, for the windows and the story viewer: the viewport units of CSS
    // (vh, dvh) are not reliable inside Android's WebView (they can come as almost nothing)
    root.style.setProperty("--screen-h", `${Math.round(window.innerHeight || height)}px`);
    const el = document.activeElement;
    // only fields that open the keyboard: a checkbox, a switch or a radio does not (tapping one is not writing)
    const NO_KEYBOARD = ["checkbox", "radio", "range", "button", "submit", "reset", "color", "file", "image"];
    const typing = !!el && (el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable
      || (el.tagName === "INPUT" && !NO_KEYBOARD.includes((el as HTMLInputElement).type)));
    if (!typing) tallest = Math.max(tallest, height);
    const keyboard = typing && (window.innerHeight - height > 120 || tallest - height > 120);
    root.classList.toggle("kb", keyboard);
    // Writing on a phone: the tab bar steps aside at once, before the keyboard has finished opening.
    root.classList.toggle("writing", typing && coarse.matches);
    if (keyboard) {
      // Only with the keyboard open: fit the app above it, so the header and the composer stay visible.
      root.style.setProperty("--app-height", `${Math.round(height)}px`);
      root.style.setProperty("--app-top", `${Math.round(vv ? vv.offsetTop : 0)}px`);
    } else if (iosStandalone()) {
      // Installed on the iPhone, iOS reports a viewport shorter than the screen (it takes the status bar off) while
      // the app is drawn from the top of the screen: size it to the whole screen, edge to edge.
      const portrait = window.innerHeight >= window.innerWidth;
      const full = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
      root.style.setProperty("--app-height", `${Math.max(full, window.innerHeight)}px`);
      root.style.setProperty("--app-top", "0px");
      // Phones with a home indicator (no home button): if iOS reports no bottom safe area, keep its space anyway.
      root.style.setProperty("--home-ind", portrait && Math.max(screen.width, screen.height) >= 812 ? "34px" : "0px");
    } else {
      // Otherwise the app fills the whole screen, also the strip under Safari's own bottom bar.
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-top");
    }
    // The page itself never scrolls (each screen scrolls inside): without the keyboard, if the phone moved it (Android
    // brings a focused switch or checkbox into view by moving the whole page up), put it back.
    if (!keyboard) unscroll();
  };
  const unscroll = () => {
    const el = document.scrollingElement || document.documentElement;
    if (window.scrollY || el.scrollTop || document.body.scrollTop || (vv && vv.offsetTop > 1 && vv.scale <= 1.01)) {
      window.scrollTo(0, 0);
      el.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  };
  window.addEventListener("scroll", () => {
    const el = document.activeElement;
    const typing = !!el && (el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable || (el.tagName === "INPUT" && !["checkbox", "radio", "range", "button", "submit", "reset", "color", "file", "image"].includes((el as HTMLInputElement).type)));
    if (!typing) unscroll();
  }, { passive: true });
  update();
  reportNative();
  vv?.addEventListener("resize", update);
  vv?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  document.addEventListener("focusin", () => { update(); window.setTimeout(update, 300); });
  window.addEventListener("orientationchange", () => { tallest = 0; window.setTimeout(update, 300); });

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

/**
 * Diagnostic: open the app with ?vp=1 to see, on the phone itself, what the browser reports about the screen
 * (sizes, safe areas, installed or not) and where the app and its tab bar end. Nothing shows otherwise.
 */
export function viewportDiagnostics() {
  if (!/[?&]vp=1\b/.test(window.location.search)) return;
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  const box = document.createElement("pre");
  box.style.cssText = "position:fixed;z-index:9999;left:8px;right:8px;top:40%;margin:0;padding:10px;border-radius:12px;background:rgba(0,0,0,.85);color:#7CFC9A;font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap;cursor:pointer";
  const line = document.createElement("div");
  line.style.cssText = "position:fixed;z-index:9998;left:0;right:0;height:0;border-top:2px dashed #ff3b6b;pointer-events:none";
  document.body.append(probe, box, line);
  // shown once: the address loses ?vp=1, and a tap on the box closes it
  const url = new URL(window.location.href);
  url.searchParams.delete("vp");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  let timer = 0;
  box.addEventListener("click", () => {
    window.clearInterval(timer);
    probe.remove();
    box.remove();
    line.remove();
  });
  const show = () => {
    const cs = getComputedStyle(probe);
    const vv = window.visualViewport;
    const root = document.getElementById("root")?.getBoundingClientRect();
    const nav = document.querySelector(".mnav")?.getBoundingClientRect();
    line.style.top = `${Math.round(root?.bottom ?? 0)}px`;
    box.textContent = [
      `standalone: ${(navigator as any).standalone ?? "?"} · display-mode: ${matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser"}`,
      `screen: ${screen.width}×${screen.height} · dpr ${devicePixelRatio}`,
      `inner: ${innerWidth}×${innerHeight} · docEl: ${document.documentElement.clientHeight}`,
      `visualViewport: ${vv ? `${Math.round(vv.width)}×${Math.round(vv.height)} top ${Math.round(vv.offsetTop)}` : "-"}`,
      `safe-area: top ${cs.paddingTop} bottom ${cs.paddingBottom} left ${cs.paddingLeft} right ${cs.paddingRight}`,
      `body: ${Math.round(document.body.getBoundingClientRect().height)} · #root bottom: ${Math.round(root?.bottom ?? 0)} (red line)`,
      `tab bar: ${nav ? `${Math.round(nav.top)}–${Math.round(nav.bottom)}` : "hidden"}`,
      `--app-height: ${getComputedStyle(document.documentElement).getPropertyValue("--app-height") || "(none)"}`,
      "✕",
    ].join("\n");
  };
  show();
  window.visualViewport?.addEventListener("resize", show);
  window.addEventListener("resize", show);
  timer = window.setInterval(show, 1000);
}



/** Inside the Android app, once: what its WebView says of the screen (in the request logs of the administration), to
 * see how it measures it. */
/** In the Android app only: the screen's measures a moment after `what` (Administration → Logs, "settings/public?diag="),
 *  to see what a phone does without a screenshot. */
export function reportNativeNow(what: string) {
  if (!/MeetGoApp\//.test(navigator.userAgent)) return;
  window.setTimeout(() => {
    const root = document.documentElement, r = (sel: string) => Math.round(document.querySelector(sel)?.getBoundingClientRect().height || 0);
    const d = { what, iw: innerWidth, ih: innerHeight, vv: Math.round(window.visualViewport?.height || 0), vvs: window.visualViewport?.scale ?? "-",
      sy: Math.round(window.scrollY), vt: Math.round(window.visualViewport?.offsetTop || 0), rt: Math.round(document.querySelector("#root")?.getBoundingClientRect().top || 0),
      apph: root.style.getPropertyValue("--app-height") || "-", kb: root.classList.contains("kb") ? 1 : 0, wr: root.classList.contains("writing") ? 1 : 0,
      root: r("#root"), shell: r(".shell"), screen: r(".screen, .page"), nav: r(".mnav"), act: document.activeElement?.tagName || "-",
      zoom: getComputedStyle(document.querySelector(".screen, .page") || root).zoom };
    const q = Object.entries(d).map(([k, v]) => `${k}:${v}`).join(",");
    import("./api").then(({ API_BASE }) => fetch(`${API_BASE}/settings/public?diag=${encodeURIComponent(q)}`).catch(() => undefined));
  }, 1500);
}

function reportNative() {
  if (!/MeetGoApp\//.test(navigator.userAgent)) return;
  try {
    if (sessionStorage.getItem("mg.diag")) return;
    sessionStorage.setItem("mg.diag", "1");
  } catch { /* a report more is fine */ }
  window.setTimeout(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;width:1px;height:100dvh;visibility:hidden;padding-top:env(safe-area-inset-top,0px)";
    document.body.appendChild(probe);
    const dvh = probe.getBoundingClientRect().height;
    probe.style.height = "100vh";
    const vh = probe.getBoundingClientRect().height;
    const top = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    const screenEl = document.querySelector(".screen");
    const d = { ih: innerHeight, iw: innerWidth, vv: Math.round(window.visualViewport?.height || 0), dvh: Math.round(dvh), vh: Math.round(vh), sat: top,
      dpr: devicePixelRatio, zoom: screenEl ? getComputedStyle(screenEl).zoom : "-", size: document.documentElement.dataset.chatsize || "normal" };
    const q = Object.entries(d).map(([k, v]) => `${k}:${v}`).join(",");
    import("./api").then(({ API_BASE }) => fetch(`${API_BASE}/settings/public?diag=${encodeURIComponent(q)}`).catch(() => undefined));
  }, 3000);
}
