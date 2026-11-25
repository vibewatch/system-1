"use client";

import React, { useState, useRef, useEffect, useMemo, useId } from "react";

export interface SelectOption {
  value: string | number;
  label: string;
  badge?: string;
  badgeType?: "d1" | "info" | "custom" | "neutral";
  badgeTone?: "d1" | "info" | "custom" | "neutral";
  category?: string;
  description?: string;
}

interface CustomSelectProps {
  value: string | number;
  onChange: (value: string) => void;
  options: SelectOption[];
  label?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  placeholder?: string;
  searchable?: boolean;
  minWidth?: number | string;
  className?: string;
}

export function CustomSelect({
  value,
  onChange,
  options,
  label,
  size = "md",
  disabled = false,
  placeholder = "Select option…",
  searchable,
  minWidth = 180,
  className = "",
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listId = useId();
  const focusOption = (index: number) => {
    const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    if (buttons?.length) buttons[(index + buttons.length) % buttons.length].focus();
  };
  const close = () => { setOpen(false); triggerRef.current?.focus(); };

  const selectedOption = useMemo(
    () => options.find((o) => String(o.value) === String(value)),
    [options, value]
  );

  const showSearch = searchable ?? options.length > 6;

  const filteredOptions = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.category && o.category.toLowerCase().includes(q)) ||
        (o.badge && o.badge.toLowerCase().includes(q)) ||
        (o.description && o.description.toLowerCase().includes(q))
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (ev: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(ev.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    const container = containerRef.current;
    container?.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      container?.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && showSearch) {
      const timer = setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    } else if (open) {
      focusOption(Math.max(0, filteredOptions.findIndex((option) => String(option.value) === String(value))));
    } else if (!open) {
      setQuery("");
    }
  }, [open, showSearch]);

  return (
    <div
      ref={containerRef}
      className={`cselect-root ${disabled ? "disabled" : ""} ${
        size === "sm" ? "cselect-sm" : ""
      } ${className}`}
      style={{ minWidth }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        if (!open) {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
          return;
        }
        const options = [...(containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || [])];
        const index = options.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0 && (event.key === "Home" || event.key === "End")) return;
        event.preventDefault();
        focusOption(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
          : index < 0 ? (event.key === "ArrowUp" ? options.length - 1 : 0)
          : index + (event.key === "ArrowUp" ? -1 : 1));
      }}
    >
      {label && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: "var(--font-xs)",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            marginBottom: 4,
          }}
        >
          {label}
        </div>
      )}
      <button
        type="button"
        className={`cselect-trigger ${open ? "open" : ""}`}
        ref={triggerRef}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label || selectedOption?.label || placeholder}
      >
        <span className="cselect-value">
          {selectedOption?.badge && (
            <span
              className={`cselect-badge ${
                selectedOption.badgeTone ||
                selectedOption.badgeType ||
                "neutral"
              }`}
            >
              {selectedOption.badge}
            </span>
          )}
          <span className="cselect-label">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </span>
        <svg
          className={`cselect-chevron ${open ? "rot" : ""}`}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="cselect-menu">
          {showSearch && (
            <div className="cselect-search-wrap">
              <input
                ref={searchInputRef}
                type="text"
                className="cselect-search"
                placeholder="Filter options…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}

          <div className="cselect-list" id={listId} role="listbox" aria-label={label || "Options"}>
            {filteredOptions.length === 0 ? (
              <div className="cselect-empty">No matching options</div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = String(opt.value) === String(value);
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`cselect-option ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      onChange(String(opt.value));
                      close();
                    }}
                  >
                    <div className="cselect-opt-main">
                      <div className="cselect-opt-top">
                        {opt.badge && (
                          <span
                            className={`cselect-badge ${
                              opt.badgeTone || opt.badgeType || "neutral"
                            }`}
                          >
                            {opt.badge}
                          </span>
                        )}
                        <span className="cselect-opt-title">{opt.label}</span>
                        {opt.category && (
                          <span className="cselect-opt-cat">
                            {opt.category}
                          </span>
                        )}
                      </div>
                      {opt.description && (
                        <div className="cselect-opt-desc">
                          {opt.description}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <span className="cselect-check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
