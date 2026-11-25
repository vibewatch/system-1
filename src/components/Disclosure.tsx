"use client";

import React, { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export function Disclosure({ label, children, className = "" }: {
  label: string; children: ReactNode; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className={`disclosure ${open ? "open" : ""} ${className}`}>
    <button type="button" className="disclosure-trigger" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <ChevronRight size={13} aria-hidden="true" />{label}
    </button>
    <div id={id} className="disclosure-panel" hidden={!open}>{open && children}</div>
  </div>;
}
