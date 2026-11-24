import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// The administration lives in the app now (Perfil → Administración); the old address takes you there.
if (window.location.hostname === "admin.meetgo.app") window.location.replace("https://www.meetgo.app/app/admin");

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
