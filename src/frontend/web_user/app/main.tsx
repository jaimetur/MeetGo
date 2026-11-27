import React from "react";
import ReactDOM from "react-dom/client";
import App from "../src/ui/App";
import { setupViewport, viewportDiagnostics } from "../src/viewport";
import { setupAutoUpdate } from "../src/update";
import { enableHaptics } from "../src/native";
import "../src/styles.css";
import { API_BASE } from "../src/api";
import { configureLanguages, needsTexts, storedLang } from "@lang";

setupViewport();
setupAutoUpdate();
enableHaptics();  // a light tap of the phone on every button press
window.addEventListener("load", viewportDiagnostics);

/** The languages switched off or added in the administration (a slow or missing answer does not hold the app up). */
async function loadLanguages() {
  const get = (path: string) => fetch(API_BASE + path, { signal: AbortSignal.timeout(2500) }).then((r) => (r.ok ? r.json() : null));
  try {
    const cfg = await get("/i18n/languages");
    if (!cfg) return;
    const added: { code: string; name: string; texts?: Record<string, string> }[] = cfg.added || [];
    const mine = added.find((l) => l.code === storedLang() && needsTexts(l.code));
    if (mine) mine.texts = (await get(`/i18n/${mine.code}`)) || undefined;
    configureLanguages(cfg.disabled || [], added);
  } catch {
    /* offline: the languages that come with the app */
  }
}

loadLanguages().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
