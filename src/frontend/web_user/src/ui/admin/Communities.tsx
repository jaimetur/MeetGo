/** The interest communities (one per zone and age range): grouped by category, each with its look and restrictions. */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@lang";
import { api, type AdminInterest } from "../../../../web_admin/api";
import { toast } from "../../store";
import { CATEGORY_KEYS, guessCategory } from "../Communities";
import { Icon, Modal, guessIcon, hobbyIcon, setInterestLooks } from "../common";
import { colorFor } from "../../util";
import { SectionHead } from "./AdminPage";
import { a } from "./i18n";
import { Badge, Empty, Field, Switch } from "./kit";

const ICONS = ["users", "chat", "coffee", "beer", "cocktail", "food", "party", "dance", "network", "ball", "basket", "racket",
  "dumbbell", "bike", "trophy", "waves", "mountain", "trees", "umbrella", "plane", "camera", "film", "ticket", "music",
  "guitar", "drum", "keys", "book", "palette", "gamepad", "paw", "car", "moto", "star", "compass", "calendar"];
const COLORS = ["#1e90ff", "#0ea5e9", "#14b8a6", "#22c55e", "#84cc16", "#eab308", "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#6366f1"];
const AGES: [string, string][] = [["18_30", "18-30"], ["31_60", "31-60"], ["61_plus", "61+"]];

function slugify(name: string) {
  return name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const autoCategory = (i: { slug: string; name: string }) => guessCategory(i.slug, i.name);
const autoIcon = (i: { slug: string; name: string }) => guessIcon(i.slug, i.name);

export function Communities() {
  const [list, setList] = useState<AdminInterest[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<AdminInterest | "new" | null>(null);

  const load = () => api.adminInterests().then((l) => { setList(l); setInterestLooks(l); }).catch((e) => { setList([]); toast(e.message, "error"); });
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = new Map<string, AdminInterest[]>();
    for (const i of (list || []).filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.slug.includes(needle))) {
      const cat = i.category || autoCategory(i);
      out.set(cat, [...(out.get(cat) || []), i]);
    }
    for (const v of out.values()) v.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
    return CATEGORY_KEYS.filter((k) => out.has(k)).map((k) => [k, out.get(k)!] as const);
  }, [list, q]);

  return (
    <div className="adm-sec">
      <SectionHead title={a("sec_communities")} sub={list ? a("co_count", { n: list.length }) : undefined}>
        <button id="adm-co-new" className="btn pri sm" onClick={() => setOpen("new")}><Icon name="plus" size="sm" />{a("co_new")}</button>
      </SectionHead>
      <div className="adm-toolbar">
        <div className="adm-search">
          <Icon name="search" size="sm" />
          <input className="inp" type="search" placeholder={a("co_search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {list === null ? <div className="adm-loading">{a("loading")}</div> : groups.length === 0 ? <Empty icon="search" text={a("us_empty")} /> : groups.map(([cat, items]) => (
        <section key={cat} className="adm-group">
          <h3>{t(cat)} <span className="muted">{items.length}</span></h3>
          <div className="adm-tiles">
            {items.map((i) => {
              const color = i.color || colorFor(i.slug);
              return (
                <button key={i.id} className={"adm-tile" + (i.active ? "" : " dim")} onClick={() => setOpen(i)}>
                  <span className="adm-tile-ic" style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}><Icon name={hobbyIcon(i.slug, i.name)} /></span>
                  <span className="grow adm-tile-txt">
                    <b>{i.name}</b>
                    <small>{a("co_stats", { zones: i.zones, people: i.people })}</small>
                    {!i.active || i.age_ranges.length ? (
                      <span className="adm-tile-badges">
                        {!i.active ? <Badge tone="gray">{a("co_off")}</Badge> : null}
                        {i.age_ranges.length ? <Badge tone="orange">{i.age_ranges.map((k) => AGES.find(([x]) => x === k)?.[1] || k).join(" · ")}</Badge> : null}
                      </span>
                    ) : null}
                  </span>
                  <span className="adm-chev" aria-hidden="true">›</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {open ? <InterestEditor interest={open === "new" ? null : open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} /> : null}
    </div>
  );
}

function InterestEditor({ interest, onClose, onSaved }: { interest: AdminInterest | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(interest?.name || "");
  const [category, setCategory] = useState(interest?.category || "");
  const [icon, setIcon] = useState(interest?.icon || "");
  const [color, setColor] = useState(interest?.color || "");
  const [ages, setAges] = useState<string[]>(interest?.age_ranges || []);
  const [active, setActive] = useState(interest?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const slug = interest?.slug || slugify(name);
  const guess = useMemo(() => ({ icon: autoIcon({ slug, name }), category: autoCategory({ slug, name }) }), [slug, name]);
  const shownIcon = icon || guess.icon;
  const shownColor = color || colorFor(slug || "x");

  async function save() {
    if (!name.trim() || !slug) return;
    setBusy(true);
    const payload = { slug, name: name.trim(), category, icon, color, age_ranges: ages, active };
    try {
      if (interest) await api.updateInterest(interest.id, payload); else await api.createInterest(payload);
      toast(interest ? a("co_saved") : a("co_created"));
      onSaved();
    } catch (e: any) {
      toast(e?.message || a("save_error"), "error");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <Modal title={interest ? interest.name : a("co_new")} onClose={onClose} footer={<>
      {interest ? (confirm
        ? <button className="btn dangerfill" disabled={busy} onClick={() => api.deleteInterest(interest.id).then(() => { toast(a("co_deleted")); onSaved(); }).catch((e) => toast(e.message, "error"))}>{a("co_delete_yes")}</button>
        : <button className="btn danger" onClick={() => setConfirm(true)}><Icon name="trash" size="sm" /></button>) : null}
      <span className="grow" />
      <button className="btn" onClick={onClose}>{a("cancel")}</button>
      <button id="adm-co-save" className="btn pri" disabled={busy || !name.trim() || !slug} onClick={save}>{a("save")}</button>
    </>}>
      <div className="adm-preview" style={{ background: `linear-gradient(135deg, ${shownColor}, color-mix(in srgb, ${shownColor} 55%, #0b1220))` }}>
        <span><Icon name={shownIcon} /></span>
        <div><b>{name || a("co_new_ph")}</b><small>{t(category || guess.category)}{interest ? ` · ${a("co_stats", { zones: interest.zones, people: interest.people })}` : ""}</small></div>
      </div>
      {confirm ? <p className="adm-red adm-note">{a("co_delete_hint")}</p> : null}

      <Field label={a("co_name")}><input id="adm-co-name" className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder={a("co_new_ph")} /></Field>
      <Field label={a("co_category")}>
        <select className="inp" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{a("co_auto", { value: t(guess.category) })}</option>
          {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{t(k)}</option>)}
        </select>
      </Field>

      <div className="adm-field"><span>{a("co_icon")}</span>
        <div className="adm-icons">
          <button type="button" className={"auto" + (!icon ? " on" : "")} title={a("co_auto_short")} onClick={() => setIcon("")}><Icon name={guess.icon} /><small>{a("co_auto_short")}</small></button>
          {ICONS.map((k) => <button type="button" key={k} className={icon === k ? "on" : ""} aria-label={k} onClick={() => setIcon(k)}><Icon name={k} /></button>)}
        </div>
      </div>

      <div className="adm-field"><span>{a("co_color")}</span>
        <div className="adm-colors">
          <button type="button" className={"auto" + (!color ? " on" : "")} onClick={() => setColor("")}>{a("co_auto_short")}</button>
          {COLORS.map((c) => <button type="button" key={c} className={color === c ? "on" : ""} style={{ background: c }} aria-label={c} onClick={() => setColor(c)} />)}
          <label className="adm-color-own" title={a("co_color_own")}><input type="color" value={color || shownColor} onChange={(e) => setColor(e.target.value)} /><Icon name="palette" size="sm" /></label>
        </div>
      </div>

      <div className="adm-sub">
        <div className="adm-sub-head"><b>{a("co_rules")}</b></div>
        <Switch id="adm-co-active" label={a("co_active")} hint={a("co_active_hint")} on={active} onChange={setActive} />
        <div className="adm-field"><span>{a("co_ages")}</span>
          <div className="adm-choice">
            {AGES.map(([k, label]) => {
              const on = !ages.length || ages.includes(k);
              return <button key={k} type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => {
                const current = ages.length ? ages : AGES.map(([x]) => x);
                const next = current.includes(k) ? current.filter((x) => x !== k) : [...current, k];
                setAges(next.length === AGES.length || next.length === 0 ? [] : next);
              }}>{label}</button>;
            })}
          </div>
          <small>{ages.length ? a("co_ages_some") : a("co_ages_all")}</small>
        </div>
      </div>
    </Modal>,
    document.body,
  );
}
