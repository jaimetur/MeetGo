/** Backups (as DriveTest Analyzer's Backup Protection): the figures, Back up now, Restore and Scheduled backups.
 * The backups are ZIPs in a folder of the server's data directory (DATA_DIR), not of this computer: full ones with the
 * database and the uploaded files, light ones with the database alone. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type BackupFile, type BackupManifest, type BackupSettings, type BackupsStatus, type BackupTask } from "../../../../web_admin/api";
import { toast } from "../../store";
import { Icon, Modal } from "../common";
import { SectionHead } from "./AdminPage";
import { a, fmtDateTime } from "./i18n";

const COMPONENTS = ["database", "files"] as const;
const WEEKDAYS = ["bk_mon", "bk_tue", "bk_wed", "bk_thu", "bk_fri", "bk_sat", "bk_sun"];
const PER_DAY: Record<string, number> = { hourly: 24, every_4_hours: 6, daily: 1, weekly: 1 / 7, monthly: 1 / 30 };

export function size(bytes?: number | null): string {
  if (bytes == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export function Backups() {
  const [data, setData] = useState<BackupsStatus | null>(null);
  const [cfg, setCfg] = useState<BackupSettings | null>(null);
  const [task, setTask] = useState<BackupTask | null>(null);
  const [saved, setSaved] = useState("");
  const [picker, setPicker] = useState<null | "backup" | "restore">(null);
  const [askLevel, setAskLevel] = useState(false);
  // restore: its own folder, the kind and the file chosen
  const [rPath, setRPath] = useState("");
  const [rType, setRType] = useState<"full" | "light">("full");
  const [rFiles, setRFiles] = useState<BackupFile[]>([]);
  const [rFile, setRFile] = useState("");
  const [confirm, setConfirm] = useState<BackupManifest | null>(null);
  const dirty = useRef(false);

  const load = () => api.backups().then((d) => {
    setData(d);
    if (!dirty.current) setCfg(d.settings);
    if (d.task && d.task.state === "running") setTask(d.task);
    setRPath((p) => p || d.settings.backup_path);
  }).catch((e) => toast(e.message, "error"));
  useEffect(() => { load(); }, []);
  // the list follows the scheduled backups as they are made
  useEffect(() => { const timer = window.setInterval(load, 30000); return () => window.clearInterval(timer); }, []);
  const loadFiles = (path: string) => api.backupFiles(path).then(setRFiles).catch(() => setRFiles([]));
  useEffect(() => { if (rPath) loadFiles(rPath); }, [rPath]);
  // a running backup or restore: its progress every second, then everything again
  useEffect(() => {
    if (!task || task.state !== "running") return;
    const timer = window.setInterval(async () => {
      try {
        const t = await api.backupTask(task.id);
        setTask(t);
        if (t.state !== "running") {
          toast(t.state === "done" ? a(t.kind === "restore" ? "bk_restored" : "bk_done", { file: t.message }) : `${a("bk_failed")}: ${t.message}`, t.state === "done" ? "info" : "error");
          load();
          if (rPath) loadFiles(rPath);
        }
      } catch { /* next time */ }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.state]);

  // what Back up now keeps and where are saved at once, for the next backups (the scheduled ones too)
  async function keep(change: Partial<BackupSettings>) {
    if (!cfg) return;
    const next = { ...cfg, ...change };
    setCfg(next);
    try {
      const d = await api.saveBackupSettings({ ...(data?.settings || next), components: next.components, backup_path: next.backup_path });
      setData(d);
      setSaved(a("bk_saved_next"));
      window.setTimeout(() => setSaved(""), 2500);
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  async function saveSchedule() {
    if (!cfg) return;
    try {
      const d = await api.saveBackupSettings(cfg);
      dirty.current = false;
      setData(d);
      setCfg(d.settings);
      toast(a("bk_schedule_saved"));
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  const edit = (change: Partial<BackupSettings>) => { dirty.current = true; setCfg((c) => (c ? { ...c, ...change } : c)); };

  async function run(level: "full" | "light") {
    setAskLevel(false);
    try {
      setTask(await api.runBackup(level));
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  async function openRestore() {
    try {
      setConfirm(await api.inspectBackup(rPath, rFile));
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  async function download() {
    try {
      window.location.href = await api.backupDownloadUrl(rPath, rFile);
    } catch (e: any) {
      toast(e.message, "error");
    }
  }
  async function remove() {
    if (!window.confirm(a("bk_delete_confirm", { file: rFile }))) return;
    try {
      await api.deleteBackup(rPath, rFile);
      setRFile("");
      loadFiles(rPath);
      load();
    } catch (e: any) {
      toast(e.message, "error");
    }
  }

  const shown = useMemo(() => rFiles.filter((f) => f.level === rType), [rFiles, rType]);
  if (!data || !cfg) return <div className="adm-loading"><Icon name="clock" /></div>;
  const s = data.status;
  const running = task?.state === "running";
  const lightAllowed = ["hourly", "every_4_hours", "daily"].includes(cfg.recurrence);
  const onlyFiles = cfg.components.length === 1 && cfg.components[0] === "files";

  // how many backups the retention keeps at most, and their space with the latest sizes
  const plan = (() => {
    const inDays = Math.max(1, Math.ceil(cfg.keep_days * (PER_DAY[cfg.recurrence] || 1)));
    const light = cfg.light_backups && lightAllowed;
    const fullInDays = light ? Math.max(1, Math.ceil(cfg.keep_days / 7)) : inDays;
    const lightN = light ? Math.max(0, inDays - fullInDays) : 0;
    const fullN = fullInDays + cfg.keep_weeks + cfg.keep_months;
    const bytes = fullN * (s.latest_full || 0) + lightN * (s.latest_light || 0);
    return { fullN, lightN, bytes };
  })();

  return (
    <>
      <SectionHead title={a("sec_backups")} sub={a("bk_sub")} />
      <section className="bk">
        <header className="bk-head">
          <span className="bk-shield" aria-hidden="true"><Icon name="shield" /></span>
          <div>
            <p className="bk-eyebrow">{a("bk_eyebrow")}</p>
            <h2>{a("bk_title")}</h2>
            <p className="muted">{a("bk_lead")}</p>
          </div>
        </header>

        <dl className="bk-stats">
          <div><dt>{a("bk_stored")}</dt><dd>{s.count}</dd><dd className="bk-detail">{a("bk_count_detail", { full: s.count_full, light: s.count_light })}</dd></div>
          <div><dt>{a("bk_total")}</dt><dd>{size(s.size)}</dd><dd className="bk-detail">{a("bk_size_detail", { full: size(s.size_full), light: size(s.size_light) })}</dd></div>
          <div className={s.disk.low ? "low" : ""} title={a("bk_disk_hint")}><dt>{a("bk_disk")}</dt><dd>{size(s.disk.free)}</dd>
            <dd className="bk-detail">{a("bk_disk_detail", { total: size(s.disk.total), pct: s.disk.total ? Math.round((100 * s.disk.used) / s.disk.total) : 0 })}{s.disk.low ? ` · ${a("bk_disk_low")}` : ""}</dd></div>
          <div><dt>{a("bk_last")}</dt><dd>{s.last_success ? fmtDateTime(s.last_success) : "—"}</dd><dd className="bk-detail">{s.last_level ? a("bk_level_" + s.last_level) : ""}</dd></div>
          <div><dt>{a("bk_next")}</dt><dd>{s.next_run ? fmtDateTime(s.next_run) : a("bk_next_off")}</dd><dd className="bk-detail">{s.next_level ? a("bk_level_" + s.next_level) : ""}</dd></div>
        </dl>
        {s.problem ? <div className="bk-problem" role="status"><Icon name="info" size="sm" />{s.problem}</div> : null}

        <div className="bk-cards">
          <section className="bk-card">
            <header className="bk-card-head">
              <span className="bk-card-ic" aria-hidden="true"><Icon name="layers" /></span>
              <div><h3>{a("bk_now")}</h3><p>{a("bk_now_hint")}</p></div>
            </header>
            <div className="bk-field"><span>{a("bk_content")}</span>
              <div className="bk-checks">
                {COMPONENTS.map((c) => (
                  <label key={c} className="bk-check">
                    <input type="checkbox" checked={cfg.components.includes(c)} onChange={(e) => {
                      const next = e.target.checked ? [...cfg.components, c] : cfg.components.filter((x) => x !== c);
                      if (next.length) keep({ components: next });
                    }} />
                    <span><b>{a("bk_c_" + c)}</b><small>{a("bk_c_" + c + "_hint")}</small></span>
                  </label>
                ))}
              </div>
            </div>
            <FolderField label={a("bk_folder")} value={cfg.backup_path} onBrowse={() => setPicker("backup")} />
            <p className="bk-summary">{a("bk_keeps", { what: cfg.components.map((c) => a("bk_c_" + c).toLowerCase()).join(" + ") })}</p>
            <div className="bk-actions"><span className="bk-saved" role="status">{saved}</span>
              <button className="btn pri" disabled={running} onClick={() => setAskLevel(true)}><Icon name="layers" size="sm" />{a("bk_now_btn")}</button></div>
          </section>

          <section className="bk-card">
            <header className="bk-card-head">
              <span className="bk-card-ic" aria-hidden="true"><Icon name="repeat" /></span>
              <div><h3>{a("bk_restore")}</h3><p>{a("bk_restore_hint")}</p></div>
            </header>
            <FolderField label={a("bk_folder")} value={rPath} onBrowse={() => setPicker("restore")} />
            <label className="bk-field"><span>{a("bk_type")}</span>
              <select className="inp" value={rType} onChange={(e) => { setRType(e.target.value as "full" | "light"); setRFile(""); }}>
                <option value="full">{a("bk_type_full")}</option><option value="light">{a("bk_type_light")}</option>
              </select>
            </label>
            <label className="bk-field"><span>{a("bk_file")}</span>
              <select className="inp" value={rFile} onChange={(e) => setRFile(e.target.value)}>
                <option value="">{shown.length ? a("bk_file_pick") : a("bk_file_none")}</option>
                {shown.map((f) => (
                  <option key={f.name} value={f.name}>{fmtDateTime(f.created_at)} · {size(f.size)} · {a("bk_origin_" + f.origin)}</option>
                ))}
              </select>
            </label>
            <div className="bk-actions">
              <button className="btn sm" disabled={!rFile} onClick={download} title={a("bk_download_hint")}><Icon name="file" size="sm" />{a("bk_download")}</button>
              <button className="btn sm danger" disabled={!rFile || running} onClick={remove}><Icon name="trash" size="sm" />{a("bk_delete")}</button>
              <span className="grow" />
              <button className="btn pri" disabled={!rFile || running} onClick={openRestore}><Icon name="repeat" size="sm" />{a("bk_restore_btn")}</button>
            </div>
          </section>
        </div>

        <section className="bk-card bk-schedule">
          <header className="bk-card-head">
            <span className="bk-card-ic" aria-hidden="true"><Icon name="clock" /></span>
            <div className="grow"><h3>{a("bk_sched")}</h3><p>{a("bk_sched_hint")}</p></div>
            <label className="tgl bk-switch" htmlFor="bk-enabled">
              <span>{a("bk_enable")}</span>
              <input id="bk-enabled" type="checkbox" role="switch" checked={cfg.enabled} onChange={(e) => edit({ enabled: e.target.checked })} />
              <span className="sw" aria-hidden="true" />
            </label>
          </header>
          {cfg.enabled ? (
            <>
              <div className="bk-grid">
                <label className="bk-field"><span>{a("bk_recurrence")}</span>
                  <select className="inp" value={cfg.recurrence} onChange={(e) => edit({ recurrence: e.target.value as BackupSettings["recurrence"] })}>
                    {["hourly", "every_4_hours", "daily", "weekly", "monthly"].map((r) => <option key={r} value={r}>{a("bk_rec_" + r)}</option>)}
                  </select>
                </label>
                {cfg.recurrence === "weekly" ? (
                  <label className="bk-field"><span>{a("bk_weekday")}</span>
                    <select className="inp" value={cfg.weekly_day} onChange={(e) => edit({ weekly_day: Number(e.target.value) })}>
                      {WEEKDAYS.map((k, i) => <option key={k} value={i}>{a(k)}</option>)}
                    </select>
                  </label>
                ) : null}
                {cfg.recurrence === "monthly" ? (
                  <label className="bk-field"><span>{a("bk_monthday")}</span>
                    <input className="inp" type="number" min={1} max={31} value={cfg.monthly_day} onChange={(e) => edit({ monthly_day: Number(e.target.value) || 1 })} />
                  </label>
                ) : null}
                <label className="bk-field"><span>{a("bk_time")}</span>
                  <input className="inp" type="time" value={cfg.execution_time} onChange={(e) => edit({ execution_time: e.target.value || "03:30" })} />
                </label>
                {lightAllowed ? (
                  <label className="bk-field"><span>{a("bk_light")}</span>
                    <select className="inp" value={cfg.light_backups ? "1" : "0"} onChange={(e) => edit({ light_backups: e.target.value === "1" })}>
                      <option value="0">{a("bk_light_no")}</option><option value="1">{a("bk_light_yes")}</option>
                    </select>
                  </label>
                ) : null}
                {lightAllowed && cfg.light_backups ? (
                  <label className="bk-field"><span>{a("bk_full_day")}</span>
                    <select className="inp" value={cfg.full_backup_day} onChange={(e) => edit({ full_backup_day: Number(e.target.value) })}>
                      {WEEKDAYS.map((k, i) => <option key={k} value={i}>{a(k)}</option>)}
                    </select>
                  </label>
                ) : null}
                <label className="bk-field"><span>{a("bk_keep_days")}</span>
                  <input className="inp" type="number" min={1} max={3650} value={cfg.keep_days} onChange={(e) => edit({ keep_days: Math.max(1, Number(e.target.value) || 1) })} />
                </label>
                <label className="bk-field"><span>{a("bk_keep_weeks")}</span>
                  <input className="inp" type="number" min={0} max={520} value={cfg.keep_weeks} onChange={(e) => edit({ keep_weeks: Math.max(0, Number(e.target.value) || 0) })} />
                </label>
                <label className="bk-field"><span>{a("bk_keep_months")}</span>
                  <input className="inp" type="number" min={0} max={240} value={cfg.keep_months} onChange={(e) => edit({ keep_months: Math.max(0, Number(e.target.value) || 0) })} />
                </label>
              </div>
              <ul className="bk-help">
                <li><b>{a("bk_keep_days")}:</b> {a("bk_help_days", { n: cfg.keep_days })}</li>
                <li><b>{a("bk_keep_weeks")}:</b> {a("bk_help_weeks", { n: cfg.keep_weeks })}</li>
                <li><b>{a("bk_keep_months")}:</b> {a("bk_help_months", { n: cfg.keep_months })}</li>
                <li>{a("bk_help_rest")}</li>
              </ul>
              <p className="bk-summary">{a("bk_plan", { full: plan.fullN, light: plan.lightN, size: s.latest_full || s.latest_light ? size(plan.bytes) : "—" })}</p>
              {cfg.light_backups && lightAllowed ? <p className="muted bk-note">{a("bk_light_note")}</p> : null}
            </>
          ) : null}
          <div className="bk-actions"><span className="grow" /><button className="btn pri" onClick={saveSchedule}>{a("bk_save_sched")}</button></div>
        </section>
        <p className="muted bk-note">{a("bk_where", { root: data.root })}</p>
      </section>

      {task ? (
        <div className={"bk-task " + task.state} role="status">
          <Icon name={task.state === "error" ? "info" : task.kind === "restore" ? "repeat" : "layers"} size="sm" />
          <div className="grow">
            <b>{a(task.kind === "restore" ? "bk_task_restore" : "bk_task_backup")}{task.step ? ` · ${a("bk_step_" + task.step)}` : ""}</b>
            <div className="bk-bar"><span style={{ width: `${Math.round((task.state === "done" ? 1 : task.progress) * 100)}%` }} /></div>
            <small>{task.state === "error" ? task.message : task.state === "done" ? a("bk_task_done") : `${Math.round(task.progress * 100)} %`}</small>
          </div>
          {task.state !== "running" ? <button className="iconbtn" onClick={() => setTask(null)} aria-label={a("close")}><Icon name="x" size="sm" /></button> : null}
        </div>
      ) : null}

      {picker ? (
        <FolderPicker start={picker === "backup" ? cfg.backup_path : rPath} root={data.root} onClose={() => setPicker(null)}
          onPick={(p) => { if (picker === "backup") keep({ backup_path: p }); else { setRPath(p); setRFile(""); } setPicker(null); }} />
      ) : null}

      {askLevel ? createPortal(
        <Modal title={a("bk_level_title")} onClose={() => setAskLevel(false)}>
          <p className="muted" style={{ margin: 0 }}>{a("bk_level_lead")}</p>
          <div className="bk-levels">
            <button className="bk-level" disabled={!cfg.components.includes("database") && !cfg.components.includes("files")} onClick={() => run("full")}>
              <b>{a("bk_level_full")}</b><small>{a("bk_level_full_hint")}</small><small className="muted">{a("bk_latest", { size: size(s.latest_full) })}</small>
            </button>
            <button className="bk-level" disabled={onlyFiles} onClick={() => run("light")}>
              <b>{a("bk_level_light")}</b><small>{a("bk_level_light_hint")}</small><small className="muted">{a("bk_latest", { size: size(s.latest_light) })}</small>
            </button>
          </div>
        </Modal>, document.body) : null}

      {confirm ? <RestoreDialog m={confirm} file={rFile} onClose={() => setConfirm(null)} onRestore={async (parts) => {
        setConfirm(null);
        try { setTask(await api.restoreBackup(rPath, rFile, parts)); } catch (e: any) { toast(e.message, "error"); }
      }} /> : null}
    </>
  );
}

function FolderField({ label, value, onBrowse }: { label: string; value: string; onBrowse: () => void }) {
  return (
    <div className="bk-field"><span>{label}</span>
      <div className="bk-path"><input className="inp" readOnly value={value} title={value} /><button className="btn sm" onClick={onBrowse}><Icon name="search" size="sm" />{a("bk_browse")}</button></div>
    </div>
  );
}

/** Folders of the server's data directory (not of this computer); a new one can be made before choosing it. */
function FolderPicker({ start, root, onClose, onPick }: { start: string; root: string; onClose: () => void; onPick: (p: string) => void }) {
  const [dir, setDir] = useState<{ path: string; parent: string | null; dirs: string[] } | null>(null);
  const [name, setName] = useState("");
  const go = (p: string) => api.backupDirs(p).then(setDir).catch((e) => toast(e.message, "error"));
  useEffect(() => { go(start || root); }, []);
  return createPortal(
    <Modal title={a("bk_pick_title")} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{a("cancel")}</button>
      <button className="btn pri" disabled={!dir} onClick={() => dir && onPick(dir.path)}>{a("bk_pick_this")}</button>
    </>}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{a("bk_pick_hint")}</p>
      <div className="bk-path"><input className="inp" readOnly value={dir?.path || ""} />
        <button className="btn sm" onClick={() => go(root)} title={a("bk_pick_home")}><Icon name="home" size="sm" /></button>
        <button className="btn sm" disabled={!dir?.parent} onClick={() => dir?.parent && go(dir.parent)} title={a("bk_pick_up")}><Icon name="back" size="sm" /></button>
      </div>
      <div className="bk-dirs">
        {dir?.dirs.length ? dir.dirs.map((d) => (
          <button key={d} className="bk-dir" onClick={() => go(`${dir.path}/${d}`)}><Icon name="file" size="sm" />{d}</button>
        )) : <div className="muted bk-dir-none">{a("bk_pick_empty")}</div>}
      </div>
      <form className="bk-path" onSubmit={(e) => { e.preventDefault(); if (dir && name.trim()) api.newBackupDir(dir.path, name.trim()).then((d) => { setDir(d); setName(""); }).catch((er) => toast(er.message, "error")); }}>
        <input className="inp" value={name} placeholder={a("bk_pick_new")} onChange={(e) => setName(e.target.value)} />
        <button className="btn sm" disabled={!name.trim()}><Icon name="plus" size="sm" />{a("add")}</button>
      </form>
    </Modal>, document.body);
}

/** What a restore replaces, chosen part by part, after saying what will be overwritten. */
function RestoreDialog({ m, file, onClose, onRestore }: { m: BackupManifest; file: string; onClose: () => void; onRestore: (parts: string[]) => void }) {
  const [parts, setParts] = useState<string[]>([...(m.has_database ? ["database"] : []), ...(m.has_files ? ["files"] : [])]);
  const [sure, setSure] = useState(false);
  const toggle = (p: string, on: boolean) => setParts((l) => (on ? [...l, p] : l.filter((x) => x !== p)));
  return createPortal(
    <Modal title={a("bk_restore_title")} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{a("cancel")}</button>
      <button className="btn dangerfill" disabled={!parts.length || !sure} onClick={() => onRestore(parts)}>{a("bk_restore_go")}</button>
    </>}>
      <p className="bk-eyebrow">{a("bk_overwrite")}</p>
      <p style={{ margin: 0 }}><b>{file}</b>{m.created_at ? ` · ${fmtDateTime(m.created_at)}` : ""}{m.by ? ` · ${m.by}` : ""}</p>
      <div className="bk-checks">
        <label className={"bk-check" + (m.has_database ? "" : " off")}>
          <input type="checkbox" disabled={!m.has_database} checked={parts.includes("database")} onChange={(e) => toggle("database", e.target.checked)} />
          <span><b>{a("bk_c_database")}</b><small>{m.has_database ? a("bk_r_database", { n: m.table_count }) : a("bk_r_none")}</small></span>
        </label>
        <label className={"bk-check" + (m.has_files ? "" : " off")}>
          <input type="checkbox" disabled={!m.has_files} checked={parts.includes("files")} onChange={(e) => toggle("files", e.target.checked)} />
          <span><b>{a("bk_c_files")}</b><small>{m.has_files ? a("bk_r_files", { n: m.file_count }) : a("bk_r_none")}</small></span>
        </label>
      </div>
      <p className="bk-problem"><Icon name="info" size="sm" />{a("bk_restore_warn")}</p>
      <label className="bk-check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /><span>{a("bk_restore_sure")}</span></label>
    </Modal>, document.body);
}
