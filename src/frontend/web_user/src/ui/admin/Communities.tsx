/** The interest communities (one per zone and age range): grouped by category, each with its look and restrictions. */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { LANGUAGES, t } from "@lang";
import { api, type AdminInterest } from "../../../../web_admin/api";
import { toast } from "../../store";
import { CATEGORY_KEYS, categoryName, guessCategory } from "../Communities";
import { Icon, Modal, guessIcon, hobbyIcon, setInterestLooks } from "../common";
import { colorFor } from "../../util";
import { SectionHead } from "./AdminPage";
import { a } from "./i18n";
import { Badge, Choice, Empty, Field, Switch } from "./kit";

const ICONS = ["users", "chat", "coffee", "beer", "cocktail", "food", "party", "dance", "network", "ball", "basket", "racket",
  "dumbbell", "bike", "trophy", "waves", "mountain", "trees", "umbrella", "plane", "camera", "film", "ticket", "music",
  "guitar", "drum", "keys", "book", "palette", "gamepad", "paw", "car", "moto", "star", "compass", "calendar"];
const COLORS = ["#1e90ff", "#0ea5e9", "#14b8a6", "#22c55e", "#84cc16", "#eab308", "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#6366f1"];
const AGES: [string, string][] = [["18_30", "18-30"], ["31_60", "31-60"], ["61_plus", "61+"]];

function slugify(name: string) {
  return name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** The age bands an interest's communities are for, as set (not only those someone is in yet): its span ("18+",
 * "25-40") or its fixed ranges (all three when none is chosen). */
function bandsOf(i: AdminInterest): string[] {
  if (i.min_age != null || i.max_age != null) return [`span:${i.min_age ?? 18}-${i.max_age ?? ""}`];
  return i.age_ranges.length ? AGES.map(([k]) => k).filter((k) => i.age_ranges.includes(k)) : AGES.map(([k]) => k);
}
function bandName(k: string): string {
  if (k.startsWith("span:")) { const [min, max] = k.slice(5).split("-"); return max ? `${min}-${max}` : `${min}+`; }
  return AGES.find(([x]) => x === k)?.[1] || k;
}

const autoCategory = (i: { slug: string; name: string }) => guessCategory(i.slug, i.name);
const autoIcon = (i: { slug: string; name: string }) => guessIcon(i.slug, i.name);

/** `initialFilter` "suggested": only the interests the app suggests joining or splitting (from a notice). */
export function Communities({ initialFilter }: { initialFilter?: string }) {
  const [list, setList] = useState<AdminInterest[] | null>(null);
  const [q, setQ] = useState("");
  const [zone, setZone] = useState("");  // only the interests with a community in this zone…
  const [age, setAge] = useState("");  // …or for this age band
  const [suggested, setSuggested] = useState(initialFilter === "suggested" ? "any" : "");  // …or to join or split
  const [open, setOpen] = useState<AdminInterest | "new" | null>(null);

  const load = () => api.adminInterests().then((l) => { setList(l); setInterestLooks(l); }).catch((e) => { setList([]); toast(e.message, "error"); });
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => {
    const plain = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const needle = plain(q.trim());
    const out = new Map<string, AdminInterest[]>();
    for (const i of (list || []).filter((i) => (!needle || [i.name, i.slug, ...(i.places || [])].some((x) => plain(x).includes(needle)))
        && (!zone || (i.zone_list || []).some((z) => z.key === zone)) && (!age || bandsOf(i).includes(age))
        && (!suggested || (suggested === "any" ? !!i.suggest : i.suggest === suggested)))) {
      const cat = i.category || autoCategory(i);
      out.set(cat, [...(out.get(cat) || []), i]);
    }
    for (const v of out.values()) v.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
    return CATEGORY_KEYS.filter((k) => out.has(k)).map((k) => [k, out.get(k)!] as const);
  }, [list, q, zone, age, suggested]);
  const toJoin = (list || []).filter((i) => i.suggest === "join").length;
  const toSplit = (list || []).filter((i) => i.suggest === "split").length;
  // every zone and age band some interest has, for the filters
  const zones = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of list || []) for (const z of i.zone_list || []) seen.set(z.key, z.label);
    return [...seen].sort((x, y) => x[1].localeCompare(y[1], undefined, { sensitivity: "base" }));
  }, [list]);
  const ages = useMemo(() => [...new Set((list || []).flatMap(bandsOf))].sort(), [list]);

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
        <select id="adm-co-zone" className="inp adm-sort" value={zone} onChange={(e) => setZone(e.target.value)} aria-label={a("co_f_zone")}>
          <option value="">{a("co_f_zone_all")}</option>
          {zones.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select id="adm-co-age" className="inp adm-sort" value={age} onChange={(e) => setAge(e.target.value)} aria-label={a("co_f_age")}>
          <option value="">{a("co_f_age_all")}</option>
          {ages.map((k) => <option key={k} value={k}>{bandName(k)}</option>)}
        </select>
        <select id="adm-co-suggest" className="inp adm-sort" value={suggested} onChange={(e) => setSuggested(e.target.value)} aria-label={a("co_f_suggest")}>
          <option value="">{a("co_f_suggest_all")}</option>
          <option value="any">{a("co_f_suggest_any", { n: toJoin + toSplit })}</option>
          <option value="join">{a("co_f_suggest_join", { n: toJoin })}</option>
          <option value="split">{a("co_f_suggest_split", { n: toSplit })}</option>
        </select>
      </div>

      {list === null ? <div className="adm-loading">{a("loading")}</div> : groups.length === 0 ? <Empty icon="search" text={a("us_empty")} /> : groups.map(([cat, items]) => (
        <section key={cat} className="adm-group">
          <h3>{categoryName(cat)} <span className="muted">{items.length}</span></h3>
          <div className="adm-tiles">
            {items.map((i) => {
              const color = i.color || colorFor(i.slug);
              return (
                <button key={i.id} className={"adm-tile" + (i.active ? "" : " dim")} onClick={() => setOpen(i)}>
                  <span className="adm-tile-ic" style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}><Icon name={hobbyIcon(i.slug, i.name)} /></span>
                  <span className="grow adm-tile-txt">
                    <span className="adm-tile-name"><b>{i.name}</b>
                      {i.suggest ? <Badge tone={i.suggest === "split" ? "orange" : "blue"}>{a(i.suggest === "split" ? "co_suggest_split" : "co_suggest_join")}</Badge> : null}</span>
                    <small>{a(i.people === 1 ? "co_person" : "co_people_n", { n: i.people })}</small>
                    <small>{a(i.zones === 1 ? "co_zone" : "co_zones_n", { n: i.zones })} · {a(bandsOf(i).length === 1 ? "co_band" : "co_bands_n", { n: bandsOf(i).length })}</small>
                    {/* one row each: the scope (and what to do), the zones (one line, all of them on hover), the age bands */}
                    <span className="adm-tile-row">
                      <Badge tone="gray">{a("co_scope_badge", { scope: a(`co_geo_${i.geo_level || "country"}`) })}</Badge>
                      {!i.active ? <Badge tone="gray">{a("co_off")}</Badge> : null}
                    </span>
                    {(i.zone_list || []).length ? (
                      <small className="adm-tile-zones" title={(i.zone_list || []).map((z) => z.label).join(", ")}>
                        <Icon name="place" size="sm" /><span>{(i.zone_list || []).map((z) => z.label).join(", ")}</span>
                      </small>
                    ) : null}
                    <span className="adm-tile-row">{bandsOf(i).map((k) => <Badge key={k} tone="teal">{bandName(k)}</Badge>)}</span>
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
  const [name, setName] = useState(interest?.base_name || interest?.name || "");  // in Spanish
  // the name in the other languages (empty: the Spanish one is shown)
  const [names, setNames] = useState<Record<string, string>>(interest?.names || {});
  const [category, setCategory] = useState(interest?.category || "");
  const [icon, setIcon] = useState(interest?.icon || "");
  const [color, setColor] = useState(interest?.color || "");
  const [ages, setAges] = useState<string[]>(interest?.age_ranges || []);
  const [active, setActive] = useState(interest?.active ?? true);
  // "all": one community for every age (a span from 18 with no maximum)
  const [ageMode, setAgeMode] = useState<"all" | "ranges" | "span">(!interest ? "ranges"
    : interest.min_age === 18 && interest.max_age == null ? "all" : interest.min_age != null || interest.max_age != null ? "span" : "ranges");
  const [geo, setGeo] = useState<"country" | "region" | "province">(interest?.geo_level || "country");
  // as typed (they can be emptied while editing); an empty maximum is "no upper limit"
  const [minAge, setMinAge] = useState(String(interest?.min_age ?? 25));
  const [maxAge, setMaxAge] = useState(interest && (interest.min_age != null || interest.max_age != null) ? (interest.max_age != null ? String(interest.max_age) : "") : "45");
  const [access, setAccess] = useState<"open" | "request">(interest?.access_mode || "open");
  const [board, setBoard] = useState<"open" | "admins">(interest?.board_mode || "open");
  const [retention, setRetention] = useState(interest?.retention_days || 365);
  const [questions, setQuestions] = useState<string[]>([...(interest?.join_questions || []), "", "", ""].slice(0, 3));
  const [tags, setTags] = useState<string[]>(interest?.tags || []);
  const [all, setAll] = useState<AdminInterest[]>([]);
  useEffect(() => { api.adminInterests().then(setAll).catch(() => undefined); }, []);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const slug = interest?.slug || slugify(name);
  const guess = useMemo(() => ({ icon: autoIcon({ slug, name }), category: autoCategory({ slug, name }) }), [slug, name]);
  const shownIcon = icon || guess.icon;
  const shownColor = color || colorFor(slug || "x");

  async function save() {
    if (!name.trim() || !slug) return;
    setBusy(true);
    const payload = {
      slug, name: name.trim(), names, category, icon, color, active, age_mode: ageMode === "all" ? "span" : ageMode, geo_level: geo,
      age_ranges: ageMode === "ranges" ? ages : [], ...(ageMode === "span" ? { min_age: Number(minAge) || 18, max_age: maxAge.trim() ? Number(maxAge) : null } : {}),
      ...(ageMode === "all" ? { min_age: 18, max_age: null } : {}),
      access_mode: access, board_mode: board, retention_days: retention,
      join_questions: access === "request" ? questions.map((q) => q.trim()).filter(Boolean) : [],
      tags: [slug, ...tags.filter((x) => x !== slug)].slice(0, 5),
    };
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
        <div><b>{name || a("co_new_ph")}</b><small>{categoryName(category || guess.category)}{interest ? ` · ${a("co_stats2", { zones: interest.zones, bands: interest.age_bands ?? 0, people: interest.people })}` : ""}</small></div>
      </div>
      {confirm ? <p className="adm-red adm-note">{a("co_delete_hint")}</p> : null}

      <Field label={a("co_name")}><input id="adm-co-name" className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder={a("co_new_ph")} /></Field>
      <details className="adm-names">
        <summary>{a("co_names")} ({LANGUAGES.filter(([l]) => l !== "es" && names[l]).length}/{LANGUAGES.length - 1})</summary>
        <small className="muted">{a("co_names_hint")}</small>
        <div className="adm-grid">
          {LANGUAGES.filter(([l]) => l !== "es").map(([l, label]) => (
            <Field key={l} label={label}><input className="inp" value={names[l] || ""} placeholder={name} onChange={(e) => setNames((n) => ({ ...n, [l]: e.target.value }))} /></Field>
          ))}
        </div>
      </details>
      <Field label={a("co_category")}>
        <select className="inp" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{a("co_auto", { value: categoryName(guess.category) })}</option>
          {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{categoryName(k)}</option>)}
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
        <div className="adm-field"><span>{a("co_geo")}</span>
          <Choice label={a("co_geo")} value={geo} onChange={setGeo} options={[["country", a("co_geo_country")], ["region", a("co_geo_region")], ["province", a("co_geo_province")]]} />
          <small>{a("co_geo_hint")}</small>
        </div>
        {interest?.suggest ? (
          <div className={"adm-note " + (interest.suggest === "split" ? "adm-red" : "")}>
            {interest.suggest === "split" ? a("co_suggest_split_note", { n: interest.biggest ?? 0 }) : a("co_suggest_join_note")}{" "}
            <button type="button" className="linkbtn" onClick={() => setGeo(interest.suggest === "split"
              ? (geo === "country" ? "region" : "province") : (geo === "province" ? "region" : "country"))}>
              {a(interest.suggest === "split" ? "co_suggest_split_do" : "co_suggest_join_do")}
            </button>
          </div>
        ) : null}
        <div className="adm-field"><span>{a("co_ages")}</span>
          <Choice label={a("co_ages")} value={ageMode} onChange={setAgeMode} options={[["all", a("co_age_all")], ["ranges", a("co_age_ranges")], ["span", a("co_age_span")]]} />
        </div>
        {ageMode === "all" ? <small className="muted">{a("co_age_all_hint")}</small> : ageMode === "span" ? (
          <div className="adm-grid">
            <Field label={a("co_min_age")}><input className="inp" type="number" inputMode="numeric" min={18} max={120} placeholder="18" value={minAge} onChange={(e) => setMinAge(e.target.value)} /></Field>
            <Field label={a("co_max_age")}><input className="inp" type="number" inputMode="numeric" min={18} max={120} placeholder={a("co_age_no_limit")} value={maxAge} onChange={(e) => setMaxAge(e.target.value)} /></Field>
            <small className="muted" style={{ gridColumn: "1 / -1" }}>{a("co_age_span_hint")}</small>
          </div>
        ) : (
        <div className="adm-field">
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
        )}
      </div>

      <div className="adm-sub">
        <div className="adm-sub-head"><b>{a("co_settings")}</b><span className="muted">{a("co_settings_hint")}</span></div>
        <div className="adm-field"><span>{a("co_access")}</span>
          <Choice label={a("co_access")} value={access} onChange={setAccess} options={[["open", a("co_access_open")], ["request", a("co_access_request")]]} />
        </div>
        {access === "request" ? (
          <div className="adm-field"><span>{a("co_questions")}</span>
            {questions.map((q, i) => <input key={i} className="inp" maxLength={200} placeholder={a("co_question_ph", { n: i + 1 })} value={q} onChange={(e) => setQuestions(questions.map((x, j) => (j === i ? e.target.value : x)))} />)}
          </div>
        ) : null}
        <div className="adm-field"><span>{a("co_board")}</span>
          <Choice label={a("co_board")} value={board} onChange={setBoard} options={[["open", a("co_board_open")], ["admins", a("co_board_admins")]]} />
        </div>
        <Field label={a("co_retention")}>
          <select className="inp" value={retention} onChange={(e) => setRetention(Number(e.target.value))}>
            {[1, 2, 3, 7, 30, 90, 180, 365].map((d) => <option key={d} value={d}>{a("ret_" + d)}</option>)}
          </select>
        </Field>
      </div>

      <div className="adm-sub">
        <div className="adm-sub-head"><b>{a("co_tags")}</b><span className="muted">{a("co_tags_hint")}</span></div>
        <div className="chips wrapchips">
          {all.filter((x) => x.slug !== slug).map((x) => {
            const on = tags.includes(x.slug);
            const full = tags.filter((y) => y !== slug).length >= 4;
            return <button key={x.slug} type="button" className={"chip" + (on ? " on" : "")} aria-pressed={on} disabled={!on && full}
              onClick={() => setTags(on ? tags.filter((y) => y !== x.slug) : [...tags, x.slug])}>{x.name}</button>;
          })}
        </div>
      </div>
    </Modal>,
    document.body,
  );
}
