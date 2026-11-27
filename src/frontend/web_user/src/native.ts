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
 *  it (Android's Chrome), a very short vibration. iPhones' browsers have none. */
let lastHaptic = 0;
export function haptic() {
  const now = Date.now();
  if (now - lastHaptic < 60) return;
  lastHaptic = now;
  if (bridge?.haptic) { call((b) => b.haptic!(), undefined); return; }
  if (!bridge) try { navigator.vibrate?.(8); } catch { /* not allowed here */ }
}

/** Every press of a button, tab, chip, switch or checkbox of the app gets the tap (once the press is done: not when a
 *  finger only starts a scroll on it). */
export function enableHaptics() {
  document.addEventListener("click", (e) => {
    const el = (e.target as Element | null)?.closest?.("button, [role=button], [role=tab], [role=switch], a.btn, .chip, label.tgl, input[type=checkbox], input[type=radio]");
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
