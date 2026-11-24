import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This folder is src/frontend: translations are in lang/ and icons in assets/branding/ at the repository root
// (the Docker build keeps the same layout).
const repoRoot = path.join(__dirname, "..", "..");
const brandingDir = path.join(repoRoot, "assets", "branding");
const langDir = path.join(repoRoot, "lang");
const appVersion: string = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8")).version;

// VITE_ROOT picks the site: ./web_user (landing at "/", app at "/app/") or ./web_admin.
const root = path.resolve(__dirname, process.env.VITE_ROOT || "web_user");
const site = path.basename(root);

/** Every page of the root folder (index.html, app/index.html, privacy.html...) is an entry. */
function htmlEntries(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      if (fs.statSync(full).isDirectory()) {
        if (!["node_modules", "src"].includes(name)) walk(full);
      } else if (name.endsWith(".html")) {
        out[path.relative(dir, full).replace(/\.html$/, "").replace(/[\\/]/g, "_")] = full;
      }
    }
  };
  walk(dir);
  return out;
}

/** In development, /app/<anything> without a file extension is the single-page app. */
function appRoutes(): Plugin {
  return {
    name: "meetgo-app-routes",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = (req.url || "").split("?")[0];
        if ((url === "/app" || url.startsWith("/app/")) && !path.extname(url) && !url.startsWith("/app/src/")) {
          req.url = "/app/index.html" + (req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
        }
        next();
      });
    },
  };
}

/** The branding files are served and published at the site root (/icon-192.png, /og-image.png...). */
function branding(): Plugin {
  // Only files: hosts like Synology add folders of their own (@eaDir) next to them.
  const files = fs.existsSync(brandingDir)
    ? fs.readdirSync(brandingDir).filter((f) => !f.startsWith(".") && !f.startsWith("@") && fs.statSync(path.join(brandingDir, f)).isFile())
    : [];
  const types: Record<string, string> = { ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp" };
  return {
    name: "meetgo-branding",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = decodeURIComponent((req.url || "").split("?")[0].slice(1));
        if (!files.includes(name)) return next();
        res.setHeader("Content-Type", types[path.extname(name)] || "application/octet-stream");
        fs.createReadStream(path.join(brandingDir, name)).pipe(res);
      });
    },
    generateBundle() {
      for (const name of files) this.emitFile({ type: "asset", fileName: name, source: fs.readFileSync(path.join(brandingDir, name)) });
    },
  };
}

export default defineConfig({
  root,
  appType: "mpa",
  publicDir: path.join(__dirname, "assets"),
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react(), branding(), ...(site === "web_user" ? [appRoutes()] : [])],
  resolve: {
    alias: {
      "../lang/lang": path.join(langDir, "lang.ts"),
      "@lang": path.join(langDir, "lang.ts"),
    },
  },
  build: {
    outDir: path.join(__dirname, "dist", site),
    emptyOutDir: true,
    rollupOptions: { input: htmlEntries(root) },
  },
  server: {
    allowedHosts: ["meetgo.app", "www.meetgo.app", "admin.meetgo.app", "api.meetgo.app", "home.meetgo.app", "inicio.meetgo.app"],
    fs: { allow: [__dirname, langDir] },
  },
});
