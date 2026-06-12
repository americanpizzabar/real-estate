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
