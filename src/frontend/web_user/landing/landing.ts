// MeetGo public pages: language switch, launch-campaign counter, Android download state and reveal on scroll.

import { LANGUAGES, browserLang, translate } from "@lang";

type Promo = { code: string; duration: string; max: number | null; left: number | null; expires_on: string | null };

function apiBase(): string {
  const env = (import.meta as any).env?.VITE_API_BASE;
  if (env) return String(env).replace(/\/+$/, "");
  const { protocol, hostname, port, origin } = window.location;
  if (port === "5173" || port === "5172") return `${protocol}//${hostname}:18000`;
  if (hostname === "meetgo.app" || hostname.endsWith(".meetgo.app")) return "https://api.meetgo.app";
  return `${origin}/api`;
}

const API = apiBase();

// ---------- language ----------




// The page is written in English; every language (English included) comes from lang/<lang>.po as landing_<key>.
let lang = "en";

function tr(key: string, vars: Record<string, string | number> = {}): string {
  return translate(lang, `landing_${key}`, vars);
}

function applyLang(next: string) {
  lang = next;
  document.documentElement.lang = next;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n!;
    const text = translate(next, `landing_${key}`);
    if (text !== `landing_${key}`) el.innerHTML = text;
  });
  const pick = document.getElementById("langPick") as HTMLSelectElement | null;
  if (pick) pick.value = next;
  try { localStorage.setItem("meetgo.lang", next); } catch { /* private mode */ }
  renderPromo();
  renderApk();
}

// ---------- launch campaign ----------

let promo: Promo | null = null;
let counted = false;

function renderPromo() {
  const box = document.getElementById("promo");
  if (!box) return;
  if (!promo || promo.max == null || promo.left == null) { box.hidden = true; return; }
  box.hidden = false;
  const max = promo.max, left = promo.left;
  setText("promoMax", String(max));
  setText("promoCodeText", promo.code);
  setText("promoOf", tr("promo_of", { max }));
  const cta = document.getElementById("promoCta") as HTMLAnchorElement | null;
  if (cta) cta.href = `/app/?view=register&code=${encodeURIComponent(promo.code)}`;
  const copy = document.getElementById("promoCode");
  copy?.setAttribute("aria-label", `${tr("promo_copy")} ${promo.code}`);
  const bar = document.getElementById("promoBarWrap");
  bar?.setAttribute("aria-valuemax", String(max));
  bar?.setAttribute("aria-valuenow", String(max - left));
  if (counted) setText("promoLeft", String(left));
  const eyebrow = document.getElementById("eyebrow");
  if (eyebrow) {
    eyebrow.classList.add("hot");
    eyebrow.setAttribute("href", "#promo");
    const span = eyebrow.querySelector("span");
    if (span) span.textContent = tr("promo_eyebrow", { left });
  }
}

function countDown() {
  if (!promo || promo.max == null || promo.left == null || counted) return;
  counted = true;
  const max = promo.max, left = promo.left;
  const bar = document.getElementById("promoBar");
  if (bar) bar.style.width = `${Math.round(((max - left) / max) * 100)}%`;
  const el = document.getElementById("promoLeft");
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { el.textContent = String(left); return; }
  const start = performance.now(), dur = 1400;
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(max - (max - left) * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function loadPromo() {
  try {
    const res = await fetch(`${API}/billing/promos`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (data.subscriptions) document.documentElement.classList.add("paid-on");
    promo = (data.promos as Promo[] | undefined)?.find((p) => p.max != null && (p.left ?? 0) > 0) ?? null;
  } catch {
    promo = null;
  }
  renderPromo();
  const box = document.getElementById("promo");
  if (!promo || !box) return;
  if (!("IntersectionObserver" in window)) { countDown(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { countDown(); io.disconnect(); }
  }, { threshold: 0.35 });
  io.observe(box);
}

function setupCopy() {
  const btn = document.getElementById("promoCode");
  btn?.addEventListener("click", async () => {
    const code = promo?.code || "LANZAMIENTO";
    const label = btn.querySelector("small");
    try {
      await navigator.clipboard.writeText(code);
      if (label) { label.textContent = tr("promo_copied"); setTimeout(() => (label.textContent = tr("promo_copy")), 1800); }
    } catch {
      const text = document.getElementById("promoCodeText");
      if (text) {
        const range = document.createRange();
        range.selectNodeContents(text);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  });
}

// ---------- Android download ----------

let apk: { available?: boolean; version?: string; build?: number } | null = null;

function renderApk() {
  const btn = document.getElementById("apkBtn") as HTMLAnchorElement | null;
  const info = document.getElementById("apkInfo");
  if (!btn || !info) return;
  if (apk?.available) {
    btn.href = `${API}/downloads/android.apk`;
    btn.removeAttribute("aria-disabled");
    info.textContent = apk.version ? tr("dl_build", { version: apk.version }) : "APK";
  } else {
    btn.href = "#";
    btn.setAttribute("aria-disabled", "true");
    info.textContent = tr("dl_soon");
  }
}

async function loadApk() {
  try {
    const res = await fetch(`${API}/downloads/android.json`, { headers: { Accept: "application/json" } });
    apk = res.ok ? await res.json() : null;
  } catch {
    apk = null;
  }
  renderApk();
}

// ---------- page chrome ----------

function setText(id: string, value: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setupReveal() {
  const items = document.querySelectorAll(".rv");
  if (!items.length || !("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.documentElement.classList.add("rvjs");
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  items.forEach((el) => {
    // Whatever is already on screen shows at once, so the first frame is complete.
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) el.classList.add("in");
    else io.observe(el);
  });
}

function setupTopBar() {
  const top = document.getElementById("top");
  if (!top) return;
  const onScroll = () => top.classList.toggle("sc", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function init() {
  setText("year", String(new Date().getFullYear()));
  const pick = document.getElementById("langPick") as HTMLSelectElement | null;
  if (pick) {
    pick.innerHTML = LANGUAGES.map(([code, name]) => `<option value="${code}">${name}</option>`).join("");
    pick.addEventListener("change", () => applyLang(pick.value));
  }
  let saved: string | null = null;
  try { saved = localStorage.getItem("meetgo.lang"); } catch { /* private mode */ }
  applyLang(saved && LANGUAGES.some(([code]) => code === saved) ? saved : browserLang());
  setupTopBar();
  setupReveal();
  setupCopy();
  if (document.getElementById("promo")) loadPromo();
  if (document.getElementById("apkBtn")) loadApk();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
