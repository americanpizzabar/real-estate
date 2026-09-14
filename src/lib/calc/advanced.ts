import { buildProjection, type ProjectionInput } from "./projection";
import { annualDebtService, buildLoanSchedule } from "./loan";

// =============================================================
// 高度分析エンジン
//  - モンテカルロ・シミュレーション（IRR分布・損失確率）
//  - トルネード感度分析（ドライバー別のIRR影響）
//  - 最適保有期間の探索（売却年別IRR）
//  - LTV / DSCR の年次推移
// すべて純関数・オフライン動作・決定論的（seed固定）。
// =============================================================

/** 決定論的PRNG（mulberry32）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 三角分布サンプリング。 */
function triangular(u: number, min: number, mode: number, max: number): number {
  if (max <= min) return min;
  const fc = (mode - min) / (max - min);
  if (u < fc) return min + Math.sqrt(u * (max - min) * (mode - min));
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ---- ドライバー定義（ベース値からの不確実性レンジ） ----
export interface DriverRange {
  key: string;
  label: string;
  min: number;
  mode: number;
  max: number;
  /** ベースに適用する関数（サンプル値→ProjectionInput変更） */
  apply: (inp: ProjectionInput, v: number) => void;
}

/** ベース入力から、モードに応じた不確実性ドライバー群を構築。 */
export function buildDrivers(base: ProjectionInput): DriverRange[] {
  const drivers: DriverRange[] = [];
  // 金利: ベース ±1.0%（下限0.3%）
  const r = base.loan.annualRatePct;
  drivers.push({
    key: "rate", label: "金利",
    min: Math.max(0.3, r - 1.0), mode: r, max: r + 1.5,
    apply: (i, v) => { i.loan = { ...i.loan, annualRatePct: v }; },
  });
  // 出口Cap: ベース ±1.5%
  const cap = base.exitCapRatePct ?? 7;
  drivers.push({
    key: "exitCap", label: "出口Cap",
    min: Math.max(2, cap - 1.5), mode: cap, max: cap + 2.0,
    apply: (i, v) => { i.exitCapRatePct = v; },
  });

  if (base.mode === "rental" && base.rental) {
    const vac = base.rental.vacancyRatePct;
    drivers.push({
      key: "vacancy", label: "空室率",
      min: Math.max(0, vac - 3), mode: vac, max: vac + 12,
      apply: (i, v) => { if (i.rental) i.rental = { ...i.rental, vacancyRatePct: clamp(v, 0, 60) }; },
    });
    const dec = base.rental.rentDeclinePctPerYear;
    drivers.push({
      key: "rentDecline", label: "賃料下落率",
      min: Math.max(0, dec - 0.5), mode: dec, max: dec + 2.0,
      apply: (i, v) => { if (i.rental) i.rental = { ...i.rental, rentDeclinePctPerYear: clamp(v, 0, 10) }; },
    });
    const rent = base.rental.monthlyGrossRent;
    drivers.push({
      key: "rent", label: "賃料水準",
      min: rent * 0.85, mode: rent, max: rent * 1.08,
      apply: (i, v) => { if (i.rental) i.rental = { ...i.rental, monthlyGrossRent: v }; },
    });
  } else if (base.mode === "minpaku" && base.minpaku) {
    const occ = base.minpaku.occupancyPct;
    drivers.push({
      key: "occupancy", label: "稼働率",
      min: Math.max(20, occ - 15), mode: occ, max: Math.min(95, occ + 10),
      apply: (i, v) => { if (i.minpaku) i.minpaku = { ...i.minpaku, occupancyPct: clamp(v, 0, 100) }; },
    });
    const adr = base.minpaku.adr;
    drivers.push({
      key: "adr", label: "ADR(客単価)",
      min: adr * 0.75, mode: adr, max: adr * 1.2,
      apply: (i, v) => { if (i.minpaku) i.minpaku = { ...i.minpaku, adr: v }; },
    });
  }
  return drivers;
}

export interface MonteCarloResult {
  trials: number;
  irrs: number[]; // %（null除外）
  percentiles: { p5: number; p10: number; p50: number; p90: number; p95: number; mean: number };
  probLossIRR: number; // IRR<0 の確率
  probNegCF: number; // いずれかの年で税引前CF<0 の確率
  probDscrUnder1: number; // 初年度DSCR<1.0 の確率
  histogram: { binStart: number; binEnd: number; count: number }[];
  baseIrr: number | null;
}

/** モンテカルロ・シミュレーション。 */
export function runMonteCarlo(
  base: ProjectionInput,
  trials = 1000,
  seed = 20240611
): MonteCarloResult {
  const rng = mulberry32(seed);
  const drivers = buildDrivers(base);
  const irrs: number[] = [];
  let lossCount = 0;
  let negCfCount = 0;
  let dscrUnderCount = 0;

  for (let t = 0; t < trials; t++) {
    const inp: ProjectionInput = structuredClone(base);
    for (const d of drivers) {
      const v = triangular(rng(), d.min, d.mode, d.max);
      d.apply(inp, v);
    }
    const res = buildProjection(inp);
    const irrVal = res.metrics.irrPct;
    if (irrVal != null && isFinite(irrVal)) {
      irrs.push(irrVal);
      if (irrVal < 0) lossCount++;
    } else {
      // IRR算出不能（＝損失で符号反転せず）は損失扱い
      lossCount++;
    }
    if (res.rows.some((r) => r.btcf < 0)) negCfCount++;
    if (isFinite(res.metrics.dscr) && res.metrics.dscr < 1.0) dscrUnderCount++;
  }

  irrs.sort((a, b) => a - b);
  const pct = (p: number) => {
    if (irrs.length === 0) return NaN;
    const idx = clamp(Math.floor((p / 100) * irrs.length), 0, irrs.length - 1);
    return irrs[idx];
  };
  const mean = irrs.length ? irrs.reduce((a, b) => a + b, 0) / irrs.length : NaN;

  // ヒストグラム（20ビン）
  const histogram: MonteCarloResult["histogram"] = [];
  if (irrs.length) {
    const lo = Math.floor(irrs[0]);
    const hi = Math.ceil(irrs[irrs.length - 1]);
    const bins = 20;
    const w = Math.max(0.5, (hi - lo) / bins);
    for (let i = 0; i < bins; i++) {
      const bs = lo + i * w;
      const be = bs + w;
      const count = irrs.filter((x) => x >= bs && (i === bins - 1 ? x <= be : x < be)).length;
      histogram.push({ binStart: bs, binEnd: be, count });
    }
  }

  const baseRes = buildProjection(base);
  return {
    trials,
    irrs,
    percentiles: { p5: pct(5), p10: pct(10), p50: pct(50), p90: pct(90), p95: pct(95), mean },
    probLossIRR: trials ? lossCount / trials : 0,
    probNegCF: trials ? negCfCount / trials : 0,
    probDscrUnder1: trials ? dscrUnderCount / trials : 0,
    histogram,
    baseIrr: baseRes.metrics.irrPct,
  };
}

export interface TornadoBar {
  key: string;
  label: string;
  low: number; // IRR@低位
  high: number; // IRR@高位
  swing: number; // |high-low|
}

/** トルネード感度: 各ドライバーを最小/最大に振ったときのIRR。他は据置。 */
export function runTornado(base: ProjectionInput): { bars: TornadoBar[]; baseIrr: number | null } {
  const drivers = buildDrivers(base);
  const baseIrr = buildProjection(base).metrics.irrPct;
  const bars: TornadoBar[] = [];
  for (const d of drivers) {
    const lo = structuredClone(base);
    d.apply(lo, d.min);
    const hi = structuredClone(base);
    d.apply(hi, d.max);
    const irrLo = buildProjection(lo).metrics.irrPct ?? 0;
    const irrHi = buildProjection(hi).metrics.irrPct ?? 0;
    bars.push({ key: d.key, label: d.label, low: irrLo, high: irrHi, swing: Math.abs(irrHi - irrLo) });
  }
  bars.sort((a, b) => b.swing - a.swing);
  return { bars, baseIrr };
}

export interface ExitYearPoint {
  year: number;
  irrPct: number | null;
  npv: number | null;
}

/** 保有年数ごとのIRR/NPVを算出し、最適売却年を返す。 */
export function optimalExit(base: ProjectionInput): {
  points: ExitYearPoint[];
  bestYear: number | null;
  bestIrr: number | null;
} {
  const points: ExitYearPoint[] = [];
  let bestYear: number | null = null;
  let bestIrr = -Infinity;
  for (let y = 1; y <= base.years; y++) {
    const res = buildProjection({ ...base, exitYear: y });
    const irrVal = res.metrics.irrPct;
    points.push({ year: y, irrPct: irrVal, npv: res.metrics.npv });
    if (irrVal != null && isFinite(irrVal) && irrVal > bestIrr) {
      bestIrr = irrVal;
      bestYear = y;
    }
  }
  return { points, bestYear, bestIrr: bestYear ? bestIrr : null };
}

export interface LtvDscrPoint {
  year: number;
  ltv: number; // % (loan balance / 推定市場価値)
  dscr: number;
  loanBalance: number;
  marketValue: number;
}

/**
 * LTV/DSCRの年次推移。市場価値は各年NOI/出口Capで推定。
 */
export function ltvDscrSeries(base: ProjectionInput): LtvDscrPoint[] {
  const res = buildProjection(base);
  const schedule = buildLoanSchedule(base.loan);
  const cap = (base.exitCapRatePct ?? 7) / 100;
  return res.rows.map((r) => {
    const marketValue = cap > 0 && r.noi > 0 ? Math.round(r.noi / cap) : base.property.price;
    const debtService = schedule[r.year - 1]?.totalPaid ?? annualDebtService(base.loan);
    return {
      year: r.year,
      loanBalance: r.loanBalance,
      marketValue,
      ltv: marketValue > 0 ? (r.loanBalance / marketValue) * 100 : 0,
      dscr: debtService > 0 ? r.noi / debtService : Infinity,
    };
  });
}
