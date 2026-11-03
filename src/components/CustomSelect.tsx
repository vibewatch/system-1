"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";

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
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && showSearch) {
      setTimeout(() => searchInputRef.current?.focus(), 20);
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
    >
      {label && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: "0.66rem",
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
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
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
        <div className="cselect-menu" role="listbox">
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

          <div className="cselect-list">
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
                      setOpen(false);
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
