import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, clearToken, frontError, getToken, setFrontendLogListener, setToken, type FrontLogEntry, type Plan } from "./api";
import { t } from "@lang";
import { madridYmd, planLabel, t2 } from "./strings";
import ModerationTab from "./ModerationTab";
import BillingTab from "./BillingTab";
import PromoCodesTab from "./PromoCodesTab";

// ---- Toggle DEBUG PANEL by code only ----
const SHOW_FRONTEND_LOG = true;

type User = {
  id: number;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  dob?: string | null;
  country?: string | null;
  province?: string | null;
  city?: string | null;
  role?: string;
  email_verified?: boolean;
  is_banned?: boolean;
  banned_until?: string | null;
  login_count?: number;
  last_login_at?: string | null;
  last_seen_at?: string | null;
  total_connected_seconds?: number;
  session_active?: boolean;
  session_started_at?: string | null;
  access_required?: boolean;
  plan?: Plan;
};

type Interest = { id: number; slug: string; name: string };

/** Free access control of the user form: none, until a day, or lifetime. */
type AccessForm = { mode: "none" | "date" | "lifetime"; date: string };

function accessFromPlan(u: User): AccessForm {
  if (u.plan?.kind !== "gift") return { mode: "none", date: "" };
  return u.plan.until ? { mode: "date", date: madridYmd(u.plan.until) } : { mode: "lifetime", date: "" };
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
  if (s.includes("backend") || s === "app") return "MeetGo-App";
  if (s.includes("web_user") || s.includes("web-user") || s === "web") return "MeetGo-Web-User";
  if (s.includes("web_admin") || s.includes("web-admin") || s === "admin") return "MeetGo-Web-Admin";
  if (s.includes("frontend-js")) return "MeetGo-JavaScript";
  if (s.includes("frontend")) return "MeetGo-JavaScript";
  return `MeetGo-${service}`;
}

function serviceLabelColor(label: string) {
  const s = label.toLowerCase();
  if (s.includes("javascript")) return "#ff4d4f";
  if (s.includes("app")) return "#40a9ff";
  if (s.includes("web-user")) return "#36cfc9";
  if (s.includes("web-admin")) return "#9254de";
  if (s.includes("database")) return "#52c41a";
  if (s.includes("redis")) return "#fa8c16";
  return "#f0f0f0";
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
  const [token, setTokenState] = useState(getToken());
  const [tab, setTab] = useState<"users" | "settings" | "interests" | "moderation" | "billing" | "codes">("users");
  const [login, setLogin] = useState({ username: "", password: "" });
  const [settings, setSettings] = useState<any>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [userMessage, setUserMessage] = useState<string>("");
  const [userForm, setUserForm] = useState<any>({
    display_name: "",
    email: "",
    phone: "",
    role: "user",
    password: "",
    email_verified: false,
    is_banned: false,
    banned_until: "",
    dob: "",
    country: "ES",
    province: "",
    city: "",
  });
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [accessForm, setAccessForm] = useState<AccessForm>({ mode: "none", date: "" });
  const [interests, setInterests] = useState<Interest[]>([]);
  const [interestName, setInterestName] = useState("");
  const [selectedInterestId, setSelectedInterestId] = useState<number | null>(null);
  const [interestMessage, setInterestMessage] = useState<string>("");
  const [settingsMessage, setSettingsMessage] = useState<string>("");
  const [testEmail, setTestEmail] = useState<string>("");
  const [smtpTestMessage, setSmtpTestMessage] = useState<string>("");

  // ---- Debug panel state ----
  const [frontLogs, setFrontLogs] = useState<FrontLogEntry[]>([]);
  const [svcLogs, setSvcLogs] = useState<ServiceLogEntry[]>([]);
  const [svcLogStatus, setSvcLogStatus] = useState<"connecting" | "connected" | "error" | "disabled">("connecting");
  const [svcLogDetail, setSvcLogDetail] = useState("");
  const [debugServiceFilter, setDebugServiceFilter] = useState<string[]>([]);
  const [debugFilterOpen, setDebugFilterOpen] = useState(false);
  const [debugMinimized, setDebugMinimized] = useState(true);
  const [debugMaximized, setDebugMaximized] = useState(false);
  const [debugVisible, setDebugVisible] = useState(true);
  const [debugAutoRefresh, setDebugAutoRefresh] = useState(true);
  const [debugPos, setDebugPos] = useState<{ x: number; y: number }>({ x: 12, y: 12 });
  const [debugSize, setDebugSize] = useState<{ w: number; h: number }>({ w: 1100, h: 520 });
  const [debugReady, setDebugReady] = useState(false);
  const debugPrevRef = useRef<{ pos: { x: number; y: number }; size: { w: number; h: number } } | null>(null);
  const debugLogsRef = useRef<HTMLDivElement | null>(null);
  const debugPanelRef = useRef<HTMLDivElement | null>(null);
  const debugFilterRef = useRef<HTMLDivElement | null>(null);
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

    setFrontendLogListener((e) => {
      setFrontLogs((prev) => {
        const next = [...prev, e];
        if (next.length > 500) next.splice(0, next.length - 500);
        return next;
      });
    });

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
    if (!SHOW_FRONTEND_LOG || !token) return;

    const es = new EventSource(api.composeLogsUrl());
    let stopped = false;

    setSvcLogStatus("connecting");
    setSvcLogDetail("");
    es.onopen = () => setSvcLogStatus("connected");
    es.onerror = () => {
      // While CONNECTING the browser retries by itself; CLOSED means the server refused the stream
      // (404 when DEBUG_COMPOSE_LOGS is off): ask once why and do not reconnect.
      if (es.readyState !== EventSource.CLOSED) {
        setSvcLogStatus("error");
        return;
      }
      api.composeLogsProbe().then(({ status, detail }) => {
        if (stopped) return;
        setSvcLogStatus(status === 404 ? "disabled" : "error");
        setSvcLogDetail(status === 404 ? "" : detail);
      });
    };
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

    return () => {
      stopped = true;
      es.close();
    };
  }, [token]);

  useEffect(() => {
    if (!SHOW_FRONTEND_LOG || !debugAutoRefresh) return;
    const id = window.setInterval(() => {
      const el = debugLogsRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight });
    }, 250);
    return () => window.clearInterval(id);
  }, [debugAutoRefresh]);

  useEffect(() => {
    if (debugReady || !SHOW_FRONTEND_LOG) return;
    const w = debugSize.w;
    const h = debugSize.h;
    const x = Math.max(12, window.innerWidth - w - 12);
    const y = Math.max(12, window.innerHeight - h - 12);
    setDebugPos({ x, y });
    setDebugReady(true);
  }, [debugReady, debugSize.h, debugSize.w]);

  useEffect(() => {
    if (!debugFilterOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target || debugFilterRef.current?.contains(target)) return;
      setDebugFilterOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [debugFilterOpen]);

  type CombinedLogItem =
    | { kind: "svc"; ts: string; service: string; line: string }
    | { kind: "front"; ts: string; service: "frontend"; entry: FrontLogEntry };

  const serviceOptions = useMemo(() => {
    const base = ["frontend", "app", "web_user", "web_admin", "db", "redis"];
    const set = new Set<string>(base);
    for (const l of svcLogs) set.add(l.service);
    const list = Array.from(set);
    list.sort((a, b) => {
      const order = (s: string) => {
        if (s === "frontend") return 0;
        if (s === "app") return 1;
        if (s === "web_user") return 2;
        if (s === "web_admin") return 3;
        if (s === "db") return 4;
        if (s === "redis") return 5;
        return 10;
      };
      const oa = order(a);
      const ob = order(b);
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });
    return list;
  }, [svcLogs]);

  const combinedLogs = useMemo<CombinedLogItem[]>(() => {
    const items: CombinedLogItem[] = [
      ...svcLogs.map((l) => ({ kind: "svc" as const, ts: l.ts, service: l.service, line: l.line })),
      ...frontLogs.map((l) => ({ kind: "front" as const, ts: l.ts, service: "frontend" as const, entry: l })),
    ];
    items.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    return items;
  }, [svcLogs, frontLogs]);

  const filteredLogs = useMemo(() => {
    if (debugServiceFilter.length === 0) return combinedLogs;
    const set = new Set(debugServiceFilter);
    return combinedLogs.filter((item) => set.has(item.service));
  }, [combinedLogs, debugServiceFilter]);

  const serviceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const svc of serviceOptions) counts[svc] = 0;
    for (const item of combinedLogs) {
      counts[item.service] = (counts[item.service] || 0) + 1;
    }
    return counts;
  }, [serviceOptions, combinedLogs]);

  const filterLabel = useMemo(() => {
    if (debugServiceFilter.length === 0) return t("debug_tab_all");
    if (debugServiceFilter.length === 1) {
      return serviceLabel(debugServiceFilter[0]).replace("MeetGo-", "");
    }
    return `${debugServiceFilter.length} servicios`;
  }, [debugServiceFilter]);

  function toggleServiceFilter(svc: string) {
    setDebugServiceFilter((prev) => {
      if (prev.length === 0) return [svc];
      if (prev.includes(svc)) return prev.filter((x) => x !== svc);
      return [...prev, svc];
    });
  }

  function onDebugMaximize() {
    if (debugMaximized) {
      const prev = debugPrevRef.current;
      if (prev) {
        setDebugPos(prev.pos);
        setDebugSize(prev.size);
      }
      setDebugMaximized(false);
      setDebugMinimized(false);
      return;
    }
    debugPrevRef.current = { pos: debugPos, size: debugSize };
    setDebugPos({ x: 12, y: 12 });
    setDebugSize({ w: Math.max(420, window.innerWidth - 24), h: Math.max(200, window.innerHeight - 24) });
    setDebugMaximized(true);
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
  }, [debugSize.h, debugSize.w]);

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

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const s = await api.settings();
        setSettings(s || {});
      } catch {}
    })();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    if (tab === "users") loadUsers();
    if (tab === "interests") loadInterests();
  }, [tab, token]);

  async function loadUsers() {
    const list = await api.users(userQuery.trim() || undefined);
    setUsers(list || []);
  }

  async function loadInterests() {
    const list = await api.interests();
    setInterests(list || []);
  }

  const usersById = useMemo(() => {
    const map = new Map<number, User>();
    users.forEach((u) => map.set(u.id, u));
    return map;
  }, [users]);

  function slugifyName(name: string) {
    return name
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function updateSettings(path: string, value: any) {
    setSettings((prev: any) => {
      const next = { ...(prev || {}) };
      const parts = path.split(".");
      let cur = next;
      for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        cur[key] = cur[key] ?? {};
        cur = cur[key];
      }
      cur[parts[parts.length - 1]] = value;
      return next;
    });
  }

  function ensureArray(path: string) {
    const parts = path.split(".");
    let cur = settings || {};
    for (const p of parts) cur = cur?.[p];
    if (!Array.isArray(cur)) updateSettings(path, []);
  }

  if (!token) {
    return (
      <div className="wrap">
        <div className="card">
          <h2>{t("admin_title")}</h2>
          <input
            className="input"
            placeholder={t("admin_login_username")}
            value={login.username}
            onChange={(e) => setLogin({ ...login, username: e.target.value })}
          />
          <input
            className="input"
            type="password"
            placeholder={t("admin_login_password")}
            value={login.password}
            onChange={(e) => setLogin({ ...login, password: e.target.value })}
          />
          <button
            className="btn primary"
            onClick={async () => {
              const res = await api.login(login.username, login.password);
              setToken(res.access_token);
              setTokenState(res.access_token);
            }}
          >
            {t("admin_login_button")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="header">
        <h2>{t("admin_title")}</h2>
        <div className="tabs">
          <button className={tab === "users" ? "tab active" : "tab"} onClick={() => setTab("users")}>{t("admin_tab_users")}</button>
          <button className={tab === "settings" ? "tab active" : "tab"} onClick={() => setTab("settings")}>{t("admin_tab_settings")}</button>
          <button className={tab === "interests" ? "tab active" : "tab"} onClick={() => setTab("interests")}>{t("admin_tab_channels")}</button>
          <button className={tab === "moderation" ? "tab active" : "tab"} onClick={() => setTab("moderation")}>{t2("tab_moderation")}</button>
          <button className={tab === "billing" ? "tab active" : "tab"} onClick={() => setTab("billing")}>{t2("tab_billing")}</button>
          <button className={tab === "codes" ? "tab active" : "tab"} onClick={() => setTab("codes")}>{t2("tab_codes")}</button>
          <button
            className="tab"
            onClick={() => {
              clearToken();
              setTokenState("");
            }}
          >
            {t("admin_logout")}
          </button>
        </div>
      </div>

      {tab === "settings" ? (
        <div className="card">
          <h3>{t("admin_settings_title")}</h3>
          {!settings ? (
            <div className="muted">{t("admin_loading")}</div>
          ) : (
            <div className="stack">
              <div className="section">
                <h4>{t("admin_app_section")}</h4>
                <label className="label">{t("admin_base_url")}</label>
                <input
                  className="input"
                  placeholder={t("admin_base_url_placeholder")}
                  value={settings.app_base_url || ""}
                  onChange={(e) => updateSettings("app_base_url", e.target.value)}
                />
              </div>

              <div className="section">
                <h4>{t("admin_smtp_section")}</h4>
                <div className="row">
                  <label className="label">{t("admin_smtp_mode")}</label>
                  <select
                    className="input"
                    value={settings.smtp?.mode || "smtp"}
                    onChange={(e) => updateSettings("smtp.mode", e.target.value)}
                  >
                    <option value="smtp">{t("admin_smtp_mode_smtp")}</option>
                    <option value="gmail_api">{t("admin_smtp_mode_gmail")}</option>
                  </select>
                  <label className="label">{t("admin_smtp_encryption")}</label>
                  <select
                    className="input"
                    value={settings.smtp?.encryption || "starttls"}
                    onChange={(e) => updateSettings("smtp.encryption", e.target.value)}
                  >
                    <option value="starttls">{t("admin_smtp_starttls")}</option>
                    <option value="ssl">{t("admin_smtp_ssl")}</option>
                  </select>
                </div>
                <div className="row">
                  <input className="input" placeholder={t("admin_smtp_host")} value={settings.smtp?.host || ""} onChange={(e) => updateSettings("smtp.host", e.target.value)} />
                  <input className="input" placeholder={t("admin_smtp_port")} value={settings.smtp?.port || ""} onChange={(e) => updateSettings("smtp.port", e.target.value)} />
                </div>
                <div className="row">
                  <input className="input" placeholder={t("admin_smtp_username")} value={settings.smtp?.username || ""} onChange={(e) => updateSettings("smtp.username", e.target.value)} />
                  <input className="input" placeholder={t("admin_smtp_password")} type="password" value={settings.smtp?.password || ""} onChange={(e) => updateSettings("smtp.password", e.target.value)} />
                </div>
                <div className="row">
                  <input className="input" placeholder={t("admin_smtp_from_email")} value={settings.smtp?.from_email || ""} onChange={(e) => updateSettings("smtp.from_email", e.target.value)} />
                </div>
                {settings.smtp?.mode === "gmail_api" ? (
                  <div className="section sub">
                    <div className="row">
                      <input className="input" placeholder={t("admin_gmail_client_id")} value={settings.smtp?.gmail_client_id || ""} onChange={(e) => updateSettings("smtp.gmail_client_id", e.target.value)} />
                      <input className="input" placeholder={t("admin_gmail_client_secret")} value={settings.smtp?.gmail_client_secret || ""} onChange={(e) => updateSettings("smtp.gmail_client_secret", e.target.value)} />
                    </div>
                    <div className="row">
                      <input className="input" placeholder={t("admin_gmail_refresh_token")} value={settings.smtp?.gmail_refresh_token || ""} onChange={(e) => updateSettings("smtp.gmail_refresh_token", e.target.value)} />
                      <input className="input" placeholder={t("admin_gmail_sender_email")} value={settings.smtp?.gmail_sender_email || ""} onChange={(e) => updateSettings("smtp.gmail_sender_email", e.target.value)} />
                    </div>
                  </div>
                ) : null}
                <div className="row">
                  <input className="input" placeholder={t("admin_smtp_test_email")} value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
                  <button
                    className="btn"
                    onClick={async () => {
                      setSmtpTestMessage("");
                      try {
                        await api.smtpTest(testEmail.trim());
                        setSmtpTestMessage(t("admin_smtp_test_ok"));
                      } catch (e: any) {
                        setSmtpTestMessage(e?.message || t("admin_smtp_test_error"));
                      }
                    }}
                  >
                    {t("admin_smtp_test_button")}
                  </button>
                </div>
                {smtpTestMessage ? <div className="notice">{smtpTestMessage}</div> : null}
              </div>

              <div className="section">
                <h4>{t("admin_languages_title")}</h4>
                <button className="btn" onClick={() => { ensureArray("languages"); updateSettings("languages", [...(settings.languages || []), { code: "", name: "" }]); }}>{t("admin_add_language")}</button>
                <div className="list">
                  {(settings.languages || []).map((l: any, idx: number) => (
                    <div key={`lang-${idx}`} className="row">
                      <input className="input" placeholder={t("admin_code")} value={l.code || ""} onChange={(e) => {
                        const next = [...settings.languages];
                        next[idx] = { ...next[idx], code: e.target.value };
                        updateSettings("languages", next);
                      }} />
                      <input className="input" placeholder={t("admin_name")} value={l.name || ""} onChange={(e) => {
                        const next = [...settings.languages];
                        next[idx] = { ...next[idx], name: e.target.value };
                        updateSettings("languages", next);
                      }} />
                      <button className="btn" onClick={() => {
                        const next = [...settings.languages];
                        next.splice(idx, 1);
                        updateSettings("languages", next);
                      }}>{t("admin_delete")}</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="section">
                <h4>{t("admin_age_ranges_title")}</h4>
                <button className="btn" onClick={() => { ensureArray("age_ranges"); updateSettings("age_ranges", [...(settings.age_ranges || []), { key: "", label: "", min: 0, max: null }]); }}>{t("admin_add_range")}</button>
                <div className="list">
                  {(settings.age_ranges || []).map((r: any, idx: number) => (
                    <div key={`age-${idx}`} className="row">
                      <input className="input" placeholder={t("admin_key")} value={r.key || ""} onChange={(e) => {
                        const next = [...settings.age_ranges];
                        next[idx] = { ...next[idx], key: e.target.value };
                        updateSettings("age_ranges", next);
                      }} />
                      <input className="input" placeholder={t("admin_label")} value={r.label || ""} onChange={(e) => {
                        const next = [...settings.age_ranges];
                        next[idx] = { ...next[idx], label: e.target.value };
                        updateSettings("age_ranges", next);
                      }} />
                      <input className="input" placeholder={t("admin_min")} value={r.min ?? ""} onChange={(e) => {
                        const next = [...settings.age_ranges];
                        next[idx] = { ...next[idx], min: Number(e.target.value) };
                        updateSettings("age_ranges", next);
                      }} />
                      <input className="input" placeholder={t("admin_max")} value={r.max ?? ""} onChange={(e) => {
                        const next = [...settings.age_ranges];
                        const val = e.target.value === "" ? null : Number(e.target.value);
                        next[idx] = { ...next[idx], max: val };
                        updateSettings("age_ranges", next);
                      }} />
                      <button className="btn" onClick={() => {
                        const next = [...settings.age_ranges];
                        next.splice(idx, 1);
                        updateSettings("age_ranges", next);
                      }}>{t("admin_delete")}</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="section">
                <h4>{t("admin_countries_title")}</h4>
                <button className="btn" onClick={() => { ensureArray("countries"); updateSettings("countries", [...(settings.countries || []), { code: "", name: "" }]); }}>{t("admin_add_country")}</button>
                <div className="list">
                  {(settings.countries || []).map((c: any, idx: number) => (
                    <div key={`country-${idx}`} className="row">
                      <input className="input" placeholder={t("admin_code")} value={c.code || ""} onChange={(e) => {
                        const next = [...settings.countries];
                        next[idx] = { ...next[idx], code: e.target.value };
                        updateSettings("countries", next);
                      }} />
                      <input className="input" placeholder={t("admin_name")} value={c.name || ""} onChange={(e) => {
                        const next = [...settings.countries];
                        next[idx] = { ...next[idx], name: e.target.value };
                        updateSettings("countries", next);
                      }} />
                      <button className="btn" onClick={() => {
                        const next = [...settings.countries];
                        next.splice(idx, 1);
                        updateSettings("countries", next);
                      }}>{t("admin_delete")}</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="section">
                <h4>{t("admin_calling_codes_title")}</h4>
                <button className="btn" onClick={() => { ensureArray("calling_codes"); updateSettings("calling_codes", [...(settings.calling_codes || []), { cc: "", name: "" }]); }}>{t("admin_add_calling_code")}</button>
                <div className="list">
                  {(settings.calling_codes || []).map((c: any, idx: number) => (
                    <div key={`cc-${idx}`} className="row">
                      <input className="input" placeholder={t("admin_calling_code_placeholder")} value={c.cc || ""} onChange={(e) => {
                        const next = [...settings.calling_codes];
                        next[idx] = { ...next[idx], cc: e.target.value };
                        updateSettings("calling_codes", next);
                      }} />
                      <input className="input" placeholder={t("admin_name")} value={c.name || ""} onChange={(e) => {
                        const next = [...settings.calling_codes];
                        next[idx] = { ...next[idx], name: e.target.value };
                        updateSettings("calling_codes", next);
                      }} />
                      <button className="btn" onClick={() => {
                        const next = [...settings.calling_codes];
                        next.splice(idx, 1);
                        updateSettings("calling_codes", next);
                      }}>{t("admin_delete")}</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="section">
                <h4>{t("admin_provinces_title")}</h4>
                <div className="row">
                  <select
                    className="input"
                    value={settings._prov_country || "ES"}
                    onChange={(e) => updateSettings("_prov_country", e.target.value)}
                  >
                    {(settings.countries || []).map((c: any) => (
                      <option key={c.code} value={c.code}>{c.code}</option>
                    ))}
                  </select>
                </div>
                <textarea
                  className="textarea"
                  rows={8}
                  value={(settings.provinces_by_country?.[settings._prov_country || "ES"] || [])
                    .map((p: any) => p.name || p.value || "")
                    .join("\n")}
                  onChange={(e) => {
                    const code = settings._prov_country || "ES";
                    const lines = e.target.value.split("\n").map((l) => l.trim()).filter(Boolean);
                    const next = { ...(settings.provinces_by_country || {}) };
                    next[code] = lines.map((l) => ({ value: l, name: l }));
                    updateSettings("provinces_by_country", next);
                  }}
                />
              </div>

              <button
                className="btn primary"
                onClick={async () => {
                  try {
                    const cleaned = { ...settings };
                    delete cleaned._prov_country;
                    const updated = await api.saveSettings(cleaned);
                    setSettings(updated || cleaned);
                    setSettingsMessage(t("admin_settings_saved"));
                  } catch (e: any) {
                    setSettingsMessage(e?.message || t("admin_settings_error"));
                  }
                }}
              >
                {t("admin_settings_save")}
              </button>
              {settingsMessage ? <div className="notice">{settingsMessage}</div> : null}
            </div>
          )}
        </div>
      ) : null}

      {tab === "users" ? (
        <div className="grid">
          <div className="card">
            <h3>{t("admin_users_title")}</h3>
            <div className="row">
              <input className="input" placeholder={t("admin_users_search_placeholder")} value={userQuery} onChange={(e) => setUserQuery(e.target.value)} />
              <button className="btn" onClick={async () => { setUserMessage(""); await loadUsers(); }}>{t("admin_users_search_button")}</button>
            </div>
            <div className="row">
              <select
                className="input"
                value={selectedUserId || ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (!id) return;
                  const u = usersById.get(id);
                  if (!u) return;
                  setSelectedUserId(u.id);
                  setAccessForm(accessFromPlan(u));
                  setUserForm({
                    display_name: u.display_name || "",
                    email: u.email || "",
                    phone: u.phone || "",
                    role: u.role || "user",
                    password: "",
                    email_verified: !!u.email_verified,
                    is_banned: !!u.is_banned,
                    banned_until: u.banned_until || "",
                    dob: u.dob || "",
                    country: u.country || "ES",
                    province: u.province || "",
                    city: u.city || "",
                  });
                }}
              >
                <option value="">{t("admin_users_select_placeholder")}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name} ({u.email || u.phone || u.id})
                  </option>
                ))}
              </select>
            </div>
            <div className="list">
              {users.map((u) => (
                <div key={u.id} className={"listItem" + (selectedUserId === u.id ? " active" : "")} onClick={() => {
                  setSelectedUserId(u.id);
                  setAccessForm(accessFromPlan(u));
                  setUserForm({
                    display_name: u.display_name || "",
                    email: u.email || "",
                    phone: u.phone || "",
                    role: u.role || "user",
                    password: "",
                    email_verified: !!u.email_verified,
                    is_banned: !!u.is_banned,
                    banned_until: u.banned_until || "",
                    dob: u.dob || "",
                    country: u.country || "ES",
                    province: u.province || "",
                    city: u.city || "",
                  });
                }}>
                  <div className="title">{u.display_name}</div>
                  <div className="meta">{u.email || ""} {u.phone || ""}</div>
                  <div className="meta">
                    {t2("plan_label")}: <span className={"pill " + planLabel(u.plan).tone}>{planLabel(u.plan).text}</span>
                  </div>
                  <div className="meta">{t("admin_users_logins_meta", { count: u.login_count || 0, last: u.last_login_at || "-" })}</div>
                  <div className="meta">{t("admin_users_last_seen_meta", { last: u.last_seen_at || "-", seconds: u.total_connected_seconds || 0 })}</div>
                  <div className="meta">{t("admin_users_active_meta", { active: u.session_active ? t("admin_yes") : t("admin_no"), start: u.session_started_at || "-" })}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>{t("admin_users_edit_title")}</h3>
            <input className="input" placeholder={t("admin_users_name")} value={userForm.display_name} onChange={(e) => setUserForm({ ...userForm, display_name: e.target.value })} />
            <input className="input" placeholder={t("admin_users_email")} value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
            <input className="input" placeholder={t("admin_users_phone")} value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })} />
            <input className="input" placeholder={t("admin_users_dob")} value={userForm.dob} onChange={(e) => setUserForm({ ...userForm, dob: e.target.value })} />
            <input className="input" placeholder={t("admin_users_country")} value={userForm.country} onChange={(e) => setUserForm({ ...userForm, country: e.target.value })} />
            <input className="input" placeholder={t("admin_users_province")} value={userForm.province} onChange={(e) => setUserForm({ ...userForm, province: e.target.value })} />
            <input className="input" placeholder={t("admin_users_city")} value={userForm.city} onChange={(e) => setUserForm({ ...userForm, city: e.target.value })} />
            <input className="input" placeholder={t("admin_users_role")} value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })} />
            <input className="input" placeholder={t("admin_users_new_password")} type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
            <label className="checkbox">
              <input type="checkbox" checked={!!userForm.email_verified} onChange={(e) => setUserForm({ ...userForm, email_verified: e.target.checked })} />
              {t("admin_users_email_verified")}
            </label>
            <button
              className="btn"
              onClick={async () => {
                if (!selectedUserId) return;
                try {
                  await api.resendVerification(selectedUserId);
                  setUserMessage(t("admin_users_resend_ok"));
                } catch (e: any) {
                  setUserMessage(e?.message || t("admin_users_resend_error"));
                }
              }}
            >
              {t("admin_users_resend_button")}
            </button>
            <label className="checkbox">
              <input type="checkbox" checked={!!userForm.is_banned} onChange={(e) => setUserForm({ ...userForm, is_banned: e.target.checked })} />
              {t("admin_users_blocked")}
            </label>
            <input className="input" placeholder={t("admin_users_blocked_until")} value={userForm.banned_until} onChange={(e) => setUserForm({ ...userForm, banned_until: e.target.value })} />
            <div className="section sub">
              <label className="label">{t2("access_title")}</label>
              <div className="row">
                <select
                  className="input"
                  value={accessForm.mode}
                  disabled={!selectedUserId}
                  onChange={(e) => setAccessForm({ ...accessForm, mode: e.target.value as AccessForm["mode"] })}
                >
                  <option value="none">{t2("access_none")}</option>
                  <option value="date">{t2("access_until")}</option>
                  <option value="lifetime">{t2("access_lifetime")}</option>
                </select>
                {accessForm.mode === "date" ? (
                  <input className="input" type="date" value={accessForm.date} onChange={(e) => setAccessForm({ ...accessForm, date: e.target.value })} />
                ) : null}
                <button
                  className="btn"
                  disabled={!selectedUserId}
                  onClick={async () => {
                    if (!selectedUserId) return;
                    setUserMessage("");
                    if (accessForm.mode === "date" && !accessForm.date) {
                      setUserMessage(t2("access_date_required"));
                      return;
                    }
                    try {
                      await api.setAccess(selectedUserId, accessForm.mode === "date" ? accessForm.date : accessForm.mode);
                      setUserMessage(t2("access_saved"));
                      await loadUsers();
                    } catch (e: any) {
                      setUserMessage(e?.message || t2("save_error"));
                    }
                  }}
                >
                  {t2("access_apply")}
                </button>
              </div>
              <div className="muted">{selectedUserId ? t2("access_hint") : t2("access_new_user_hint")}</div>
            </div>
            <div className="row">
              <button className="btn primary" onClick={async () => {
                setUserMessage("");
                const payload: any = { ...userForm };
                if (!payload.password) delete payload.password;
                if (!payload.banned_until) payload.banned_until = null;
                if (!selectedUserId) {
                  const missing = [];
                  if (!payload.display_name) missing.push(t("admin_users_name"));
                  if (!payload.email) missing.push(t("admin_users_email"));
                  if (!payload.phone) missing.push(t("admin_users_phone"));
                  if (!payload.password) missing.push(t("admin_users_password_label"));
                  if (!payload.dob) missing.push(t("admin_users_dob_short"));
                  if (!payload.province) missing.push(t("admin_users_province"));
                  if (missing.length) {
                    setUserMessage(t("admin_users_missing_fields", { fields: missing.join(", ") }));
                    return;
                  }
                }
                try {
                  if (selectedUserId) {
                    await api.updateUser(selectedUserId, payload);
                    setUserMessage(t("admin_users_updated"));
                  } else {
                    await api.createUser(payload);
                    setUserMessage(t("admin_users_created"));
                  }
                  await loadUsers();
                } catch (e: any) {
                  setUserMessage(e?.message || t("admin_users_save_error"));
                }
              }}>{selectedUserId ? t("admin_users_save_button") : t("admin_users_create_button")}</button>
              <button className="btn danger" onClick={async () => {
                if (!selectedUserId) return;
                if (!confirm(t("admin_users_delete_confirm"))) return;
                try {
                  await api.deleteUser(selectedUserId);
                  setSelectedUserId(null);
                  await loadUsers();
                  setUserMessage(t("admin_users_deleted"));
                } catch (e: any) {
                  setUserMessage(e?.message || t("admin_users_delete_error"));
                }
              }}>{t("admin_users_delete_button")}</button>
            </div>
            {userMessage ? <div className="notice">{userMessage}</div> : null}
          </div>
        </div>
      ) : null}

      {tab === "interests" ? (
        <div className="grid">
          <div className="card">
            <h3>{t("admin_channels_title")}</h3>
            <div className="list">
              {interests.map((i) => (
                <div key={i.id} className={"listItem" + (selectedInterestId === i.id ? " active" : "")}>
                  <div className="title">{i.name}</div>
                  <div className="meta">{i.slug}</div>
                  <div className="row">
                    <button className="btn" onClick={() => { setSelectedInterestId(i.id); setInterestName(i.name); }}>{t("admin_channels_edit_button")}</button>
                    <button className="btn" onClick={async () => {
                      setInterestMessage("");
                      try {
                        await api.deleteInterest(i.id);
                        await loadInterests();
                      } catch (e: any) {
                        // 409 when channels use it: the backend explains why
                        setInterestMessage(e?.message || t2("save_error"));
                      }
                    }}>{t("admin_channels_delete_button")}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h3>{t("admin_channels_form_title")}</h3>
            <input className="input" placeholder={t("admin_channels_name_placeholder")} value={interestName} onChange={(e) => setInterestName(e.target.value)} />
            <div className="muted">{t("admin_channels_slug_label", { slug: slugifyName(interestName || "") || "-" })}</div>
            <div className="row">
              <button className="btn primary" onClick={async () => {
                setInterestMessage("");
                const slug = slugifyName(interestName);
                if (!slug || !interestName.trim()) {
                  setInterestMessage(t("admin_channels_name_required"));
                  return;
                }
                try {
                  if (selectedInterestId) {
                    await api.updateInterest(selectedInterestId, { slug, name: interestName.trim() });
                    setInterestMessage(t("admin_channels_updated"));
                  } else {
                    await api.createInterest({ slug, name: interestName.trim() });
                    setInterestMessage(t("admin_channels_created"));
                  }
                  setSelectedInterestId(null);
                  setInterestName("");
                  await loadInterests();
                } catch (e: any) {
                  setInterestMessage(e?.message || t("admin_channels_save_error"));
                }
              }}>{t("admin_channels_save_button")}</button>
            </div>
            {interestMessage ? <div className="notice">{interestMessage}</div> : null}
          </div>
        </div>
      ) : null}

      {tab === "moderation" ? <ModerationTab /> : null}
      {tab === "billing" ? <BillingTab /> : null}
      {tab === "codes" ? <PromoCodesTab /> : null}

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
                  <div
                    ref={debugFilterRef}
                    style={{ position: "relative" }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <button
                      className="tab"
                      style={{ padding: "6px 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
                      onClick={() => setDebugFilterOpen((open) => !open)}
                    >
                      Servicios: {filterLabel}
                      <span style={{ opacity: 0.8 }}>▾</span>
                    </button>
                    {debugFilterOpen ? (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          marginTop: 6,
                          background: "rgba(18,18,18,0.98)",
                          border: "1px solid rgba(255,255,255,0.15)",
                          borderRadius: 10,
                          padding: 10,
                          minWidth: 240,
                          zIndex: 10001,
                          boxShadow: "0 12px 24px rgba(0,0,0,0.35)",
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "white", padding: "4px 0" }}>
                          <input
                            type="checkbox"
                            checked={debugServiceFilter.length === 0}
                            onChange={() => setDebugServiceFilter([])}
                          />
                          {t("debug_tab_all")} ({combinedLogs.length})
                        </label>
                        <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "6px 0" }} />
                        {serviceOptions.map((svc) => (
                          <label key={svc} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "white", padding: "4px 0" }}>
                            <input
                              type="checkbox"
                              checked={debugServiceFilter.length === 0 ? false : debugServiceFilter.includes(svc)}
                              onChange={() => toggleServiceFilter(svc)}
                            />
                            {serviceLabel(svc).replace("MeetGo-", "")} ({serviceCounts[svc] || 0})
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {t("debug_subtitle", { count: filteredLogs.length })} - {svcLogStatus === "connected" ? t("debug_services_connected") : (svcLogStatus === "connecting" ? t("debug_services_connecting") : svcLogStatus === "disabled" ? t2("logs_disabled") : t("debug_services_error") + (svcLogDetail ? ` (${svcLogDetail})` : ""))}
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={debugAutoRefresh}
                      onChange={(e) => setDebugAutoRefresh(e.target.checked)}
                    />
                    {t("debug_auto_refresh")}
                  </label>
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
                title={debugMaximized ? t("debug_restore") : t("debug_maximize")}
                onClick={onDebugMaximize}
              >
                []
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

          {!debugMinimized ? (
            <div ref={debugLogsRef} style={{ overflow: "auto", padding: 12, paddingBottom: 40, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, whiteSpace: "pre" }}>
              {filteredLogs.map((item, idx) => {
                if (item.kind === "front") {
                  const info = extractService(item.entry.msg);
                  const ts = formatTime(item.entry.ts);
                  const meta = levelMeta(item.entry.level);
                  const svcLabel = serviceLabel("frontend");
                  return (
                    <div key={`front-${idx}`} style={{ marginBottom: 8, color: "white" }}>
                      <div style={{ opacity: 0.9 }}>
                        <span style={{ color: serviceLabelColor(svcLabel) }}>[{svcLabel}]</span>
                        <span style={{ color: meta.color }}> - [{ts}] - [{meta.label}] - {info.text}</span>
                      </div>
                      {item.entry.data !== undefined ? (
                        <div style={{ marginTop: 4, opacity: 0.85 }}>
                          <span style={{ color: serviceLabelColor(svcLabel) }}>[{svcLabel}]</span>
                          <span style={{ color: meta.color }}> - [{ts}] - [{meta.label}] - {safeStr(item.entry.data)}</span>
                        </div>
                      ) : null}
                    </div>
                  );
                }
                const clean = cleanDockerLogLine(item.line);
                const meta = serviceLevelMeta(clean);
                const svcLabel = serviceLabel(item.service);
                return (
                  <div key={`svc-${idx}`} style={{ marginBottom: 8, color: "white" }}>
                    <div style={{ opacity: 0.9 }}>
                      <span style={{ color: serviceLabelColor(svcLabel) }}>[{svcLabel}]</span>
                      <span style={{ color: meta.color }}> - [{formatTime(item.ts, true)}] - [{meta.label}] - {clean}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {!debugMinimized ? (
            <div style={{ display: "flex", gap: 10, padding: "18px 12px", borderTop: "1px solid rgba(255,255,255,0.12)", alignItems: "center" }}>
              <button
                className="btn"
                style={{ padding: "12px 16px", minHeight: 48, lineHeight: "20px" }}
                onClick={() => {
                  const filterSet = new Set(debugServiceFilter);
                  const clearAll = debugServiceFilter.length === 0;
                  setFrontLogs((prev) => (clearAll || filterSet.has("frontend") ? [] : prev));
                  setSvcLogs((prev) => {
                    if (clearAll) return [];
                    if (filterSet.size === 0) return prev;
                    return prev.filter((l) => !filterSet.has(l.service));
                  });
                }}
              >
                {t("debug_clear")}
              </button>
              <button
                className="btn"
                style={{ padding: "12px 16px", minHeight: 48, lineHeight: "20px" }}
                onClick={() => {
                  try {
                    const txt = filteredLogs.map((item) => {
                      if (item.kind === "front") {
                        const info = extractService(item.entry.msg);
                        const ts = formatTime(item.entry.ts);
                        const meta = levelMeta(item.entry.level);
                        const base = `[${serviceLabel("frontend")}] - [${ts}] - [${meta.label}] - ${info.text}`;
                        if (item.entry.data === undefined) return base;
                        return `${base}\n[${serviceLabel("frontend")}] - [${ts}] - [${meta.label}] - ${safeStr(item.entry.data)}`;
                      }
                      const clean = cleanDockerLogLine(item.line);
                      const meta = serviceLevelMeta(clean);
                      return `[${serviceLabel(item.service)}] - [${formatTime(item.ts, true)}] - [${meta.label}] - ${clean}`;
                    }).join("\n");
                    copyToClipboard(txt);
                  } catch {
                    // silent
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
                    if (!sel.trim()) return;
                    copyToClipboard(sel);
                  } catch {
                    // silent
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
