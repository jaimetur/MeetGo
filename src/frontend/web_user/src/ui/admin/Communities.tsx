/** The interest communities (one per zone and age range): grouped by category, renamed or removed in place. */
import React, { useEffect, useMemo, useState } from "react";
import { t } from "@lang";
import { api } from "../../../../web_admin/api";
import { toast } from "../../store";
import { communityCategory } from "../Communities";
import { Icon, hobbyIcon } from "../common";
import { SectionHead } from "./AdminPage";
import { a } from "./i18n";
import { Empty } from "./kit";

type Interest = { id: number; slug: string; name: string };

function slugify(name: string) {
  return name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function Communities() {
  const [list, setList] = useState<Interest[] | null>(null);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState<number | null>(null);

  const load = () => api.interests().then((l: Interest[]) => setList(l || [])).catch((e) => { setList([]); toast(e.message, "error"); });
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = new Map<string, Interest[]>();
    for (const i of (list || []).filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.slug.includes(needle))) {
      const cat = communityCategory({ slug: i.slug, title: i.name } as any);
      out.set(cat, [...(out.get(cat) || []), i]);
    }
    for (const v of out.values()) v.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
    return [...out.entries()].sort(([x], [y]) => (x === "ui_cat_other" ? 1 : y === "ui_cat_other" ? -1 : t(x).localeCompare(t(y))));
  }, [list, q]);

  async function run(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      toast(done);
      await load();
    } catch (e: any) {
      toast(e?.message || a("save_error"), "error");
    }
  }

  const add = () => {
    const n = name.trim();
    if (!slugify(n)) return;
    run(() => api.createInterest({ slug: slugify(n), name: n }), a("co_created")).then(() => setName(""));
  };
  const rename = (i: Interest) => {
    const n = draft.trim();
    if (!n || n === i.name) return setEditing(null);
    run(() => api.updateInterest(i.id, { slug: i.slug, name: n }), a("co_saved")).then(() => setEditing(null));
  };

  return (
    <div className="adm-sec">
      <SectionHead title={a("sec_communities")} sub={list ? a("co_count", { n: list.length }) : undefined} />
      <div className="adm-toolbar">
        <div className="adm-search">
          <Icon name="search" size="sm" />
          <input className="inp" type="search" placeholder={a("co_search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <form className="adm-card adm-addrow" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <span className="adm-stat-ic t-teal"><Icon name="plus" /></span>
        <input id="adm-co-new" className="inp" placeholder={a("co_new_ph")} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn pri sm" disabled={!slugify(name)}>{a("co_add")}</button>
      </form>

      {list === null ? <div className="adm-loading">{a("loading")}</div> : groups.length === 0 ? <Empty icon="search" text={a("us_empty")} /> : groups.map(([cat, items]) => (
        <section key={cat} className="adm-group">
          <h3>{t(cat)} <span className="muted">{items.length}</span></h3>
          <div className="adm-tiles">
            {items.map((i) => (
              <div key={i.id} className="adm-tile">
                <span className="adm-tile-ic"><Icon name={hobbyIcon(i.slug, i.name)} /></span>
                {editing === i.id ? (
                  <form className="grow adm-tile-edit" onSubmit={(e) => { e.preventDefault(); rename(i); }}>
                    <input className="inp" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(null)} />
                    <button className="iconbtn" aria-label={a("co_saved")}><Icon name="check" size="sm" /></button>
                  </form>
                ) : confirm === i.id ? (
                  <span className="grow adm-tile-confirm">
                    <span>{a("co_delete_q", { name: i.name })}</span>
                    <button className="btn sm dangerfill" onClick={() => run(() => api.deleteInterest(i.id), a("co_deleted")).then(() => setConfirm(null))}>{a("co_delete_yes")}</button>
                    <button className="btn sm" onClick={() => setConfirm(null)}>{a("cancel")}</button>
                  </span>
                ) : (
                  <>
                    <span className="grow adm-tile-txt"><b>{i.name}</b><small>{i.slug}</small></span>
                    <button className="iconbtn" title={a("co_rename")} aria-label={a("co_rename")} onClick={() => { setEditing(i.id); setDraft(i.name); setConfirm(null); }}><Icon name="edit" size="sm" /></button>
                    <button className="iconbtn" title={a("co_delete_yes")} aria-label={a("co_delete_yes")} onClick={() => { setConfirm(i.id); setEditing(null); }}><Icon name="trash" size="sm" /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
