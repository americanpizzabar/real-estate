import type { StructureType } from "./types";

// =============================================================
// リアルオプション分析
// 現況継続だけでなく、更地化売却・用途転換・建替えの価値を比較し、
// 最有効使用（HBU: Highest and Best Use）とオプション価値を提示する。
// =============================================================

/** 構造別 解体費の目安（円/㎡・延床）。 */
const DEMOLITION_UNIT: Record<StructureType, number> = {
  RC: 45_000, SRC: 50_000, S: 40_000, LightS: 30_000, W: 28_000,
};
/** 構造別 新築の再調達（建築費）目安（円/㎡）— 建替え用。 */
const REBUILD_UNIT: Record<StructureType, number> = {
  RC: 320_000, SRC: 340_000, S: 280_000, LightS: 240_000, W: 220_000,
};

export interface RealOptionInput {
  currentNoi: number; // 現況NOI（円/年）
  altNoi?: number | null; // 用途転換後のNOI（賃貸⇔民泊の逆）
  altLabel?: string; // 転換先ラベル
  capRatePct: number; // 還元利回り(%)
  landMarketValue: number; // 実勢土地値（円）
  buildingArea: number; // 延床(㎡)
  landArea: number; // 土地(㎡)
  structure: StructureType;
  floorAreaRatioPct?: number | null; // 容積率(%)
  currentMonthlyRentPerSqm?: number | null; // 現況の㎡あたり月額賃料（建替え収益推定用）
  price: number; // 取得価格（プレミアム算出の基準）
}

export interface OptionStrategy {
  key: string;
  label: string;
  value: number; // 想定実現価値（円）
  detail: string;
  feasible: boolean;
}

export interface RealOptionResult {
  strategies: OptionStrategy[];
  best: OptionStrategy;
  /** 現況継続に対する最有効使用の上乗せ価値（オプション・プレミアム） */
  optionPremium: number;
  /** 取得価格に対する最有効使用価値の比率 */
  hbuVsPricePct: number;
}

export function analyzeRealOptions(i: RealOptionInput): RealOptionResult {
  const cap = i.capRatePct / 100;
  const demolition = Math.round(i.buildingArea * (DEMOLITION_UNIT[i.structure] ?? 40_000));
  const strategies: OptionStrategy[] = [];

  // 1) 現況継続（収益還元）
  const continueValue = cap > 0 && i.currentNoi > 0 ? Math.round(i.currentNoi / cap) : 0;
  strategies.push({
    key: "continue", label: "現況継続（収益還元）", value: continueValue, feasible: continueValue > 0,
    detail: `現況NOI ${man(i.currentNoi)} ÷ Cap ${i.capRatePct}% = ${man(continueValue)}`,
  });

  // 2) 更地化・土地売却
  const landSaleValue = Math.max(0, i.landMarketValue - demolition);
  strategies.push({
    key: "landSale", label: "更地化して土地売却", value: landSaleValue, feasible: i.landMarketValue > 0,
    detail: `実勢土地値 ${man(i.landMarketValue)} − 解体費 ${man(demolition)} = ${man(landSaleValue)}`,
  });

  // 3) 用途転換（賃貸⇔民泊）
  if (i.altNoi != null && i.altNoi > 0 && cap > 0) {
    const convertValue = Math.round(i.altNoi / cap);
    strategies.push({
      key: "convert", label: `用途転換（${i.altLabel ?? "他用途"}）`, value: convertValue, feasible: true,
      detail: `転換後NOI ${man(i.altNoi)} ÷ Cap ${i.capRatePct}% = ${man(convertValue)}`,
    });
  }

  // 4) 建替え（容積率いっぱいの新築ポテンシャル）
  if (i.floorAreaRatioPct && i.floorAreaRatioPct > 0 && i.landArea > 0 && cap > 0) {
    const maxFloor = Math.round(i.landArea * (i.floorAreaRatioPct / 100));
    const rentPerSqm = i.currentMonthlyRentPerSqm && i.currentMonthlyRentPerSqm > 0
      ? i.currentMonthlyRentPerSqm : 2_800; // ㎡月額の目安
    const newGpi = maxFloor * rentPerSqm * 12;
    const newNoi = newGpi * 0.75; // 空室・運営費控除後の目安
    const buildCost = maxFloor * (REBUILD_UNIT[i.structure] ?? 300_000);
    const rebuildValue = Math.round(newNoi / cap - buildCost - demolition);
    strategies.push({
      key: "rebuild", label: "建替え（容積率フル活用）", value: rebuildValue, feasible: rebuildValue > 0,
      detail: `新築NOI ${man(newNoi)} ÷ Cap − 建築費 ${man(buildCost)}(延床${maxFloor}㎡) − 解体 ${man(demolition)} = ${man(rebuildValue)}`,
    });
  }

  const feasible = strategies.filter((s) => s.feasible);
  const best = (feasible.length ? feasible : strategies).reduce((a, b) => (b.value > a.value ? b : a));
  return {
    strategies,
    best,
    optionPremium: best.value - continueValue,
    hbuVsPricePct: i.price > 0 ? (best.value / i.price) * 100 : 0,
  };
}

function man(v: number): string {
  const s = v < 0 ? "-" : "";
  const a = Math.abs(Math.round(v));
  if (a >= 100_000_000) return `${s}${(a / 100_000_000).toFixed(2)}億円`;
  return `${s}${Math.round(a / 10_000).toLocaleString()}万円`;
}
