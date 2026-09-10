import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const langDir = fs.existsSync(path.join(__dirname, "lang", "lang.ts"))
  ? path.join(__dirname, "lang")
  : path.join(__dirname, "..", "lang");

export default defineConfig({
  root: process.env.VITE_ROOT || ".",
  plugins: [react()],
  resolve: {
    alias: {
      "../lang/lang": path.join(langDir, "lang.ts"),
    },
  },
  server: {
    allowedHosts: ["meetgo.app", "www.meetgo.app", "admin.meetgo.app", "api.meetgo.app", "home.meetgo.app", "inicio.meetgo.app"],
    fs: {
      allow: [__dirname, langDir]
    }
  }
});
