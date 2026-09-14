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
