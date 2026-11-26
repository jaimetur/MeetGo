/** Countries (name, calling code, kind of region, regions) and the age ranges, edited visually. */
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@lang";
import { Icon, Modal } from "../common";
import { a } from "./i18n";
import { Badge, Field } from "./kit";

type Row = Record<string, any>;
type Region = { value: string; name: string };
type Settings = Row;

const KINDS = ["province", "state", "region", "department", "county", "prefecture", "canton", "district", "parish", "voivodeship"];
const kindLabel = (k: string) => (k === "province" ? t("ui_province") : t(`ui_region_${k}`));

/** 🇪🇸 from "ES". */
export function flag(code: string): string {
  return /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "🏳️";
}

export function Countries({ s, patch }: { s: Settings; patch: (p: Settings) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | "new" | null>(null);
  const countries: Row[] = s.countries || [];
  const ccOf = (code: string, name: string) => ((s.calling_codes || []) as Row[]).find((c) => c.code === code || (!c.code && c.name === name))?.cc || "";
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return countries.filter((c) => !n || c.name.toLowerCase().includes(n) || c.code.toLowerCase() === n)
      .sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
  }, [countries, q]);

  return (
    <>
      <div className="adm-toolbar">
        <div className="adm-search">
          <Icon name="search" size="sm" />
          <input className="inp" type="search" autoComplete="off" autoCorrect="off" spellCheck={false} placeholder={a("ge_search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button id="adm-country-new" className="btn pri sm" onClick={() => setOpen("new")}><Icon name="plus" size="sm" />{a("ge_new")}</button>
      </div>
      <div className="adm-countries">
        {shown.map((c) => {
          const regions = (s.provinces_by_country?.[c.code] || []).length;
          const kind = s.region_kinds?.[c.code] || "province";
          return (
            <button key={c.code} className="adm-country" onClick={() => setOpen(c.code)}>
              <span className="adm-flag">{flag(c.code)}</span>
              <span className="grow adm-tile-txt">
                <b>{c.name}</b>
                <small>{[ccOf(c.code, c.name), `${regions} · ${kindLabel(kind)}`].filter(Boolean).join(" · ")}</small>
              </span>
              {(s.geo_edited || []).includes(c.code) ? <Badge tone="violet">{a("ge_edited")}</Badge> : null}
              <span className="adm-chev" aria-hidden="true">›</span>
            </button>
          );
        })}
      </div>
      {open ? <CountryEditor s={s} code={open === "new" ? null : open} onClose={() => setOpen(null)}
        onApply={(p) => { patch(p); setOpen(null); }} /> : null}
    </>
  );
}

function CountryEditor({ s, code, onClose, onApply }: { s: Settings; code: string | null; onClose: () => void; onApply: (p: Settings) => void }) {
  const existing: Row | undefined = code ? (s.countries || []).find((c: Row) => c.code === code) : undefined;
  const ccRow: Row | undefined = code ? (s.calling_codes || []).find((c: Row) => c.code === code || (!c.code && c.name === existing?.name)) : undefined;
  const [cc, setCc] = useState(existing?.code || "");
  const [name, setName] = useState(existing?.name || "");
  const [phone, setPhone] = useState(ccRow?.cc || "+");
  const [kind, setKind] = useState<string>((code && s.region_kinds?.[code]) || "province");
  const [regions, setRegions] = useState<Region[]>(() => [...((code && s.provinces_by_country?.[code]) || [])]);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // groups of regions (autonomous communities, states…): what a community's scope can be besides a region or the country
  const [groups, setGroups] = useState<Row[]>(() => ((code && s.region_groups?.[code]) || []).map((g: Row) => ({ ...g, regions: [...(g.regions || [])] })));
  const [newGroup, setNewGroup] = useState("");
  const groupValueOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const g of groups) for (const r of g.regions || []) m[r] = g.value;
    return m;
  }, [groups]);
  const slugOf = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "group";
  function addGroup() {
    const n = newGroup.trim();
    if (!n || groups.some((g) => g.name.toLowerCase() === n.toLowerCase())) return;
    let v = slugOf(n);
    while (groups.some((g) => g.value === v)) v += "_2";
    setGroups([...groups, { value: v, name: n, regions: [] }].sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" })));
    setNewGroup("");
  }
  // a region belongs to one group at most
  function assign(region: string, groupValue: string) {
    setGroups(groups.map((g) => ({ ...g, regions: g.value === groupValue ? [...(g.regions || []).filter((r: string) => r !== region), region]
      : (g.regions || []).filter((r: string) => r !== region) })));
  }

  const taken = useMemo(() => new Set(Object.entries(s.provinces_by_country || {}).filter(([k]) => k !== code)
    .flatMap(([, list]) => (list as Region[]).map((r) => r.value.toLowerCase()))), [s, code]);

  function add() {
    const names = adding.split(/\n|;/).map((x) => x.trim()).filter(Boolean);
    const next = [...regions];
    for (const n of names) {
      if (next.some((r) => r.name.toLowerCase() === n.toLowerCase())) continue;
      const value = taken.has(n.toLowerCase()) ? `${n} (${cc.toUpperCase()})` : n;
      next.push({ value, name: n });
    }
    setRegions(next.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" })));
    setAdding("");
  }

  const C = cc.trim().toUpperCase();
  const valid = /^[A-Z]{2}$/.test(C) && name.trim() && (!!code || !(s.countries || []).some((c: Row) => c.code === C));

  function apply() {
    const countries = [...(s.countries || [])];
    const i = countries.findIndex((c: Row) => c.code === C);
    if (i >= 0) countries[i] = { ...countries[i], name: name.trim() }; else countries.push({ code: C, name: name.trim() });
    const calling = (s.calling_codes || []).filter((c: Row) => !(c.code === C || (!c.code && c.name === existing?.name)));
    if (phone.trim() && phone.trim() !== "+") calling.push({ cc: phone.trim().startsWith("+") ? phone.trim() : `+${phone.trim()}`, name: name.trim(), code: C });
    // groups keep only regions that still exist
    const values = new Set(regions.map((r) => r.value));
    const nextGroups = groups.map((g) => ({ ...g, name: (g.name || "").trim() || g.value, regions: (g.regions || []).filter((r: string) => values.has(r)) })).filter((g) => g.regions.length);
    onApply({
      countries,
      calling_codes: calling,
      provinces_by_country: { ...(s.provinces_by_country || {}), [C]: regions },
      region_kinds: { ...(s.region_kinds || {}), [C]: kind },
      region_groups: { ...(s.region_groups || {}), [C]: nextGroups },
      geo_edited: [...new Set([...(s.geo_edited || []), C])],
      geo_removed: (s.geo_removed || []).filter((x: string) => x !== C),
    });
  }

  function remove() {
    const drop = (obj: Row) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => k !== code));
    onApply({
      countries: (s.countries || []).filter((c: Row) => c.code !== code),
      calling_codes: (s.calling_codes || []).filter((c: Row) => !(c.code === code || (!c.code && c.name === existing?.name))),
      provinces_by_country: drop(s.provinces_by_country), region_kinds: drop(s.region_kinds), region_groups: drop(s.region_groups),
      geo_edited: (s.geo_edited || []).filter((x: string) => x !== code),
      geo_removed: [...new Set([...(s.geo_removed || []), code])],
    });
  }

  const shown = regions.filter((r) => !filter.trim() || r.name.toLowerCase().includes(filter.trim().toLowerCase()));
  return createPortal(
    <Modal title={code ? `${flag(code)} ${existing?.name || code}` : a("ge_new")} onClose={onClose} footer={<>
      {code ? (confirmDelete
        ? <button className="btn dangerfill" onClick={remove}>{a("ge_delete_yes")}</button>
        : <button className="btn danger" onClick={() => setConfirmDelete(true)}><Icon name="trash" size="sm" /></button>) : null}
      <span className="grow" />
      <button className="btn" onClick={onClose}>{a("cancel")}</button>
      <button id="adm-country-apply" className="btn pri" disabled={!valid} onClick={apply}>{a("ud_apply")}</button>
    </>}>
      <div className="adm-grid">
        <Field label={a("ge_name")}><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={a("ge_code")} hint={code ? undefined : a("ge_code_hint")}>
          <input className="inp" maxLength={2} readOnly={!!code} value={cc} onChange={(e) => setCc(e.target.value.toUpperCase())} placeholder="ES" />
        </Field>
        <Field label={a("ge_phone")}><input className="inp" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+34" /></Field>
        <Field label={a("ge_kind")}>
          <select className="inp" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
          </select>
        </Field>
      </div>
      {confirmDelete ? <p className="adm-red adm-note">{a("ge_delete_hint")}</p> : null}

      <div className="adm-sub">
        <div className="adm-sub-head"><b>{kindLabel(kind)} · {regions.length}</b>{groups.length ? <span className="muted">{a("ge_groups", { n: groups.length })}</span> : null}</div>
        {regions.length > 8 ? <input className="inp" type="search" autoComplete="off" autoCorrect="off" spellCheck={false} placeholder={a("ge_filter")} value={filter} onChange={(e) => setFilter(e.target.value)} /> : null}
        <div className="adm-regions">
          {shown.map((r) => (
            <div key={r.value} className="adm-region">
              {editing === r.value ? (
                <form className="adm-tile-edit grow" onSubmit={(e) => { e.preventDefault(); setRegions(regions.map((x) => x.value === r.value ? { ...x, name: draft.trim() || x.name } : x)); setEditing(null); }}>
                  <input className="inp" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
                  <button className="iconbtn" aria-label={a("co_saved")}><Icon name="check" size="sm" /></button>
                </form>
              ) : (
                <>
                  <span className="grow adm-tile-txt"><b>{r.name}</b></span>
                  {groups.length ? (
                    <select className="inp adm-region-group" aria-label={a("ge_group_of", { region: r.name })} value={groupValueOf[r.value] || ""} onChange={(e) => assign(r.value, e.target.value)}>
                      <option value="">—</option>
                      {groups.map((g) => <option key={g.value} value={g.value}>{g.name}</option>)}
                    </select>
                  ) : null}
                  <button className="iconbtn" aria-label={a("co_rename")} onClick={() => { setEditing(r.value); setDraft(r.name); }}><Icon name="edit" size="sm" /></button>
                  <button className="iconbtn" aria-label={a("co_delete_yes")} onClick={() => setRegions(regions.filter((x) => x.value !== r.value))}><Icon name="x" size="sm" /></button>
                </>
              )}
            </div>
          ))}
        </div>
        <form className="adm-test" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input className="inp" placeholder={a("ge_add_region", { kind: kindLabel(kind).toLowerCase() })} value={adding} onChange={(e) => setAdding(e.target.value)}
            onPaste={(e) => { const text = e.clipboardData.getData("text"); if (text.includes("\n")) { e.preventDefault(); setAdding(text); } }} />
          <button className="btn sm" disabled={!adding.trim()}><Icon name="plus" size="sm" />{a("add")}</button>
        </form>
        <small className="muted">{a("ge_regions_hint")}</small>
      </div>
      <div className="adm-sub">
        <div className="adm-sub-head"><b>{a("ge_groups_title")} · {groups.length}</b></div>
        <small className="muted">{a("ge_groups_hint")}</small>
        <div className="adm-regions">
          {groups.map((g) => (
            <div key={g.value} className="adm-region">
              <input className="inp grow" aria-label={a("co_rename")} value={g.name} onChange={(e) => setGroups(groups.map((x) => x.value === g.value ? { ...x, name: e.target.value } : x))} />
              <span className="muted adm-group-n">{(g.regions || []).length}</span>
              <button className="iconbtn" aria-label={a("co_delete_yes")} onClick={() => setGroups(groups.filter((x) => x.value !== g.value))}><Icon name="x" size="sm" /></button>
            </div>
          ))}
        </div>
        <form className="adm-test" onSubmit={(e) => { e.preventDefault(); addGroup(); }}>
          <input className="inp" placeholder={a("ge_group_add")} value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
          <button className="btn sm" disabled={!newGroup.trim()}><Icon name="plus" size="sm" />{a("add")}</button>
        </form>
      </div>
    </Modal>,
    document.body,
  );
}

/** The age ranges: fixed in the database (communities are made per range), shown as a scale. */
export function AgeRanges({ s }: { s: Settings }) {
  const ranges: Row[] = s.age_ranges || [];
  const tones = ["#1e90ff", "#14b8a6", "#f59e0b", "#ec4899"];
  const span = (r: Row) => ((r.max ?? 80) - r.min + 1);
  const total = ranges.reduce((n, r) => n + span(r), 0) || 1;
  return (
    <>
      <div className="adm-ages" role="img" aria-label={ranges.map((r) => r.label).join(", ")}>
        {ranges.map((r, i) => (
          <div key={r.key} style={{ flex: span(r) / total, background: tones[i % tones.length] }}>
            <b>{r.label}</b>
            <small>{r.max ? a("ag_years", { min: r.min, max: r.max }) : a("ag_plus", { min: r.min })}</small>
          </div>
        ))}
      </div>
      <p className="muted adm-note">{a("ag_fixed")}</p>
    </>
  );
}
