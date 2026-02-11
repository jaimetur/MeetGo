import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  clearToken,
  getToken,
  setToken,
  setFrontendLogListener,
  frontLog,
  frontWarn,
  frontError,
  getWsBase,
  type FrontLogEntry,
} from "./api";
import LogoSvg from "../assets/logo.svg";
import { getLang, setLang, t, type Lang } from "./lang";

// ---- Toggle DEBUG PANEL by code only ----
const SHOW_FRONTEND_LOG = true;

// If logo.png exists it will be preferred by bundler as static import (optional)
let LogoPng: string | null = null;
try { LogoPng = (await import("../assets/logo.png")).default; } catch {}

type User = {
  id: number;
  display_name: string;
  email?: string | null;
  province: string;
  age_range: string;
  country?: string | null;
  city?: string | null;
  accept_dm: boolean;
  avatar_url?: string | null;
  bio?: string | null;
  dob?: string;
  dob_change_count?: number;
  email_verified?: boolean;
  role?: string;
  phone?: string | null;
  login_count?: number;
  last_login_at?: string | null;
  last_seen_at?: string | null;
  total_connected_seconds?: number;
  session_active?: boolean;
  session_started_at?: string | null;
};

type Room = { id: number; province: string; age_range: string; interest: { slug: string; name: string } };

type Msg = {
  id: number;
  room_id: number;
  user_id: number;
  user: { id: number; display_name: string; avatar_url?: string | null };
  content: string;
  created_at: string;
  is_deleted: boolean;
  moderation_reason?: string | null;
};

type Post = {
  id: number;
  user_id: number;
  user: { id: number; display_name: string; avatar_url?: string | null };
  content: string;
  created_at: string;
};

type Interest = { id: number; slug: string; name: string };

function avatarSrc(u?: { avatar_url?: string | null; display_name?: string }) {
  if (u?.avatar_url) return u.avatar_url;
  const seed = encodeURIComponent((u?.display_name || "user").slice(0, 2));
  return `https://api.dicebear.com/9.x/thumbs/svg?seed=${seed}`;
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}

function calcAge(dobYYYYMMDD: string): number | null {
  if (!dobYYYYMMDD) return null;
  const d = new Date(dobYYYYMMDD);
  if (Number.isNaN(d.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

function normalizePhoneDigits(s: string) {
  return (s || "").replace(/[^\d]/g, "");
}

function splitPhone(phone: string | null | undefined, callingCodes: { cc: string }[]) {
  const raw = (phone || "").trim();
  if (!raw) return { cc: "+34", number: "" };
  const sorted = [...callingCodes].sort((a, b) => b.cc.length - a.cc.length);
  for (const c of sorted) {
    if (raw.startsWith(c.cc)) {
      return { cc: c.cc, number: raw.slice(c.cc.length) };
    }
  }
  return { cc: "+34", number: raw.replace(/[^\d]/g, "") };
}

function safeStr(x: any) {
  if (x == null) return "";
  if (typeof x === "string") return x;
  try { return JSON.stringify(x); } catch { return String(x); }
}

function formatTime(ts: string, useUtc = false) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const h = useUtc ? d.getUTCHours() : d.getHours();
  const m = useUtc ? d.getUTCMinutes() : d.getMinutes();
  const s = useUtc ? d.getUTCSeconds() : d.getSeconds();
  const ms = useUtc ? d.getUTCMilliseconds() : d.getMilliseconds();
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

function extractService(msg: string) {
  const m = msg.match(/^\[([^\]]+)\]\s*/);
  if (!m) return { service: "frontend", text: msg };
  return { service: m[1], text: msg.slice(m[0].length) };
}

function levelMeta(level: "log" | "warn" | "error") {
  if (level === "warn") return { label: "WARN", color: "#f3b73f" };
  if (level === "error") return { label: "ERROR", color: "#ff6b6b" };
  return { label: "INFO", color: "#33d17a" };
}

function serviceLevelMeta(line: string) {
  const text = line || "";
  const up = text.toUpperCase();
  if (up.includes("TRACEBACK") || /\b(ERROR|ERR|FATAL|CRITICAL)\b/.test(up)) {
    return { label: "ERROR", color: "#ff6b6b" };
  }
  if (/\b(WARN|WARNING)\b/.test(up)) {
    return { label: "WARNING", color: "#f3b73f" };
  }
  if (/\b(DEBUG)\b/.test(up)) {
    return { label: "DEBUG", color: "#c77dff" };
  }
  return { label: "INFO", color: "#33d17a" };
}

function serviceLabel(service: string) {
  const s = service.toLowerCase();
  if (s.includes("db") || s.includes("postgres") || s.includes("database")) return "MeetGo-Database";
  if (s.includes("redis")) return "MeetGo-Redis";
  if (s.includes("backend")) return "MeetGo-BackEnd";
  if (s.includes("web")) return "MeetGo-FrontEnd-Web";
  if (s.includes("frontend-js")) return "MeetGo-FrontEnd-JS";
  if (s.includes("frontend")) return "MeetGo-FrontEnd-JS";
  return `MeetGo-${service}`;
}

function flagFromIso(code: string) {
  if (!code || code.length !== 2) return "";
  const upper = code.toUpperCase();
  const A = 0x1f1e6;
  const base = "A".charCodeAt(0);
  return String.fromCodePoint(A + upper.charCodeAt(0) - base, A + upper.charCodeAt(1) - base);
}

function cleanDockerLogLine(line: string) {
  // Strip leading container timestamps and keep the rest as-is.
  let out = line;
  const patterns = [
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s+/,
    /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+(?:UTC|GMT)\s+/,
    /^[0-9]+:[A-Z]\s+\d{1,2}\s+\w+\s+\d{4}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+\*\s+/,
    /^\s*\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM)\s+/,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of patterns) {
      if (re.test(out)) {
        out = out.replace(re, "");
        changed = true;
      }
    }
  }
  return out;
}

async function copyToClipboard(text: string) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

type ServiceLogEntry = {
  ts: string;
  service: string;
  line: string;
};

export default function App() {
  const [tab, setTab] = useState<"rooms" | "feed" | "profile">("rooms");
  const [lang, setLangState] = useState<Lang>(getLang());

  function changeLang(l: Lang) {
    setLang(l);
    setLangState(l); // force re-render
  }

  // ---- Debug panel state ----
  const [frontLogs, setFrontLogs] = useState<FrontLogEntry[]>([]);
  const [svcLogs, setSvcLogs] = useState<ServiceLogEntry[]>([]);
  const [svcLogStatus, setSvcLogStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [debugTab, setDebugTab] = useState<string>("web");
  const [debugMinimized, setDebugMinimized] = useState(true);
  const [debugMaximized, setDebugMaximized] = useState(false);
  const [debugVisible, setDebugVisible] = useState(true);
  const [debugPos, setDebugPos] = useState<{ x: number; y: number }>({ x: 12, y: 12 });
  const [debugSize, setDebugSize] = useState<{ w: number; h: number }>({ w: 1100, h: 520 });
  const [debugReady, setDebugReady] = useState(false);
  const debugPrevRef = useRef<{ pos: { x: number; y: number }; size: { w: number; h: number } } | null>(null);
  const frontLogsRef = useRef<HTMLDivElement | null>(null);
  const svcLogsRef = useRef<HTMLDivElement | null>(null);
  const debugPanelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    corner: "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
  } | null>(null);
  const dragSelectRef = useRef<string>("");

  useEffect(() => {
    if (!SHOW_FRONTEND_LOG) return;

    // subscribe to api.ts logs
    setFrontendLogListener((e) => {
      setFrontLogs((prev) => {
        const next = [...prev, e];
        // keep last 500 lines max
        if (next.length > 500) next.splice(0, next.length - 500);
        return next;
      });
    });

    // capture global runtime errors too
    const onError = (ev: ErrorEvent) => {
      frontError("[JS] Uncaught error", {
        message: ev.message,
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
      });
    };
    const onUnhandled = (ev: PromiseRejectionEvent) => {
      frontError("[JS] Unhandled rejection", { reason: safeStr(ev.reason) });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);

    return () => {
      setFrontendLogListener(null);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  useEffect(() => {
    if (!SHOW_FRONTEND_LOG) return;
    setTimeout(() => {
      frontLogsRef.current?.scrollTo({ top: frontLogsRef.current.scrollHeight });
    }, 0);
  }, [frontLogs.length]);

  useEffect(() => {
    if (!SHOW_FRONTEND_LOG) return;

    const url = `${api.API_BASE}/debug/compose-logs`;
    const es = new EventSource(url);

    setSvcLogStatus("connecting");
    es.onopen = () => setSvcLogStatus("connected");
    es.onerror = () => setSvcLogStatus("error");
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (!data?.line || !data?.service) return;
        setSvcLogs((prev) => {
          const next = [...prev, { ts: data.ts || new Date().toISOString(), service: data.service, line: data.line }];
          if (next.length > 800) next.splice(0, next.length - 800);
          return next;
        });
      } catch {
        // ignore parse errors
      }
    };

    return () => es.close();
  }, []);

  useEffect(() => {
    if (!SHOW_FRONTEND_LOG) return;
    setTimeout(() => {
      svcLogsRef.current?.scrollTo({ top: svcLogsRef.current.scrollHeight });
    }, 0);
  }, [svcLogs.length]);

  useEffect(() => {
    if (debugReady || !SHOW_FRONTEND_LOG) return;
    const w = debugSize.w;
    const h = debugSize.h;
    const x = Math.max(12, window.innerWidth - w - 12);
    const y = Math.max(12, window.innerHeight - h - 12);
    setDebugPos({ x, y });
    setDebugReady(true);
  }, [debugReady, debugSize.h, debugSize.w]);

  const serviceTabs = useMemo(() => {
    const base = ["web", "backend", "db", "redis"];
    const set = new Set<string>(base);
    for (const l of svcLogs) set.add(l.service);
    const list = Array.from(set);
    list.sort((a, b) => {
      const order = (s: string) => {
        if (s === "web") return 0;
        if (s === "backend") return 1;
        if (s === "db") return 2;
        if (s === "redis") return 3;
        return 10;
      };
      const oa = order(a);
      const ob = order(b);
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });
    return list;
  }, [svcLogs]);

  function onDebugMaximize() {
    if (!debugMaximized) {
      debugPrevRef.current = { pos: debugPos, size: debugSize };
      setDebugPos({ x: 12, y: 12 });
      setDebugSize({ w: Math.max(420, window.innerWidth - 24), h: Math.max(200, window.innerHeight - 24) });
      setDebugMaximized(true);
      setDebugMinimized(false);
      return;
    }
  }

  function onDebugRestore() {
    const prev = debugPrevRef.current;
    if (prev) {
      setDebugPos(prev.pos);
      setDebugSize(prev.size);
    }
    setDebugMaximized(false);
    setDebugMinimized(false);
  }

  useEffect(() => {
    if (!SHOW_FRONTEND_LOG) return;

    const onMove = (e: MouseEvent) => {
      if (resizeRef.current) {
        const { startX, startY, origX, origY, origW, origH, corner } = resizeRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const minW = 420;
        const minH = 200;
        let nextW = origW;
        let nextH = origH;
        let nextX = origX;
        let nextY = origY;

        if (corner.includes("e")) nextW = origW + dx;
        if (corner.includes("s")) nextH = origH + dy;
        if (corner.includes("w")) {
          nextW = origW - dx;
          nextX = origX + dx;
        }
        if (corner.includes("n")) {
          nextH = origH - dy;
          nextY = origY + dy;
        }

        const maxW = Math.max(minW, window.innerWidth - nextX);
        const maxH = Math.max(minH, window.innerHeight - nextY);
        nextW = Math.min(Math.max(nextW, minW), maxW);
        nextH = Math.min(Math.max(nextH, minH), maxH);

        nextX = Math.min(Math.max(nextX, 0), window.innerWidth - nextW);
        nextY = Math.min(Math.max(nextY, 0), window.innerHeight - nextH);

        setDebugPos({ x: nextX, y: nextY });
        setDebugSize({ w: nextW, h: nextH });
        return;
      }
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const w = debugSize.w;
      const h = debugSize.h;
      const maxX = Math.max(0, window.innerWidth - w);
      const maxY = Math.max(0, window.innerHeight - h);
      const nextX = Math.min(Math.max(dragRef.current.origX + dx, 0), maxX);
      const nextY = Math.min(Math.max(dragRef.current.origY + dy, 0), maxY);
      setDebugPos({ x: nextX, y: nextY });
    };

    const onUp = () => {
      if (dragRef.current) dragRef.current = null;
      if (resizeRef.current) resizeRef.current = null;
      document.body.style.userSelect = dragSelectRef.current;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function onDebugDragStart(e: React.MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (target?.closest("button")) return;
    dragSelectRef.current = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: debugPos.x, origY: debugPos.y };
  }

  function onDebugResizeStart(corner: "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w", e: React.MouseEvent) {
    e.stopPropagation();
    dragSelectRef.current = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: debugPos.x,
      origY: debugPos.y,
      origW: debugSize.w,
      origH: debugSize.h,
      corner,
    };
  }

  const [me, setMe] = useState<User | null>(null);
  const [auth, setAuth] = useState<{ email: string; pass: string }>({
    email: "",
    pass: "",
  });
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [publicSettings, setPublicSettings] = useState<any | null>(null);

  // --------- Country / Province / Phone data ---------
  const DEFAULT_COUNTRIES = useMemo(() => ([
    { code: "ES", labelKey: "country_es_spain" },
    { code: "PT", labelKey: "country_pt_portugal" },
    { code: "FR", labelKey: "country_fr_france" },
    { code: "IT", labelKey: "country_it_italy" },
    { code: "DE", labelKey: "country_de_germany" },
    { code: "GB", labelKey: "country_gb_uk" },
    { code: "US", labelKey: "country_us_usa" },
    { code: "MX", labelKey: "country_mx_mexico" },
    { code: "AR", labelKey: "country_ar_argentina" },
    { code: "CO", labelKey: "country_co_colombia" },
  ]), []);

  const DEFAULT_CALLING_CODES = useMemo(() => ([
    { cc: "+34", labelKey: "calling_es_spain" },
    { cc: "+351", labelKey: "calling_pt_portugal" },
    { cc: "+33", labelKey: "calling_fr_france" },
    { cc: "+39", labelKey: "calling_it_italy" },
    { cc: "+49", labelKey: "calling_de_germany" },
    { cc: "+44", labelKey: "calling_gb_uk" },
    { cc: "+1", labelKey: "calling_us_ca" },
    { cc: "+52", labelKey: "calling_mx_mexico" },
    { cc: "+54", labelKey: "calling_ar_argentina" },
    { cc: "+57", labelKey: "calling_co_colombia" },
  ]), []);

  const DEFAULT_PROVINCES_BY_COUNTRY: Record<string, { value: string; labelKey: string }[]> = useMemo(() => ({
    ES: [
      { value: "Alava", labelKey: "province_es_alava" },
      { value: "Albacete", labelKey: "province_es_albacete" },
      { value: "Alicante", labelKey: "province_es_alicante" },
      { value: "Almeria", labelKey: "province_es_almeria" },
      { value: "Asturias", labelKey: "province_es_asturias" },
      { value: "Avila", labelKey: "province_es_avila" },
      { value: "Badajoz", labelKey: "province_es_badajoz" },
      { value: "Barcelona", labelKey: "province_es_barcelona" },
      { value: "Burgos", labelKey: "province_es_burgos" },
      { value: "Caceres", labelKey: "province_es_caceres" },
      { value: "Cadiz", labelKey: "province_es_cadiz" },
      { value: "Cantabria", labelKey: "province_es_cantabria" },
      { value: "Castellon", labelKey: "province_es_castellon" },
      { value: "Ciudad Real", labelKey: "province_es_ciudad_real" },
      { value: "Cordoba", labelKey: "province_es_cordoba" },
      { value: "Cuenca", labelKey: "province_es_cuenca" },
      { value: "Girona", labelKey: "province_es_girona" },
      { value: "Granada", labelKey: "province_es_granada" },
      { value: "Guadalajara", labelKey: "province_es_guadalajara" },
      { value: "Gipuzkoa", labelKey: "province_es_gipuzkoa" },
      { value: "Huelva", labelKey: "province_es_huelva" },
      { value: "Huesca", labelKey: "province_es_huesca" },
      { value: "Illes Balears", labelKey: "province_es_illes_balears" },
      { value: "Jaen", labelKey: "province_es_jaen" },
      { value: "A Coruna", labelKey: "province_es_a_coruna" },
      { value: "La Rioja", labelKey: "province_es_la_rioja" },
      { value: "Las Palmas", labelKey: "province_es_las_palmas" },
      { value: "Leon", labelKey: "province_es_leon" },
      { value: "Lleida", labelKey: "province_es_lleida" },
      { value: "Lugo", labelKey: "province_es_lugo" },
      { value: "Madrid", labelKey: "province_es_madrid" },
      { value: "Malaga", labelKey: "province_es_malaga" },
      { value: "Murcia", labelKey: "province_es_murcia" },
      { value: "Navarra", labelKey: "province_es_navarra" },
      { value: "Ourense", labelKey: "province_es_ourense" },
      { value: "Palencia", labelKey: "province_es_palencia" },
      { value: "Pontevedra", labelKey: "province_es_pontevedra" },
      { value: "Salamanca", labelKey: "province_es_salamanca" },
      { value: "Santa Cruz de Tenerife", labelKey: "province_es_santa_cruz_de_tenerife" },
      { value: "Segovia", labelKey: "province_es_segovia" },
      { value: "Sevilla", labelKey: "province_es_sevilla" },
      { value: "Soria", labelKey: "province_es_soria" },
      { value: "Tarragona", labelKey: "province_es_tarragona" },
      { value: "Teruel", labelKey: "province_es_teruel" },
      { value: "Toledo", labelKey: "province_es_toledo" },
      { value: "Valencia", labelKey: "province_es_valencia" },
      { value: "Valladolid", labelKey: "province_es_valladolid" },
      { value: "Bizkaia", labelKey: "province_es_bizkaia" },
      { value: "Zamora", labelKey: "province_es_zamora" },
      { value: "Zaragoza", labelKey: "province_es_zaragoza" },
    ],
    PT: [
      { value: "Lisboa", labelKey: "province_pt_lisboa" },
      { value: "Porto", labelKey: "province_pt_porto" },
      { value: "Braga", labelKey: "province_pt_braga" },
      { value: "Setubal", labelKey: "province_pt_setubal" },
      { value: "Aveiro", labelKey: "province_pt_aveiro" },
    ],
    FR: [
      { value: "Ile-de-France", labelKey: "province_fr_ile_de_france" },
      { value: "Occitanie", labelKey: "province_fr_occitanie" },
      { value: "Nouvelle-Aquitaine", labelKey: "province_fr_nouvelle_aquitaine" },
      { value: "Auvergne-Rhone-Alpes", labelKey: "province_fr_auvergne_rhone_alpes" },
    ],
    IT: [
      { value: "Lazio", labelKey: "province_it_lazio" },
      { value: "Lombardia", labelKey: "province_it_lombardia" },
      { value: "Campania", labelKey: "province_it_campania" },
      { value: "Sicilia", labelKey: "province_it_sicilia" },
    ],
  }), []);

  const COUNTRY_OPTIONS = useMemo(() => {
    return (publicSettings?.countries?.length ? publicSettings.countries : DEFAULT_COUNTRIES) || [];
  }, [publicSettings, DEFAULT_COUNTRIES]);

  const CALLING_CODES = useMemo(() => {
    return (publicSettings?.calling_codes?.length ? publicSettings.calling_codes : DEFAULT_CALLING_CODES) || [];
  }, [publicSettings, DEFAULT_CALLING_CODES]);

function callingCodeLabel(x: { cc: string; labelKey?: string; name?: string; code?: string }, countryOptions: { code: string; labelKey?: string; name?: string }[]) {
  const cc = x.cc || "";
  const ccMap: Record<string, string> = {
    "+34": "ES",
      "+351": "PT",
      "+33": "FR",
      "+39": "IT",
      "+49": "DE",
      "+44": "GB",
      "+1": "US",
      "+52": "MX",
      "+54": "AR",
      "+57": "CO",
    };
  const name = x.labelKey ? t(x.labelKey) : (x.name || "");
  let code = x.code && x.code.length === 2 ? x.code.toUpperCase() : "";
  if (!code && name) {
    const nameNorm = name.trim().toLowerCase();
    const match = countryOptions.find((c: any) => {
      const cname = c.labelKey ? t(c.labelKey) : (c.name || c.code);
      return cname.trim().toLowerCase() === nameNorm;
    });
    if (match?.code) code = match.code.toUpperCase();
    if (!code && /^[a-zA-Z]{2}$/.test(name.trim())) code = name.trim().toUpperCase();
  }
  if (!code) code = ccMap[cc] || "";
  let countryName = name;
  if (!countryName && code) {
    const match = countryOptions.find((c: any) => c.code === code);
    if (match) countryName = match.labelKey ? t(match.labelKey) : (match.name || "");
  }
  const flag = flagFromIso(code);
  const prefix = flag ? `${flag} ` : (code ? `${code} ` : "");
  if (countryName) {
    return `${prefix}${countryName} (${cc})`;
  }
  return `${prefix}${cc}`;
}

  const PROVINCES_BY_COUNTRY: Record<string, { value: string; labelKey?: string; name?: string }[]> = useMemo(() => {
    return publicSettings?.provinces_by_country || DEFAULT_PROVINCES_BY_COUNTRY;
  }, [publicSettings, DEFAULT_PROVINCES_BY_COUNTRY]);

  const LANGUAGE_OPTIONS = useMemo(() => {
    return (publicSettings?.languages?.length ? publicSettings.languages : [{ code: "es", name: "ES" }, { code: "en", name: "EN" }]) || [];
  }, [publicSettings]);

  const [registerErr, setRegisterErr] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [registerOk, setRegisterOk] = useState<string | null>(null);

  const [registerForm, setRegisterForm] = useState<any>({
    phone_cc: "+34",
    phone_number: "",
    email: "",
    password: "",
    display_name: "",
    dob: "",
    country: "ES",
    province: "Madrid",
    phone_cc: "+34",
    phone_number: "",
    accept_dm: true,
    avatar_url: "",
    bio: "",
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showUsersPanel, setShowUsersPanel] = useState(false);
  const [roomsPanelOpen, setRoomsPanelOpen] = useState(true);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetPass, setResetPass] = useState("");
  const [roomPresence, setRoomPresence] = useState<Record<number, { count: number; users: { id: number; display_name: string; avatar_url?: string | null }[] }>>({});
  const [settingsForm, setSettingsForm] = useState({
    country: "ES",
    province: "",
    accept_dm: "yes",
  });
  const [profileForm, setProfileForm] = useState({
    display_name: "",
    email: "",
    password: "",
    dob: "",
    phone_cc: "+34",
    phone_number: "",
  });

  // Derived province list based on selected country
  const provinceOptions = useMemo(() => {
    const c = registerForm.country as string;
    return PROVINCES_BY_COUNTRY[c] || [];
  }, [registerForm.country, PROVINCES_BY_COUNTRY]);

  // Keep province consistent if user changes country
  useEffect(() => {
    const opts = provinceOptions;
    if (!opts.length) {
      if (registerForm.province) setRegisterForm((prev: any) => ({ ...prev, province: "" }));
      return;
    }
    if (!opts.some((p) => p.value === registerForm.province)) {
      setRegisterForm((prev: any) => ({ ...prev, province: opts[0].value }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerForm.country]);

  const settingsProvinceOptions = useMemo(() => {
    const c = settingsForm.country as string;
    return PROVINCES_BY_COUNTRY[c] || [];
  }, [settingsForm.country, PROVINCES_BY_COUNTRY]);

  useEffect(() => {
    const opts = settingsProvinceOptions;
    if (!opts.length) {
      if (settingsForm.province) setSettingsForm(prev => ({ ...prev, province: "" }));
    } else if (!opts.some((p) => p.value === settingsForm.province)) {
      setSettingsForm(prev => ({ ...prev, province: opts[0].value }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsForm.country]);


  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [msgsByRoom, setMsgsByRoom] = useState<Record<number, Msg[]>>({});
  const [composer, setComposer] = useState("");

  const INTEREST_EMOJIS: Record<string, string> = {
    cafe: "☕",
    senderismo: "🥾",
    cine: "🎬",
    deporte: "💪",
    networking: "🤝",
    ciclismo: "🚴",
    mtb: "🚵",
    motos: "🏍️",
    coches: "🚗",
    playa: "🏖️",
    viajes: "✈️",
    lectura: "📚",
    picnics: "🧺",
    cerveza: "🍺",
    copas: "🍸",
    deportes: "🏋️",
    deportes_aire_libre: "🏞️",
    deportes_acuaticos: "🏄",
    futbol: "⚽",
    futbol_sala: "⚽",
    tenis: "🎾",
    padel: "🎾",
    fitness: "🏋️",
    crossfit: "🔥",
  };

  const [joinInterest, setJoinInterest] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  const wsClosingRef = useRef<boolean>(false);
  const pendingMsgsRef = useRef<{ tempId: number; roomId: number; userId: number; ts: number }[]>([]);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const [menu, setMenu] = useState<{ x: number; y: number; userId: number; name: string } | null>(null);
  const [profileModal, setProfileModal] = useState<{ user: User } | null>(null);

  const [feed, setFeed] = useState<Post[]>([]);
  const [newPost, setNewPost] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);
  const [interestsError, setInterestsError] = useState<string | null>(null);
  const [interestsLoading, setInterestsLoading] = useState(false);
  const sortedInterests = useMemo(() => {
    return [...interests].sort((a, b) => a.name.localeCompare(b.name));
  }, [interests]);
  const sortedRooms = useMemo(() => {
    return [...rooms].sort((a, b) => a.interest.name.localeCompare(b.interest.name));
  }, [rooms]);
  const onlineStats = useMemo(() => {
    const users = new Set<number>();
    let activeRooms = 0;
    for (const presence of Object.values(roomPresence)) {
      if (presence.count > 0) activeRooms += 1;
      for (const u of presence.users || []) users.add(u.id);
    }
    return { users: users.size, activeRooms };
  }, [roomPresence]);

  const logoSrc = LogoPng || LogoSvg;

  function formatInterestLabel(interest: { slug: string; name: string }) {
    const emoji = INTEREST_EMOJIS[interest.slug];
    return emoji ? `${emoji} ${interest.name}` : interest.name;
  }

  function formatAgeRange(range: string) {
    if (range === "18_30") return "18-30";
    if (range === "31_50") return "31-50";
    if (range === "51_plus") return "51-∞";
    if (range === "31_55") return "31-50";
    if (range === "55_plus") return "51-∞";
    return range.replace("_", "-");
  }

  function ageRangeFromDob(dob: string) {
    const age = calcAge(dob);
    if (age === null) return null;
    if (age <= 30) return "18_30";
    if (age <= 50) return "31_50";
    return "51_plus";
  }

  async function refreshMe() {
    const u = await api.me();
    setMe(u);
    frontLog("[AUTH] me()", u);
    await loadRooms(true);
    return u as User;
  }

  useEffect(() => {
    (async () => {
      if (getToken()) {
        try { await refreshMe(); } catch (e) { frontWarn("[AUTH] me() failed, clearing token", e); clearToken(); }
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.publicSettings();
        setPublicSettings(s || null);
      } catch (e) {
        frontWarn("[SETTINGS] public load failed", e);
      }
    })();
  }, []);

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const verify = qs.get("verify_token");
    const reset = qs.get("reset_token");
    if (verify) {
      (async () => {
        try {
          await api.verifyEmail(verify);
          alert(t("verify_email_ok"));
        } catch (e) {
          alert(t("verify_email_fail"));
        }
      })();
    }
    if (reset) {
      setResetToken(reset);
    }
  }, []);

  useEffect(() => {
    if (!me) return;
    const split = splitPhone(me.phone || "", CALLING_CODES);
    setSettingsForm({
      country: me.country || "ES",
      province: me.province || "",
      accept_dm: me.accept_dm ? "yes" : "no",
    });
    setProfileForm({
      display_name: me.display_name || "",
      email: me.email || "",
      password: "",
      dob: me.dob || "",
      phone_cc: split.cc,
      phone_number: split.number,
    });
  }, [me]);

  useEffect(() => {
    function onDocClick() { setMenu(null); }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") { setMenu(null); setProfileModal(null); } }
    window.addEventListener("click", onDocClick);
    window.addEventListener("keydown", onEsc);
    return () => { window.removeEventListener("click", onDocClick); window.removeEventListener("keydown", onEsc); };
  }, []);

  async function loadInterestsList() {
    setInterestsLoading(true);
    setInterestsError(null);
    try {
      const list = await api.listInterests();
      setInterests(list || []);
    } catch (e) {
      frontWarn("[INTERESTS] list failed", e);
      setInterestsError(t("interests_load_error"));
    } finally {
      setInterestsLoading(false);
    }
  }

  useEffect(() => {
    loadInterestsList();
  }, []);

  useEffect(() => {
    if (!joinInterest && interests.length) {
      setJoinInterest(interests[0].slug);
    }
  }, [interests, joinInterest]);

  const msgs = selectedRoom ? (msgsByRoom[selectedRoom.id] || []) : [];

  function setMsgsForRoom(roomId: number, updater: Msg[] | ((prev: Msg[]) => Msg[])) {
    setMsgsByRoom(prev => {
      const current = prev[roomId] || [];
      const next = typeof updater === "function" ? (updater as (p: Msg[]) => Msg[])(current) : updater;
      return { ...prev, [roomId]: next };
    });
  }

  async function doLogin() {
    setLoginErr(null);
    try {
      if (!auth.email.trim()) {
        alert(t("register_err_email_missing"));
        return;
      }
      const tok = await api.login({ email: auth.email.trim(), password: auth.pass });
      setToken(tok.access_token);
      frontLog("[AUTH] login OK");
      await refreshMe();
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : t("login_error_generic");
      setLoginErr(msg);
    }
  }

  async function doLogout() {
    try { await api.logout(); } catch {}
    closeChat("logout");
    setSelectedRoom(null);
    setRooms([]);
    setMsgsByRoom({});
    setRoomPresence({});
    setJoinInterest("");
    setShowUsersPanel(false);
    clearToken();
    setMe(null);
  }

  function validateRegister(): string | null {
    if (!registerForm.email?.trim()) return t("register_err_email_missing");
    if (!registerForm.password || registerForm.password.length < 6) return t("register_err_password_short");
    if (!registerForm.display_name?.trim()) return t("register_err_name_missing");

    const age = calcAge(registerForm.dob);
    if (age === null) return t("register_err_dob_invalid");
    if (age < 18) return t("register_err_underage");

    if (!registerForm.country) return t("register_err_country_missing");
    if (provinceOptions.length) {
      if (!registerForm.province) return t("register_err_province_missing");
    } else {
      return t("register_err_province_unavailable");
    }

    const digits = normalizePhoneDigits(registerForm.phone_number);
    if (!registerForm.phone_cc) return t("register_err_phone_cc_missing");
    if (digits.length < 6) return t("register_err_phone_short");

    return null;
  }

  async function doRegister() {
    setRegisterErr(null);
    setRegisterOk(null);

    const err = validateRegister();
    if (err) { setRegisterErr(err); return; }

    const digits = normalizePhoneDigits(registerForm.phone_number);
    const payload: any = {
      email: registerForm.email.trim(),
      phone: `${registerForm.phone_cc}${digits}`,
      password: registerForm.password,
      display_name: registerForm.display_name.trim(),
      dob: registerForm.dob,
      country: registerForm.country,
      province: registerForm.province,
      accept_dm: !!registerForm.accept_dm,
      avatar_url: registerForm.avatar_url?.trim() || null,
      bio: registerForm.bio?.trim() || null,
    };

    try {
      const u = await api.register(payload);
      frontLog("[AUTH] registered", u);
      setRegisterOk(t("register_ok"));
      alert(t("register_verify_email"));
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : t("error_generic");
      setRegisterErr(msg);
    }
  }

  async function loadRooms(forceSelectFirst?: boolean) {
    const r = await api.myRooms();
    setRooms(r);
    frontLog("[ROOMS] myRooms()", r);
    if ((forceSelectFirst || !selectedRoom) && r.length) setSelectedRoom(r[0]);
    await loadRoomsOnline();
  }

  async function loadRoomsOnline() {
    try {
      const list = await api.roomsOnline();
      const next: Record<number, { count: number; users: { id: number; display_name: string; avatar_url?: string | null }[] }> = {};
      for (const item of list || []) {
        if (!item?.room_id) continue;
        next[item.room_id] = { count: item.count || 0, users: item.users || [] };
      }
      setRoomPresence(next);
    } catch (e) {
      frontWarn("[ROOMS] online error", e);
    }
  }

  async function joinRoom() {
    if (!joinInterest) {
      alert(t("loading_interests"));
      return;
    }
    try {
      frontLog("[ROOMS] joinRoom()", { interest_slug: joinInterest });
      const room = await api.joinRoom(joinInterest);
      await loadRooms();
      await openRoom(room);
    } catch (e: any) {
      const msg = e?.message || String(e) || t("join_room_error");
      frontError("[joinRoom] error", e);
      alert(msg);
    }
  }

  async function leaveRoom() {
    if (!selectedRoom) return;
    const roomLabel = formatInterestLabel(selectedRoom.interest);
    const ok = confirm(t("leave_room_confirm", { room: roomLabel }));
    if (!ok) return;
    try {
      frontLog("[ROOMS] leaveRoom()", { roomId: selectedRoom.id });
      await api.leaveRoom(selectedRoom.id);
      if (wsRef.current) {
        try {
          wsClosingRef.current = true;
          wsRef.current.close(1000, "leave");
        } catch {
          wsClosingRef.current = false;
        }
      }
      wsRef.current = null;
      setSelectedRoom(null);
      setMsgsByRoom({});
      await loadRooms(true);
      alert(t("leave_room_ok"));
    } catch (e: any) {
      const msg = e?.message || String(e) || t("leave_room_error");
      frontError("[leaveRoom] error", e);
      alert(msg);
    }
  }

  async function openRoom(room: Room) {
    setSelectedRoom(room);
    const history = await api.roomMessages(room.id);
    setMsgsForRoom(room.id, history);
    frontLog("[ROOMS] openRoom()", { roomId: room.id, messages: history?.length ?? 0 });
    connectWS(room.id);
    setTimeout(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight }), 50);
  }

  function connectWS(roomId: number) {
    const token = getToken();
    if (!token) {
      frontError(t("no_session"));
      return;
    }
    if (wsRef.current) {
      try {
        wsClosingRef.current = true;
        wsRef.current.close(1000, "switching");
      } catch {
        wsClosingRef.current = false;
      }
    }

    const wsBase = getWsBase();
    const wsUrl = `${wsBase}/ws/rooms/${roomId}?token=${encodeURIComponent(token)}`;

    frontLog("[WS] connecting", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      wsClosingRef.current = false;
      frontLog("[WS] connected OK");
    };

    ws.onclose = (e) => {
      if (wsClosingRef.current) {
        wsClosingRef.current = false;
        frontWarn("[WS] closed (switch)", { code: e.code, reason: e.reason, wasClean: e.wasClean });
        return;
      }
      frontWarn("[WS] closed", { code: e.code, reason: e.reason, wasClean: e.wasClean });
      alert(t("chat_disconnected"));
      frontError(t("chat_disconnected"));
    };

    ws.onerror = (e) => {
      frontError("[WS] error", e);
      frontError(t("chat_ws_error"));
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);

      if (data.type === "room_message") {
        const msg = data.message as Msg;
        const meId = me?.id;
        if (meId && msg.user_id === meId) {
          const idx = pendingMsgsRef.current.findIndex((p) => p.roomId === msg.room_id && p.userId === msg.user_id);
          if (idx >= 0) {
            const pending = pendingMsgsRef.current[idx];
            const serverTs = new Date(msg.created_at).getTime();
            const diff = Number.isNaN(serverTs) ? 0 : Math.abs(serverTs - pending.ts);
            if (!Number.isNaN(serverTs) && diff <= 15000) {
              pendingMsgsRef.current.splice(idx, 1);
        setMsgsForRoom(msg.room_id, prev => {
          const tIdx = prev.findIndex((m) => m.id === pending.tempId);
          if (tIdx === -1) return [...prev, msg];
          const next = [...prev];
          next[tIdx] = msg;
          return next;
        });
              setTimeout(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" }), 10);
              return;
            }
          }
        }
      setMsgsForRoom(msg.room_id, prev => [...prev, msg]);
        setTimeout(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" }), 10);
        return;
      }

      if (data.type === "room_presence") {
        const presence = data.presence;
        if (presence?.room_id) {
          setRoomPresence(prev => ({
            ...prev,
            [presence.room_id]: { count: presence.count || 0, users: presence.users || [] },
          }));
        }
        return;
      }

      if (data.type === "error") {
        const s = `Chat: ${data.code} (${data.detail})`;
        alert(s);
        frontError(s);
        return;
      }

      frontLog("[WS] message (unknown)", data);
    };
  }

  function sendMsg() {
    const ws = wsRef.current;
    if (!ws) {
      alert(t("chat_not_connected"));
      frontError(t("chat_not_connected"));
      return;
    }
    if (!selectedRoom || !me) return;
    if (ws.readyState !== 1) {
      alert(t("chat_not_connected_state", { state: ws.readyState }));
      frontError(t("chat_not_connected_state", { state: ws.readyState }));
      return;
    }
    const content = composer.trim();
    if (!content) return;
    const tempId = -Date.now();
    const tempMsg: Msg = {
      id: tempId,
      room_id: selectedRoom.id,
      user_id: me.id,
      user: { id: me.id, display_name: me.display_name, avatar_url: me.avatar_url || null },
      content,
      created_at: new Date().toISOString(),
      is_deleted: false,
      moderation_reason: null,
    };
    pendingMsgsRef.current.push({ tempId, roomId: selectedRoom.id, userId: me.id, ts: Date.now() });
    setMsgsForRoom(selectedRoom.id, prev => [...prev, tempMsg]);
    ws.send(JSON.stringify({ content }));
    setComposer("");
  }

  function onAvatarContextMenu(e: React.MouseEvent, u: { id: number; display_name: string }) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, userId: u.id, name: u.display_name });
  }

  async function viewProfile(userId: number) {
    const u = await api.getUser(userId);
    setProfileModal({ user: u });
    setMenu(null);
  }

  async function followUser(userId: number) {
    await api.follow(userId);
    setMenu(null);
    alert(t("following_ok"));
    frontLog(t("following_ok"));
  }

  async function friendUser(userId: number) {
    await api.friendRequest(userId);
    setMenu(null);
    alert(t("friend_req_ok"));
    frontLog(t("friend_req_ok"));
  }

  async function loadFeed() {
    const f = await api.feed();
    setFeed(f);
    frontLog("[FEED] loaded", f?.length ?? 0);
  }

  async function publishPost() {
    const t2 = newPost.trim();
    if (!t2) return;
    await api.createPost(t2);
    setNewPost("");
    await loadFeed();
  }

  function closeChat(reason: string) {
    if (wsRef.current) {
      try {
        wsClosingRef.current = true;
        wsRef.current.close(1000, reason);
      } catch {
        wsClosingRef.current = false;
      }
      wsRef.current = null;
    }
  }

  async function saveSettings() {
    if (!me) return;
    if (settingsProvinceOptions.length && !settingsForm.province) {
      alert(t("register_err_province_missing"));
      return;
    }
    const provinceChanged = settingsForm.province !== me.province;
    const countryChanged = (settingsForm.country || "ES") !== (me.country || "ES");
    if (provinceChanged) {
      const ok = confirm(t("warn_province_change"));
      if (!ok) return;
    } else if (countryChanged) {
      const ok = confirm(t("warn_country_change"));
      if (!ok) return;
    }
    const payload: any = {
      country: settingsForm.country || "ES",
      accept_dm: settingsForm.accept_dm === "yes",
    };
    if (settingsProvinceOptions.length) payload.province = settingsForm.province;
    const u = await api.updateProfile(payload);
    setMe(u);
    if (provinceChanged) {
      closeChat("profile-change");
      setSelectedRoom(null);
      setMsgsByRoom({});
      await loadRooms(true);
    }
    alert(t("settings_saved"));
    frontLog(t("settings_saved"));
  }

  async function saveProfile() {
    if (!me) return;
    if (!profileForm.display_name.trim()) {
      alert(t("register_err_name_missing"));
      return;
    }
    if (!profileForm.email.trim()) {
      alert(t("register_err_email_missing"));
      return;
    }
    const dobChanged = profileForm.dob && profileForm.dob !== me.dob;
    if (dobChanged && (me.dob_change_count || 0) >= 1) {
      alert(t("dob_change_limit"));
      return;
    }
    if (dobChanged) {
      const age = calcAge(profileForm.dob);
      if (age === null) {
        alert(t("dob_invalid"));
        return;
      }
      if (age < 18) {
        alert(t("dob_underage"));
        return;
      }
    }
    const newRange = dobChanged ? ageRangeFromDob(profileForm.dob) : null;
    if (dobChanged) {
      const warn = newRange && newRange !== me.age_range ? t("warn_dob_change_range") : t("warn_dob_change");
      const ok = confirm(warn);
      if (!ok) return;
    }
    const payload: any = {
      display_name: profileForm.display_name,
      email: profileForm.email || null,
      dob: profileForm.dob || null,
    };
    const phoneDigits = normalizePhoneDigits(profileForm.phone_number);
    if (phoneDigits) payload.phone = `${profileForm.phone_cc}${phoneDigits}`;
    if (profileForm.password) payload.password = profileForm.password;
    const u = await api.updateProfile(payload);
    setMe(u);
    setProfileForm(prev => ({ ...prev, password: "" }));
    if (dobChanged && newRange && newRange !== me.age_range) {
      closeChat("profile-change");
      setSelectedRoom(null);
      setMsgsByRoom({});
      await loadRooms(true);
    }
    alert(t("profile_updated"));
    frontLog(t("profile_updated"));
  }

  const isLogged = !!me;

  return (
    <div className="container">
      <div className="card">
        <div className="header">
          <div className="brand">
            <img src={logoSrc} alt={t("app_name")} />
            <div>
              <div className="name">{t("app_name")}</div>
              <div className="tagline">{t("tagline")}</div>
              <div className="small">{t("online_users", { users: onlineStats.users })}</div>
              <div className="small">{t("online_rooms", { rooms: onlineStats.activeRooms })}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "nowrap", justifyContent: "flex-start", alignItems: "flex-start" }}>
                <button className={"btn sidebarToggle smallToggle" + (sidebarOpen ? " toggleActive" : "")} onClick={() => setSidebarOpen(v => !v)}>
                  {t("panel_user")}
                </button>
                <button className={"btn sidebarToggle smallToggle" + (roomsPanelOpen ? " toggleActive" : "")} onClick={() => setRoomsPanelOpen(v => !v)}>
                  {t("panel_rooms")}
                </button>
                {isLogged ? (
                  <button className="btn sidebarToggle smallToggle dangerBtn" onClick={doLogout}>
                    {t("logout")}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }} />
        </div>

        <div className={"sidebar" + (sidebarOpen ? "" : " hidden")}>
          {!isLogged ? (
            <>
              <div style={{ fontWeight: 800 }}>{t("login_title")}</div>
              <input className="input" placeholder={t("email")} value={auth.email} onChange={e => setAuth({ ...auth, email: e.target.value })} />
              <input className="input" placeholder={t("password")} type="password" value={auth.pass} onChange={e => setAuth({ ...auth, pass: e.target.value })} />
              <button className="btn primary" onClick={doLogin}>{t("login_btn")}</button>
              {loginErr ? (
                <div className="item" style={{ border: "1px solid rgba(255,0,0,.25)" }}>
                  <div style={{ fontWeight: 900 }}>{t("error_title")}</div>
                  <div className="small">{loginErr}</div>
                </div>
              ) : null}
              <button className="btn" onClick={async () => {
                const email = prompt(t("forgot_password_prompt"));
                if (!email) return;
                await api.forgotPassword(email.trim());
                alert(t("forgot_password_sent"));
              }}>{t("forgot_password_btn")}</button>
              <button className="btn" onClick={() => {
                setShowRegister((v) => {
                  const next = !v;
                  if (!next) {
                    setRegisterErr(null);
                    setRegisterOk(null);
                  }
                  return next;
                });
              }}>
                {showRegister ? t("hide_register_btn") : t("new_user_btn")}
              </button>
              {resetToken ? (
                <div className="item" style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 800 }}>{t("reset_password_title")}</div>
                  <input className="input" type="password" placeholder={t("new_password")} value={resetPass} onChange={e => setResetPass(e.target.value)} />
                  <button className="btn" onClick={async () => {
                    await api.resetPassword(resetToken, resetPass);
                    setResetToken(null);
                    setResetPass("");
                    alert(t("reset_password_ok"));
                  }}>{t("reset_password_btn")}</button>
                </div>
              ) : null}

              {showRegister ? (
                <>
                  <div className="small">{t("or_register")}</div>

                  {registerErr ? (
                    <div className="item" style={{ border: "1px solid rgba(255,0,0,.25)" }}>
                      <div style={{ fontWeight: 900 }}>{t("error_title")}</div>
                      <div className="small">{registerErr}</div>
                    </div>
                  ) : null}
                  {registerOk ? (
                    <div className="item" style={{ border: "1px solid rgba(0,180,0,.25)" }}>
                      <div style={{ fontWeight: 900 }}>{t("ok_title")}</div>
                      <div className="small">{registerOk}</div>
                    </div>
                  ) : null}

                  <input className="input" placeholder={t("email")} value={registerForm.email} onChange={e => setRegisterForm({ ...registerForm, email: e.target.value })} />

                  <input
                    className="input"
                    placeholder={t("password_hint")}
                    type="password"
                    maxLength={60}
                    value={registerForm.password}
                    onChange={e => setRegisterForm({ ...registerForm, password: e.target.value })}
                  />

                  <input className="input" placeholder={t("name")} value={registerForm.display_name} onChange={e => setRegisterForm({ ...registerForm, display_name: e.target.value })} />

                  <label className="small" style={{ display: "block", marginTop: 10 }}>{t("phone_label")}</label>
                  <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8 }}>
                    <select
                      className="input"
                      style={{ fontFamily: "Segoe UI Emoji, Segoe UI, sans-serif" }}
                      value={registerForm.phone_cc}
                      onChange={e => setRegisterForm({ ...registerForm, phone_cc: e.target.value })}
                    >
                      {CALLING_CODES.map(x => (
                        <option key={x.cc} value={x.cc}>{callingCodeLabel(x, COUNTRY_OPTIONS)}</option>
                      ))}
                    </select>
                    <input
                      className="input"
                      placeholder={t("phone_number")}
                      value={registerForm.phone_number}
                      onChange={e => setRegisterForm({ ...registerForm, phone_number: e.target.value })}
                    />
                  </div>

                  <label className="small" style={{ display: "block", marginTop: 8 }}>{t("dob_label")}</label>
                  <input
                    className="input"
                    type="date"
                    value={registerForm.dob}
                    onChange={e => setRegisterForm({ ...registerForm, dob: e.target.value })}
                  />
                  <div className="small" style={{ marginTop: -6 }}>
                    {registerForm.dob ? (() => {
                      const a = calcAge(registerForm.dob);
                      if (a === null) return t("dob_invalid");
                      return a < 18 ? t("age_display_underage", { age: a, note: t("dob_underage") }) : t("age_display", { age: a });
                    })() : t("dob_pick")}
                  </div>

                  <label className="small" style={{ display: "block", marginTop: 10 }}>{t("country_label")}</label>
                  <select
                    className="input"
                    value={registerForm.country}
                    onChange={e => setRegisterForm({ ...registerForm, country: e.target.value })}
                  >
                    {COUNTRY_OPTIONS.map((c: any) => (
                      <option key={c.code} value={c.code}>{c.labelKey ? t(c.labelKey) : (c.name || c.code)}</option>
                    ))}
                  </select>

                  <label className="small" style={{ display: "block", marginTop: 10 }}>{t("province_label")}</label>
                  <select
                    className="input"
                    value={registerForm.province}
                    disabled={!provinceOptions.length}
                    onChange={e => setRegisterForm({ ...registerForm, province: e.target.value })}
                  >
                    {provinceOptions.length ? (
                      provinceOptions.map((p: any) => <option key={p.value} value={p.value}>{p.labelKey ? t(p.labelKey) : (p.name || p.value)}</option>)
                    ) : (
                      <option value="">{t("not_available")}</option>
                    )}
                  </select>

                  <input className="input" placeholder={t("avatar_url")} value={registerForm.avatar_url} onChange={e => setRegisterForm({ ...registerForm, avatar_url: e.target.value })} />
                  <textarea className="input" placeholder={t("bio")} rows={3} value={registerForm.bio} onChange={e => setRegisterForm({ ...registerForm, bio: e.target.value })} />
                  <button className="btn" onClick={doRegister}>{t("create_account")}</button>
                </>
              ) : null}

              <div className="item" style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 900 }}>{t("settings_title")}</div>
                <label className="small" style={{ display: "block", marginTop: 8 }}>{t("language_label")}</label>
                <select
                  className="input"
                  value={lang}
                  onChange={(e) => changeLang(e.target.value as Lang)}
                >
                  <option value="es">ES</option>
                  <option value="en">EN</option>
                </select>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 800 }}>{t("hello", { name: me.display_name })}</div>
              <div className="nav">
                <button className={"tab " + (tab === "rooms" ? "active" : "")} onClick={() => setTab("rooms")}>{t("rooms")}</button>
                <button className={"tab " + (tab === "feed" ? "active" : "")} onClick={() => { setTab("feed"); loadFeed(); }}>{t("feed")}</button>
                <button className={"tab " + (tab === "profile" ? "active" : "")} onClick={() => setTab("profile")}>{t("profile")}</button>
              </div>

              {tab === "rooms" ? (
                <>
                  <div className="item" style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 900 }}>{t("join_room_title")}</div>
                    <div className="small">{t("join_room_desc")}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8 }}>
                    <select className="input" style={{ width: "100%" }} value={joinInterest} onChange={e => setJoinInterest(e.target.value)}>
                      {sortedInterests.length ? (
                        sortedInterests.map(i => (
                          <option key={i.slug} value={i.slug}>{formatInterestLabel(i)}</option>
                        ))
                      ) : (
                        <option value="">{interestsLoading ? t("loading_interests") : (interestsError || t("loading_interests"))}</option>
                      )}
                    </select>
                    {interestsError ? (
                      <button className="btn" style={{ width: "100%", marginTop: 6 }} onClick={loadInterestsList}>
                        {t("retry_btn")}
                      </button>
                    ) : null}
                      <button className="btn primary" style={{ width: "100%" }} onClick={joinRoom}>{t("join_btn")}</button>
                    </div>
                  </div>

                </>
              ) : null}

              {tab === "feed" ? (
                <>
                  <textarea className="input" rows={3} placeholder={t("publish_placeholder")} value={newPost} onChange={e => setNewPost(e.target.value)} />
                  <button className="btn primary" onClick={publishPost}>{t("publish_btn")}</button>
                  <button className="btn" onClick={loadFeed}>{t("refresh_btn")}</button>
                </>
              ) : null}

              <div className="sectionStack">
                <div className="section">
                  <button className="sectionToggle" onClick={() => setSettingsOpen(v => !v)}>
                    <span>{t("settings_title")}</span>
                    <span>{settingsOpen ? "−" : "+"}</span>
                  </button>
                  {settingsOpen ? (
                    <div className="sectionBody">
                      <label className="small" style={{ display: "block", marginTop: 8 }}>{t("language_label")}</label>
                      <select
                        className="input"
                        value={lang}
                        onChange={(e) => changeLang(e.target.value as Lang)}
                      >
                        {LANGUAGE_OPTIONS.map((l: any) => (
                          <option key={l.code} value={l.code}>{l.name || l.code}</option>
                        ))}
                      </select>

                      <label className="small" style={{ display: "block", marginTop: 8 }}>{t("country_label")}</label>
                      <select
                        className="input"
                        value={settingsForm.country}
                        onChange={e => setSettingsForm({ ...settingsForm, country: e.target.value })}
                      >
                        {COUNTRY_OPTIONS.map((c: any) => (
                          <option key={c.code} value={c.code}>{c.labelKey ? t(c.labelKey) : (c.name || c.code)}</option>
                        ))}
                      </select>

                      <label className="small" style={{ display: "block", marginTop: 8 }}>{t("province_label")}</label>
                      <select
                        className="input"
                        value={settingsForm.province}
                        disabled={!settingsProvinceOptions.length}
                        onChange={e => setSettingsForm({ ...settingsForm, province: e.target.value })}
                      >
                        {settingsProvinceOptions.length ? (
                          settingsProvinceOptions.map((p: any) => <option key={p.value} value={p.value}>{p.labelKey ? t(p.labelKey) : (p.name || p.value)}</option>)
                        ) : (
                          <option value="">{t("not_available")}</option>
                        )}
                      </select>

                      <label className="small" style={{ display: "block", marginTop: 8 }}>{t("accept_dm")}</label>
                      <select
                        className="input"
                        value={settingsForm.accept_dm}
                        onChange={e => setSettingsForm({ ...settingsForm, accept_dm: e.target.value })}
                      >
                        <option value="yes">{t("yes")}</option>
                        <option value="no">{t("no")}</option>
                      </select>

                      <button className="btn" style={{ marginTop: 8 }} onClick={saveSettings}>{t("save_settings")}</button>
                    </div>
                  ) : null}
                </div>

                <div className="section">
                  <button className="sectionToggle" onClick={() => setProfileOpen(v => !v)}>
                    <span>{t("edit_profile_title")}</span>
                    <span>{profileOpen ? "−" : "+"}</span>
                  </button>
                  {profileOpen ? (
                    <div className="sectionBody">
                      <label className="small" style={{ display: "block", marginTop: 8 }}>{t("name")}</label>
                      <input className="input" value={profileForm.display_name} onChange={e => setProfileForm({ ...profileForm, display_name: e.target.value })} />

                      <label className="small" style={{ display: "block", marginTop: 8 }}>{t("email")}</label>
                      <input className="input" value={profileForm.email} onChange={e => setProfileForm({ ...profileForm, email: e.target.value })} />

                      <label className="small" style={{ display: "block", marginTop: 8 }}>{t("phone_label")}</label>
                      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8 }}>
                        <select
                          className="input"
                          style={{ fontFamily: "Segoe UI Emoji, Segoe UI, sans-serif" }}
                          value={profileForm.phone_cc}
                          onChange={e => setProfileForm({ ...profileForm, phone_cc: e.target.value })}
                        >
                          {CALLING_CODES.map(x => (
                            <option key={x.cc} value={x.cc}>{callingCodeLabel(x, COUNTRY_OPTIONS)}</option>
                          ))}
                        </select>
                        <input
                          className="input"
                          placeholder={t("phone_number")}
                          value={profileForm.phone_number}
                          onChange={e => setProfileForm({ ...profileForm, phone_number: e.target.value })}
                        />
                      </div>

                      <label className="small" style={{ display: "block", marginTop: 8 }}>{t("new_password")}</label>
                      <input className="input" type="password" value={profileForm.password} onChange={e => setProfileForm({ ...profileForm, password: e.target.value })} />

                      <label className="small" style={{ display: "block", marginTop: 8 }}>{t("dob_label")}</label>
                      <input className="input" type="date" value={profileForm.dob} onChange={e => setProfileForm({ ...profileForm, dob: e.target.value })} />
                      <div className="small" style={{ marginTop: 4 }}>{t("dob_change_note")}</div>

                      <button className="btn primary" style={{ marginTop: 8 }} onClick={saveProfile}>{t("save_profile")}</button>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card main">
        <div className="header">
          <div>
            <div style={{ fontWeight: 900 }}>
              {tab === "rooms"
                ? (selectedRoom
                    ? `${formatInterestLabel(selectedRoom.interest)} · ${selectedRoom.province} · ${formatAgeRange(selectedRoom.age_range)}`
                    : t("rooms"))
                : (tab === "feed" ? t("feed") : t("profile"))}
            </div>
          </div>
          <div className="headerActions">
            <div className="small">{t("tagline_long")}</div>
          </div>
        </div>

        <div className={"mainBody" + (roomsPanelOpen ? "" : " wide")}>
          {tab === "rooms" ? (
            <>
              <div className={"list roomsPanel" + (roomsPanelOpen ? "" : " hidden")}>
              <div className="item" style={{ cursor: "default" }}>
                <div style={{ fontWeight: 800 }}>{t("tip_title")}</div>
                <div className="small">{t("tip_body")}</div>
              </div>
                {selectedRoom ? (
                  <div className="item">
                    <button className="btn" style={{ width: "100%" }} onClick={async () => { await loadRoomsOnline(); setShowUsersPanel(v => !v); }}>
                      {showUsersPanel ? t("hide_users_panel") : t("show_users_panel")}
                    </button>
                  </div>
                ) : null}
                {selectedRoom ? (
                  <div className="item">
                    <button className="btn dangerBtn" style={{ width: "100%" }} onClick={leaveRoom}>{t("leave_room_btn")}</button>
                  </div>
                ) : null}
                <div className="item roomsItem">
                  <div style={{ fontWeight: 800 }}>{t("rooms")}</div>
                  <div className="roomsList">
                    {rooms.length === 0 ? (
                      <div className="small">{t("no_rooms_desc")}</div>
                    ) : null}
                    {sortedRooms.map(r => (
                      <div key={r.id} className={"item " + (selectedRoom?.id === r.id ? "active" : "")} onClick={() => openRoom(r)}>
                        <div style={{ fontWeight: 800 }}>{formatInterestLabel(r.interest)}</div>
                        <div className="small">{r.province} - {formatAgeRange(r.age_range)} - #{r.interest.slug}</div>
                        <div className="small">{t("users_online", { count: roomPresence[r.id]?.count || 0 })}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="chatWrap">
                {showUsersPanel ? (
                  <div className="usersPanel">
                    <div className="usersHeader">
                      <div style={{ fontWeight: 800 }}>{t("users_panel_title")}</div>
                      <button className="btn" onClick={() => setShowUsersPanel(false)}>{t("close_panel")}</button>
                    </div>
                    <div className="usersList">
                      {!selectedRoom ? (
                        <div className="small">{t("users_no_room")}</div>
                      ) : (
                        (() => {
                          const presence = roomPresence[selectedRoom.id];
                          return (
                            <div className="usersRoom">
                              <div className="usersRoomTitle">
                                <span>{formatInterestLabel(selectedRoom.interest)}</span>
                                <span className="small">{t("users_online", { count: presence?.count || 0 })}</span>
                              </div>
                              <div className="usersRoomList">
                                {(presence?.users || []).length ? (
                                  (presence?.users || []).map((u) => (
                                    <div key={`${selectedRoom.id}-${u.id}`} className="usersRow">
                                      <img src={avatarSrc(u)} alt={u.display_name} />
                                      <span>{u.display_name}</span>
                                    </div>
                                  ))
                                ) : (
                                  <div className="small">{t("users_none")}</div>
                                )}
                              </div>
                            </div>
                          );
                        })()
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="messages" ref={messagesRef}>
                  {msgs.map(m => (
                    <div key={m.id} className="msgRow">
                      <div className="avatar" onContextMenu={(e) => onAvatarContextMenu(e, { id: m.user.id, display_name: m.user.display_name })} title={t("quick_body")}>
                        <img src={avatarSrc(m.user)} alt={m.user.display_name} />
                      </div>
                      <div className="bubble">
                        <div className="meta">
                          <div className="name">{m.user.display_name}</div>
                          <div className="time">{fmtTime(m.created_at)}</div>
                          {m.is_deleted ? <div className="time">({m.moderation_reason})</div> : null}
                        </div>
                        <div className="text">{m.is_deleted ? t("msg_deleted_by_mod") : m.content}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="composer">
                  <textarea
                    placeholder={t("write_placeholder")}
                    value={composer}
                    onChange={e => setComposer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.altKey) {
                        e.preventDefault();
                        sendMsg();
                      }
                    }}
                  />
                  <button className="btn primary" onClick={sendMsg}>{t("send_btn")}</button>
                </div>
              </div>
            </>
          ) : null}

          {tab === "feed" ? (
            <div className="chatWrap" style={{ gridColumn: "1 / -1" }}>
              <div className="messages">
                {feed.map(p => (
                  <div key={p.id} className="msgRow">
                    <div className="avatar" onContextMenu={(e) => onAvatarContextMenu(e, { id: p.user.id, display_name: p.user.display_name })}>
                      <img src={avatarSrc(p.user)} alt={p.user.display_name} />
                    </div>
                    <div className="bubble" style={{ maxWidth: "860px" }}>
                      <div className="meta">
                        <div className="name">{p.user.display_name}</div>
                        <div className="time">{fmtTime(p.created_at)}</div>
                      </div>
                      <div className="text">{p.content}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tab === "profile" ? (
            <div className="chatWrap" style={{ gridColumn: "1 / -1" }}>
              <div className="messages">
                <div className="msgRow">
                  <div className="bigAvatar">
                    <img src={avatarSrc(me || undefined)} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 18 }}>{me?.display_name}</div>
                    <div className="small">{me?.province} - {me ? formatAgeRange(me.age_range) : ""}</div>
                    <div style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{me?.bio || t("no_bio_yet")}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {menu ? (
        <div className="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => viewProfile(menu.userId)}>{t("menu_view_profile")}</button>
          <div className="sep" />
          <button onClick={() => friendUser(menu.userId)}>{t("menu_friend_request")}</button>
          <button onClick={() => followUser(menu.userId)}>{t("menu_follow_feed")}</button>
        </div>
      ) : null}

      {profileModal ? (
        <div className="modalBackdrop" onClick={() => setProfileModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div className="modalTitle">{t("modal_profile_title")}</div>
              <button className="tab" onClick={() => setProfileModal(null)}>{t("modal_close")}</button>
            </div>
            <div className="grid2">
              <div className="bigAvatar"><img src={avatarSrc(profileModal.user)} /></div>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{profileModal.user.display_name}</div>
                <div className="small">{profileModal.user.province} - {formatAgeRange(profileModal.user.age_range)}</div>
                <div style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{profileModal.user.bio || t("no_bio_yet")}</div>
                <div className="actions">
                  <button className="btn primary" onClick={() => friendUser(profileModal.user.id)}>{t("modal_friend")}</button>
                  <button className="btn" onClick={() => followUser(profileModal.user.id)}>{t("modal_follow")}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- DEBUG PANEL ---- */}
      {SHOW_FRONTEND_LOG && debugVisible ? (
        <div
          ref={debugPanelRef}
          style={{
            position: "fixed",
            left: debugMinimized ? "auto" : debugPos.x,
            top: debugMinimized ? "auto" : debugPos.y,
            right: debugMinimized ? 12 : "auto",
            bottom: debugMinimized ? 12 : "auto",
            width: debugMinimized ? 260 : debugSize.w,
            height: debugMinimized ? 40 : debugSize.h,
            minWidth: 420,
            minHeight: debugMinimized ? 48 : 200,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "calc(100vh - 24px)",
            background: "rgba(10,10,10,0.92)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 12,
            overflow: "hidden",
            zIndex: 9999,
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            display: "grid",
            gridTemplateRows: debugMinimized ? "1fr" : "40px 1fr 52px",
          }}
        >
          <div
            onMouseDown={(e) => onDebugResizeStart("nw", e)}
            style={{ position: "absolute", left: 0, top: 0, width: 14, height: 14, cursor: "nwse-resize" }}
          />
          <div
            onMouseDown={(e) => onDebugResizeStart("ne", e)}
            style={{ position: "absolute", right: 0, top: 0, width: 14, height: 14, cursor: "nesw-resize" }}
          />
          <div
            onMouseDown={(e) => onDebugResizeStart("sw", e)}
            style={{ position: "absolute", left: 0, bottom: 0, width: 14, height: 14, cursor: "nesw-resize" }}
          />
          <div
            onMouseDown={(e) => onDebugResizeStart("se", e)}
            style={{ position: "absolute", right: 0, bottom: 0, width: 14, height: 14, cursor: "nwse-resize" }}
          />
          <div
            onMouseDown={(e) => onDebugResizeStart("n", e)}
            style={{ position: "absolute", left: 14, right: 14, top: 0, height: 8, cursor: "ns-resize" }}
          />
          <div
            onMouseDown={(e) => onDebugResizeStart("s", e)}
            style={{ position: "absolute", left: 14, right: 14, bottom: 0, height: 8, cursor: "ns-resize" }}
          />
          <div
            onMouseDown={(e) => onDebugResizeStart("w", e)}
            style={{ position: "absolute", left: 0, top: 14, bottom: 14, width: 8, cursor: "ew-resize" }}
          />
          <div
            onMouseDown={(e) => onDebugResizeStart("e", e)}
            style={{ position: "absolute", right: 0, top: 14, bottom: 14, width: 8, cursor: "ew-resize" }}
          />
          <div
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px", borderBottom: "1px solid rgba(255,255,255,0.12)", cursor: "grab" }}
            onMouseDown={onDebugDragStart}
          >
            <div style={{ color: "white", fontWeight: 800 }}>{t("debug_title")}</div>
            {!debugMinimized ? (
              <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {serviceTabs.slice(0, 1).map((svc) => (
                    <button
                      key={svc}
                      className={"tab " + (debugTab === svc ? "active" : "")}
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      onClick={() => setDebugTab(svc)}
                    >
                      {serviceLabel(svc).replace("MeetGo-", "")} ({svcLogs.filter(x => x.service === svc).length})
                    </button>
                  ))}
                  <button
                    className={"tab " + (debugTab === "frontend" ? "active" : "")}
                    style={{ padding: "6px 10px", fontSize: 12 }}
                    onClick={() => setDebugTab("frontend")}
                  >
                    FrontEnd-JS ({frontLogs.length})
                  </button>
                  {serviceTabs.slice(1).map((svc) => (
                    <button
                      key={svc}
                      className={"tab " + (debugTab === svc ? "active" : "")}
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      onClick={() => setDebugTab(svc)}
                    >
                      {serviceLabel(svc).replace("MeetGo-", "")} ({svcLogs.filter(x => x.service === svc).length})
                    </button>
                  ))}
                </div>
                <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                    {debugTab === "frontend" ? t("debug_subtitle", { count: frontLogs.length }) : (svcLogStatus === "connected" ? t("debug_services_connected") : (svcLogStatus === "connecting" ? t("debug_services_connecting") : t("debug_services_error")))}
                  </div>
              </>
            ) : null}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button
                className="tab"
                style={{ padding: "4px 8px", fontSize: 12 }}
                title={t("debug_minimize")}
                onClick={() => setDebugMinimized(true)}
              >
                _
              </button>
              <button
                className="tab"
                style={{ padding: "4px 8px", fontSize: 12 }}
                title={t("debug_maximize")}
                onClick={onDebugMaximize}
              >
                []
              </button>
              <button
                className="tab"
                style={{ padding: "4px 8px", fontSize: 12 }}
                title={t("debug_restore")}
                onClick={onDebugRestore}
              >
                O
              </button>
              <button
                className="tab"
                style={{ padding: "4px 8px", fontSize: 12 }}
                title={t("debug_close")}
                onClick={() => setDebugVisible(false)}
              >
                X
              </button>
            </div>
          </div>

          {!debugMinimized && debugTab === "frontend" ? (
            <div ref={frontLogsRef} style={{ overflow: "auto", padding: 12, paddingBottom: 40, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, whiteSpace: "pre" }}>
              {frontLogs.map((l, idx) => {
                const info = extractService(l.msg);
                const ts = formatTime(l.ts);
                const meta = levelMeta(l.level);
                const svcLabel = serviceLabel("frontend-js");
                return (
                  <div key={idx} style={{ marginBottom: 8, color: "white" }}>
                    <div style={{ opacity: 0.9, color: meta.color }}>
                      [{svcLabel}] - [{ts}] - [{meta.label}] - {info.text}
                    </div>
                    {l.data !== undefined ? (
                      <div style={{ marginTop: 4, opacity: 0.85, color: meta.color }}>
                        [{svcLabel}] - [{ts}] - [{meta.label}] - {safeStr(l.data)}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (!debugMinimized ? (
            <div ref={svcLogsRef} style={{ overflow: "auto", padding: 12, paddingBottom: 40, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, whiteSpace: "pre" }}>
              {svcLogs.filter((l) => l.service === debugTab).map((l, idx) => {
                const clean = cleanDockerLogLine(l.line);
                const meta = serviceLevelMeta(clean);
                return (
                  <div key={idx} style={{ marginBottom: 8, color: "white" }}>
                    <div style={{ opacity: 0.9, color: meta.color }}>
                      [{serviceLabel(l.service)}] - [{formatTime(l.ts, true)}] - [{meta.label}] - {clean}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null)}

          {!debugMinimized ? (
            <div style={{ display: "flex", gap: 10, padding: "18px 12px", borderTop: "1px solid rgba(255,255,255,0.12)", alignItems: "center" }}>
            <button
              className="btn"
              style={{ padding: "12px 16px", minHeight: 48, lineHeight: "20px" }}
              onClick={() => {
                if (debugTab === "frontend") setFrontLogs([]);
                else setSvcLogs([]);
              }}
            >
              {t("debug_clear")}
            </button>
            <button
              className="btn"
              style={{ padding: "12px 16px", minHeight: 48, lineHeight: "20px" }}
              onClick={() => {
                try {
                  const txt = debugTab === "frontend"
                    ? frontLogs.map((x) => {
                      const info = extractService(x.msg);
                      const ts = formatTime(x.ts);
                      const meta = levelMeta(x.level);
                      const base = `[${serviceLabel("frontend")}] - [${ts}] - [${meta.label}] - ${info.text}`;
                      if (x.data === undefined) return base;
                      return `${base}\n[${serviceLabel("frontend")}] - [${ts}] - [${meta.label}] - ${safeStr(x.data)}`;
                    }).join("\n")
                    : svcLogs.map(x => {
                      const clean = cleanDockerLogLine(x.line);
                      const meta = serviceLevelMeta(clean);
                      return `[${serviceLabel(x.service)}] - [${formatTime(x.ts, true)}] - [${meta.label}] - ${clean}`;
                    }).join("\n");
                  copyToClipboard(txt).then((ok) => {
                    alert(ok ? t("debug_copy_ok") : t("debug_copy_fail"));
                  });
                } catch {
                  alert(t("debug_copy_fail"));
                }
              }}
            >
              {t("debug_copy")}
            </button>
            <button
              className="btn"
              style={{ padding: "12px 16px", minHeight: 48, lineHeight: "20px" }}
              onClick={() => {
                try {
                  const sel = window.getSelection()?.toString() || "";
                  if (!sel.trim()) {
                    alert(t("debug_copy_selection_empty"));
                    return;
                  }
                  copyToClipboard(sel).then((ok) => {
                    alert(ok ? t("debug_copy_ok") : t("debug_copy_fail"));
                  });
                } catch {
                  alert(t("debug_copy_fail"));
                }
              }}
            >
              {t("debug_copy_selection")}
            </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {SHOW_FRONTEND_LOG && !debugVisible ? (
        <div
          style={{
            position: "fixed",
            right: 12,
            bottom: 12,
            background: "rgba(10,10,10,0.92)",
            color: "white",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 12,
            padding: "8px 12px",
            cursor: "pointer",
            zIndex: 9999,
          }}
          onClick={() => { setDebugVisible(true); setDebugMinimized(false); }}
          title={t("debug_restore")}
        >
          {t("debug_title")}
        </div>
      ) : null}
    </div>
  );
}
