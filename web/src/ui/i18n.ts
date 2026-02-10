export type Lang = "es" | "en";

type Dict = Record<string, string>;

const STRINGS: Record<Lang, Dict> = {
  es: {
    app_name: "MeetGo",
    tagline: "menos swipe, más vida",

    logout: "Salir",
    login_title: "Acceso",
    login_btn: "Login",

    or_register: "O regístrate",
    error_title: "Error",

    email: "Email",
    password: "Password",
    password_hint: "Password (min 6, max 60)",
    name: "Nombre",
    dob_label: "Fecha de nacimiento",
    dob_pick: "Selecciona tu fecha.",
    dob_invalid: "Formato inválido.",
    dob_underage: "Debes ser mayor de edad (18+).",
    phone_label: "Teléfono",
    phone_number: "Número",
    country_label: "País",
    province_label: "Provincia",
    not_available: "(No disponible)",
    avatar_url: "Avatar URL (opcional)",
    bio: "Bio (opcional)",
    accept_dm: "Aceptar privados",
    create_account: "Crear cuenta",

    hello: "Hola, {name}",
    right_click_hint: "Click derecho en un avatar del chat → perfil / seguir / amistad",

    rooms: "Salas",
    feed: "Feed",
    profile: "Perfil",

    load_my_rooms: "Cargar mis salas",
    join_room_title: "Entrar en una sala",
    join_room_desc: "Elige un interés y entra. Si no existe, se crea.",
    join_btn: "Entrar",
    no_rooms_title: "Aún no tienes salas",
    no_rooms_desc: "Usa “Entrar” arriba para crear/entrar en una.",

    tip_title: "Tip",
    tip_body: "Prueba enviar un link o un teléfono: el bot lo borrará. Si floodeas, te mutea.",
    quick_title: "Acción rápida",
    quick_body: "Click derecho sobre un avatar → abre menú.",

    write_placeholder: "Escribe...",
    send_btn: "Enviar",

    publish_placeholder: "Publica algo...",
    publish_btn: "Publicar",
    refresh_btn: "Refrescar",

    profile_updated: "Perfil actualizado ✅",
    following_ok: "Siguiendo ✅",
    friend_req_ok: "Solicitud de amistad enviada ✅",

    chat_not_connected: "Chat no conectado (ws=null). Abre una sala primero.",
    chat_not_connected_state: "Chat no conectado (WS readyState={state}).",
    chat_disconnected: "Chat desconectado. Vuelve a abrir la sala (o haz login de nuevo).",
    no_session: "No hay sesión (token). Haz login de nuevo.",
  },

  en: {
    app_name: "MeetGo",
    tagline: "less swipe, more life",

    logout: "Logout",
    login_title: "Access",
    login_btn: "Login",

    or_register: "Or register",
    error_title: "Error",

    email: "Email",
    password: "Password",
    password_hint: "Password (min 6, max 60)",
    name: "Name",
    dob_label: "Date of birth",
    dob_pick: "Pick your date.",
    dob_invalid: "Invalid format.",
    dob_underage: "You must be 18+.",
    phone_label: "Phone",
    phone_number: "Number",
    country_label: "Country",
    province_label: "Province/State",
    not_available: "(Not available)",
    avatar_url: "Avatar URL (optional)",
    bio: "Bio (optional)",
    accept_dm: "Allow DMs",
    create_account: "Create account",

    hello: "Hi, {name}",
    right_click_hint: "Right click an avatar → profile / follow / friend",

    rooms: "Rooms",
    feed: "Feed",
    profile: "Profile",

    load_my_rooms: "Load my rooms",
    join_room_title: "Join a room",
    join_room_desc: "Pick an interest and join. If it doesn’t exist, it will be created.",
    join_btn: "Join",
    no_rooms_title: "You have no rooms yet",
    no_rooms_desc: "Use “Join” above to create/join one.",

    tip_title: "Tip",
    tip_body: "Try sending a link or a phone: the bot will delete it. Flooding will mute you.",
    quick_title: "Quick action",
    quick_body: "Right click an avatar → menu.",

    write_placeholder: "Type...",
    send_btn: "Send",

    publish_placeholder: "Post something...",
    publish_btn: "Publish",
    refresh_btn: "Refresh",

    profile_updated: "Profile updated ✅",
    following_ok: "Following ✅",
    friend_req_ok: "Friend request sent ✅",

    chat_not_connected: "Chat not connected (ws=null). Open a room first.",
    chat_not_connected_state: "Chat not connected (WS readyState={state}).",
    chat_disconnected: "Chat disconnected. Open the room again (or login again).",
    no_session: "No session (token). Login again.",
  },
};

export function getLang(): Lang {
  const v = (localStorage.getItem("lang") || "es") as Lang;
  return v === "en" ? "en" : "es";
}

export function setLang(l: Lang) {
  localStorage.setItem("lang", l);
}

export function t(key: string, vars?: Record<string, string | number>) {
  const lang = getLang();
  const dict = STRINGS[lang] || STRINGS.es;
  let s = dict[key] || STRINGS.es[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
