/** A swipe down closes a sheet or popover, as in iOS: it follows the finger and closes past a threshold. A touch that
 * starts inside something scrolled down (a list not at its top) scrolls it instead. */
import React, { useRef, useState } from "react";

export function useSwipeDown(onClose: (() => void) | undefined, scrollers = ".epick-page, .epick-body, .menu") {
  const drag = useRef<{ x: number; y: number; ok: boolean } | null>(null);
  const [pull, setPull] = useState(0);
  const onTouchStart = (e: React.TouchEvent) => {
    if (!onClose || e.touches.length !== 1) return;
    const inner = (e.target as HTMLElement).closest(scrollers) as HTMLElement | null;
    drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, ok: !inner || inner.scrollTop <= 0 };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const d = drag.current;
    if (!d || !d.ok) return;
    const dx = e.touches[0].clientX - d.x, dy = e.touches[0].clientY - d.y;
    if (pull === 0 && (dy < 8 || Math.abs(dx) > dy)) {
      if (Math.abs(dx) > 8 || dy < -8) d.ok = false;  // sideways or up: not a close
      return;
    }
    setPull(Math.max(0, dy));
  };
  const onTouchEnd = () => {
    const close = pull > 70;
    drag.current = null;
    setPull(0);
    if (close) onClose?.();
  };
  const style: React.CSSProperties | undefined = pull
    ? { transform: `translateY(${pull}px)`, opacity: Math.max(0.4, 1 - pull / 300), transition: "none" } : undefined;
  return { handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd }, style };
}
