import React, { useEffect, useMemo, useState } from "react";
import { api, clearToken, getToken, setToken } from "./api";

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
};

type Interest = { id: number; slug: string; name: string };

export default function App() {
  const [token, setTokenState] = useState(getToken());
  const [tab, setTab] = useState<"users" | "settings" | "interests">("users");
  const [login, setLogin] = useState({ username: "admin", password: "admin" });
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
  const [interests, setInterests] = useState<Interest[]>([]);
  const [interestName, setInterestName] = useState("");
  const [selectedInterestId, setSelectedInterestId] = useState<number | null>(null);
  const [interestMessage, setInterestMessage] = useState<string>("");
  const [settingsMessage, setSettingsMessage] = useState<string>("");
  const [testEmail, setTestEmail] = useState<string>("");
  const [smtpTestMessage, setSmtpTestMessage] = useState<string>("");

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
          <h2>MeetGo Admin</h2>
          <input
            className="input"
            placeholder="Username"
            value={login.username}
            onChange={(e) => setLogin({ ...login, username: e.target.value })}
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
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
            Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="header">
        <h2>MeetGo Admin</h2>
        <div className="tabs">
          <button className={tab === "users" ? "tab active" : "tab"} onClick={() => setTab("users")}>Usuarios</button>
          <button className={tab === "settings" ? "tab active" : "tab"} onClick={() => setTab("settings")}>Configuracion</button>
          <button className={tab === "interests" ? "tab active" : "tab"} onClick={() => setTab("interests")}>Canales</button>
          <button
            className="tab"
            onClick={() => {
              clearToken();
              setTokenState("");
            }}
          >
            Salir
          </button>
        </div>
      </div>

      {tab === "settings" ? (
        <div className="card">
          <h3>Configuracion</h3>
          {!settings ? (
            <div className="muted">Cargando...</div>
          ) : (
            <div className="stack">
              <div className="section">
                <h4>Aplicacion</h4>
                <label className="label">Base URL</label>
                <input
                  className="input"
                  placeholder="http://localhost:5173"
                  value={settings.app_base_url || ""}
                  onChange={(e) => updateSettings("app_base_url", e.target.value)}
                />
              </div>

              <div className="section">
                <h4>SMTP</h4>
                <div className="row">
                  <label className="label">Modo</label>
                  <select
                    className="input"
                    value={settings.smtp?.mode || "smtp"}
                    onChange={(e) => updateSettings("smtp.mode", e.target.value)}
                  >
                    <option value="smtp">SMTP</option>
                    <option value="gmail_api">Gmail API</option>
                  </select>
                  <label className="label">Encryption</label>
                  <select
                    className="input"
                    value={settings.smtp?.encryption || "starttls"}
                    onChange={(e) => updateSettings("smtp.encryption", e.target.value)}
                  >
                    <option value="starttls">STARTTLS</option>
                    <option value="ssl">SSL/TLS</option>
                  </select>
                </div>
                <div className="row">
                  <input className="input" placeholder="Host" value={settings.smtp?.host || ""} onChange={(e) => updateSettings("smtp.host", e.target.value)} />
                  <input className="input" placeholder="Port" value={settings.smtp?.port || ""} onChange={(e) => updateSettings("smtp.port", e.target.value)} />
                </div>
                <div className="row">
                  <input className="input" placeholder="Username" value={settings.smtp?.username || ""} onChange={(e) => updateSettings("smtp.username", e.target.value)} />
                  <input className="input" placeholder="Password" type="password" value={settings.smtp?.password || ""} onChange={(e) => updateSettings("smtp.password", e.target.value)} />
                </div>
                <div className="row">
                  <input className="input" placeholder="From email" value={settings.smtp?.from_email || ""} onChange={(e) => updateSettings("smtp.from_email", e.target.value)} />
                </div>
                {settings.smtp?.mode === "gmail_api" ? (
                  <div className="section sub">
                    <div className="row">
                      <input className="input" placeholder="Gmail Client ID" value={settings.smtp?.gmail_client_id || ""} onChange={(e) => updateSettings("smtp.gmail_client_id", e.target.value)} />
                      <input className="input" placeholder="Gmail Client Secret" value={settings.smtp?.gmail_client_secret || ""} onChange={(e) => updateSettings("smtp.gmail_client_secret", e.target.value)} />
                    </div>
                    <div className="row">
                      <input className="input" placeholder="Gmail Refresh Token" value={settings.smtp?.gmail_refresh_token || ""} onChange={(e) => updateSettings("smtp.gmail_refresh_token", e.target.value)} />
                      <input className="input" placeholder="Gmail Sender Email" value={settings.smtp?.gmail_sender_email || ""} onChange={(e) => updateSettings("smtp.gmail_sender_email", e.target.value)} />
                    </div>
                  </div>
                ) : null}
                <div className="row">
                  <input className="input" placeholder="Test email (destinatario)" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
                  <button
                    className="btn"
                    onClick={async () => {
                      setSmtpTestMessage("");
                      try {
                        await api.smtpTest(testEmail.trim());
                        setSmtpTestMessage("Correo de prueba enviado.");
                      } catch (e: any) {
                        setSmtpTestMessage(e?.message || "Error al enviar.");
                      }
                    }}
                  >
                    Enviar prueba
                  </button>
                </div>
                {smtpTestMessage ? <div className="notice">{smtpTestMessage}</div> : null}
              </div>

              <div className="section">
                <h4>Idiomas</h4>
                <button className="btn" onClick={() => { ensureArray("languages"); updateSettings("languages", [...(settings.languages || []), { code: "", name: "" }]); }}>Agregar idioma</button>
                <div className="list">
                  {(settings.languages || []).map((l: any, idx: number) => (
                    <div key={`lang-${idx}`} className="row">
                      <input className="input" placeholder="code" value={l.code || ""} onChange={(e) => {
                        const next = [...settings.languages];
                        next[idx] = { ...next[idx], code: e.target.value };
                        updateSettings("languages", next);
                      }} />
                      <input className="input" placeholder="name" value={l.name || ""} onChange={(e) => {
                        const next = [...settings.languages];
                        next[idx] = { ...next[idx], name: e.target.value };
                        updateSettings("languages", next);
                      }} />
                      <button className="btn" onClick={() => {
                        const next = [...settings.languages];
                        next.splice(idx, 1);
                        updateSettings("languages", next);
                      }}>Eliminar</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="section">
                <h4>Rangos de edad</h4>
                <button className="btn" onClick={() => { ensureArray("age_ranges"); updateSettings("age_ranges", [...(settings.age_ranges || []), { key: "", label: "", min: 0, max: null }]); }}>Agregar rango</button>
                <div className="list">
                  {(settings.age_ranges || []).map((r: any, idx: number) => (
                    <div key={`age-${idx}`} className="row">
                      <input className="input" placeholder="key" value={r.key || ""} onChange={(e) => {
                        const next = [...settings.age_ranges];
                        next[idx] = { ...next[idx], key: e.target.value };
                        updateSettings("age_ranges", next);
                      }} />
                      <input className="input" placeholder="label" value={r.label || ""} onChange={(e) => {
                        const next = [...settings.age_ranges];
                        next[idx] = { ...next[idx], label: e.target.value };
                        updateSettings("age_ranges", next);
                      }} />
                      <input className="input" placeholder="min" value={r.min ?? ""} onChange={(e) => {
                        const next = [...settings.age_ranges];
                        next[idx] = { ...next[idx], min: Number(e.target.value) };
                        updateSettings("age_ranges", next);
                      }} />
                      <input className="input" placeholder="max" value={r.max ?? ""} onChange={(e) => {
                        const next = [...settings.age_ranges];
                        const val = e.target.value === "" ? null : Number(e.target.value);
                        next[idx] = { ...next[idx], max: val };
                        updateSettings("age_ranges", next);
                      }} />
                      <button className="btn" onClick={() => {
                        const next = [...settings.age_ranges];
                        next.splice(idx, 1);
                        updateSettings("age_ranges", next);
                      }}>Eliminar</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="section">
                <h4>Paises</h4>
                <button className="btn" onClick={() => { ensureArray("countries"); updateSettings("countries", [...(settings.countries || []), { code: "", name: "" }]); }}>Agregar pais</button>
                <div className="list">
                  {(settings.countries || []).map((c: any, idx: number) => (
                    <div key={`country-${idx}`} className="row">
                      <input className="input" placeholder="code" value={c.code || ""} onChange={(e) => {
                        const next = [...settings.countries];
                        next[idx] = { ...next[idx], code: e.target.value };
                        updateSettings("countries", next);
                      }} />
                      <input className="input" placeholder="name" value={c.name || ""} onChange={(e) => {
                        const next = [...settings.countries];
                        next[idx] = { ...next[idx], name: e.target.value };
                        updateSettings("countries", next);
                      }} />
                      <button className="btn" onClick={() => {
                        const next = [...settings.countries];
                        next.splice(idx, 1);
                        updateSettings("countries", next);
                      }}>Eliminar</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="section">
                <h4>Prefijos telefonicos</h4>
                <button className="btn" onClick={() => { ensureArray("calling_codes"); updateSettings("calling_codes", [...(settings.calling_codes || []), { cc: "", name: "" }]); }}>Agregar prefijo</button>
                <div className="list">
                  {(settings.calling_codes || []).map((c: any, idx: number) => (
                    <div key={`cc-${idx}`} className="row">
                      <input className="input" placeholder="+34" value={c.cc || ""} onChange={(e) => {
                        const next = [...settings.calling_codes];
                        next[idx] = { ...next[idx], cc: e.target.value };
                        updateSettings("calling_codes", next);
                      }} />
                      <input className="input" placeholder="name" value={c.name || ""} onChange={(e) => {
                        const next = [...settings.calling_codes];
                        next[idx] = { ...next[idx], name: e.target.value };
                        updateSettings("calling_codes", next);
                      }} />
                      <button className="btn" onClick={() => {
                        const next = [...settings.calling_codes];
                        next.splice(idx, 1);
                        updateSettings("calling_codes", next);
                      }}>Eliminar</button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="section">
                <h4>Provincias por pais</h4>
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
                    setSettingsMessage("Configuracion guardada.");
                  } catch (e: any) {
                    setSettingsMessage(e?.message || "Error al guardar.");
                  }
                }}
              >
                Guardar configuracion
              </button>
              {settingsMessage ? <div className="notice">{settingsMessage}</div> : null}
            </div>
          )}
        </div>
      ) : null}

      {tab === "users" ? (
        <div className="grid">
          <div className="card">
            <h3>Usuarios</h3>
            <div className="row">
              <input className="input" placeholder="Search" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} />
              <button className="btn" onClick={async () => { setUserMessage(""); await loadUsers(); }}>Buscar</button>
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
                <option value="">Seleccionar usuario</option>
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
                  <div className="meta">logins: {u.login_count || 0} last: {u.last_login_at || "-"}</div>
                  <div className="meta">last seen: {u.last_seen_at || "-"} total: {u.total_connected_seconds || 0}s</div>
                  <div className="meta">active: {u.session_active ? "yes" : "no"} start: {u.session_started_at || "-"}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>Editar usuario</h3>
            <input className="input" placeholder="Nombre" value={userForm.display_name} onChange={(e) => setUserForm({ ...userForm, display_name: e.target.value })} />
            <input className="input" placeholder="Email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
            <input className="input" placeholder="Telefono" value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })} />
            <input className="input" placeholder="DOB (YYYY-MM-DD)" value={userForm.dob} onChange={(e) => setUserForm({ ...userForm, dob: e.target.value })} />
            <input className="input" placeholder="Pais" value={userForm.country} onChange={(e) => setUserForm({ ...userForm, country: e.target.value })} />
            <input className="input" placeholder="Provincia" value={userForm.province} onChange={(e) => setUserForm({ ...userForm, province: e.target.value })} />
            <input className="input" placeholder="Ciudad" value={userForm.city} onChange={(e) => setUserForm({ ...userForm, city: e.target.value })} />
            <input className="input" placeholder="Rol" value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })} />
            <input className="input" placeholder="Nueva clave" type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
            <label className="checkbox">
              <input type="checkbox" checked={!!userForm.email_verified} onChange={(e) => setUserForm({ ...userForm, email_verified: e.target.checked })} />
              Email verificado
            </label>
            <button
              className="btn"
              onClick={async () => {
                if (!selectedUserId) return;
                try {
                  await api.resendVerification(selectedUserId);
                  setUserMessage("Email de verificacion reenviado.");
                } catch (e: any) {
                  setUserMessage(e?.message || "Error al reenviar verificacion.");
                }
              }}
            >
              Reenviar verificacion
            </button>
            <label className="checkbox">
              <input type="checkbox" checked={!!userForm.is_banned} onChange={(e) => setUserForm({ ...userForm, is_banned: e.target.checked })} />
              Bloqueado
            </label>
            <input className="input" placeholder="Bloqueado hasta (YYYY-MM-DD)" value={userForm.banned_until} onChange={(e) => setUserForm({ ...userForm, banned_until: e.target.value })} />
            <div className="row">
              <button className="btn primary" onClick={async () => {
                setUserMessage("");
                const payload: any = { ...userForm };
                if (!payload.password) delete payload.password;
                if (!payload.banned_until) payload.banned_until = null;
                if (!selectedUserId) {
                  const missing = [];
                  if (!payload.display_name) missing.push("Nombre");
                  if (!payload.email) missing.push("Email");
                  if (!payload.phone) missing.push("Telefono");
                  if (!payload.password) missing.push("Clave");
                  if (!payload.dob) missing.push("DOB");
                  if (!payload.province) missing.push("Provincia");
                  if (missing.length) {
                    setUserMessage(`Faltan campos: ${missing.join(", ")}`);
                    return;
                  }
                }
                try {
                  if (selectedUserId) {
                    await api.updateUser(selectedUserId, payload);
                    setUserMessage("Usuario actualizado.");
                  } else {
                    await api.createUser(payload);
                    setUserMessage("Usuario creado.");
                  }
                  await loadUsers();
                } catch (e: any) {
                  setUserMessage(e?.message || "Error al guardar usuario.");
                }
              }}>{selectedUserId ? "Guardar" : "Crear"}</button>
              <button className="btn danger" onClick={async () => {
                if (!selectedUserId) return;
                if (!confirm("Eliminar este usuario? Esta accion no se puede deshacer.")) return;
                try {
                  await api.deleteUser(selectedUserId);
                  setSelectedUserId(null);
                  await loadUsers();
                  setUserMessage("Usuario eliminado.");
                } catch (e: any) {
                  setUserMessage(e?.message || "Error al eliminar.");
                }
              }}>Eliminar</button>
            </div>
            {userMessage ? <div className="notice">{userMessage}</div> : null}
          </div>
        </div>
      ) : null}

      {tab === "interests" ? (
        <div className="grid">
          <div className="card">
            <h3>Canales</h3>
            <div className="list">
              {interests.map((i) => (
                <div key={i.id} className={"listItem" + (selectedInterestId === i.id ? " active" : "")}>
                  <div className="title">{i.name}</div>
                  <div className="meta">{i.slug}</div>
                  <div className="row">
                    <button className="btn" onClick={() => { setSelectedInterestId(i.id); setInterestName(i.name); }}>Editar</button>
                    <button className="btn" onClick={async () => { await api.deleteInterest(i.id); await loadInterests(); }}>Eliminar</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h3>Agregar / Editar canal</h3>
            <input className="input" placeholder="Nombre del canal" value={interestName} onChange={(e) => setInterestName(e.target.value)} />
            <div className="muted">Slug: {slugifyName(interestName || "") || "-"}</div>
            <div className="row">
              <button className="btn primary" onClick={async () => {
                setInterestMessage("");
                const slug = slugifyName(interestName);
                if (!slug || !interestName.trim()) {
                  setInterestMessage("Nombre del canal requerido.");
                  return;
                }
                try {
                  if (selectedInterestId) {
                    await api.updateInterest(selectedInterestId, { slug, name: interestName.trim() });
                    setInterestMessage("Canal actualizado.");
                  } else {
                    await api.createInterest({ slug, name: interestName.trim() });
                    setInterestMessage("Canal creado.");
                  }
                  setSelectedInterestId(null);
                  setInterestName("");
                  await loadInterests();
                } catch (e: any) {
                  setInterestMessage(e?.message || "Error al guardar canal.");
                }
              }}>Guardar</button>
            </div>
            {interestMessage ? <div className="notice">{interestMessage}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
