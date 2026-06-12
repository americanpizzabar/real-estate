import type { StructureType } from "./types";

// =============================================================
// プロ基準の各種定数・係数
// 数値は一般的なプロ実務での目安。UIから上書き可能にする前提。
// =============================================================

/** 構造別 法定耐用年数（住宅用途）。 */
export const LEGAL_LIFESPAN: Record<StructureType, number> = {
  RC: 47,
  SRC: 47,
  S: 34, // 重量鉄骨（肉厚4mm超）目安
  LightS: 19, // 軽量鉄骨
  W: 22, // 木造
};

/**
 * 構造別 再調達原価の目安単価（円/㎡）。
 * 昨今の建築資材高騰を反映した新しめの相場感（2024-2025想定）。
 * 実務では地域・グレードで上下するため UI で調整可能にする。
 */
export const REPLACEMENT_UNIT_COST: Record<StructureType, number> = {
  RC: 280_000,
  SRC: 300_000,
  S: 240_000,
  LightS: 200_000,
  W: 180_000,
};

/** 構造別ラベル（日本語表示用）。 */
export const STRUCTURE_LABEL: Record<StructureType, string> = {
  RC: "RC造（鉄筋コンクリート）",
  SRC: "SRC造（鉄骨鉄筋コンクリート）",
  S: "S造（重量鉄骨）",
  LightS: "軽量鉄骨造",
  W: "木造",
};

/**
 * 路線価→実勢流動性価格への補正倍率。
 * 路線価は公示地価の約80%水準のため、実勢は路線価の1.15〜1.25倍が目安。
 */
export const LIQUIDITY_MULTIPLIER = 1.18;

/** 路線価から固定資産税評価額（土地）を推定する係数（路線価≒公示の80%, 固評≒公示の70%）。 */
export const LAND_FIXED_ASSET_FACTOR = 0.875; // 0.70 / 0.80

/** 不動産取得税率（住宅・土地特例考慮の簡易値）。 */
export const ACQUISITION_TAX_RATE = 0.03;

/** 登録免許税率（所有権移転・土地建物の簡易合算目安）。 */
export const REGISTRATION_TAX_RATE_LAND = 0.015; // 土地（軽減税率）
export const REGISTRATION_TAX_RATE_BUILDING = 0.02; // 建物（本則）

/** 概算の所得税＋住民税の実効税率（個人・課税所得帯による）。UIで変更可。 */
export const DEFAULT_EFFECTIVE_TAX_RATE = 0.33;

/** 建物割合の推定（価格按分が無い場合のデフォルト、構造別の目安）。 */
export const DEFAULT_BUILDING_RATIO: Record<StructureType, number> = {
  RC: 0.45,
  SRC: 0.45,
  S: 0.4,
  LightS: 0.35,
  W: 0.3,
};
