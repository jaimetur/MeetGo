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
// Each build has its own id, in the code and in /version.json: an open page sees when a newer one is deployed.
const isBuild = process.argv.includes("build");
const buildId = isBuild ? process.env.MEETGO_BUILD || `${appVersion}-${Date.now().toString(36)}` : "dev";

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

/** Older engines (the WebView of Android phones that have not updated it, e.g. Chrome 90) ignore color-mix(): each
 *  declaration that uses it gets, just before, a plain colour to fall back on (the colour with the larger share). */
function splitArgs(inner: string): string[] {
  const out: string[] = []; let depth = 0, cur = "";
  for (const ch of inner) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function plainColour(value: string): string {
  let i = value.indexOf("color-mix(");
  while (i >= 0) {
    let depth = 0, j = i + "color-mix".length;
    for (; j < value.length; j++) {
      if (value[j] === "(") depth++;
      else if (value[j] === ")" && --depth === 0) break;
    }
    const [, a = "", b = ""] = splitArgs(value.slice(i + "color-mix(".length, j));
    const share = (x: string) => { const m = x.match(/\s(\d+(?:\.\d+)?)%\s*$/); return m ? parseFloat(m[1]) : NaN; };
    const strip = (x: string) => x.replace(/\s\d+(?:\.\d+)?%\s*$/, "").trim();
    const pa = share(a), pb = share(b);
    const first = isNaN(pa) ? (isNaN(pb) ? 50 : 100 - pb) : pa;
    const pick = plainColour(strip(first >= 50 ? a : b));
    value = value.slice(0, i) + pick + value.slice(j + 1);
    i = value.indexOf("color-mix(");
  }
  return value;
}
const colorMixFallback = { postcssPlugin: "color-mix-fallback", Declaration(decl: any) {
  if (!decl.value.includes("color-mix(") || decl.__fallback) return;
  const plain = plainColour(decl.value);
  if (plain && plain !== decl.value) { const prev = decl.clone({ value: plain }); prev.__fallback = true; decl.before(prev); }
} };

/** /version.json with the build id (published with each build; the page compares it with its own). */
function versionFile(): Plugin {
  return {
    name: "meetgo-version",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: buildId, version: appVersion }) });
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
  define: { __APP_VERSION__: JSON.stringify(appVersion), __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [react(), branding(), versionFile(), ...(site === "web_user" ? [appRoutes()] : [])],
  css: { postcss: { plugins: [colorMixFallback] } },
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
