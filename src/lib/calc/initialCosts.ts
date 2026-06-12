import type { PropertyInput, InitialCosts, IncomeMode } from "./types";
import {
  ACQUISITION_TAX_RATE,
  REGISTRATION_TAX_RATE_LAND,
  REGISTRATION_TAX_RATE_BUILDING,
  LAND_FIXED_ASSET_FACTOR,
  DEFAULT_BUILDING_RATIO,
} from "./constants";

// =============================================================
// 初期費用（諸経費）の自動概算
// プロ基準の項目を物件価格・評価額から自動プロット。
// 民泊モードでは旅館業申請・家具家電等を加算。
// =============================================================

/** 仲介手数料（速算式: 3%+6万、税込）。 */
export function brokerageFee(price: number): number {
  if (price <= 0) return 0;
  // 速算式は売買価格400万超を前提とした簡易版
  return Math.round((price * 0.03 + 60_000) * 1.1);
}

export interface InitialCostOptions {
  /** 融資額（融資手数料の算出に使用） */
  loanAmount: number;
  /** 融資手数料率（対融資額、%）。一般に2.2%前後。 */
  loanFeeRatePct?: number;
  /** 火災・地震保険（円、5年一括等の総額） */
  insurance?: number;
  /** 固都税清算金（円） */
  settlement?: number;
  /** 民泊初期費用の上書き */
  minpaku?: {
    licenseApplication?: number;
    renovation?: number;
    furniture?: number;
    infrastructure?: number;
  };
  /** その他予備費（円） */
  other?: number;
}

/** 建物・土地の固定資産税評価額を推定（指定が無い場合）。 */
function estimateFixedAssetValues(p: PropertyInput): {
  land: number;
  building: number;
} {
  let land = p.fixedAssetValueLand ?? 0;
  let building = p.fixedAssetValueBuilding ?? 0;

  if (land <= 0) {
    if (p.rosenkaPerSqm > 0) {
      // 路線価 → 固定資産税評価額（土地）の推定
      land = Math.round(p.rosenkaPerSqm * p.landArea * LAND_FIXED_ASSET_FACTOR);
    } else {
      // 路線価が無い場合は価格按分で推定
      const buildingRatio = DEFAULT_BUILDING_RATIO[p.structure];
      land = Math.round(p.price * (1 - buildingRatio) * 0.7);
    }
  }

  if (building <= 0) {
    const buildingRatio = DEFAULT_BUILDING_RATIO[p.structure];
    // 建物の固評は再調達原価の60%前後を目安に、価格按分から推定
    building = Math.round(p.price * buildingRatio * 0.6);
  }

  return { land, building };
}

/**
 * 初期費用を自動概算する。
 */
export function calcInitialCosts(
  p: PropertyInput,
  mode: IncomeMode,
  opts: InitialCostOptions
): InitialCosts {
  const { land, building } = estimateFixedAssetValues(p);

  const brokerage = brokerageFee(p.price);
  const registrationTax = Math.round(
    land * REGISTRATION_TAX_RATE_LAND + building * REGISTRATION_TAX_RATE_BUILDING
  );
  const acquisitionTax = Math.round((land + building) * ACQUISITION_TAX_RATE);

  const loanFeeRate = (opts.loanFeeRatePct ?? 2.2) / 100;
  const loanFee = Math.round(opts.loanAmount * loanFeeRate);

  const insurance = opts.insurance ?? Math.round(p.buildingArea * 1_200); // 簡易: 延床×目安
  const settlement = opts.settlement ?? Math.round((land + building) * 0.0017 * 0.5); // 固都税の半年分目安

  // 印紙税（売買契約書、価格帯別の概算）
  const stampTax = estimateStampTax(p.price);
  // 司法書士報酬（登記手続き）
  const judicialScrivener = 120_000;

  // 民泊特有
  let licenseApplication = 0;
  let renovation = 0;
  let furniture = 0;
  let infrastructure = 0;
  if (mode === "minpaku") {
    licenseApplication = opts.minpaku?.licenseApplication ?? 250_000; // 行政書士＋申請
    renovation = opts.minpaku?.renovation ?? 1_500_000; // 内装・コーディネート
    furniture = opts.minpaku?.furniture ?? 800_000; // 家具家電一式
    infrastructure = opts.minpaku?.infrastructure ?? 200_000; // スマートロック・Wi-Fi等
  }

  const other = opts.other ?? 100_000;

  const total =
    brokerage +
    registrationTax +
    acquisitionTax +
    loanFee +
    insurance +
    settlement +
    stampTax +
    judicialScrivener +
    licenseApplication +
    renovation +
    furniture +
    infrastructure +
    other;

  return {
    brokerageFee: brokerage,
    registrationTax,
    acquisitionTax,
    loanFee,
    insurance,
    settlement,
    stampTax,
    judicialScrivener,
    licenseApplication,
    renovation,
    furniture,
    infrastructure,
    other,
    total,
  };
}

/** 印紙税（不動産売買契約書、軽減措置考慮の概算）。 */
function estimateStampTax(price: number): number {
  if (price <= 5_000_000) return 1_000;
  if (price <= 10_000_000) return 5_000;
  if (price <= 50_000_000) return 10_000;
  if (price <= 100_000_000) return 30_000;
  if (price <= 500_000_000) return 60_000;
  return 160_000;
}
