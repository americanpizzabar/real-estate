"use client";
import React from "react";

export function Card({
  title,
  right,
  children,
  className = "",
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card p-4 ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-3">
          {title && <h3 className="card-title">{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Metric({
  label,
  value,
  sub,
  color,
  emphasize,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-slate-400">{label}</span>
      <span
        className={`tnum font-semibold leading-tight ${emphasize ? "text-2xl" : "text-lg"}`}
        style={color ? { color } : undefined}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-slate-500 mt-0.5">{sub}</span>}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  suffix,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  suffix?: string;
  min?: number;
}) {
  return (
    <label className="block">
      <span className="field-label">
        {label}
        {suffix ? <span className="text-slate-500"> ({suffix})</span> : null}
      </span>
      <input
        type="number"
        className="field-input"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      />
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input
        type="text"
        className="field-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <select
        className="field-input"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-sm text-slate-300"
    >
      <span
        className={`w-9 h-5 rounded-full transition-colors relative ${
          checked ? "bg-accent" : "bg-base-600"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${
            checked ? "left-4" : "left-0.5"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

export function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 bg-base-600 rounded-full overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}
