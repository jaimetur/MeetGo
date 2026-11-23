import React from "react";
import ReactDOM from "react-dom/client";
import App from "../src/ui/App";
import { setupViewport, viewportDiagnostics } from "../src/viewport";
import { setupAutoUpdate } from "../src/update";
import "../src/styles.css";

setupViewport();
setupAutoUpdate();
window.addEventListener("load", viewportDiagnostics);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
