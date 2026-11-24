/** Small building blocks of the administration: figures, badges, switches and folding sections. */
import React from "react";
import { Icon } from "../common";

export type Tone = "blue" | "green" | "teal" | "violet" | "orange" | "red" | "pink" | "gray";

export function Stat({ icon, tone, label, value, sub, onClick, alert }: {
  icon: string; tone: Tone; label: string; value: React.ReactNode; sub?: React.ReactNode; onClick?: () => void; alert?: boolean;
}) {
  const body = (
    <>
      <span className={"adm-stat-ic t-" + tone}><Icon name={icon} /></span>
      <span className="adm-stat-txt">
        <span className="adm-stat-val">{value}</span>
        <span className="adm-stat-lbl">{label}</span>
        {sub ? <span className="adm-stat-sub">{sub}</span> : null}
      </span>
    </>
  );
  const cls = "adm-stat" + (alert ? " alert" : "") + (onClick ? " link" : "");
  return onClick ? <button type="button" className={cls} onClick={onClick}>{body}</button> : <div className={cls}>{body}</div>;
}

export function Badge({ tone = "gray", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return <span className={"adm-badge t-" + tone} title={title}>{children}</span>;
}

export function Switch({ id, label, hint, on, onChange, disabled }: {
  id: string; label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className={"tgl" + (disabled ? " off" : "")} htmlFor={id}>
      <span className="grow">{label}{hint ? <small>{hint}</small> : null}</span>
      <input id={id} type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="sw" aria-hidden="true" />
    </label>
  );
}

/** Choice between a few options, as one row of buttons. */
export function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="adm-choice" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

/** A card with a title that can fold away (settings, subscriptions). */
export function Fold({ icon, title, summary, open, children, id }: {
  icon: string; title: string; summary?: React.ReactNode; open?: boolean; children: React.ReactNode; id?: string;
}) {
  return (
    <details className="adm-fold" open={open} id={id}>
      <summary>
        <span className="adm-fold-ic"><Icon name={icon} size="sm" /></span>
        <span className="grow"><b>{title}</b>{summary ? <small>{summary}</small> : null}</span>
        <span className="adm-fold-chev" aria-hidden="true">›</span>
      </summary>
      <div className="adm-fold-body">{children}</div>
    </details>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="adm-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="adm-empty">
      <span className="adm-empty-ic"><Icon name={icon} /></span>
      <span>{text}</span>
    </div>
  );
}

/** A short how-to: numbered steps, with an optional link to where they happen. */
export function Steps({ title, steps, link }: { title: string; steps: React.ReactNode[]; link?: { href: string; text: string } }) {
  return (
    <div className="adm-steps">
      <b>{title}</b>
      <ol>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      {link ? <a className="btn sm" href={link.href} target="_blank" rel="noreferrer"><Icon name="link" size="sm" />{link.text}</a> : null}
    </div>
  );
}
