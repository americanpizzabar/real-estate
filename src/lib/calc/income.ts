import type { RentalParams, MinpakuParams } from "./types";

// =============================================================
// 収益（インカムアプローチ）— 単年度の GPI/EGI/OPEX/NOI 算出
// 賃貸・民泊で全く異なる収益構造を別関数で表現する。
// =============================================================

export interface IncomeBreakdown {
  gpi: number; // 潜在総収入（満室想定）
  vacancyLoss: number; // 空室・稼働ロス
  egi: number; // 実効総収入
  opex: number; // 運営費
  noi: number; // 純営業利益
  /** ウォーターフォール表示用の運営費内訳 */
  opexDetail: { label: string; amount: number }[];
}

/**
 * 賃貸（長期）の単年度収益。
 * @param rentMultiplier 賃料の経年補正係数（1年目=1.0、下落を反映）
 */
export function rentalIncome(
  params: RentalParams,
  rentMultiplier = 1
): IncomeBreakdown {
  const annualGrossBase = params.monthlyGrossRent * 12;
  const gpi = Math.round(annualGrossBase * rentMultiplier);
  const vacancyLoss = Math.round(gpi * (params.vacancyRatePct / 100));
  const egi = gpi - vacancyLoss;

  let opex: number;
  let opexDetail: { label: string; amount: number }[];
  if (params.opexAnnual != null && params.opexAnnual > 0) {
    opex = Math.round(params.opexAnnual);
    opexDetail = [{ label: "運営費（実額）", amount: opex }];
  } else {
    opex = Math.round(egi * (params.opexRatePct / 100));
    opexDetail = [
      { label: `運営費（対EGI ${params.opexRatePct}%）`, amount: opex },
    ];
  }

  const noi = egi - opex;
  return { gpi, vacancyLoss, egi, opex, noi, opexDetail };
}

/**
 * 民泊（短期）の単年度収益。
 * 売上 = ADR × 営業日数 × 稼働率。各種手数料・稼働連動費を控除。
 * @param adrMultiplier ADRの経年補正（市況変動シナリオ用、1年目=1.0）
 * @param occMultiplier 稼働率の経年補正
 */
export function minpakuIncome(
  params: MinpakuParams,
  adrMultiplier = 1,
  occMultiplier = 1
): IncomeBreakdown {
  const adr = params.adr * adrMultiplier;
  const occ = Math.min(1, (params.occupancyPct / 100) * occMultiplier);
  const soldNights = params.operableDays * occ;

  const gpi = Math.round(adr * params.operableDays); // 満室（100%稼働）想定売上
  const egi = Math.round(adr * soldNights); // 実稼働売上
  const vacancyLoss = gpi - egi;

  // 稼働回数（清掃回数）= 宿泊数 / 平均宿泊日数
  const stays =
    params.avgStayNights > 0 ? soldNights / params.avgStayNights : 0;

  const managementFee = Math.round(egi * (params.managementFeePct / 100));
  const otaFee = Math.round(egi * (params.otaFeePct / 100));
  const cleaning = Math.round(stays * params.cleaningCostPerStay);
  const variable = Math.round(soldNights * params.variableCostPerNight);
  const fixedOpex = Math.round(params.fixedOpexAnnual);

  const opexDetail = [
    { label: "運営代行手数料", amount: managementFee },
    { label: "OTA手数料", amount: otaFee },
    { label: "清掃費", amount: cleaning },
    { label: "水道光熱・消耗品", amount: variable },
    { label: "固定運営費", amount: fixedOpex },
  ];
  const opex = managementFee + otaFee + cleaning + variable + fixedOpex;
  const noi = egi - opex;

  return { gpi, vacancyLoss, egi, opex, noi, opexDetail };
}

/** 民泊の損益分岐（必要NOI=年間返済額）に対する稼働率×ADRマトリクス用の単点NOI。 */
export function minpakuNoiAt(
  params: MinpakuParams,
  adr: number,
  occupancyPct: number
): number {
  const occ = Math.min(1, occupancyPct / 100);
  const soldNights = params.operableDays * occ;
  const egi = adr * soldNights;
  const stays = params.avgStayNights > 0 ? soldNights / params.avgStayNights : 0;
  const opex =
    egi * (params.managementFeePct / 100) +
    egi * (params.otaFeePct / 100) +
    stays * params.cleaningCostPerStay +
    soldNights * params.variableCostPerNight +
    params.fixedOpexAnnual;
  return egi - opex;
}
