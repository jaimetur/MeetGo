import React from "react";
import ReactDOM from "react-dom/client";
import App from "../src/ui/App";
import { setupViewport } from "../src/viewport";
import "../src/styles.css";

setupViewport();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
