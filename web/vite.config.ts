import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ["meetgo.app", "www.meetgo.app", "admin.meetgo.app", "api.meetgo.app", "home.meetgo.app", "inicio.meetgo.app"]
  }
});
