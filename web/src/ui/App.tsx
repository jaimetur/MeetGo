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
  type FrontLogEntry,
} from "./api";
import LogoSvg from "../assets/logo.svg";
import { getLang, setLang, t, type Lang } from "./lang";

// ---- Toggle DEBUG PANEL by code only ----
const DEBUG_FRONTEND_LOG = true;

// If logo.png exists it will be preferred by bundler as static import (optional)
let LogoPng: string | null = null;
try { LogoPng = (await import("../assets/logo.png")).default; } catch {}

type User = {
  id: number;
  display_name: string;
  province: string;
  age_range: string;
  accept_dm: boolean;
  avatar_url?: string | null;
  bio?: string | null;
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

function apiBaseFromWindow() {
  // If you configured VITE_API_BASE, api.ts will use it.
  // This is only used to build a WS URL that matches the host.
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname;
  return { wsProto: proto, host };
}

function safeStr(x: any) {
  if (x == null) return "";
  if (typeof x === "string") return x;
  try { return JSON.stringify(x); } catch { return String(x); }
}

function formatTime(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function extractService(msg: string) {
  const m = msg.match(/^\[([^\]]+)\]\s*/);
  if (!m) return { service: "frontend", text: msg };
  return { service: m[1], text: msg.slice(m[0].length) };
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
  const [debugTab, setDebugTab] = useState<"frontend" | "services">("frontend");
  const [debugPos, setDebugPos] = useState<{ x: number; y: number }>({ x: 12, y: 12 });
  const frontLogsRef = useRef<HTMLDivElement | null>(null);
  const svcLogsRef = useRef<HTMLDivElement | null>(null);
  const debugPanelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const dragSelectRef = useRef<string>("");

  useEffect(() => {
    if (!DEBUG_FRONTEND_LOG) return;

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
    if (!DEBUG_FRONTEND_LOG) return;
    setTimeout(() => {
      frontLogsRef.current?.scrollTo({ top: frontLogsRef.current.scrollHeight });
    }, 0);
  }, [frontLogs.length]);

  useEffect(() => {
    if (!DEBUG_FRONTEND_LOG) return;

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
    if (!DEBUG_FRONTEND_LOG) return;
    setTimeout(() => {
      svcLogsRef.current?.scrollTo({ top: svcLogsRef.current.scrollHeight });
    }, 0);
  }, [svcLogs.length]);

  useEffect(() => {
    if (!DEBUG_FRONTEND_LOG) return;

    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const panel = debugPanelRef.current;
      const w = panel?.offsetWidth || 0;
      const h = panel?.offsetHeight || 0;
      const maxX = Math.max(0, window.innerWidth - w);
      const maxY = Math.max(0, window.innerHeight - h);
      const nextX = Math.min(Math.max(dragRef.current.origX + dx, 0), maxX);
      const nextY = Math.min(Math.max(dragRef.current.origY + dy, 0), maxY);
      setDebugPos({ x: nextX, y: nextY });
    };

    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
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

  const [me, setMe] = useState<User | null>(null);
  const [auth, setAuth] = useState<{ email: string; pass: string }>({ email: "", pass: "" });

  // --------- Country / Province / Phone data ---------
  const COUNTRIES = useMemo(() => ([
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

  const CALLING_CODES = useMemo(() => ([
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

  const PROVINCES_BY_COUNTRY: Record<string, { value: string; labelKey: string }[]> = useMemo(() => ({
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

  const [registerErr, setRegisterErr] = useState<string | null>(null);

  const [registerForm, setRegisterForm] = useState<any>({
    email: "",
    password: "",
    display_name: "",
    dob: "",
    country: "ES",
    province: "Madrid",
    phone_cc: "+34",
    phone_number: "",
    accept_dm: false,
    avatar_url: "",
    bio: "",
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

  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [composer, setComposer] = useState("");

  const INTEREST_EMOJIS: Record<string, string> = {
    cafe: "☕",
    senderismo: "🥾",
    cine: "🎬",
    deporte: "💪",
    networking: "🤝",
  };

  const [joinInterest, setJoinInterest] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const [menu, setMenu] = useState<{ x: number; y: number; userId: number; name: string } | null>(null);
  const [profileModal, setProfileModal] = useState<{ user: User } | null>(null);

  const [feed, setFeed] = useState<Post[]>([]);
  const [newPost, setNewPost] = useState("");
  const [interests, setInterests] = useState<Interest[]>([]);

  const logoSrc = LogoPng || LogoSvg;

  function formatInterestLabel(interest: { slug: string; name: string }) {
    const emoji = INTEREST_EMOJIS[interest.slug];
    return emoji ? `${emoji} ${interest.name}` : interest.name;
  }

  async function refreshMe() {
    const u = await api.me();
    setMe(u);
    frontLog("[AUTH] me()", u);
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
    function onDocClick() { setMenu(null); }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") { setMenu(null); setProfileModal(null); } }
    window.addEventListener("click", onDocClick);
    window.addEventListener("keydown", onEsc);
    return () => { window.removeEventListener("click", onDocClick); window.removeEventListener("keydown", onEsc); };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listInterests();
        setInterests(list || []);
      } catch (e) {
        frontWarn("[INTERESTS] list failed", e);
      }
    })();
  }, []);

  useEffect(() => {
    if (!joinInterest && interests.length) {
      setJoinInterest(interests[0].slug);
    }
  }, [interests, joinInterest]);

  async function doLogin() {
    const tok = await api.login({ email: auth.email, password: auth.pass });
    setToken(tok.access_token);
    frontLog("[AUTH] login OK");
    await refreshMe();
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

    const err = validateRegister();
    if (err) { setRegisterErr(err); return; }

    const payload: any = {
      email: registerForm.email.trim(),
      password: registerForm.password,
      display_name: registerForm.display_name.trim(),
      dob: registerForm.dob,
      province: registerForm.province,
      accept_dm: !!registerForm.accept_dm,
      avatar_url: registerForm.avatar_url?.trim() || null,
      bio: registerForm.bio?.trim() || null,
    };

    const u = await api.register(payload);

    const tok = await api.login({ email: payload.email, password: payload.password });
    setToken(tok.access_token);
    setMe(u);
    frontLog("[AUTH] registered + logged in", u);
  }

  async function loadRooms() {
    const r = await api.myRooms();
    setRooms(r);
    frontLog("[ROOMS] myRooms()", r);
    if (!selectedRoom && r.length) setSelectedRoom(r[0]);
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

  async function openRoom(room: Room) {
    setSelectedRoom(room);
    const history = await api.roomMessages(room.id);
    setMsgs(history);
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
      try { wsRef.current.close(); } catch {}
    }

    const { wsProto, host } = apiBaseFromWindow();
    const wsPort = "18000"; // <-- el puerto host del backend (18000:8000)
    const wsUrl = `${wsProto}//${host}:${wsPort}/ws/rooms/${roomId}?token=${encodeURIComponent(token)}`;

    frontLog("[WS] connecting", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      frontLog("[WS] connected OK");
    };

    ws.onclose = (e) => {
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
        setMsgs(prev => [...prev, data.message]);
        setTimeout(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" }), 10);
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
    if (ws.readyState !== 1) {
      alert(t("chat_not_connected_state", { state: ws.readyState }));
      frontError(t("chat_not_connected_state", { state: ws.readyState }));
      return;
    }
    const content = composer.trim();
    if (!content) return;
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

  async function updateMyProfile() {
    if (!me) return;
    await api.updateProfile({ display_name: me.display_name, avatar_url: me.avatar_url || null, bio: me.bio || null, accept_dm: me.accept_dm });
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
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {isLogged ? (
              <button className="tab" onClick={() => { clearToken(); setMe(null); }}>{t("logout")}</button>
            ) : null}
          </div>
        </div>

        <div className="sidebar">
          {!isLogged ? (
            <>
              <div style={{ fontWeight: 800 }}>{t("login_title")}</div>
              <input className="input" placeholder={t("email")} value={auth.email} onChange={e => setAuth({ ...auth, email: e.target.value })} />
              <input className="input" placeholder={t("password")} type="password" value={auth.pass} onChange={e => setAuth({ ...auth, pass: e.target.value })} />
              <button className="btn primary" onClick={doLogin}>{t("login_btn")}</button>

              <div className="small">{t("or_register")}</div>

              {registerErr ? (
                <div className="item" style={{ border: "1px solid rgba(255,0,0,.25)" }}>
                  <div style={{ fontWeight: 900 }}>{t("error_title")}</div>
                  <div className="small">{registerErr}</div>
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

              <label className="small" style={{ display: "block", marginTop: 10 }}>{t("phone_label")}</label>
              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8 }}>
                <select
                  className="input"
                  value={registerForm.phone_cc}
                  onChange={e => setRegisterForm({ ...registerForm, phone_cc: e.target.value })}
                >
                  {CALLING_CODES.map(x => (
                    <option key={x.cc} value={x.cc}>{x.cc} - {t(x.labelKey)}</option>
                  ))}
                </select>
                <input
                  className="input"
                  placeholder={t("phone_number")}
                  value={registerForm.phone_number}
                  onChange={e => setRegisterForm({ ...registerForm, phone_number: e.target.value })}
                />
              </div>

              <label className="small" style={{ display: "block", marginTop: 10 }}>{t("country_label")}</label>
              <select
                className="input"
                value={registerForm.country}
                onChange={e => setRegisterForm({ ...registerForm, country: e.target.value })}
              >
                {COUNTRIES.map(c => (
                  <option key={c.code} value={c.code}>{t(c.labelKey)}</option>
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
                  provinceOptions.map((p) => <option key={p.value} value={p.value}>{t(p.labelKey)}</option>)
                ) : (
                  <option value="">{t("not_available")}</option>
                )}
              </select>

              <input className="input" placeholder={t("avatar_url")} value={registerForm.avatar_url} onChange={e => setRegisterForm({ ...registerForm, avatar_url: e.target.value })} />
              <textarea className="input" placeholder={t("bio")} rows={3} value={registerForm.bio} onChange={e => setRegisterForm({ ...registerForm, bio: e.target.value })} />
              <label className="small">
                <input type="checkbox" checked={registerForm.accept_dm} onChange={e => setRegisterForm({ ...registerForm, accept_dm: e.target.checked })} /> {t("accept_dm")}
              </label>

              <button className="btn" onClick={doRegister}>{t("create_account")}</button>

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
              <div className="small">{me.province} - {me.age_range}</div>
              <div className="small">{t("right_click_hint")}</div>

              <div className="nav">
                <button className={"tab " + (tab === "rooms" ? "active" : "")} onClick={() => setTab("rooms")}>{t("rooms")}</button>
                <button className={"tab " + (tab === "feed" ? "active" : "")} onClick={() => { setTab("feed"); loadFeed(); }}>{t("feed")}</button>
                <button className={"tab " + (tab === "profile" ? "active" : "")} onClick={() => setTab("profile")}>{t("profile")}</button>
              </div>

              {tab === "rooms" ? (
                <>
                  <button className="btn primary" onClick={() => loadRooms()}>{t("load_my_rooms")}</button>

                  <div className="item" style={{ marginTop: 10 }}>
                    <div style={{ fontWeight: 900 }}>{t("join_room_title")}</div>
                    <div className="small">{t("join_room_desc")}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8 }}>
                      <select className="input" style={{ width: "100%" }} value={joinInterest} onChange={e => setJoinInterest(e.target.value)}>
                        {interests.length ? (
                          interests.map(i => (
                            <option key={i.slug} value={i.slug}>{formatInterestLabel(i)}</option>
                          ))
                        ) : (
                          <option value="">{t("loading_interests")}</option>
                        )}
                      </select>
                      <button className="btn primary" style={{ width: "100%" }} onClick={joinRoom}>{t("join_btn")}</button>
                    </div>
                  </div>

                  <div className="list" style={{ maxHeight: 420 }}>
                    {rooms.length === 0 ? (
                      <div className="item" style={{ cursor: "default" }}>
                        <div style={{ fontWeight: 800 }}>{t("no_rooms_title")}</div>
                        <div className="small">{t("no_rooms_desc")}</div>
                      </div>
                    ) : null}

                    {rooms.map(r => (
                      <div key={r.id} className={"item " + (selectedRoom?.id === r.id ? "active" : "")} onClick={() => openRoom(r)}>
                        <div style={{ fontWeight: 800 }}>{formatInterestLabel(r.interest)}</div>
                        <div className="small">{r.province} - {r.age_range} - #{r.interest.slug}</div>
                      </div>
                    ))}
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

              {tab === "profile" ? (
                <>
                  <input className="input" value={me.display_name} onChange={e => setMe({ ...me, display_name: e.target.value })} />
                  <input className="input" placeholder={t("avatar_url")} value={me.avatar_url || ""} onChange={e => setMe({ ...me, avatar_url: e.target.value })} />
                  <textarea className="input" rows={4} placeholder={t("bio")} value={me.bio || ""} onChange={e => setMe({ ...me, bio: e.target.value })} />
                  <button className="btn primary" onClick={updateMyProfile}>{t("save_profile")}</button>
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
                <label className="small" style={{ display: "block", marginTop: 8 }}>
                  <input type="checkbox" checked={me.accept_dm} onChange={e => setMe({ ...me, accept_dm: e.target.checked })} /> {t("accept_dm")}
                </label>
                <button className="btn" onClick={updateMyProfile}>{t("save_settings")}</button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card main">
        <div className="header">
          <div>
            <div style={{ fontWeight: 900 }}>
              {tab === "rooms" ? (selectedRoom ? formatInterestLabel(selectedRoom.interest) : t("rooms")) : (tab === "feed" ? t("feed") : t("profile"))}
            </div>
            <div className="small">
              {tab === "rooms" && selectedRoom ? `${selectedRoom.province} - ${selectedRoom.age_range}` : ""}
            </div>
          </div>
          <div className="small">{t("tagline_long")}</div>
        </div>

        <div className="mainBody">
          {tab === "rooms" ? (
            <>
              <div className="list">
                <div className="item" style={{ cursor: "default" }}>
                  <div style={{ fontWeight: 800 }}>{t("tip_title")}</div>
                  <div className="small">{t("tip_body")}</div>
                </div>
                <div className="item" style={{ cursor: "default" }}>
                  <div style={{ fontWeight: 800 }}>{t("quick_title")}</div>
                  <div className="small">{t("quick_body")}</div>
                </div>
              </div>

              <div className="chatWrap">
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
                  <textarea placeholder={t("write_placeholder")} value={composer} onChange={e => setComposer(e.target.value)} />
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
                    <div className="small">{me?.province} - {me?.age_range}</div>
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
                <div className="small">{profileModal.user.province} - {profileModal.user.age_range}</div>
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
      {DEBUG_FRONTEND_LOG ? (
        <div
          ref={debugPanelRef}
          style={{
            position: "fixed",
            left: debugPos.x,
            top: debugPos.y,
            width: 720,
            height: 380,
            minWidth: 420,
            minHeight: 200,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "calc(100vh - 24px)",
            background: "rgba(10,10,10,0.92)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 12,
            overflow: "auto",
            zIndex: 9999,
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            display: "grid",
            gridTemplateRows: "40px 1fr 40px",
            resize: "both",
          }}
          >
            <div
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px", borderBottom: "1px solid rgba(255,255,255,0.12)", cursor: "grab" }}
              onMouseDown={onDebugDragStart}
            >
            <div style={{ color: "white", fontWeight: 800 }}>{t("debug_title")}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className={"tab " + (debugTab === "frontend" ? "active" : "")}
                style={{ padding: "6px 10px", fontSize: 12 }}
                onClick={() => setDebugTab("frontend")}
              >
                {t("debug_frontend_tab", { count: frontLogs.length })}
              </button>
              <button
                className={"tab " + (debugTab === "services" ? "active" : "")}
                style={{ padding: "6px 10px", fontSize: 12 }}
                onClick={() => setDebugTab("services")}
              >
                {t("debug_services_tab", { count: svcLogs.length })}
              </button>
            </div>
            {debugTab === "services" ? (
              <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                {svcLogStatus === "connected" ? t("debug_services_connected") : (svcLogStatus === "connecting" ? t("debug_services_connecting") : t("debug_services_error"))}
              </div>
            ) : (
              <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{t("debug_subtitle", { count: frontLogs.length })}</div>
            )}
          </div>

          {debugTab === "frontend" ? (
            <div ref={frontLogsRef} style={{ overflow: "auto", padding: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
              {frontLogs.map((l, idx) => {
                const info = extractService(l.msg);
                const ts = formatTime(l.ts);
                return (
                  <div key={idx} style={{ marginBottom: 8, color: "white" }}>
                    <div style={{ opacity: 0.85, whiteSpace: "pre-wrap" }}>
                      {ts}[{l.level.toUpperCase()}][{info.service}] {info.text}
                    </div>
                    {l.data !== undefined ? (
                      <div style={{ marginTop: 4, opacity: 0.85, whiteSpace: "pre-wrap" }}>
                        {ts}[{l.level.toUpperCase()}][{info.service}] {safeStr(l.data)}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div ref={svcLogsRef} style={{ overflow: "auto", padding: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 }}>
              {svcLogs.map((l, idx) => (
                <div key={idx} style={{ marginBottom: 8, color: "white" }}>
                  <div style={{ opacity: 0.85, whiteSpace: "pre-wrap" }}>
                    {formatTime(l.ts)}[LOG][{l.service}] {l.line}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.12)" }}>
            <button
              className="btn"
              style={{ padding: "6px 10px" }}
              onClick={() => {
                if (debugTab === "frontend") setFrontLogs([]);
                else setSvcLogs([]);
              }}
            >
              {t("debug_clear")}
            </button>
            <button
              className="btn"
              style={{ padding: "6px 10px" }}
              onClick={() => {
                try {
                  const txt = debugTab === "frontend"
                    ? frontLogs.map((x) => {
                      const info = extractService(x.msg);
                      const ts = formatTime(x.ts);
                      const base = `${ts}[${x.level.toUpperCase()}][${info.service}] ${info.text}`;
                      if (x.data === undefined) return base;
                      return `${base}\n${ts}[${x.level.toUpperCase()}][${info.service}] ${safeStr(x.data)}`;
                    }).join("\n")
                    : svcLogs.map(x => `${formatTime(x.ts)}[LOG][${x.service}] ${x.line}`).join("\n");
                  navigator.clipboard.writeText(txt);
                  alert(t("debug_copy_ok"));
                } catch {
                  alert(t("debug_copy_fail"));
                }
              }}
            >
              {t("debug_copy")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

