import type {
  PropertyInput,
  LoanInput,
  RentalParams,
  MinpakuParams,
  IncomeMode,
  CashflowYearRow,
  InvestmentMetrics,
} from "./types";
import { buildLoanSchedule, annualDebtService } from "./loan";
import { rentalIncome, minpakuIncome, type IncomeBreakdown } from "./income";
import { irr, npv } from "./finance";
import { LEGAL_LIFESPAN, DEFAULT_BUILDING_RATIO } from "./constants";

// =============================================================
// 複数年キャッシュフロー予測エンジン
// 収益（賃貸/民泊）× ローン × 減価償却 × 税 を統合し、
// デッドクロス・元本回収・IRR・NPV まで一気通貫で算出する。
// =============================================================

export interface ProjectionInput {
  property: PropertyInput;
  mode: IncomeMode;
  rental?: RentalParams;
  minpaku?: MinpakuParams;
  loan: LoanInput;
  /** 自己資金のうち頭金（円）。初期費用は別途加算。 */
  downPayment: number;
  /** 初期費用合計（円）。 */
  initialCostsTotal: number;
  /** 予測年数（10〜20年） */
  years: number;
  /** 実効税率（0〜1） */
  taxRate: number;
  /** 割引率（NPV用、0〜1） */
  discountRate: number;
  /** 出口（売却）想定: 売却年。null なら保有継続のみ。 */
  exitYear?: number | null;
  /** 売却時の還元利回り（%）。NOI/cap で売却価格を推定。0なら土地値想定。 */
  exitCapRatePct?: number;
  /** 評価基準年（築年数算出用） */
  currentYear: number;
}

/**
 * 中古建物の減価償却年数（簡便法）。
 * 法定耐用年数を超過: 法定×0.2、未超過: (法定-経過)+経過×0.2。
 */
export function depreciationYears(structure: PropertyInput["structure"], age: number): number {
  const legal = LEGAL_LIFESPAN[structure];
  let years: number;
  if (age >= legal) {
    years = Math.floor(legal * 0.2);
  } else {
    years = Math.floor(legal - age + age * 0.2);
  }
  return Math.max(2, years);
}

/** 建物の償却対象額（建物割合 × 価格）。固評按分があればそれを優先。 */
function buildingDepreciableBasis(p: PropertyInput): number {
  if (
    p.fixedAssetValueBuilding &&
    p.fixedAssetValueLand &&
    p.fixedAssetValueBuilding > 0 &&
    p.fixedAssetValueLand > 0
  ) {
    const total = p.fixedAssetValueBuilding + p.fixedAssetValueLand;
    const ratio = p.fixedAssetValueBuilding / total;
    return Math.round(p.price * ratio);
  }
  return Math.round(p.price * DEFAULT_BUILDING_RATIO[p.structure]);
}

export interface ProjectionResult {
  rows: CashflowYearRow[];
  metrics: InvestmentMetrics;
}

export function buildProjection(input: ProjectionInput): ProjectionResult {
  const {
    property: p,
    loan,
    years,
    taxRate,
    discountRate,
    mode,
  } = input;

  const loanSchedule = buildLoanSchedule(loan);
  const selfFunds = input.downPayment + input.initialCostsTotal;

  // 減価償却の準備
  const age = Math.max(0, input.currentYear - p.builtYear);
  const depYears = depreciationYears(p.structure, age);
  const depBasis = buildingDepreciableBasis(p);
  const annualDepreciation = Math.round(depBasis / depYears);

  const rows: CashflowYearRow[] = [];
  let cumulativeBtcf = -selfFunds; // 自己資金回収の起点
  let firstNoi = 0;
  let paybackYear: number | null = null;
  let deadCrossYear: number | null = null;

  // IRR/NPV 用のキャッシュフロー列（0年目 = -自己資金）
  const cashflows: number[] = [-selfFunds];

  for (let y = 1; y <= years; y++) {
    // --- 収益 ---
    let inc: IncomeBreakdown;
    if (mode === "rental" && input.rental) {
      const rentMult = Math.pow(
        1 - input.rental.rentDeclinePctPerYear / 100,
        y - 1
      );
      inc = rentalIncome(input.rental, rentMult);
    } else if (mode === "minpaku" && input.minpaku) {
      inc = minpakuIncome(input.minpaku);
    } else {
      inc = { gpi: 0, vacancyLoss: 0, egi: 0, opex: 0, noi: 0, opexDetail: [] };
    }

    if (y === 1) firstNoi = inc.noi;

    // --- ローン ---
    const ls = loanSchedule[y - 1];
    const interest = ls ? ls.interestPaid : 0;
    const principal = ls ? ls.principalPaid : 0;
    const debtService = ls ? ls.totalPaid : 0;
    const loanBalance = ls ? ls.balanceEnd : 0;

    // --- 減価償却 ---
    const depreciation = y <= depYears ? annualDepreciation : 0;

    // --- 税 ---
    const taxableIncome = inc.noi - interest - depreciation;
    const tax = Math.round(Math.max(0, taxableIncome) * taxRate);

    // --- キャッシュフロー ---
    const btcf = inc.noi - debtService;
    const atcf = btcf - tax;
    cumulativeBtcf += btcf;

    // デッドクロス: 減価償却 < 元金返済（帳簿黒字だが手残り薄）
    const isDeadCross = depreciation < principal && y > 1;
    if (isDeadCross && deadCrossYear === null) deadCrossYear = y;

    // 元本回収（累積CFが初めてプラス）
    if (paybackYear === null && cumulativeBtcf >= 0) paybackYear = y;

    rows.push({
      year: y,
      gpi: inc.gpi,
      egi: inc.egi,
      opex: inc.opex,
      noi: inc.noi,
      debtService,
      btcf,
      depreciation,
      taxableIncome,
      tax,
      atcf,
      cumulativeBtcf,
      loanBalance,
      isDeadCross,
    });

    cashflows.push(atcf);
  }

  // --- 出口（売却）の織り込み ---
  let irrPct: number | null = null;
  let npvVal: number | null = null;
  const exitYear = input.exitYear ?? years;
  if (exitYear >= 1 && exitYear <= years) {
    const exitRow = rows[exitYear - 1];
    let salePrice: number;
    if (input.exitCapRatePct && input.exitCapRatePct > 0) {
      salePrice = Math.round(exitRow.noi / (input.exitCapRatePct / 100));
    } else {
      // capが無ければ簡易に当初価格の現状維持を仮定
      salePrice = p.price;
    }
    // 売却コスト（仲介3%+譲渡諸費の概算5%）
    const sellingCost = Math.round(salePrice * 0.05);
    const netSaleProceeds = salePrice - sellingCost - exitRow.loanBalance;

    // exitYear のキャッシュフローに売却益を加算した列でIRR/NPV
    const exitFlows = cashflows.slice(0, exitYear + 1);
    exitFlows[exitYear] = (exitFlows[exitYear] ?? 0) + netSaleProceeds;
    irrPct = (() => {
      const r = irr(exitFlows);
      return r === null ? null : r * 100;
    })();
    npvVal = Math.round(npv(discountRate, exitFlows));
  }

  // --- 指標サマリ ---
  const grossBase =
    mode === "rental" && input.rental
      ? input.rental.monthlyGrossRent * 12
      : mode === "minpaku" && input.minpaku
        ? input.minpaku.adr * input.minpaku.operableDays
        : 0;
  const grossYieldPct = p.price > 0 ? (grossBase / p.price) * 100 : 0;
  const netYieldPct = p.price > 0 ? (firstNoi / p.price) * 100 : 0;
  const ds = annualDebtService(loan);
  const dscr = ds > 0 ? firstNoi / ds : Infinity;
  const firstBtcf = rows.length > 0 ? rows[0].btcf : 0;
  const ccr = selfFunds > 0 ? (firstBtcf / selfFunds) * 100 : 0;

  const metrics: InvestmentMetrics = {
    grossYieldPct,
    netYieldPct,
    noi: firstNoi,
    dscr,
    ccr,
    selfFunds,
    paybackYear,
    deadCrossYear,
    irrPct,
    npv: npvVal,
  };

  return { rows, metrics };
}

/** DSCR のプロ判定。 */
export function judgeDscr(dscr: number): {
  label: string;
  color: string;
  message: string;
} {
  if (!isFinite(dscr) || dscr >= 1.3) {
    return {
      label: "優良（融資が引きやすい）",
      color: "#2dd4a7",
      message: "DSCR 1.3以上。NOIが返済額を十分上回り、金融機関の評価も得やすい水準。",
    };
  }
  if (dscr >= 1.1) {
    return {
      label: "許容範囲",
      color: "#f5b14c",
      message: "DSCR 1.1〜1.3。返済はカバーできるが、空室・金利上昇への耐性は限定的。",
    };
  }
  return {
    label: "危険（返済余力不足）",
    color: "#f56c6c",
    message: "DSCR 1.1未満。NOIに対し返済負担が重く、僅かな変動で赤字に転落するリスク。",
  };
}
