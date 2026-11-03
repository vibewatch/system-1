"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Tooltip } from "./Tooltip";

export function IconButton({ label, icon, tag, tooltip, className = "", ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "title"> & {
  label: string;
  icon: ReactNode;
  tag?: ReactNode;
  tooltip?: ReactNode;
}) {
  return <Tooltip content={tooltip || label}><button {...props} type={props.type || "button"} className={`icon-button ${className}`} aria-label={label}>
    <span className="icon-button-symbol" aria-hidden="true">{icon}</span>
    {tag !== undefined && <span className="icon-button-tag">{tag}</span>}
  </button></Tooltip>;
}
