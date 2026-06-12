"use client";
import React from "react";
import {
  type CatalogItem,
  type PropertyStatus,
  STATUS_META,
} from "@/lib/catalog";
import { yen, pct } from "@/lib/format";

const STATUS_ORDER: PropertyStatus[] = ["reviewing", "negotiating", "owned", "passed"];

export function Catalog({
  items,
  onLoad,
  onChangeStatus,
  onDelete,
  onNewIntake,
}: {
  items: CatalogItem[];
  onLoad: (item: CatalogItem) => void;
  onChangeStatus: (id: string, status: PropertyStatus) => void;
  onDelete: (id: string) => void;
  onNewIntake: () => void;
}) {
  const [statusFilter, setStatusFilter] = React.useState<PropertyStatus | "all">("all");
  const [tagFilter, setTagFilter] = React.useState<string | null>(null);

  const allTags = React.useMemo(() => {
    const s = new Set<string>();
    items.forEach((it) => it.tags.forEach((t) => s.add(t)));
    return Array.from(s);
  }, [items]);

  const filtered = items.filter((it) => {
    if (statusFilter !== "all" && it.status !== statusFilter) return false;
    if (tagFilter && !it.tags.includes(tagFilter)) return false;
    return true;
  });

  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const s of STATUS_ORDER) c[s] = items.filter((i) => i.status === s).length;
    return c;
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <FilterChip label={`すべて (${counts.all})`} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
            {STATUS_ORDER.map((s) => (
              <FilterChip
                key={s}
                label={`${STATUS_META[s].label} (${counts[s] ?? 0})`}
                active={statusFilter === s}
                color={STATUS_META[s].color}
                onClick={() => setStatusFilter(s)}
              />
            ))}
          </div>
          <button
            onClick={onNewIntake}
            className="px-3 py-1.5 rounded-md text-xs font-bold bg-accent hover:bg-accent/90 text-white"
          >
            ＋ 物件を取り込む
          </button>
        </div>
        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-3 pt-3 border-t border-base-700">
            <span className="text-[11px] text-slate-500 mr-1">タグ:</span>
            <FilterChip label="解除" active={tagFilter === null} onClick={() => setTagFilter(null)} />
            {allTags.map((t) => (
              <FilterChip key={t} label={t} active={tagFilter === t} onClick={() => setTagFilter(t)} />
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-2">🗂️</div>
          <p className="text-sm text-slate-300">
            {items.length === 0 ? "まだ物件がありません。" : "条件に一致する物件がありません。"}
          </p>
          {items.length === 0 && (
            <button
              onClick={onNewIntake}
              className="mt-4 px-4 py-2 rounded-md text-sm font-bold bg-accent hover:bg-accent/90 text-white"
            >
              📥 最初の物件を取り込む
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((it) => (
            <CatalogCard
              key={it.id}
              item={it}
              onLoad={onLoad}
              onChangeStatus={onChangeStatus}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
        active ? "text-white" : "text-slate-400 border-base-600 hover:text-slate-200"
      }`}
      style={active ? { background: color ?? "#4f9cf9", borderColor: color ?? "#4f9cf9" } : undefined}
    >
      {label}
    </button>
  );
}

function CatalogCard({
  item,
  onLoad,
  onChangeStatus,
  onDelete,
}: {
  item: CatalogItem;
  onLoad: (item: CatalogItem) => void;
  onChangeStatus: (id: string, status: PropertyStatus) => void;
  onDelete: (id: string) => void;
}) {
  const snap = item.snapshot;
  const gradeColor =
    snap?.grade === "S" || snap?.grade === "A" ? "#2dd4a7" : snap?.grade === "B" ? "#f5b14c" : "#f56c6c";
  return (
    <div className="card p-3.5 flex flex-col gap-2.5 hover:border-accent/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-slate-100 truncate">{item.property.name || "（無題物件）"}</h4>
          <p className="text-[11px] text-slate-400 truncate">{item.property.address}</p>
        </div>
        {snap && (
          <div className="text-right shrink-0">
            <div className="tnum text-lg font-bold leading-none" style={{ color: gradeColor }}>
              {snap.score}
            </div>
            <div className="text-[10px]" style={{ color: gradeColor }}>{snap.grade}</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1 text-center">
        <Mini label="価格" value={yen(item.property.price)} />
        <Mini label="表面利回り" value={snap ? pct(snap.grossYieldPct) : "—"} />
        <Mini label="土地値比率" value={snap ? pct(snap.landValueRatio * 100, 0) : "—"} />
      </div>

      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.slice(0, 5).map((t) => (
            <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-base-700 text-slate-300">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-auto pt-1">
        <select
          value={item.status}
          onChange={(e) => onChangeStatus(item.id, e.target.value as PropertyStatus)}
          className="bg-base-900 border border-base-600 rounded-md px-2 py-1 text-[11px] font-semibold"
          style={{ color: STATUS_META[item.status].color }}
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{STATUS_META[s].label}</option>
          ))}
        </select>
        <button
          onClick={() => onLoad(item)}
          className="flex-1 px-2 py-1 rounded-md text-[11px] font-bold bg-accent/90 hover:bg-accent text-white"
        >
          分析を開く
        </button>
        <button
          onClick={() => onDelete(item.id)}
          className="px-2 py-1 rounded-md text-[11px] text-slate-400 hover:text-red-400"
          title="削除"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-base-900 rounded-md py-1">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="tnum text-xs font-semibold text-slate-200">{value}</div>
    </div>
  );
}
