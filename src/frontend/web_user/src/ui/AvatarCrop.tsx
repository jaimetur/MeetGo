/** Choosing the part of a photo that becomes my avatar: the photo moves under a round frame (drag it), zooms with the
 * slider, the mouse wheel or two fingers, and only that square goes up (512×512 JPEG). */
import React, { useEffect, useRef, useState } from "react";
import { t } from "@lang";
import { Modal } from "./common";

const VIEW = 280;  // the frame on screen, in CSS pixels
const OUT = 512;   // the avatar uploaded
const MAX_ZOOM = 4;

export function AvatarCrop({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (cropped: File) => void }) {
  const [url, setUrl] = useState("");
  const img = useRef<HTMLImageElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  // made and freed by the same effect (React may run it twice: a URL freed by the first run would show nothing)
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const base = nat ? Math.max(VIEW / nat.w, VIEW / nat.h) : 1;  // the photo just covers the frame
  const s = base * zoom;
  // the photo always covers the frame: it cannot move further than its edges
  const clamp = (o: { x: number; y: number }, z = zoom) => {
    if (!nat) return o;
    const mx = Math.max(0, (nat.w * base * z - VIEW) / 2), my = Math.max(0, (nat.h * base * z - VIEW) / 2);
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  };
  const setZ = (z: number) => {
    const nz = Math.min(MAX_ZOOM, Math.max(1, z));
    setZoom(nz);
    setOff((o) => clamp(o, nz));
  };

  function down(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }
  function move(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      setZ(pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / (pinch.current.dist || 1));
    } else if (pointers.current.size === 1) {
      setOff((o) => clamp({ x: o.x + e.clientX - prev.x, y: o.y + e.clientY - prev.y }));
    }
  }
  function up(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function done() {
    if (!nat || !img.current) return;
    const left = (VIEW - nat.w * s) / 2 + off.x, top = (VIEW - nat.h * s) / 2 + off.y;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = OUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img.current, -left / s, -top / s, VIEW / s, VIEW / s, 0, 0, OUT, OUT);
    canvas.toBlob((blob) => blob && onDone(new File([blob], "avatar.jpg", { type: "image/jpeg" })), "image/jpeg", 0.9);
  }

  return (
    <Modal title={t("ui_avatar_crop_title")} onClose={onCancel} footer={<>
      <button className="btn" onClick={onCancel}>{t("ui_cancel")}</button>
      <button className="btn pri" disabled={!nat} onClick={done}>{t("ui_avatar_crop_use")}</button>
    </>}>
      <div className="avcrop" style={{ width: VIEW, height: VIEW }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onWheel={(e) => setZ(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}>
        {url ? <img ref={img} src={url} alt="" draggable={false} onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={nat ? { width: nat.w * s, height: nat.h * s, transform: `translate(${(VIEW - nat.w * s) / 2 + off.x}px, ${(VIEW - nat.h * s) / 2 + off.y}px)` } : { opacity: 0 }} /> : null}
        <span className="avcrop-ring" aria-hidden="true" />
      </div>
      <label className="fld avcrop-zoom">{t("ui_avatar_crop_zoom")}
        <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => setZ(Number(e.target.value))} />
      </label>
      <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: "center" }}>{t("ui_avatar_crop_hint")}</p>
    </Modal>
  );
}
