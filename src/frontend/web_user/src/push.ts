import { api } from "./api";
import { isNativeApp, native, setNativeHandlers } from "./native";

let registeredFcm = "";

/** Android app: register the FCM token the native side gives us (now and on refresh). */
export function setupNativePush() {
  if (!isNativeApp) return;
  setNativeHandlers({ pushToken: (token) => registerFcm(token) });
  const token = native.pushToken();
  if (token) registerFcm(token);
}

function registerFcm(token: string) {
  if (!token || token === registeredFcm) return;
  registeredFcm = token;
  api.registerDevice("fcm", token).catch(() => (registeredFcm = ""));
}

export function webPushSupported(): boolean {
  return !isNativeApp && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function webPushPermission(): NotificationPermission | "unsupported" {
  return webPushSupported() ? Notification.permission : "unsupported";
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

/** Ask permission (from a click) and subscribe this browser to Web Push. */
export async function enableWebPush(): Promise<boolean> {
  if (!webPushSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  return subscribeExisting();
}

/** Re-subscribe silently when permission was already granted. */
export async function subscribeExisting(): Promise<boolean> {
  if (!webPushSupported() || Notification.permission !== "granted") return false;
  const reg = await registerServiceWorker();
  if (!reg) return false;
  const { webpush_public_key } = await api.pushConfig();
  if (!webpush_public_key) return false;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(webpush_public_key) as BufferSource });
  }
  const json = sub.toJSON();
  await api.registerDevice("webpush", sub.endpoint, { p256dh: json.keys?.p256dh || "", auth: json.keys?.auth || "" });
  return true;
}

export async function disableWebPush() {
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.removeDevice("webpush", sub.endpoint).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
}

/** Tell the service worker which conversation is on screen, so it does not notify it. */
export function announceActiveConversation(id: number | null) {
  native.setActiveConversation(id);
  navigator.serviceWorker?.controller?.postMessage({ type: "active-conversation", id });
}
