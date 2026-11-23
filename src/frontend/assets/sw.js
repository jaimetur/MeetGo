/* MeetGo service worker: shows Web Push notifications and opens the conversation when tapped. */
let activeConversation = null;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "active-conversation") activeConversation = event.data.id || null;
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "MeetGo", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const focused = windows.some((w) => w.focused && w.visibilityState === "visible");
    // The open, visible conversation already shows the message.
    if (focused && String(activeConversation) === String(data.conversation_id)) return;
    await self.registration.showNotification(data.title || "MeetGo", {
      body: data.body || "",
      tag: "c" + (data.conversation_id || ""),
      renotify: true,
      icon: "/apple-touch-icon.png",
      badge: "/apple-touch-icon.png",
      data: { url: data.url || "/app/" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/app/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of windows) {
      if (w.url.startsWith(self.location.origin + "/app")) {
        await w.focus();
        return w.navigate(url);
      }
    }
    return self.clients.openWindow(url);
  })());
});
