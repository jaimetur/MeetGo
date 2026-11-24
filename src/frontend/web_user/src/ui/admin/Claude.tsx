/** Claude's API key (the moderation bot and the translation of new languages): state, how to get one, save and test. */
import React, { useEffect, useState } from "react";
import { api, type AiStatus } from "../../../../web_admin/api";
import { toast } from "../../store";
import { Icon } from "../common";
import { a } from "./i18n";
import { Field, Steps } from "./kit";

const MODEL_NAMES: Record<string, string> = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-haiku-5-5": "Claude Haiku 5.5",
};

export function ClaudeSettings({ onChange }: { onChange?: (s: AiStatus) => void }) {
  const [s, setS] = useState<AiStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; error?: string } | null>(null);
  const got = (r: AiStatus) => { setS(r); onChange?.(r); };
  useEffect(() => { api.ai().then(got).catch((e) => toast(e.message, "error")); }, []);

  async function run(fn: () => Promise<AiStatus>, done: string) {
    setBusy(true);
    setTest(null);
    try {
      got(await fn());
      toast(done);
    } catch (e: any) {
      toast(e?.message || a("save_error"), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <div className="adm-loading">{a("loading")}</div>;
  return (
    <>
      <div className={"adm-state" + (s.configured ? " ok" : "")}>
        <span className="adm-state-ic"><Icon name="star" /></span>
        <span className="grow">
          <b>{s.configured ? a("ai_on") : a("ai_off")}</b>
          <small>{s.configured ? `${s.hint} · ${s.source === "env" ? a("ai_from_env") : a("ai_from_panel")}` : a("ai_off_hint")}</small>
        </span>
        <span className="adm-state-dot" aria-hidden="true">{s.configured ? "✓" : "!"}</span>
      </div>
      <p className="muted adm-note">{a("ai_what")}</p>

      <Steps title={a("ai_how")} steps={[a("ai_step1"), a("ai_step2"), a("ai_step3"), a("ai_step4")]}
        link={{ href: "https://console.anthropic.com/settings/keys", text: "console.anthropic.com" }} />

      <Field label={a("ai_key")} hint={s.configured ? a("ai_key_replace") : undefined}>
        <div className="row" style={{ gap: 8 }}>
          <input id="adm-ai-key" className="inp mono" type="password" autoComplete="off" placeholder="sk-ant-api03-…" value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="btn pri sm" disabled={busy || !key.trim()} onClick={() => run(() => api.saveAi({ api_key: key.trim() }), a("ai_saved")).then(() => setKey(""))}>{a("save")}</button>
        </div>
      </Field>
      <Field label={a("ai_model")} hint={a("ai_model_hint")}>
        <select className="inp" value={s.model} onChange={(e) => run(() => api.saveAi({ model: e.target.value }), a("ai_saved"))}>
          {s.models.map((m) => <option key={m} value={m}>{MODEL_NAMES[m] || m}</option>)}
        </select>
      </Field>
      <div className="adm-actions">
        <button className="btn sm" disabled={busy || !s.configured} onClick={async () => {
          setBusy(true);
          setTest(null);
          try { setTest(await api.testAi()); } catch (e: any) { setTest({ ok: false, error: e?.message }); } finally { setBusy(false); }
        }}><Icon name="check2" size="sm" />{a("ai_test")}</button>
        {s.source === "panel" ? <button className="btn sm danger" disabled={busy} onClick={() => run(() => api.saveAi({ clear: true }), a("ai_removed"))}><Icon name="trash" size="sm" />{a("ai_remove")}</button> : null}
      </div>
      {test ? <div className={"adm-result" + (test.ok ? " ok" : "")}>{test.ok ? a("ai_test_ok") : a("ai_test_fail", { error: test.error || "" })}</div> : null}
    </>
  );
}
