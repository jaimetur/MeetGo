import React, { useEffect, useMemo, useState } from "react";
import { LANGUAGES, getLang, setLang, t } from "@lang";
import { api, setToken } from "../api";
import { isNativeApp } from "../native";
import { queryParam } from "../router";
import { countryOptions } from "./common";

type View = "login" | "register" | "forgot" | "reset" | "sent";

export function AuthScreen({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const resetToken = queryParam("reset_token");
  const [view, setView] = useState<View>(resetToken ? "reset" : queryParam("view") === "register" ? "register" : "login");
  const [lang, setLangState] = useState(getLang());
  const switchLang = (next: string) => {
    setLang(next);
    setLangState(next);
  };

  const logo = <><span className="m">Meet</span><span className="g">Go</span></>;
  return (
    <div className="auth">
      <div className="authcol" key={lang}>
        {/* The logo and the "Home page" button go to the public website (not in the Android app, which has no website). */}
        <div className="authtop">
          {isNativeApp
            ? <div className="logo grow" aria-label="MeetGo">{logo}</div>
            : <a className="logo grow" href="/" aria-label={t("ui_home_page")}>{logo}</a>}
          {isNativeApp ? null : <a className="btn sm home" href="/"><span aria-hidden="true">🏠</span><span className="lbl">{t("ui_home_page")}</span></a>}
          <select className="langpick" value={lang} onChange={(e) => switchLang(e.target.value)} aria-label={t("ui_language")}>
            {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </div>
        <div className="box">
          {view === "login" ? <Login onSignedIn={onSignedIn} setView={setView} /> : null}
          {view === "register" ? <Register setView={setView} /> : null}
          {view === "forgot" ? <Forgot setView={setView} /> : null}
          {view === "reset" ? <Reset token={resetToken || ""} setView={setView} /> : null}
          {view === "sent" ? (
            <div className="stack">
              <h1>{t("ui_check_email_title")}</h1>
              <p className="muted">{t("ui_check_email_body")}</p>
              <button className="btn pri" onClick={() => setView("login")}>{t("ui_go_login")}</button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Login({ onSignedIn, setView }: { onSignedIn: () => Promise<void>; setView: (v: View) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [unverified, setUnverified] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setUnverified(false);
    setNotice("");
    try {
      const res = await api.login(email.trim(), password);
      setToken(res.access_token);
      await onSignedIn();
    } catch (err: any) {
      setError(err.message);
      setUnverified(err.status === 403 && err.message === t("err_email_not_verified"));
      setToken("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <h1>{t("ui_login_title")}</h1>
      <label className="fld">{t("ui_email")}<input id="login-email" className="inp" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="fld">{t("ui_password")}<input id="login-password" className="inp" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error ? <div className="err" role="alert">{error}</div> : null}
      {unverified ? (
        <button type="button" className="linkbtn" style={{ textAlign: "left" }}
          onClick={() => api.resendVerification(email.trim()).then(() => { setUnverified(false); setError(""); setNotice(t("ui_verification_resent")); }).catch((e) => setError(e.message))}>
          {t("ui_resend_verification")}
        </button>
      ) : null}
      {notice ? <div className="ok" role="status">{notice}</div> : null}
      <button className="btn pri block" disabled={busy}>{busy ? t("ui_wait") : t("ui_login_btn")}</button>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button type="button" className="linkbtn" onClick={() => setView("forgot")}>{t("ui_forgot")}</button>
        <button type="button" className="linkbtn" onClick={() => setView("register")}>{t("ui_create_account")}</button>
      </div>
    </form>
  );
}

function Register({ setView }: { setView: (v: View) => void }) {
  const [settings, setSettings] = useState<any>(null);
  const [form, setForm] = useState({
    display_name: "", email: "", password: "", dob: "", country: "ES", province: "", cc: "+34", phone: "",
    accept_dm: true, promo_code: queryParam("code") || "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.publicSettings().then(setSettings).catch(() => setSettings({}));
  }, []);
  const provinces = useMemo(() => (settings?.provinces_by_country?.[form.country] || []) as { value: string; name: string }[], [settings, form.country]);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.register({
        display_name: form.display_name.trim(), email: form.email.trim(), password: form.password, dob: form.dob,
        country: form.country, province: form.province, phone: `${form.cc}${form.phone.replace(/\D/g, "")}`,
        accept_dm: form.accept_dm, promo_code: form.promo_code.trim() || undefined,
      });
      setView("sent");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h1>{t("ui_register_title")}</h1>
      <p className="muted" style={{ margin: 0 }}>{t("ui_register_lead")}</p>
      <label className="fld">{t("ui_display_name")}<input id="reg-name" className="inp" required maxLength={64} value={form.display_name} onChange={(e) => set("display_name", e.target.value)} /></label>
      <label className="fld">{t("ui_email")}<input id="reg-email" className="inp" type="email" autoComplete="email" required value={form.email} onChange={(e) => set("email", e.target.value)} /></label>
      <label className="fld">{t("ui_password_new")}<input id="reg-password" className="inp" type="password" autoComplete="new-password" minLength={6} required value={form.password} onChange={(e) => set("password", e.target.value)} /></label>
      <div className="grid2">
        <label className="fld">{t("ui_dob")}<input id="reg-dob" className="inp" type="date" required value={form.dob} onChange={(e) => set("dob", e.target.value)} /></label>
        <label className="fld">{t("ui_country")}
          <select id="reg-country" className="inp" value={form.country} onChange={(e) => { set("country", e.target.value); set("province", ""); }}>
            {countryOptions(settings?.countries).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <label className="fld">{t("ui_province")}
        {provinces.length ? (
          <select id="reg-province" className="inp" required value={form.province} onChange={(e) => set("province", e.target.value)}>
            <option value="">{t("ui_choose")}</option>
            {provinces.map((p) => <option key={p.value} value={p.value}>{p.name}</option>)}
          </select>
        ) : (
          <input id="reg-province" className="inp" required value={form.province} onChange={(e) => set("province", e.target.value)} />
        )}
      </label>
      <label className="fld">{t("ui_phone")}
        <div className="row">
          <select id="reg-cc" className="inp" style={{ width: 110 }} value={form.cc} onChange={(e) => set("cc", e.target.value)}>
            {(settings?.calling_codes || [{ cc: "+34", name: "España" }]).map((c: any) => <option key={c.cc + c.name} value={c.cc}>{c.cc} {c.name}</option>)}
          </select>
          <input id="reg-phone" className="inp" inputMode="tel" required value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
      </label>
      <label className="check"><input id="reg-dm" type="checkbox" checked={form.accept_dm} onChange={(e) => set("accept_dm", e.target.checked)} />{t("ui_accept_dm")}</label>
      {settings?.subscriptions ? <label className="fld">{t("ui_promo_code")}<input id="reg-code" className="inp" value={form.promo_code} onChange={(e) => set("promo_code", e.target.value)} placeholder="LANZAMIENTO" /></label> : null}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>{t("ui_register_legal")}</p>
      {error ? <div className="err" role="alert">{error}</div> : null}
      <button className="btn pri block" disabled={busy}>{busy ? t("ui_wait") : t("ui_create_account")}</button>
      <button type="button" className="linkbtn" onClick={() => setView("login")}>{t("ui_have_account")}</button>
    </form>
  );
}

function Forgot({ setView }: { setView: (v: View) => void }) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await api.forgotPassword(email.trim()).catch(() => undefined);
    setDone(true);
  }
  return (
    <form className="stack" onSubmit={submit}>
      <h1>{t("ui_forgot_title")}</h1>
      {done ? <p className="ok">{t("ui_forgot_sent")}</p> : (
        <>
          <label className="fld">{t("ui_email")}<input id="forgot-email" className="inp" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button className="btn pri block">{t("ui_send_link")}</button>
        </>
      )}
      <button type="button" className="linkbtn" onClick={() => setView("login")}>{t("ui_go_login")}</button>
    </form>
  );
}

function Reset({ token, setView }: { token: string; setView: (v: View) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <h1>{t("ui_reset_title")}</h1>
      {done ? <p className="ok">{t("ui_reset_done")}</p> : (
        <>
          <label className="fld">{t("ui_password_new")}<input id="reset-password" className="inp" type="password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error ? <div className="err">{error}</div> : null}
          <button className="btn pri block">{t("ui_save")}</button>
        </>
      )}
      <button type="button" className="linkbtn" onClick={() => setView("login")}>{t("ui_go_login")}</button>
    </form>
  );
}
