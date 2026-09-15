"use client";
import React from "react";
import {
  type CatalogItem,
  type PropertyStatus,
  STATUS_META,
  summarizePortfolio,
  optimizePortfolio,
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
      {items.length > 0 && <PortfolioPanel items={items} />}
      {items.length >= 2 && <PortfolioOptimizationPanel items={items} />}

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

// ===================== ポートフォリオ集計 =====================
function PortfolioPanel({ items }: { items: CatalogItem[] }) {
  const s = summarizePortfolio(items);
  const dscrColor = !isFinite(s.portfolioDscr) || s.portfolioDscr >= 1.3 ? "#2dd4a7" : s.portfolioDscr >= 1.1 ? "#f5b14c" : "#f56c6c";
  const ltvColor = s.overallLtvPct <= 70 ? "#2dd4a7" : s.overallLtvPct <= 90 ? "#f5b14c" : "#f56c6c";
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="card-title">📊 ポートフォリオ集計（{s.count}件）</h3>
        {s.withFinancials < s.count && (
          <span className="text-[10px] text-slate-500">財務集計は{s.withFinancials}件（保存し直すと反映）</span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <PMetric label="合計投資額(価格)" value={yen(s.totalPrice)} emphasize />
        <PMetric label="合計借入" value={yen(s.totalLoan)} />
        <PMetric label="合計自己資金" value={yen(s.totalSelfFunds)} />
        <PMetric label="全体LTV" value={pct(s.overallLtvPct, 0)} color={ltvColor} />
        <PMetric label="合計NOI(年)" value={yen(s.totalNoi)} color="#4f9cf9" />
        <PMetric label="合計税引前CF(年)" value={yen(s.totalBtcf)} color={s.totalBtcf < 0 ? "#f56c6c" : "#2dd4a7"} />
        <PMetric label="加重 表面利回り" value={pct(s.weightedGrossYieldPct)} />
        <PMetric label="加重 実質利回り" value={pct(s.weightedNetYieldPct)} />
        <PMetric label="ポートフォリオDSCR" value={isFinite(s.portfolioDscr) ? s.portfolioDscr.toFixed(2) : "—"} color={dscrColor} />
        <PMetric label="平均スコア" value={s.avgScore.toFixed(0)} />
        <PMetric label="平均 土地値比率" value={pct(s.avgLandValueRatio * 100, 0)} />
        <PMetric label="購入済み" value={`${s.byStatus.owned}件`} color="#2dd4a7" />
      </div>
      {s.byKind.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-base-700">
          <span className="text-[11px] text-slate-500 mr-1">種別構成:</span>
          {s.byKind.map((k) => (
            <span key={k.kind} className="text-[11px] bg-base-900 border border-base-600 rounded-full px-2.5 py-1 text-slate-300">
              {k.kind} {k.count}件 · {yen(k.price)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PMetric({ label, value, color, emphasize }: { label: string; value: string; color?: string; emphasize?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-slate-400 truncate">{label}</div>
      <div className={`tnum font-bold ${emphasize ? "text-lg" : "text-base"}`} style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

// ===================== ポートフォリオ最適化 (#12) =====================
function PortfolioOptimizationPanel({ items }: { items: CatalogItem[] }) {
  const o = optimizePortfolio(items);
  const divColor = o.diversificationScore >= 60 ? "#2dd4a7" : o.diversificationScore >= 35 ? "#f5b14c" : "#f56c6c";
  const maxRet = Math.max(10, ...o.riskReturn.map((r) => r.returnPct));
  const maxPrice = Math.max(1, ...o.riskReturn.map((r) => r.price));
  return (
    <div className="card p-4">
      <h3 className="card-title mb-3">🧮 ポートフォリオ最適化（集中リスク・分散）</h3>
      <div className="grid grid-cols-12 gap-4">
        {/* 指標＋提案 */}
        <div className="col-span-12 lg:col-span-5 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] text-slate-400">分散スコア</div>
              <div className="tnum text-3xl font-bold" style={{ color: divColor }}>{o.diversificationScore}</div>
              <div className="text-[10px] text-slate-500">100=よく分散</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">種別集中(HHI)</div>
              <div className="tnum text-lg font-semibold">{o.hhiKind.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">エリア集中(HHI)</div>
              <div className="tnum text-lg font-semibold">{o.hhiArea.toFixed(2)}</div>
            </div>
          </div>
          {o.topConcentration && (
            <div className="text-[11px] text-slate-400">
              最大集中: <span className="text-slate-200">{o.topConcentration.label}</span>（{o.topConcentration.sharePct}%）
            </div>
          )}
          <div className="space-y-1.5">
            <div className="text-[11px] text-slate-400">最適化の提案</div>
            {o.suggestions.map((s, i) => (
              <div key={i} className="text-[12px] text-slate-300 leading-relaxed flex gap-1.5">
                <span className="text-accent">›</span><span>{s}</span>
              </div>
            ))}
          </div>
        </div>
        {/* リスク・リターン散布図（CSS） */}
        <div className="col-span-12 lg:col-span-7">
          <div className="text-[11px] text-slate-400 mb-1">リスク・リターン分布（横=リスク, 縦=実質利回り, 大きさ=価格）</div>
          <div className="relative bg-base-900 border border-base-600 rounded-lg" style={{ height: 220 }}>
            {/* グリッド軸ラベル */}
            <span className="absolute left-1 top-1 text-[9px] text-slate-500">高利回り</span>
            <span className="absolute left-1 bottom-1 text-[9px] text-slate-500">低利回り</span>
            <span className="absolute right-1 bottom-1 text-[9px] text-slate-500">高リスク→</span>
            <span className="absolute left-1 bottom-1 text-[9px] text-slate-500" style={{ transform: "translateX(0)" }}></span>
            {o.riskReturn.map((r, i) => {
              const size = 10 + Math.round((r.price / maxPrice) * 26);
              const left = Math.max(2, Math.min(96, r.riskPct));
              const bottom = Math.max(2, Math.min(94, (r.returnPct / maxRet) * 100));
              return (
                <div
                  key={i}
                  className="absolute rounded-full border border-white/40 flex items-center justify-center"
                  style={{
                    left: `${left}%`, bottom: `${bottom}%`, width: size, height: size,
                    marginLeft: -size / 2, marginBottom: -size / 2,
                    background: r.riskPct >= 75 ? "#f56c6c99" : r.returnPct >= 6 ? "#2dd4a799" : "#4f9cf999",
                  }}
                  title={`${r.name}: 利回り${r.returnPct.toFixed(1)}% / リスク${r.riskPct}`}
                />
              );
            })}
          </div>
          <p className="text-[10px] text-slate-500 mt-1">左上（低リスク・高利回り）が理想。右下（高リスク・低利回り）は要見直し。</p>
        </div>
      </div>
    </div>
  );
}
