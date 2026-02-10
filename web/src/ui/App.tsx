import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, clearToken, getToken, setToken } from "./api";
import LogoSvg from "../assets/logo.svg";
import { getLang, setLang, t, type Lang } from "./i18n";

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

export default function App() {
  const [tab, setTab] = useState<"rooms"|"feed"|"profile">("rooms");
  const [lang, setLangState] = useState<Lang>(getLang());

  function changeLang(l: Lang) {
    setLang(l);
    setLangState(l); // force re-render
  }

  const [me, setMe] = useState<User | null>(null);
  const [auth, setAuth] = useState<{email:string; pass:string}>({ email:"", pass:"" });

  // --------- Country / Province / Phone data ---------
  const COUNTRIES = useMemo(() => ([
    { code: "ES", name: "España" },
    { code: "PT", name: "Portugal" },
    { code: "FR", name: "Francia" },
    { code: "IT", name: "Italia" },
    { code: "DE", name: "Alemania" },
    { code: "GB", name: "Reino Unido" },
    { code: "US", name: "Estados Unidos" },
    { code: "MX", name: "México" },
    { code: "AR", name: "Argentina" },
    { code: "CO", name: "Colombia" },
  ]), []);

  const CALLING_CODES = useMemo(() => ([
    { cc: "+34", country: "España" },
    { cc: "+351", country: "Portugal" },
    { cc: "+33", country: "Francia" },
    { cc: "+39", country: "Italia" },
    { cc: "+49", country: "Alemania" },
    { cc: "+44", country: "Reino Unido" },
    { cc: "+1", country: "EE. UU. / Canadá" },
    { cc: "+52", country: "México" },
    { cc: "+54", country: "Argentina" },
    { cc: "+57", country: "Colombia" },
  ]), []);

  const PROVINCES_BY_COUNTRY: Record<string, string[]> = useMemo(() => ({
    ES: [
      "Álava", "Albacete", "Alicante", "Almería", "Asturias", "Ávila", "Badajoz", "Barcelona", "Burgos",
      "Cáceres", "Cádiz", "Cantabria", "Castellón", "Ciudad Real", "Córdoba", "Cuenca", "Girona", "Granada",
      "Guadalajara", "Gipuzkoa", "Huelva", "Huesca", "Illes Balears", "Jaén", "A Coruña", "La Rioja", "Las Palmas",
      "León", "Lleida", "Lugo", "Madrid", "Málaga", "Murcia", "Navarra", "Ourense", "Palencia", "Pontevedra",
      "Salamanca", "Santa Cruz de Tenerife", "Segovia", "Sevilla", "Soria", "Tarragona", "Teruel", "Toledo",
      "Valencia", "Valladolid", "Bizkaia", "Zamora", "Zaragoza",
    ],
    // Ejemplos mínimos (amplíalos cuando quieras)
    PT: ["Lisboa", "Porto", "Braga", "Setúbal", "Aveiro"],
    FR: ["Île-de-France", "Occitanie", "Nouvelle-Aquitaine", "Auvergne-Rhône-Alpes"],
    IT: ["Lazio", "Lombardia", "Campania", "Sicilia"],
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
      // no provinces for this country in our list => clear & disable
      if (registerForm.province) setRegisterForm((prev: any) => ({ ...prev, province: "" }));
      return;
    }
    if (!opts.includes(registerForm.province)) {
      setRegisterForm((prev: any) => ({ ...prev, province: opts[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerForm.country]);

  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [composer, setComposer] = useState("");

  const INTERESTS = useMemo(() => ([
    { slug: "coffee", name: "☕ Quedar para un café" },
    { slug: "walk", name: "🚶 Paseo / caminar" },
    { slug: "gym", name: "🏋️ Gym" },
    { slug: "beer", name: "🍺 Cerveza" },
    { slug: "cinema", name: "🎬 Cine" },
  ]), []);

  const [joinInterest, setJoinInterest] = useState<string>("coffee");
  const wsRef = useRef<WebSocket | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const [menu, setMenu] = useState<{x:number;y:number; userId:number; name:string} | null>(null);
  const [profileModal, setProfileModal] = useState<{user: User} | null>(null);

  const [feed, setFeed] = useState<Post[]>([]);
  const [newPost, setNewPost] = useState("");

  const logoSrc = LogoPng || LogoSvg;

  async function refreshMe() {
    const u = await api.me();
    setMe(u);
    return u as User;
  }

  useEffect(() => {
    (async () => {
      if (getToken()) {
        try { await refreshMe(); } catch { clearToken(); }
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

  async function doLogin() {
    const tok = await api.login({ email: auth.email, password: auth.pass });
    setToken(tok.access_token);
    await refreshMe();
  }

  function validateRegister(): string | null {
    if (!registerForm.email?.trim()) return "Falta el email.";
    if (!registerForm.password || registerForm.password.length < 6) return "La contraseña debe tener al menos 6 caracteres.";
    if (!registerForm.display_name?.trim()) return "Falta el nombre.";

    // DOB: required, 18+
    const age = calcAge(registerForm.dob);
    if (age === null) return "Fecha de nacimiento inválida.";
    if (age < 18) return "Debes ser mayor de edad (18+).";

    // Country / Province
    if (!registerForm.country) return "Selecciona un país.";
    if (provinceOptions.length) {
      if (!registerForm.province) return "Selecciona una provincia.";
    } else {
      return "Aún no hay provincias configuradas para ese país.";
    }

    // Phone
    const digits = normalizePhoneDigits(registerForm.phone_number);
    if (!registerForm.phone_cc) return "Selecciona un prefijo internacional.";
    if (digits.length < 6) return "Teléfono inválido (muy corto).";

    return null;
  }

  async function doRegister() {
    setRegisterErr(null);

    const err = validateRegister();
    if (err) { setRegisterErr(err); return; }

    // Backend payload: only fields the API expects today
    const payload: any = {
      email: registerForm.email.trim(),
      password: registerForm.password,
      display_name: registerForm.display_name.trim(),
      dob: registerForm.dob,                // YYYY-MM-DD
      province: registerForm.province,      // used for rooms
      accept_dm: !!registerForm.accept_dm,
      avatar_url: registerForm.avatar_url?.trim() || null,
      bio: registerForm.bio?.trim() || null,
      // country & phone are collected but not sent yet (until backend supports them)
    };

    const u = await api.register(payload);

    // auto login
    const tok = await api.login({ email: payload.email, password: payload.password });
    setToken(tok.access_token);
    setMe(u);
  }

  async function loadRooms() {
    const r = await api.myRooms();
    setRooms(r);
    if (!selectedRoom && r.length) setSelectedRoom(r[0]);
  }

  async function joinRoom() {
    try {
      const room = await api.joinRoom(joinInterest);
      await loadRooms();
      await openRoom(room);
    } catch (e: any) {
      const msg = e?.message || String(e) || "No se pudo entrar en la sala.";
      console.error("[joinRoom] error:", e);
      alert(msg);
    }
  }

  async function openRoom(room: Room) {
    setSelectedRoom(room);
    const history = await api.roomMessages(room.id);
    setMsgs(history);
    connectWS(room.id);
    setTimeout(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight }), 50);
  }

  function connectWS(roomId: number) {
    const token = getToken();
    if (!token) {
      console.error("No hay sesión (token). Haz login de nuevo.");
      return;
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
    }

    const { wsProto, host } = apiBaseFromWindow();
    const wsPort = "18000"; // <-- el puerto host del backend (18000:8000)
    const wsUrl = `${wsProto}//${host}:${wsPort}/ws/rooms/${roomId}?token=${encodeURIComponent(token)}`;

    console.log("[WS] connecting:", wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[WS] connected ✅");
    };

    ws.onclose = (e) => {
      console.log("[WS] closed ❌", { code: e.code, reason: e.reason, wasClean: e.wasClean });
      alert(t("chat_disconnected"));
      console.error(t("chat_disconnected"));
    };

    ws.onerror = (e) => {
      console.log("[WS] error ❌", e);
      console.error("Error de conexión del chat (WebSocket). Revisa puerto/URL del backend.");
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);

      if (data.type === "room_message") {
        setMsgs(prev => [...prev, data.message]);
        setTimeout(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior:"smooth" }), 10);
        return;
      }

      if (data.type === "error") {
        alert(`Chat: ${data.code} (${data.detail})`);
        console.error(`Chat: ${data.code} (${data.detail})`);
        return;
      }

      console.log("[WS] message (unknown):", data);
    };
  }

  function sendMsg() {
    const ws = wsRef.current;
    if (!ws) {
      alert(t("chat_not_connected"));
      console.error(t("chat_not_connected"));
      return;
    }
    if (ws.readyState !== 1) {
      alert(t("chat_not_connected_state", { state: ws.readyState }));
      console.error(t("chat_not_connected_state", { state: ws.readyState }));
      return;
    }
    const content = composer.trim();
    if (!content) return;
    ws.send(JSON.stringify({ content }));
    setComposer("");
  }

  function onAvatarContextMenu(e: React.MouseEvent, u: {id:number; display_name:string}) {
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
    alert("Siguiendo ✅");
    console.log("Siguiendo ✅");
  }

  async function friendUser(userId: number) {
    await api.friendRequest(userId);
    setMenu(null);
    alert("Solicitud de amistad enviada ✅");
    console.log("Solicitud de amistad enviada ✅");
  }

  async function loadFeed() {
    const f = await api.feed();
    setFeed(f);
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
    alert("Perfil actualizado ✅");
    console.log("Perfil actualizado ✅");
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

          <div style={{display:"flex", gap:10, alignItems:"center"}}>
            <select
              className="input"
              style={{width: 120, padding: "6px 10px"}}
              value={lang}
              onChange={(e) => changeLang(e.target.value as Lang)}
            >
              <option value="es">ES</option>
              <option value="en">EN</option>
            </select>

            {isLogged ? (
              <button className="tab" onClick={() => { clearToken(); setMe(null); }}>{t("logout")}</button>
            ) : null}
          </div>
        </div>

        <div className="sidebar">
          {!isLogged ? (
            <>
              <div style={{fontWeight:800}}>{t("login_title")}</div>
              <input className="input" placeholder={t("email")} value={auth.email} onChange={e=>setAuth({...auth, email:e.target.value})} />
              <input className="input" placeholder={t("password")} type="password" value={auth.pass} onChange={e=>setAuth({...auth, pass:e.target.value})} />
              <button className="btn primary" onClick={doLogin}>{t("login_btn")}</button>

              <div className="small">{t("or_register")}</div>

              {registerErr ? (
                <div className="item" style={{border:"1px solid rgba(255,0,0,.25)"}}>
                  <div style={{fontWeight:900}}>{t("error_title")}</div>
                  <div className="small">{registerErr}</div>
                </div>
              ) : null}

              <input className="input" placeholder={t("email")} value={registerForm.email} onChange={e=>setRegisterForm({...registerForm, email:e.target.value})} />

              <input
                className="input"
                placeholder={t("password_hint")}
                type="password"
                maxLength={60}
                value={registerForm.password}
                onChange={e => setRegisterForm({ ...registerForm, password: e.target.value })}
              />

              <input className="input" placeholder={t("name")} value={registerForm.display_name} onChange={e=>setRegisterForm({...registerForm, display_name:e.target.value})} />

              {/* DOB: date picker */}
              <label className="small" style={{display:"block", marginTop:8}}>{t("dob_label")}</label>
              <input
                className="input"
                type="date"
                value={registerForm.dob}
                onChange={e=>setRegisterForm({...registerForm, dob:e.target.value})}
              />
              <div className="small" style={{marginTop:-6}}>
                {registerForm.dob ? (() => {
                  const a = calcAge(registerForm.dob);
                  if (a === null) return t("dob_invalid");
                  return a < 18 ? `Edad: ${a} (${t("dob_underage")})` : `Edad: ${a}`;
                })() : t("dob_pick")}
              </div>

              {/* Phone: calling code dropdown + number */}
              <label className="small" style={{display:"block", marginTop:10}}>{t("phone_label")}</label>
              <div style={{display:"grid", gridTemplateColumns:"140px 1fr", gap:8}}>
                <select
                  className="input"
                  value={registerForm.phone_cc}
                  onChange={e=>setRegisterForm({...registerForm, phone_cc:e.target.value})}
                >
                  {CALLING_CODES.map(x => (
                    <option key={x.cc} value={x.cc}>{x.cc} · {x.country}</option>
                  ))}
                </select>
                <input
                  className="input"
                  placeholder={t("phone_number")}
                  value={registerForm.phone_number}
                  onChange={e=>setRegisterForm({...registerForm, phone_number:e.target.value})}
                />
              </div>

              {/* Country + Province (dependent) */}
              <label className="small" style={{display:"block", marginTop:10}}>{t("country_label")}</label>
              <select
                className="input"
                value={registerForm.country}
                onChange={e=>setRegisterForm({...registerForm, country:e.target.value})}
              >
                {COUNTRIES.map(c => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>

              <label className="small" style={{display:"block", marginTop:10}}>{t("province_label")}</label>
              <select
                className="input"
                value={registerForm.province}
                disabled={!provinceOptions.length}
                onChange={e=>setRegisterForm({...registerForm, province:e.target.value})}
              >
                {provinceOptions.length ? (
                  provinceOptions.map((p: string) => <option key={p} value={p}>{p}</option>)
                ) : (
                  <option value="">{t("not_available")}</option>
                )}
              </select>

              <input className="input" placeholder={t("avatar_url")} value={registerForm.avatar_url} onChange={e=>setRegisterForm({...registerForm, avatar_url:e.target.value})} />
              <textarea className="input" placeholder={t("bio")} rows={3} value={registerForm.bio} onChange={e=>setRegisterForm({...registerForm, bio:e.target.value})} />
              <label className="small">
                <input type="checkbox" checked={registerForm.accept_dm} onChange={e=>setRegisterForm({...registerForm, accept_dm:e.target.checked})} /> {t("accept_dm")}
              </label>

              <button className="btn" onClick={doRegister}>{t("create_account")}</button>
            </>
          ) : (
            <>
              <div style={{fontWeight:800}}>{t("hello", { name: me.display_name })}</div>
              <div className="small">{me.province} · {me.age_range}</div>
              <div className="small">{t("right_click_hint")}</div>

              <div className="nav">
                <button className={"tab " + (tab==="rooms"?"active":"")} onClick={()=>setTab("rooms")}>{t("rooms")}</button>
                <button className={"tab " + (tab==="feed"?"active":"")} onClick={()=>{ setTab("feed"); loadFeed(); }}>{t("feed")}</button>
                <button className={"tab " + (tab==="profile"?"active":"")} onClick={()=>setTab("profile")}>{t("profile")}</button>
              </div>

              {tab==="rooms" ? (
                <>
                  <button className="btn primary" onClick={() => loadRooms()}>{t("load_my_rooms")}</button>

                  <div className="item" style={{marginTop:10}}>
                    <div style={{fontWeight:900}}>{t("join_room_title")}</div>
                    <div className="small">{t("join_room_desc")}</div>
                    <div style={{display:"grid", gridTemplateColumns:"1fr 140px", gap:8, marginTop:8}}>
                      <select className="input" value={joinInterest} onChange={e=>setJoinInterest(e.target.value)}>
                        {INTERESTS.map(i => (
                          <option key={i.slug} value={i.slug}>{i.name}</option>
                        ))}
                      </select>
                      <button className="btn primary" onClick={joinRoom}>{t("join_btn")}</button>
                    </div>
                  </div>

                  <div className="list" style={{maxHeight: 420}}>
                    {rooms.length === 0 ? (
                      <div className="item" style={{cursor:"default"}}>
                        <div style={{fontWeight:800}}>{t("no_rooms_title")}</div>
                        <div className="small">{t("no_rooms_desc")}</div>
                      </div>
                    ) : null}

                    {rooms.map(r => (
                      <div key={r.id} className={"item " + (selectedRoom?.id===r.id?"active":"")} onClick={()=>openRoom(r)}>
                        <div style={{fontWeight:800}}>{r.interest.name}</div>
                        <div className="small">{r.province} · {r.age_range} · #{r.interest.slug}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {tab==="feed" ? (
                <>
                  <textarea className="input" rows={3} placeholder={t("publish_placeholder")} value={newPost} onChange={e=>setNewPost(e.target.value)} />
                  <button className="btn primary" onClick={publishPost}>{t("publish_btn")}</button>
                  <button className="btn" onClick={loadFeed}>{t("refresh_btn")}</button>
                </>
              ) : null}

              {tab==="profile" ? (
                <>
                  <input className="input" value={me.display_name} onChange={e=>setMe({...me, display_name:e.target.value})} />
                  <input className="input" placeholder={t("avatar_url")} value={me.avatar_url || ""} onChange={e=>setMe({...me, avatar_url:e.target.value})} />
                  <textarea className="input" rows={4} placeholder={t("bio")} value={me.bio || ""} onChange={e=>setMe({...me, bio:e.target.value})} />
                  <label className="small">
                    <input type="checkbox" checked={me.accept_dm} onChange={e=>setMe({...me, accept_dm:e.target.checked})} /> {t("accept_dm")}
                  </label>
                  <button className="btn primary" onClick={updateMyProfile}>Guardar perfil</button>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="card main">
        <div className="header">
          <div>
            <div style={{fontWeight:900}}>
              {tab==="rooms" ? (selectedRoom ? selectedRoom.interest.name : t("rooms")) : (tab==="feed" ? t("feed") : t("profile"))}
            </div>
            <div className="small">
              {tab==="rooms" && selectedRoom ? `${selectedRoom.province} · ${selectedRoom.age_range}` : ""}
            </div>
          </div>
          <div className="small">MeetGo — meet people, go places</div>
        </div>

        <div className="mainBody">
          {tab==="rooms" ? (
            <>
              <div className="list">
                <div className="item" style={{cursor:"default"}}>
                  <div style={{fontWeight:800}}>{t("tip_title")}</div>
                  <div className="small">{t("tip_body")}</div>
                </div>
                <div className="item" style={{cursor:"default"}}>
                  <div style={{fontWeight:800}}>{t("quick_title")}</div>
                  <div className="small">{t("quick_body")}</div>
                </div>
              </div>

              <div className="chatWrap">
                <div className="messages" ref={messagesRef}>
                  {msgs.map(m => (
                    <div key={m.id} className="msgRow">
                      <div className="avatar" onContextMenu={(e)=>onAvatarContextMenu(e, {id:m.user.id, display_name:m.user.display_name})} title={t("quick_body")}>
                        <img src={avatarSrc(m.user)} alt={m.user.display_name} />
                      </div>
                      <div className="bubble">
                        <div className="meta">
                          <div className="name">{m.user.display_name}</div>
                          <div className="time">{fmtTime(m.created_at)}</div>
                          {m.is_deleted ? <div className="time">({m.moderation_reason})</div> : null}
                        </div>
                        <div className="text">{m.is_deleted ? "Mensaje eliminado por moderación" : m.content}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="composer">
                  <textarea placeholder={t("write_placeholder")} value={composer} onChange={e=>setComposer(e.target.value)} />
                  <button className="btn primary" onClick={sendMsg}>{t("send_btn")}</button>
                </div>
              </div>
            </>
          ) : null}

          {tab==="feed" ? (
            <div className="chatWrap" style={{gridColumn:"1 / -1"}}>
              <div className="messages">
                {feed.map(p => (
                  <div key={p.id} className="msgRow">
                    <div className="avatar" onContextMenu={(e)=>onAvatarContextMenu(e, {id:p.user.id, display_name:p.user.display_name})}>
                      <img src={avatarSrc(p.user)} alt={p.user.display_name} />
                    </div>
                    <div className="bubble" style={{maxWidth:"860px"}}>
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

          {tab==="profile" ? (
            <div className="chatWrap" style={{gridColumn:"1 / -1"}}>
              <div className="messages">
                <div className="msgRow">
                  <div className="bigAvatar">
                    <img src={avatarSrc(me || undefined)} />
                  </div>
                  <div>
                    <div style={{fontWeight:900, fontSize:18}}>{me?.display_name}</div>
                    <div className="small">{me?.province} · {me?.age_range}</div>
                    <div style={{marginTop:10, whiteSpace:"pre-wrap"}}>{me?.bio || "Sin bio todavía."}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {menu ? (
        <div className="menu" style={{left: menu.x, top: menu.y}} onClick={(e)=>e.stopPropagation()}>
          <button onClick={()=>viewProfile(menu.userId)}>Ver perfil</button>
          <div className="sep" />
          <button onClick={()=>friendUser(menu.userId)}>Enviar solicitud de amistad</button>
          <button onClick={()=>followUser(menu.userId)}>Seguir feed</button>
        </div>
      ) : null}

      {profileModal ? (
        <div className="modalBackdrop" onClick={()=>setProfileModal(null)}>
          <div className="modal" onClick={(e)=>e.stopPropagation()}>
            <div className="modalHeader">
              <div className="modalTitle">Perfil</div>
              <button className="tab" onClick={()=>setProfileModal(null)}>Cerrar</button>
            </div>
            <div className="grid2">
              <div className="bigAvatar"><img src={avatarSrc(profileModal.user)} /></div>
              <div>
                <div style={{fontWeight:900, fontSize:18}}>{profileModal.user.display_name}</div>
                <div className="small">{profileModal.user.province} · {profileModal.user.age_range}</div>
                <div style={{marginTop:10, whiteSpace:"pre-wrap"}}>{profileModal.user.bio || "Sin bio todavía."}</div>
                <div className="actions">
                  <button className="btn primary" onClick={()=>friendUser(profileModal.user.id)}>Amistad</button>
                  <button className="btn" onClick={()=>followUser(profileModal.user.id)}>Seguir</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
