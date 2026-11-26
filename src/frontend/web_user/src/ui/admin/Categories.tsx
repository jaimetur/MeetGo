/** Administration → Categories: the categories of communities (named in every language), the ones people propose, and
 * moving many communities at once into one category. */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { LANGUAGES } from "@lang";
import { api, type AdminCategories, type AdminCategory } from "../../../../web_admin/api";
import { loadCategories, toast } from "../../store";
import { Icon, Modal } from "../common";
import { categoryName, guessCategory } from "../Communities";
import { SectionHead } from "./AdminPage";
import { a, fmtDate } from "./i18n";
import { Badge, Empty, Field } from "./kit";

export function Categories() {
  const [data, setData] = useState<AdminCategories | null>(null);
  const [open, setOpen] = useState<AdminCategory | "new" | null>(null);
  const [approving, setApproving] = useState<AdminCategories["proposals"][number] | null>(null);
  const load = () => api.adminCategories().then((d) => { setData(d); loadCategories(); }).catch((e) => toast(e.message, "error"));
  useEffect(() => { load(); }, []);

  if (!data) return <div className="adm-loading">{a("loading")}</div>;
  // counted as the app shows them: the chosen category, or the one worked out from the name
  const counts: Record<string, number> = {};
  for (const i of data.interests) {
    const k = i.category || guessCategory(i.slug, i.title);
    counts[k] = (counts[k] || 0) + 1;
  }
  for (const c of data.communities) {
    const k = c.category || guessCategory(null, c.title);
    counts[k] = (counts[k] || 0) + 1;
  }
  return (
    <div className="adm-sec">
      <SectionHead title={a("sec_categories")} sub={a("cg_lead")}>
        <button id="adm-cat-new" className="btn pri sm" onClick={() => setOpen("new")}><Icon name="plus" size="sm" />{a("cg_new")}</button>
      </SectionHead>

      {data.proposals.length ? (
        <section className="adm-card">
          <div className="adm-card-head"><b>{a("cg_proposals")}</b><Badge tone="orange">{data.proposals.length}</Badge></div>
          <div className="adm-list">
            {data.proposals.map((p) => (
              <div key={p.id} className="cg-prop">
                <span className="grow"><b>{p.name}</b><small className="muted">
                  {a("cg_proposed_by", { user: p.user?.name || "—", community: p.community?.title || "—", date: fmtDate(p.created_at) })}
                </small></span>
                <button className="btn sm pri" onClick={() => setApproving(p)}>{a("cg_approve")}</button>
                <button className="btn sm" onClick={() => api.rejectProposal(p.id).then(() => { toast(a("cg_rejected")); load(); }).catch((e) => toast(e.message, "error"))}>{a("cg_reject")}</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="adm-tiles">
        {data.categories.map((c) => (
          <button key={c.key} id={`adm-cat-${c.key}`} className="adm-tile" onClick={() => setOpen(c)}>
            <span className="grow adm-tile-txt">
              <b>{c.name}</b>
              <small>{a("cg_count", { n: counts[c.key] || 0 })}</small>
            </span>
            {c.builtin ? <Badge tone="gray">MeetGo</Badge> : null}
            <span className="adm-chev" aria-hidden="true">›</span>
          </button>
        ))}
      </div>

      <BulkMove data={data} onDone={load} />

      {open ? <CategoryForm category={open === "new" ? null : { ...open, count: counts[open.key] || 0 }} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} /> : null}
      {approving ? <ApproveForm proposal={approving} categories={data.categories} onClose={() => setApproving(null)} onDone={() => { setApproving(null); load(); }} /> : null}
    </div>
  );
}

function NamesFields({ names, setNames, placeholder }: { names: Record<string, string>; setNames: (f: (n: Record<string, string>) => Record<string, string>) => void; placeholder?: string }) {
  return (
    <div className="adm-grid">
      {LANGUAGES.map(([l, label]) => (
        <Field key={l} label={l === "es" ? `${label} *` : label}>
          <input className="inp" id={`adm-cat-name-${l}`} value={names[l] || ""} placeholder={l === "es" ? "" : names.es || placeholder} onChange={(e) => setNames((n) => ({ ...n, [l]: e.target.value }))} />
        </Field>
      ))}
    </div>
  );
}

function CategoryForm({ category, onClose, onSaved }: { category: AdminCategory | null; onClose: () => void; onSaved: () => void }) {
  const [names, setNames] = useState<Record<string, string>>(category?.names || {});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    fn().then(() => { toast(done); onSaved(); }).catch((e) => toast(e.message, "error")).finally(() => setBusy(false));
  };
  return createPortal(
    <Modal wide title={category ? category.name : a("cg_new")} onClose={onClose} footer={<>
      {category && !category.builtin ? (confirm
        ? <button className="btn dangerfill" disabled={busy} onClick={() => run(() => api.deleteCategory(category.key), a("cg_deleted"))}>{a("cg_delete_yes")}</button>
        : <button className="btn danger" onClick={() => setConfirm(true)}><Icon name="trash" size="sm" />{a("cg_delete")}</button>) : null}
      <span className="grow" />
      <button className="btn" onClick={onClose}>{a("cancel")}</button>
      <button id="adm-cat-save" className="btn pri" disabled={busy || !(names.es || "").trim()}
        onClick={() => run(() => (category ? api.updateCategory(category.key, { names }) : api.createCategory({ names })), category ? a("cg_saved") : a("cg_created"))}>{a("save")}</button>
    </>}>
      {confirm ? <p className="adm-red adm-note">{a("cg_delete_hint", { n: category?.count || 0 })}</p> : null}
      <p className="muted adm-note">{a("cg_names_hint")}</p>
      <NamesFields names={names} setNames={setNames} />
    </Modal>,
    document.body,
  );
}

function ApproveForm({ proposal, categories, onClose, onDone }: {
  proposal: AdminCategories["proposals"][number]; categories: AdminCategory[]; onClose: () => void; onDone: () => void;
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [names, setNames] = useState<Record<string, string>>({ es: proposal.name });
  const [key, setKey] = useState(categories[0]?.key || "");
  const [busy, setBusy] = useState(false);
  return createPortal(
    <Modal wide title={a("cg_approve_title", { name: proposal.name })} onClose={onClose} footer={<>
      <span className="grow" />
      <button className="btn" onClick={onClose}>{a("cancel")}</button>
      <button id="adm-cat-approve" className="btn pri" disabled={busy || (mode === "new" ? !(names.es || "").trim() : !key)} onClick={() => {
        setBusy(true);
        api.approveProposal(proposal.id, mode === "new" ? { names } : { key }).then(() => { toast(a("cg_approved")); onDone(); })
          .catch((e) => toast(e.message, "error")).finally(() => setBusy(false));
      }}>{a("cg_approve")}</button>
    </>}>
      <div className="adm-choice">
        <button type="button" className={mode === "new" ? "on" : ""} onClick={() => setMode("new")}>{a("cg_as_new")}</button>
        <button type="button" className={mode === "existing" ? "on" : ""} onClick={() => setMode("existing")}>{a("cg_as_existing")}</button>
      </div>
      {mode === "new" ? <NamesFields names={names} setNames={setNames} /> : (
        <Field label={a("cg_existing")}>
          <select className="inp" value={key} onChange={(e) => setKey(e.target.value)}>
            {categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        </Field>
      )}
      {proposal.community ? <p className="muted adm-note">{a("cg_approve_hint", { community: proposal.community.title })}</p> : null}
    </Modal>,
    document.body,
  );
}

/** Pick communities (interests in every zone, and people's) and move them all into one category. */
function BulkMove({ data, onDone }: { data: AdminCategories; onDone: () => void }) {
  type Row = { id: string; title: string; kind: "interest" | "custom"; category: string; detail: string };
  const rows: Row[] = useMemo(() => [
    ...data.interests.map((i) => ({ id: `i${i.id}`, title: i.title, kind: "interest" as const, category: i.category || guessCategory(i.slug, i.title), detail: a("cg_kind_interest") })),
    ...data.communities.map((c) => ({ id: `c${c.id}`, title: c.title, kind: "custom" as const, category: c.category || guessCategory(null, c.title), detail: `${c.province || ""} · ${a("cg_members", { n: c.members })}` })),
  ].sort((x, y) => x.title.localeCompare(y.title, undefined, { sensitivity: "base" })), [data]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const plain = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const shown = rows.filter((r) => (!from || r.category === from) && (!q || plain(r.title).includes(plain(q))));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allShown = shown.length > 0 && shown.every((r) => picked.has(r.id));
  return (
    <section className="adm-card cg-bulk">
      <div className="adm-card-head"><b>{a("cg_bulk")}</b><span className="muted">{a("cg_bulk_hint")}</span></div>
      <div className="adm-toolbar">
        <div className="adm-search"><Icon name="search" size="sm" /><input className="inp" type="search" placeholder={a("cg_search")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="inp" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={a("cg_from")}>
          <option value="">{a("cg_from_all")}</option>
          {data.categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
      </div>
      {shown.length ? (
        <div className="cg-rows">
          <label className="cg-row head"><input type="checkbox" checked={allShown} onChange={() => setPicked((p) => {
            const n = new Set(p);
            shown.forEach((r) => (allShown ? n.delete(r.id) : n.add(r.id)));
            return n;
          })} /><span className="grow">{a("cg_select_all", { n: shown.length })}</span></label>
          {shown.map((r) => (
            <label key={r.id} className="cg-row">
              <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
              <span className="grow"><b>{r.title}</b><small className="muted">{r.detail}</small></span>
              <Badge tone={r.kind === "interest" ? "teal" : "blue"}>{categoryName(r.category)}</Badge>
            </label>
          ))}
        </div>
      ) : <Empty icon="search" text={a("us_empty")} />}
      <div className="cg-move">
        <span className="grow">{a("cg_picked", { n: picked.size })}</span>
        <select id="adm-cat-to" className="inp" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">{a("cg_to")}</option>
          {data.categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
        <button id="adm-cat-move" className="btn pri" disabled={busy || !to || !picked.size} onClick={() => {
          setBusy(true);
          const ids = [...picked];
          api.assignCategory({ key: to, community_ids: ids.filter((x) => x[0] === "c").map((x) => +x.slice(1)), interest_ids: ids.filter((x) => x[0] === "i").map((x) => +x.slice(1)) })
            .then((r) => { toast(a("cg_moved", { n: r.changed })); setPicked(new Set()); onDone(); })
            .catch((e) => toast(e.message, "error")).finally(() => setBusy(false));
        }}>{a("cg_move")}</button>
      </div>
    </section>
  );
}

