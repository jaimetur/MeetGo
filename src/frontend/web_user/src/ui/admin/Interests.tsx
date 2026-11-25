/** The interests people can choose, in their profile and when they create a community: add, rename, hide or delete. */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { LANGUAGES, t } from "@lang";
import { api, type AdminInterest } from "../../../../web_admin/api";
import { toast } from "../../store";
import { CATEGORY_KEYS, guessCategory } from "../Communities";
import { Icon, Modal, hobbyIcon, setInterestLooks } from "../common";
import { colorFor } from "../../util";
import { SectionHead, goSection } from "./AdminPage";
import { a } from "./i18n";
import { Badge, Empty, Field, Switch } from "./kit";

function slugify(name: string) {
  return name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const OTHER_LANGS = LANGUAGES.filter(([l]) => l !== "es");
const translated = (i: AdminInterest) => OTHER_LANGS.filter(([l]) => (i.names || {})[l]).length;

export function Interests() {
  const [list, setList] = useState<AdminInterest[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<AdminInterest | "new" | null>(null);

  const load = () => api.adminInterests().then((l) => { setList(l); setInterestLooks(l); }).catch((e) => { setList([]); toast(e.message, "error"); });
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list || [])
      .filter((i) => !needle || i.name.toLowerCase().includes(needle) || (i.base_name || "").toLowerCase().includes(needle) || i.slug.includes(needle))
      .sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
  }, [list, q]);

  return (
    <div className="adm-sec">
      <SectionHead title={a("sec_interests")} sub={list ? a("in_count", { n: list.length }) : undefined}>
        <button id="adm-in-new" className="btn pri sm" onClick={() => setOpen("new")}><Icon name="plus" size="sm" />{a("in_new")}</button>
      </SectionHead>
      <p className="muted adm-note">{a("in_lead")}</p>
      <div className="adm-toolbar">
        <div className="adm-search">
          <Icon name="search" size="sm" />
          <input className="inp" type="search" placeholder={a("in_search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {list === null ? <div className="adm-loading">{a("loading")}</div> : !shown.length ? <Empty icon="search" text={a("us_empty")} /> : (
        <div className="adm-tiles">
          {shown.map((i) => {
            const color = i.color || colorFor(i.slug);
            return (
              <button key={i.id} id={`adm-in-${i.slug}`} className={"adm-tile" + (i.active ? "" : " dim")} onClick={() => setOpen(i)}>
                <span className="adm-tile-ic" style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}><Icon name={hobbyIcon(i.slug, i.name)} /></span>
                <span className="grow adm-tile-txt">
                  <b>{i.name}</b>
                  <small>{a("in_people", { n: i.people })} · {a("in_langs", { n: translated(i) + 1, total: LANGUAGES.length })}</small>
                  {!i.active ? <span className="adm-tile-badges"><Badge tone="gray">{a("in_hidden")}</Badge></span> : null}
                </span>
                <span className="adm-chev" aria-hidden="true">›</span>
              </button>
            );
          })}
        </div>
      )}
      {open ? <InterestForm interest={open === "new" ? null : open} all={list || []} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} /> : null}
    </div>
  );
}

function InterestForm({ interest, all, onClose, onSaved }: { interest: AdminInterest | null; all: AdminInterest[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(interest?.base_name || interest?.name || "");  // in Spanish
  const [names, setNames] = useState<Record<string, string>>(interest?.names || {});
  const [category, setCategory] = useState(interest?.category || "");
  const [active, setActive] = useState(interest?.active ?? true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const slug = interest?.slug || slugify(name);
  const taken = !interest && !!slug && all.some((i) => i.slug === slug);
  // its community already exists somewhere: deleting it would take chats with it, so it can only be hidden
  const inUse = !!interest && interest.zones > 0;

  const save = async (patch: { active?: boolean } = {}) => {
    setBusy(true);
    try {
      const payload = { slug, name: name.trim(), names, category, active, ...patch };
      if (interest) await api.updateInterest(interest.id, payload); else await api.createInterest(payload);
      toast(interest ? a("in_saved") : a("in_created"));
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const remove = () => {
    if (!interest) return;
    setBusy(true);
    api.deleteInterest(interest.id).then(() => { toast(a("in_deleted")); onSaved(); })
      .catch((e) => toast(e.message, "error")).finally(() => setBusy(false));
  };

  return createPortal(
    <Modal title={interest ? interest.name : a("in_new")} onClose={onClose} footer={<>
      {interest && !confirm ? <button id="adm-in-delete" className="btn danger" onClick={() => setConfirm(true)}><Icon name="trash" size="sm" />{a("in_delete")}</button> : null}
      <span className="grow" />
      <button className="btn" onClick={onClose}>{a("cancel")}</button>
      <button id="adm-in-save" className="btn pri" disabled={busy || !name.trim() || !slug || taken} onClick={() => save()}>{a("save")}</button>
    </>}>
      {confirm && interest ? (
        <div className="adm-sub">
          {inUse ? (
            <>
              <p className="adm-note">{a("in_in_use", { zones: interest.zones })}</p>
              <div className="row gap">
                <button className="btn" onClick={() => setConfirm(false)}>{a("cancel")}</button>
                {interest.active ? <button id="adm-in-hide" className="btn pri" disabled={busy} onClick={() => save({ active: false })}>{a("in_hide")}</button> : null}
              </div>
            </>
          ) : (
            <>
              <p className="adm-red adm-note">{a("in_delete_q", { name: interest.name, n: interest.people })}</p>
              <div className="row gap">
                <button className="btn" onClick={() => setConfirm(false)}>{a("cancel")}</button>
                <button id="adm-in-delete-yes" className="btn dangerfill" disabled={busy} onClick={remove}>{a("in_delete")}</button>
              </div>
            </>
          )}
        </div>
      ) : null}

      <Field label={a("in_name")} hint={taken ? a("in_exists") : undefined}>
        <input id="adm-in-name" className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder={a("in_name_ph")} autoFocus={!interest} />
      </Field>
      <div className="adm-field"><span>{a("in_names")}</span>
        <small className="muted">{a("co_names_hint")}</small>
        <div className="adm-grid">
          {OTHER_LANGS.map(([l, label]) => (
            <Field key={l} label={label}><input className="inp" value={names[l] || ""} placeholder={name} onChange={(e) => setNames((n) => ({ ...n, [l]: e.target.value }))} /></Field>
          ))}
        </div>
      </div>
      <Field label={a("in_category")}>
        <select className="inp" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{a("co_auto", { value: t(guessCategory(slug, name)) })}</option>
          {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{t(k)}</option>)}
        </select>
      </Field>
      <Switch id="adm-in-active" label={a("in_visible")} hint={a("in_visible_hint")} on={active} onChange={setActive} />
      <p className="muted adm-note">
        {a("in_more")} <button type="button" className="linkbtn" onClick={() => { onClose(); goSection("communities"); }}>{a("sec_communities")} ›</button>
      </p>
    </Modal>,
    document.body,
  );
}
