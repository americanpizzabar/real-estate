import type { PropertyInput } from "@/lib/calc/types";
import type { ExtractedFields } from "@/lib/external/extraction";

// =============================================================
// 物件カタログ（名寄せ）— localStorage 永続化
// 取り込んだ物件をタグ付け・ステータス管理し、ダッシュボードへ
// 即ロードできる「マイ資産カタログ」を提供する。
// （将来Supabase等のDBに差し替え可能なよう薄いCRUDで分離）
// =============================================================

export type PropertyStatus = "reviewing" | "negotiating" | "passed" | "owned";

export const STATUS_META: Record<PropertyStatus, { label: string; color: string }> = {
  reviewing: { label: "検討中", color: "#4f9cf9" },
  negotiating: { label: "打診中", color: "#f5b14c" },
  passed: { label: "見送り", color: "#94a3b8" },
  owned: { label: "購入済み", color: "#2dd4a7" },
};

/** カタログに保存する追加属性（PropertyInput に無い抽出項目）。 */
export type CatalogExtras = Pick<
  ExtractedFields,
  | "floors"
  | "grossYieldPct"
  | "annualRentIncome"
  | "nearestStation"
  | "stationWalkMin"
  | "landRightType"
  | "zoningUse"
  | "buildingCoveragePct"
  | "floorAreaRatioPct"
>;

export interface CatalogSnapshot {
  landValueRatio: number;
  grossYieldPct: number;
  score: number;
  grade: string;
  // ポートフォリオ集計用の財務スナップショット（任意・後方互換）
  price?: number;
  noi?: number;
  netYieldPct?: number;
  btcf?: number; // 初年度税引前CF
  selfFunds?: number;
  loanAmount?: number;
  annualDebtService?: number;
  dscr?: number;
}

export interface CatalogItem {
  id: string;
  createdAt: number;
  status: PropertyStatus;
  property: PropertyInput;
  extras: CatalogExtras;
  tags: string[];
  sourceName?: string;
  snapshot?: CatalogSnapshot;
}

// =============================================================
// ポートフォリオ集計（カタログ横断）
// =============================================================
export interface PortfolioSummary {
  count: number;
  totalPrice: number;
  totalLoan: number;
  totalSelfFunds: number;
  totalNoi: number;
  totalBtcf: number; // 初年度税引前CF合計
  totalDebtService: number;
  overallLtvPct: number; // 総借入 / 総価格
  weightedGrossYieldPct: number; // 価格加重の表面利回り
  weightedNetYieldPct: number; // 価格加重の実質利回り
  portfolioDscr: number; // ΣNOI / Σ返済
  avgScore: number;
  avgLandValueRatio: number;
  byStatus: Record<PropertyStatus, number>;
  byKind: { kind: string; count: number; price: number }[];
  /** 集計に財務データが揃っている件数（古いスナップショットは除外） */
  withFinancials: number;
}

/** カタログからポートフォリオ指標を集計する。 */
export function summarizePortfolio(items: CatalogItem[]): PortfolioSummary {
  const byStatus: Record<PropertyStatus, number> = {
    reviewing: 0, negotiating: 0, passed: 0, owned: 0,
  };
  const kindMap = new Map<string, { count: number; price: number }>();

  let totalPrice = 0, totalLoan = 0, totalSelfFunds = 0, totalNoi = 0, totalBtcf = 0, totalDebtService = 0;
  let wYieldNum = 0, wNetNum = 0, wPriceForYield = 0;
  let scoreSum = 0, scoreCount = 0, lvrSum = 0, lvrCount = 0;
  let withFinancials = 0;

  for (const it of items) {
    byStatus[it.status] = (byStatus[it.status] ?? 0) + 1;
    const kind = it.property.propertyKind ?? "その他";
    const km = kindMap.get(kind) ?? { count: 0, price: 0 };
    km.count += 1;
    km.price += it.property.price || 0;
    kindMap.set(kind, km);

    const s = it.snapshot;
    if (s) {
      if (s.score != null) { scoreSum += s.score; scoreCount++; }
      if (s.landValueRatio != null) { lvrSum += s.landValueRatio; lvrCount++; }
    }
    // 財務集計は price+loan+noi が揃うものだけ
    if (s && s.price != null && s.loanAmount != null && s.noi != null) {
      withFinancials++;
      totalPrice += s.price;
      totalLoan += s.loanAmount;
      totalSelfFunds += s.selfFunds ?? 0;
      totalNoi += s.noi;
      totalBtcf += s.btcf ?? 0;
      totalDebtService += s.annualDebtService ?? 0;
      wPriceForYield += s.price;
      wYieldNum += (s.grossYieldPct ?? 0) * s.price;
      wNetNum += (s.netYieldPct ?? 0) * s.price;
    }
  }

  return {
    count: items.length,
    totalPrice, totalLoan, totalSelfFunds, totalNoi, totalBtcf, totalDebtService,
    overallLtvPct: totalPrice > 0 ? (totalLoan / totalPrice) * 100 : 0,
    weightedGrossYieldPct: wPriceForYield > 0 ? wYieldNum / wPriceForYield : 0,
    weightedNetYieldPct: wPriceForYield > 0 ? wNetNum / wPriceForYield : 0,
    portfolioDscr: totalDebtService > 0 ? totalNoi / totalDebtService : Infinity,
    avgScore: scoreCount > 0 ? scoreSum / scoreCount : 0,
    avgLandValueRatio: lvrCount > 0 ? lvrSum / lvrCount : 0,
    byStatus,
    byKind: [...kindMap.entries()].map(([kind, v]) => ({ kind, count: v.count, price: v.price })).sort((a, b) => b.price - a.price),
    withFinancials,
  };
}

// =============================================================
// ポートフォリオ最適化（集中リスク・分散・提案）
// =============================================================
export interface PortfolioOptimization {
  hhiKind: number; // 種別の集中度(HHI, 0-1)
  hhiArea: number; // エリア(市区町村)の集中度
  diversificationScore: number; // 分散スコア(0-100, 高いほど分散)
  topConcentration: { label: string; sharePct: number } | null; // 最大集中先
  riskReturn: { name: string; returnPct: number; riskPct: number; price: number }[];
  suggestions: string[];
}

/** 住所から市区町村レベルのエリアキーを抽出（都道府県＋市区郡＋町村/区）。 */
function areaKey(address: string): string {
  if (!address) return "不明";
  const m = address.match(/(.+?[都道府県])?(.+?[市区郡])(.+?[区町村])?/);
  if (m) return `${m[1] ?? ""}${m[2] ?? ""}${m[3] ?? ""}`.slice(0, 20) || address.slice(0, 12);
  return address.slice(0, 12);
}

function hhi(shares: number[]): number {
  const total = shares.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return shares.reduce((a, s) => a + (s / total) ** 2, 0);
}

/** カタログのポートフォリオ最適化分析。 */
export function optimizePortfolio(items: CatalogItem[]): PortfolioOptimization {
  const kindMap = new Map<string, number>();
  const areaMap = new Map<string, number>();
  const riskReturn: PortfolioOptimization["riskReturn"] = [];

  for (const it of items) {
    const price = it.property.price || 0;
    const kind = it.property.propertyKind ?? "その他";
    kindMap.set(kind, (kindMap.get(kind) ?? 0) + price);
    const ak = areaKey(it.property.address);
    areaMap.set(ak, (areaMap.get(ak) ?? 0) + price);

    const s = it.snapshot;
    if (s && price > 0) {
      // リターン=実質利回り、リスク=LTV(高いほどリスク)と土地値比率の逆数を合成
      const ltv = s.loanAmount != null && s.price ? (s.loanAmount / s.price) * 100 : 60;
      const landSafety = (s.landValueRatio ?? 0.5) * 100;
      const risk = Math.max(0, Math.min(100, ltv * 0.7 + (100 - landSafety) * 0.3));
      riskReturn.push({
        name: it.property.name || "物件",
        returnPct: s.netYieldPct ?? s.grossYieldPct ?? 0,
        riskPct: Math.round(risk),
        price,
      });
    }
  }

  const hhiKind = hhi([...kindMap.values()]);
  const hhiArea = hhi([...areaMap.values()]);
  // 分散スコア: 種別・エリアの集中度を平均し反転（件数1は低評価）
  const base = 1 - (hhiKind + hhiArea) / 2;
  const countFactor = Math.min(1, items.length / 5); // 5件以上で満点係数
  const diversificationScore = Math.round(base * countFactor * 100);

  // 最大集中先
  const allShares = [
    ...[...kindMap.entries()].map(([label, v]) => ({ label: `種別:${label}`, v })),
    ...[...areaMap.entries()].map(([label, v]) => ({ label: `エリア:${label}`, v })),
  ];
  const totalPrice = items.reduce((a, it) => a + (it.property.price || 0), 0);
  const top = allShares.sort((a, b) => b.v - a.v)[0];
  const topConcentration = top && totalPrice > 0
    ? { label: top.label, sharePct: Math.round((top.v / totalPrice) * 100) }
    : null;

  // 提案
  const suggestions: string[] = [];
  if (items.length < 3) suggestions.push("物件数が少なく分散が効いていません。異なるエリア・種別の追加で価格変動・空室リスクを平準化できます。");
  if (hhiKind >= 0.5) suggestions.push(`種別が「${[...kindMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]}」に集中。用途分散（例: 区分＋一棟、賃貸＋民泊）でリスク低減を。`);
  if (hhiArea >= 0.5) suggestions.push(`エリアが集中しています。災害・地域需要リスクの分散のため別商圏の物件検討を。`);
  if (topConcentration && topConcentration.sharePct >= 50) suggestions.push(`${topConcentration.label}が全体の${topConcentration.sharePct}%を占め集中リスク大。1物件・1エリアへの依存を下げましょう。`);
  const highRisk = riskReturn.filter((r) => r.riskPct >= 75);
  if (highRisk.length) suggestions.push(`高リスク（高LTV/低土地値）物件が${highRisk.length}件。自己資金厚めの安全資産で全体のリスクを中和すると安定します。`);
  if (suggestions.length === 0) suggestions.push("種別・エリアともに程よく分散しています。現在のリスク配分は良好です。");

  return { hhiKind, hhiArea, diversificationScore, topConcentration, riskReturn, suggestions };
}

const KEY = "fudosan_catalog_v1";

export function loadCatalog(): CatalogItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as CatalogItem[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persist(items: CatalogItem[]) {
  window.localStorage.setItem(KEY, JSON.stringify(items));
}

export function upsertItem(item: CatalogItem): CatalogItem[] {
  const items = loadCatalog();
  const idx = items.findIndex((x) => x.id === item.id);
  if (idx >= 0) items[idx] = item;
  else items.unshift(item);
  persist(items);
  return items;
}

export function updateItem(id: string, patch: Partial<CatalogItem>): CatalogItem[] {
  const items = loadCatalog().map((x) => (x.id === id ? { ...x, ...patch } : x));
  persist(items);
  return items;
}

export function deleteItem(id: string): CatalogItem[] {
  const items = loadCatalog().filter((x) => x.id !== id);
  persist(items);
  return items;
}

export function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * AI自動タグ付け。物件属性・抽出値・判定スナップショットから特徴タグを生成。
 */
export function generateTags(
  p: PropertyInput,
  extras: CatalogExtras,
  snap: CatalogSnapshot | undefined
): string[] {
  const tags: string[] = [];

  // 構造・規模
  if (p.structure === "RC" || p.structure === "SRC") tags.push("RC/SRC");
  if (p.structure === "W") tags.push("木造");
  if (extras.floors && extras.floors >= 3) tags.push(`${extras.floors}階建`);
  if (p.buildingArea >= 200) tags.push("一棟規模");

  // 立地
  if (extras.stationWalkMin != null) {
    if (extras.stationWalkMin <= 5) tags.push("駅徒歩5分以内");
    else if (extras.stationWalkMin <= 10) tags.push("駅徒歩10分以内");
  }

  // 収益性
  const gy = snap?.grossYieldPct ?? extras.grossYieldPct ?? 0;
  if (gy >= 10) tags.push("超高利回り");
  else if (gy >= 8) tags.push("高利回り");

  // 資産性
  if (snap) {
    if (snap.landValueRatio >= 0.7) tags.push("土地値比率70%以上");
    else if (snap.landValueRatio >= 0.5) tags.push("土地値比率50%以上");
    if (snap.grade === "S" || snap.grade === "A") tags.push(`高スコア(${snap.grade})`);
  }

  // 民泊ポテンシャル（駅近 × 都心系の簡易ヒューリスティック）
  const minpakuArea = /中央区|新宿|渋谷|台東|浅草|京都|大阪|難波|博多|那覇|札幌|横浜|港区/.test(
    p.address
  );
  if (minpakuArea && (extras.stationWalkMin ?? 99) <= 10) tags.push("民泊ポテンシャル高");

  // 築年
  const age = new Date().getFullYear() - p.builtYear;
  if (age <= 5) tags.push("築浅");
  else if (age >= 35) tags.push("築古");

  return Array.from(new Set(tags));
}
