import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: process.env.VITE_ROOT || ".",
  plugins: [react()],
  server: {
    allowedHosts: ["meetgo.app", "www.meetgo.app", "admin.meetgo.app", "api.meetgo.app", "home.meetgo.app", "inicio.meetgo.app"],
    fs: {
      allow: [__dirname]
    }
  }
});
