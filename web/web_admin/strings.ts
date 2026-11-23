// Strings added to the administration interface after the .po files (lang/es.po, lang/en.po).
// t2() follows the language chosen with getLang(), like t() does for the .po keys.
import { getLang } from "@lang";
import type { Plan } from "./api";

type Dict = Record<string, string>;

const ES: Dict = {
  tab_moderation: "Moderación",
  tab_billing: "Suscripciones",
  tab_codes: "Códigos",

  loading: "Cargando…",
  load_error: "No se pudo cargar",
  save: "Guardar",
  saving: "Guardando…",
  saved: "Guardado",
  save_error: "No se pudo guardar",
  refresh: "Actualizar",
  cancel: "Cancelar",
  copy: "Copiar",
  configured: "Configurado",
  not_configured: "Sin configurar",

  logs_disabled: "Registros desactivados",

  plan_label: "Plan",
  plan_free: "Gratis",
  plan_none: "Sin plan",
  plan_gift_until: "Regalo hasta {date}",
  plan_gift_expired: "Regalo caducado el {date}",
  plan_gift_life: "Regalo de por vida",
  plan_web_monthly: "Web mensual",
  plan_web_yearly: "Web anual",
  plan_web: "Web",
  plan_play: "Google Play",
  status_active: "activa",
  status_trialing: "en prueba",
  status_past_due: "pago pendiente",
  status_canceled: "cancelada",
  status_unpaid: "impagada",
  status_incomplete: "incompleta",
  status_incomplete_expired: "caducada",
  status_paused: "pausada",
  status_in_grace_period: "periodo de gracia",
  status_on_hold: "en espera",
  status_expired: "caducada",
  status_pending: "pendiente",

  access_title: "Acceso gratuito",
  access_none: "Sin acceso gratuito",
  access_until: "Hasta una fecha",
  access_lifetime: "De por vida",
  access_apply: "Aplicar acceso",
  access_saved: "Acceso gratuito actualizado",
  access_date_required: "Elige la fecha de fin del acceso gratuito",
  access_hint: "Da acceso completo sin pagar. Quitarlo también anula el regalo de un código promocional.",
  access_new_user_hint: "Guarda el usuario antes de darle acceso gratuito.",

  mod_title: "Denuncias",
  mod_hint: "Resolver una denuncia cierra también las demás abiertas sobre el mismo mensaje.",
  mod_status_open: "Abiertas",
  mod_status_dismissed: "Descartadas",
  mod_status_actioned: "Con acción",
  mod_empty: "No hay denuncias.",
  mod_reason_spam: "Spam",
  mod_reason_harassment: "Acoso",
  mod_reason_hate: "Odio",
  mod_reason_sexual: "Contenido sexual",
  mod_reason_violence: "Violencia",
  mod_reason_other: "Otro",
  mod_reported_by: "Denunciado por {name} el {date}",
  mod_details: "Detalles: {text}",
  mod_conversation: "conversación #{id}",
  mod_unknown_user: "Usuario eliminado",
  mod_message_missing: "El mensaje ya no existe.",
  mod_message_deleted: "Mensaje eliminado",
  mod_original_body: "Texto original eliminado (solo lo ven los moderadores):",
  mod_no_text: "(sin texto)",
  mod_attachments: "Adjuntos",
  mod_dismiss: "Descartar",
  mod_delete_message: "Eliminar mensaje",
  mod_mark_actioned: "Marcar como resuelta",
  mod_resolved: "Denuncia resuelta",

  bill_title: "Suscripciones",
  bill_general: "General",
  bill_general_hint: "Con las suscripciones activadas, las cuentas nuevas necesitan un plan o un código para escribir; las cuentas anteriores siguen gratis.",
  bill_enabled: "Suscripciones activadas",
  bill_trial_days: "Días de prueba al suscribirse en la web (0–90)",
  bill_counts: "Regalos: {gift} · Web activas: {web} · Google Play: {play}",
  bill_stripe: "Stripe (web)",
  bill_stripe_hint: "Cobra 2,50 €/mes o 25 €/año con tarjeta en la web. Al guardar la clave secreta se buscan o crean los precios.",
  bill_stripe_secret: "Clave secreta",
  bill_stripe_webhook: "Secreto de firma del webhook",
  bill_secret_placeholder: "Vacío = mantener el actual",
  bill_webhook_url: "URL del webhook (añádela en Stripe)",
  bill_prices: "Precios detectados",
  bill_prices_none: "Ninguno (guarda la clave secreta)",
  bill_price_monthly: "Mensual",
  bill_price_yearly: "Anual",
  bill_play: "Google Play",
  bill_play_hint: "Suscripciones compradas en la app de Android. La cuenta de servicio permite verificar las compras con Google.",
  bill_play_package: "Paquete de la app",
  bill_play_product: "Producto de suscripción",
  bill_play_store_url: "URL de la ficha en Google Play",
  bill_service_account: "Cuenta de servicio (JSON)",
  bill_sa_placeholder: "Pega aquí el JSON para reemplazarla",
  bill_fcm: "Firebase (notificaciones push)",
  bill_fcm_hint: "Envía las notificaciones push a la app de Android con Firebase Cloud Messaging.",
  bill_fcm_project: "Proyecto: {id}",
  bill_invalid_json: "El JSON de la cuenta de servicio no es válido.",
  bill_nothing_to_save: "No hay cambios que guardar.",

  codes_title: "Códigos promocionales",
  codes_hint: "Se canjean al registrarse o desde el perfil; no importan mayúsculas, espacios ni acentos.",
  codes_empty: "No hay códigos.",
  codes_used: "{used} / {max} usados · quedan {left}",
  codes_used_unlimited: "{used} usados · sin límite",
  codes_aliases: "Alias: {list}",
  codes_public: "Público",
  codes_private: "Privado",
  codes_expires: "Se puede canjear hasta el {date}",
  codes_expired: "Caducado el {date}",
  codes_no_expiry: "Sin fecha límite",
  codes_duration: "Acceso gratuito: {duration}",
  duration_1m: "1 mes",
  duration_3m: "3 meses",
  duration_6m: "6 meses",
  duration_1y: "1 año",
  duration_life: "De por vida",
  duration_date: "Hasta una fecha",
  duration_until: "Hasta el {date}",
  codes_edit: "Editar",
  codes_delete: "Eliminar",
  codes_delete_confirm: "¿Eliminar el código {code}?",
  codes_delete_yes: "Sí, eliminar",
  codes_deleted: "Código eliminado",
  codes_form_new: "Nuevo código",
  codes_form_edit: "Editar {code}",
  codes_new: "Nuevo",
  codes_code: "Código",
  codes_aliases_input: "Alias separados por comas",
  codes_duration_label: "Duración del acceso gratuito",
  codes_max: "Plazas (vacío = sin límite)",
  codes_public_label: "Público: se anuncia en la página de inicio con las plazas que quedan",
  codes_expires_label: "Último día para canjearlo (vacío = sin límite)",
  codes_save: "Guardar código",
  codes_saved: "Código guardado",
  codes_code_required: "El código necesita al menos 2 caracteres.",
  codes_max_invalid: "Las plazas deben ser un número mayor que 0.",
  codes_date_required: "Elige la fecha de fin del acceso gratuito.",
  codes_too_many_aliases: "Como máximo 10 alias.",
};

const EN: Dict = {
  tab_moderation: "Moderation",
  tab_billing: "Subscriptions",
  tab_codes: "Codes",

  loading: "Loading…",
  load_error: "Could not load",
  save: "Save",
  saving: "Saving…",
  saved: "Saved",
  save_error: "Could not save",
  refresh: "Refresh",
  cancel: "Cancel",
  copy: "Copy",
  configured: "Configured",
  not_configured: "Not configured",

  logs_disabled: "Logs disabled",

  plan_label: "Plan",
  plan_free: "Free",
  plan_none: "No plan",
  plan_gift_until: "Gift until {date}",
  plan_gift_expired: "Gift expired on {date}",
  plan_gift_life: "Lifetime gift",
  plan_web_monthly: "Web monthly",
  plan_web_yearly: "Web yearly",
  plan_web: "Web",
  plan_play: "Google Play",
  status_active: "active",
  status_trialing: "trial",
  status_past_due: "payment due",
  status_canceled: "canceled",
  status_unpaid: "unpaid",
  status_incomplete: "incomplete",
  status_incomplete_expired: "expired",
  status_paused: "paused",
  status_in_grace_period: "grace period",
  status_on_hold: "on hold",
  status_expired: "expired",
  status_pending: "pending",

  access_title: "Free access",
  access_none: "No free access",
  access_until: "Until a date",
  access_lifetime: "Lifetime",
  access_apply: "Apply access",
  access_saved: "Free access updated",
  access_date_required: "Choose the last day of free access",
  access_hint: "Gives full access without paying. Removing it also cancels a gift from a promo code.",
  access_new_user_hint: "Save the user before giving free access.",

  mod_title: "Reports",
  mod_hint: "Resolving a report also closes the other open reports on the same message.",
  mod_status_open: "Open",
  mod_status_dismissed: "Dismissed",
  mod_status_actioned: "Actioned",
  mod_empty: "No reports.",
  mod_reason_spam: "Spam",
  mod_reason_harassment: "Harassment",
  mod_reason_hate: "Hate",
  mod_reason_sexual: "Sexual content",
  mod_reason_violence: "Violence",
  mod_reason_other: "Other",
  mod_reported_by: "Reported by {name} on {date}",
  mod_details: "Details: {text}",
  mod_conversation: "conversation #{id}",
  mod_unknown_user: "Deleted user",
  mod_message_missing: "The message no longer exists.",
  mod_message_deleted: "Message removed",
  mod_original_body: "Original removed text (only moderators see it):",
  mod_no_text: "(no text)",
  mod_attachments: "Attachments",
  mod_dismiss: "Dismiss",
  mod_delete_message: "Delete message",
  mod_mark_actioned: "Mark as actioned",
  mod_resolved: "Report resolved",

  bill_title: "Subscriptions",
  bill_general: "General",
  bill_general_hint: "With subscriptions on, new accounts need a plan or a code to write; older accounts stay free.",
  bill_enabled: "Subscriptions enabled",
  bill_trial_days: "Trial days when subscribing on the web (0–90)",
  bill_counts: "Gifts: {gift} · Active web: {web} · Google Play: {play}",
  bill_stripe: "Stripe (web)",
  bill_stripe_hint: "Charges €2.50/month or €25/year by card on the web. Saving the secret key finds or creates the prices.",
  bill_stripe_secret: "Secret key",
  bill_stripe_webhook: "Webhook signing secret",
  bill_secret_placeholder: "Empty = keep the current one",
  bill_webhook_url: "Webhook URL (add it in Stripe)",
  bill_prices: "Detected prices",
  bill_prices_none: "None (save the secret key)",
  bill_price_monthly: "Monthly",
  bill_price_yearly: "Yearly",
  bill_play: "Google Play",
  bill_play_hint: "Subscriptions bought in the Android app. The service account lets the server verify purchases with Google.",
  bill_play_package: "App package",
  bill_play_product: "Subscription product",
  bill_play_store_url: "Google Play listing URL",
  bill_service_account: "Service account (JSON)",
  bill_sa_placeholder: "Paste the JSON here to replace it",
  bill_fcm: "Firebase (push notifications)",
  bill_fcm_hint: "Sends push notifications to the Android app through Firebase Cloud Messaging.",
  bill_fcm_project: "Project: {id}",
  bill_invalid_json: "The service account JSON is not valid.",
  bill_nothing_to_save: "Nothing to save.",

  codes_title: "Promo codes",
  codes_hint: "Redeemed at sign-up or from the profile; case, spaces and accents do not matter.",
  codes_empty: "No codes.",
  codes_used: "{used} / {max} used · {left} left",
  codes_used_unlimited: "{used} used · unlimited",
  codes_aliases: "Aliases: {list}",
  codes_public: "Public",
  codes_private: "Private",
  codes_expires: "Redeemable until {date}",
  codes_expired: "Expired on {date}",
  codes_no_expiry: "No end date",
  codes_duration: "Free access: {duration}",
  duration_1m: "1 month",
  duration_3m: "3 months",
  duration_6m: "6 months",
  duration_1y: "1 year",
  duration_life: "Lifetime",
  duration_date: "Until a date",
  duration_until: "Until {date}",
  codes_edit: "Edit",
  codes_delete: "Delete",
  codes_delete_confirm: "Delete code {code}?",
  codes_delete_yes: "Yes, delete",
  codes_deleted: "Code deleted",
  codes_form_new: "New code",
  codes_form_edit: "Edit {code}",
  codes_new: "New",
  codes_code: "Code",
  codes_aliases_input: "Aliases, comma separated",
  codes_duration_label: "Free access duration",
  codes_max: "Places (empty = unlimited)",
  codes_public_label: "Public: shown on the landing page with the places left",
  codes_expires_label: "Last day to redeem it (empty = no limit)",
  codes_save: "Save code",
  codes_saved: "Code saved",
  codes_code_required: "The code needs at least 2 characters.",
  codes_max_invalid: "Places must be a number above 0.",
  codes_date_required: "Choose the last day of free access.",
  codes_too_many_aliases: "At most 10 aliases.",
};

export function t2(key: string, vars?: Record<string, string | number>) {
  const dict = getLang() === "en" ? EN : ES;
  let s = dict[key] ?? ES[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

const TZ = "Europe/Madrid"; // free periods end at the end of a day in Madrid time
const locale = () => (getLang() === "en" ? "en-GB" : "es-ES");

/** A day for people: "2027-01-31" as is, or an ISO date-time in Madrid time. */
export function fmtDay(value?: string | null) {
  if (!value) return "-";
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = plain ? new Date(Date.UTC(+plain[1], +plain[2] - 1, +plain[3], 12)) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(locale(), { timeZone: plain ? "UTC" : TZ });
}

export function fmtDateTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });
}

/** YYYY-MM-DD in Madrid time, for date inputs and comparisons with plain dates. */
export function madridYmd(value?: string | Date | null) {
  const d = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function statusLabel(status?: string | null) {
  if (!status) return "";
  const key = "status_" + status.replace(/^SUBSCRIPTION_STATE_/, "").toLowerCase();
  const s = t2(key);
  return s === key ? status : s;
}

/** Plan column of the users list. */
export function planLabel(plan?: Plan | null): { text: string; tone: "" | "ok" | "warn" } {
  if (!plan || plan.kind === "free") return { text: t2("plan_free"), tone: "" };
  if (plan.kind === "none") return { text: t2("plan_none"), tone: "warn" };
  if (plan.kind === "gift") {
    const source = plan.source && plan.source !== "admin" ? ` (${plan.source})` : "";
    if (!plan.until) return { text: t2("plan_gift_life") + source, tone: "ok" };
    const expired = new Date(plan.until).getTime() < Date.now();
    return {
      text: t2(expired ? "plan_gift_expired" : "plan_gift_until", { date: fmtDay(plan.until) }) + source,
      tone: expired ? "warn" : "ok",
    };
  }
  const status = statusLabel(plan.status);
  const suffix = status ? ` (${status})` : "";
  if (plan.kind === "web") {
    const name = plan.plan === "monthly" ? t2("plan_web_monthly") : plan.plan === "yearly" ? t2("plan_web_yearly") : t2("plan_web");
    return { text: name + suffix, tone: ["active", "trialing"].includes(plan.status || "") ? "ok" : "warn" };
  }
  return {
    text: t2("plan_play") + suffix,
    tone: ["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"].includes(plan.status || "") ? "ok" : "warn",
  };
}
