import React from "react";
import ReactDOM from "react-dom/client";
import App from "../src/ui/App";
import { setupViewport, viewportDiagnostics } from "../src/viewport";
import "../src/styles.css";

setupViewport();
window.addEventListener("load", viewportDiagnostics);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
