// MeetGo public pages: language switch, launch-campaign counter, Android download state and reveal on scroll.

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

const EN: Record<string, string> = {
  skip: "Skip to content",
  nav_how: "How it works", nav_features: "Features", nav_prices: "Pricing", nav_download: "Download", nav_faq: "FAQ",
  signin: "Sign in",
  eyebrow: "Chat by province, age and interests",
  hero_title: 'Talk to people <span class="meet">near you</span>. Then <span class="go">meet up</span>.',
  hero_lead: "Channels with people from your province, your age range and your hobbies. When a plan comes up, start a group and sort it out in private.",
  cta_register: "Create account", cta_how: "See how it works",
  strip_zone: "Your province and age range", strip_mod: "Active moderation", strip_phone: "Your phone number stays hidden",
  strip_devices: "Web, Android and iPhone",
  promo_badge: "Launch campaign",
  promo_title: '<span class="sunt">1 year free</span> for the first accounts',
  promo_text: "Create your account with the code and pay nothing for a whole year. Only for the first",
  promo_text2: "accounts.",
  promo_copy: "Copy", promo_copied: "Copied!", promo_left: "places left", promo_of: "of {max}",
  promo_cta: "Get my free year", promo_eyebrow: "Launch · {left} free places left",
  how_k: "How it works", how_title: "From chat to plan in three steps",
  s1_t: "Pick your hobbies", s1_p: "Hiking, padel, cinema, coffee… Each hobby is a channel with people from your province and age range.",
  s2_t: "Chat in your channels", s2_p: "Reply in threads to keep things tidy, mention anyone and react without flooding the chat.",
  s3_t: "Plan it in a group", s3_p: "Create a private group, invite whoever is in and sort out cars, times and photos without the noise.",
  feat_k: "Features", feat_title: "Made for chatting with lots of people without getting lost",
  feat_p: "Big channels stay readable, groups are yours and direct messages arrive instantly.",
  f1_k: "Local channels", f1_t: "Many voices at once, all readable",
  f1_p: "Every topic gets its own thread and the main conversation stays clean. Catch up on what you missed without endless scrolling.",
  f1_l1: "Threads with a summary of replies and participants", f1_l2: "Mentions with their own inbox, and alerts only when someone names you",
  f1_l3: "A new-messages divider and a button to jump to the latest", f1_l4: "Reactions, quoted replies and pinned messages",
  f2_k: "Private groups", f2_t: "From “count me in” to a done deal",
  f2_p: "Create a group with your friends or share an invitation link with whoever signed up in the channel.",
  f2_l1: "Invitation links and admin roles", f2_l2: "Photos and files up to 10 MB", f2_l3: "Read receipts to know who has seen it",
  f2_l4: "Mute or pin any group",
  f3_k: "Direct messages", f3_t: "In private, when you both want it",
  f3_p: "With friends you chat right away. With anyone else a request comes first, and only if they accept direct messages.",
  f3_l1: "Instant notifications, with quick reply on Android", f3_l2: "See who is typing and who is online",
  f3_l3: "Your phone number is never shown",
  more_k: "And also", more_title: "A good atmosphere is no accident",
  t1_t: "Automatic moderation", t1_p: "Insults, spam and phone numbers posted in public are removed on their own.",
  t2_t: "Reports and moderators", t2_p: "Report a message in two taps; moderators can silence or remove people.",
  t3_t: "Slow mode", t3_p: "When a channel gets too busy, its moderators set the pace.",
  t4_t: "Alerts your way", t4_p: "Everything, mentions only or nothing, per conversation. Mute what you don't want to hear.",
  t5_t: "Search", t5_p: "Find that message with the meeting time across all your conversations.",
  t6_t: "Photos and files", t6_p: "Share the summit photo, the route track or the booking PDF.",
  web_k: "On your computer too", web_title: "All your conversations at a glance",
  web_p: "On a big screen you see the list, the channel and the thread or the members at the same time.",
  dl_k: "Download", dl_title: "With you on your phone and your computer",
  dl_android_p: "The app with instant notifications and quick reply. Download the APK and install it.",
  dl_soon: "Coming very soon", dl_android_btn: "Download APK", dl_build: "Version {version}",
  dl_play_p: "We are preparing the store listing. With your MeetGo account you will pick up where you left off.",
  dl_soon2: "Coming soon", dl_play_btn: "Coming soon",
  dl_web_t: "iPhone and web",
  dl_web_p: "Open MeetGo in your browser. On iPhone, tap Share and “Add to Home Screen” to keep it like an app.",
  dl_web_btn: "Open MeetGo",
  pr_k: "Pricing", pr_title: "Less than a coffee a month",
  pr_p: "Every feature in both plans. 7-day free trial and cancel any time.",
  pr_m: "Monthly", pr_month: "/month", pr_y: "Yearly", pr_year: "/year", pr_save: "Save 17%", pr_eq: "Works out at €2.08 a month",
  pr_l1: "7-day free trial", pr_l2: "Channels, groups and direct messages", pr_l3: "Cancel any time", pr_btn: "Start the trial",
  pr_note: "Pay by card (Stripe) on the web or with Google Play in the app. Prices include VAT.",
  faq_k: "FAQ", faq_title: "What people usually ask",
  q0: "How much does it cost?", a0: "Nothing. MeetGo is free: create your account and use it without limits, no card needed.",
  q1: "How much does it cost?", a1: "€2.50 a month or €25 a year, with a 7-day free trial. Both options include everything.",
  q2: "How do I get the free year?", a2: "Create your account with the code LANZAMIENTO while places last. It is only for the first 50 accounts and we don't ask for a card.",
  q3: "What happens when the free year ends?", a3: "Your account becomes read-only until you subscribe: you can read your conversations but not write. Nothing is deleted.",
  q4: "Who sees my phone number?", a4: "Nobody. Your number is not on your profile, and messages sharing numbers in channels are removed automatically.",
  q5: "Is there a minimum age?", a5: "Yes, MeetGo is for people over 18. Channels are grouped by age range: 18-30, 31-50 and over 50.",
  q6: "Which cities does it work in?", a6: "Every province in Spain. Your channels are those of your province and age range, one for each hobby you choose.",
  q7: "How do I cancel?", a7: "From your MeetGo account if you pay by card, or from Google Play if you subscribed in the app. You keep access until the end of the paid period.",
  q8: "Is there an app for Android and iPhone?", a8: "On Android, download the app. On iPhone, open meetgo.app/app in Safari and add it to your Home Screen.",
  final_title: 'Your next plan <span class="go">is already talking</span>', final_p: "Come in, pick your hobbies and say hi.",
  f_privacy: "Privacy", f_terms: "Terms", f_app: "Open the app", f_contact: "Contact:",
};
const ES_EXTRA: Record<string, string> = {
  promo_copied: "¡Copiado!", promo_of: "de {max}", promo_eyebrow: "Lanzamiento · quedan {left} plazas gratis",
  dl_build: "Versión {version}",
};

let lang: "es" | "en" = "es";
const original = new Map<Element, string>();

function tr(key: string, vars: Record<string, string | number> = {}): string {
  const fromDom = [...original.entries()].find(([el]) => (el as HTMLElement).dataset.i18n === key)?.[1];
  let s = lang === "en" ? (EN[key] ?? fromDom ?? key) : (ES_EXTRA[key] ?? fromDom ?? key);
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

function applyLang(next: "es" | "en") {
  lang = next;
  document.documentElement.lang = next;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    if (!original.has(el)) original.set(el, el.innerHTML);
    const key = el.dataset.i18n!;
    el.innerHTML = next === "en" && EN[key] ? EN[key] : original.get(el)!;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === next)));
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
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => original.set(el, el.innerHTML));
  document.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((b) =>
    b.addEventListener("click", () => applyLang(b.dataset.lang === "en" ? "en" : "es")));
  let saved: string | null = null;
  try { saved = localStorage.getItem("meetgo.lang"); } catch { /* private mode */ }
  const prefersEn = !saved && navigator.language && !navigator.language.toLowerCase().startsWith("es");
  if (saved === "en" || prefersEn) applyLang("en");
  setupTopBar();
  setupReveal();
  setupCopy();
  if (document.getElementById("promo")) loadPromo();
  if (document.getElementById("apkBtn")) loadApk();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
