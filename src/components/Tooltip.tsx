"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function Tooltip({ content, children }: {
  content: React.ReactNode;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const hide = () => { clear(); setOpen(false); };
  const show = () => { clear(); timer.current = setTimeout(() => setOpen(true), 250); };
  const leave = () => { clear(); timer.current = setTimeout(() => setOpen(false), 100); };

  useEffect(() => () => clear(), []);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = anchor.current!.getBoundingClientRect();
      const tooltip = bubble.current!.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(innerWidth - tooltip.width - 8, trigger.left + (trigger.width - tooltip.width) / 2)),
        top: Math.max(8, Math.min(innerHeight - tooltip.height - 8, trigger.top >= tooltip.height + 16 ? trigger.top - tooltip.height - 8 : trigger.bottom + 8)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, content]);

  const describedBy = [children.props["aria-describedby"], open ? id : undefined].filter(Boolean).join(" ") || undefined;
  const host = anchor.current?.closest("dialog[open]") || (typeof document !== "undefined" ? document.body : null);
  return <span ref={anchor} className="tooltip-anchor" onMouseEnter={show} onMouseLeave={leave} onFocusCapture={() => { clear(); setOpen(true); }} onBlurCapture={hide} onClickCapture={hide}>
    {React.cloneElement(children, { "aria-describedby": describedBy })}
    {open && host && createPortal(<div ref={bubble} id={id} role="tooltip" className="custom-tooltip" style={position} onMouseEnter={clear} onMouseLeave={leave}>{content}</div>, host)}
  </span>;
}
