/** The Android app's bridge (window.MeetGoNative). Everything is a no-op in a normal browser. */

type Bridge = {
  appVersion(): string;
  setSession(apiBase: string, token: string): void;
  getPushToken(): string;
  setActiveConversation(id: number): void;
  setBadge(count: number): void;
  openNotificationSettings(): void;
  changeServer(): void;
  billingProducts(): string;
  subscribe(plan: string): void;
  restorePurchase(): void;
  takeShared(): string;
  saveFile(name: string, mime: string, base64: string): void;
  haptic?(): void;  // apps from 0.2.0 (23) on
};

const bridge = (window as unknown as { MeetGoNative?: Bridge }).MeetGoNative;
export const isNativeApp = !!bridge;
if (isNativeApp) document.documentElement.classList.add("inapp");

function call<T>(fn: (b: Bridge) => T, fallback: T): T {
  if (!bridge) return fallback;
  try {
    return fn(bridge);
  } catch {
    return fallback;
  }
}

export const native = {
  setSession: (apiBase: string, token: string) => call((b) => b.setSession(apiBase, token), undefined),
  pushToken: () => call((b) => b.getPushToken() || "", ""),
  setActiveConversation: (id: number | null) => call((b) => b.setActiveConversation(id || 0), undefined),
  setBadge: (count: number) => call((b) => b.setBadge(count), undefined),
  openNotificationSettings: () => call((b) => b.openNotificationSettings(), undefined),
  changeServer: () => call((b) => b.changeServer(), undefined),
  billingProducts: (): { plan: string; price: string; trialDays: number }[] =>
    call((b) => JSON.parse(b.billingProducts() || "[]"), []),
  subscribe: (plan: string) => call((b) => b.subscribe(plan), undefined),
  restorePurchase: () => call((b) => b.restorePurchase(), undefined),
  takeShared: (): { text?: string; files?: { name: string; mime: string; base64: string }[] } =>
    call((b) => JSON.parse(b.takeShared() || "{}"), {}),
};

/** A light tap of the phone when a button is pressed: the app's own (system touch feedback) or, in a browser that has
 *  it (Android's Chrome), a very short vibration. */
let lastHaptic = 0;
const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
export function haptic() {
  const now = Date.now();
  if (now - lastHaptic < 60) return;
  lastHaptic = now;
  if (bridge?.haptic) { call((b) => b.haptic!(), undefined); return; }
  if (bridge) return;  // an older app: nothing
  try { if (canVibrate) navigator.vibrate(8); } catch { /* not allowed here */ }
}

/** iPhones (no vibration for web pages): the system gives its tap only when a finger really presses a switch
 *  (<input type="checkbox" switch>, iOS 18 on). So, for every button (as on Android), one invisible switch is put
 *  right under the finger when it touches one, and the press is handed to the button underneath. Where holding the
 *  finger opens a menu (the chats of the list, the logo), the hold is handed too (as a context menu). Not inside the
 *  messages of a chat, which handle the finger themselves. While waiting it is fully transparent and off the screen: iOS then does
 *  not count its move as something appearing under the finger (it would drop that first tap). A move of the finger
 *  (a scroll) sends it away, so lists scroll as always. */
// buttons, tabs, chips, switches, checkboxes and the cards that open something (role link) or links
const TAP_TARGETS = "button, [role=button], [role=tab], [role=switch], [role=link], a[href], .chip, label.tgl, input[type=checkbox], input[type=radio]";
const IOS_SKIP = ".msgs";
const IOS_HOLD = ".crow, .appiconbtn";
function iosTaps() {
  const sw = document.createElement("input");
  sw.type = "checkbox";
  sw.setAttribute("switch", "");
  sw.tabIndex = -1;
  sw.setAttribute("aria-hidden", "true");
  sw.dataset.hapticSelf = "1";
  sw.style.cssText = "position:fixed;margin:0;padding:0;opacity:0;z-index:2147483647;left:-200px;top:-200px;width:44px;height:44px;";
  document.body.appendChild(sw);
  let target: HTMLElement | null = null;
  let from: { x: number; y: number } | null = null;
  let held = false;
  let holdTimer = 0;
  let heldAt = 0;
  let heldEl: HTMLElement | null = null;
  // lifting the finger after a hold must not also open what was held
  document.addEventListener("click", (e) => {
    if (heldEl && Date.now() - heldAt < 1500 && heldEl.contains(e.target as Node)) {
      e.preventDefault();
      e.stopPropagation();
    }
    heldEl = null;
  }, { capture: true });
  const park = () => { sw.style.left = "-200px"; sw.style.top = "-200px"; target = null; window.clearTimeout(holdTimer); };
  document.addEventListener("touchstart", (e) => {
    const touched = e.target as Element | null;
    // a switch of the app: the whole row (its own checkbox is hidden inside it)
    const el = (touched?.closest?.("label.tgl") || touched?.closest?.(TAP_TARGETS)) as HTMLElement | null;
    if (!el || e.touches.length > 1 || (el as HTMLButtonElement).disabled || touched?.closest?.(IOS_SKIP) || el === sw) return;
    const r = el.getBoundingClientRect();
    Object.assign(sw.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    target = el;
    from = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    held = false;
    window.clearTimeout(holdTimer);
    // holding the finger on a chat of the list (or the logo): its menu, as a long press would open it
    if (el.matches(IOS_HOLD)) {
      const at = from;
      holdTimer = window.setTimeout(() => {
        if (target !== el) return;
        held = true;
        heldAt = Date.now();
        heldEl = el;
        park();
        el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }));
      }, 500);
    }
  }, { capture: true, passive: true });
  document.addEventListener("touchmove", (e) => {
    if (target && from && Math.hypot(e.touches[0].clientX - from.x, e.touches[0].clientY - from.y) > 8) park();
  }, { capture: true, passive: true });
  document.addEventListener("scroll", () => { if (target) park(); }, { capture: true, passive: true });
  // while writing (Send), pressing it keeps the focus in the text, so the keyboard stays open
  const writing = () => {
    const a = document.activeElement as HTMLElement | null;
    return a && (/^(INPUT|TEXTAREA)$/.test(a.tagName) || a.isContentEditable) && a !== sw ? a : null;
  };
  let field: HTMLElement | null = null;
  sw.addEventListener("mousedown", (e) => { field = writing(); if (field) e.preventDefault(); });
  sw.addEventListener("click", () => {
    const el = held ? null : target;  // after a hold, the menu is open: no press as well
    held = false;
    park();
    if (document.activeElement === sw) sw.blur();  // a focused hidden box could make the page scroll to it
    if (el && el.isConnected) el.click();
    if (field && document.activeElement !== field && field.isConnected) field.focus();
    field = null;
  });
}

/** Every press of a button, tab, chip, switch or checkbox of the app gets the tap (once the press is done: not when a
 *  finger only starts a scroll on it); on iPhones, through iosTaps. */
export function enableHaptics() {
  if (!bridge && !canVibrate) {
    const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (iphone) iosTaps();
    return;
  }
  document.addEventListener("click", (e) => {
    const target = e.target as Element | null;
    const el = target?.closest?.(TAP_TARGETS);
    if (el && !(el as HTMLButtonElement).disabled) haptic();
  }, { capture: true, passive: true });
}

type W = Window & {
  mgBack?: () => boolean;
  mgNativePushToken?: (token: string) => void;
  mgPurchase?: (result: { token?: string; product?: string; error?: string }) => void;
};

/** Hooks the native side calls into the page. */
export function setNativeHandlers(h: {
  back?: () => boolean;
  pushToken?: (token: string) => void;
  purchase?: (result: { token?: string; product?: string; error?: string }) => void;
}) {
  const w = window as W;
  if (h.back) w.mgBack = h.back;
  if (h.pushToken) w.mgNativePushToken = h.pushToken;
  if (h.purchase) w.mgPurchase = h.purchase;
}
