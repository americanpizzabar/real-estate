import type { ProjectionInput } from "./projection";
import { buildProjection } from "./projection";
import { minpakuNoiAt } from "./income";
import type { MinpakuParams } from "./types";

// =============================================================
// ストレステスト & 感度分析
// =============================================================

export interface StressScenario {
  key: string;
  label: string;
  noi: number;
  btcf: number; // 初年度税引前CF
  dscr: number;
  delta: number; // ベースとの初年度BTCF差
}

/**
 * ストレステスト: 空室率上昇 / 賃料下落 / 金利上昇 のシナリオで
 * 初年度のNOI・BTCF・DSCRを再計算する。
 */
export function runStressTest(base: ProjectionInput): StressScenario[] {
  const scenarios: StressScenario[] = [];

  const evalCase = (key: string, label: string, mod: (i: ProjectionInput) => ProjectionInput) => {
    const res = buildProjection(mod(structuredClone(base)));
    const row = res.rows[0];
    return {
      key,
      label,
      noi: row?.noi ?? 0,
      btcf: row?.btcf ?? 0,
      dscr: res.metrics.dscr,
      delta: 0,
    } as StressScenario;
  };

  const baseCase = evalCase("base", "ベースシナリオ", (i) => i);
  scenarios.push(baseCase);

  // 空室率 +10pt（賃貸）/ 稼働率 -10pt（民泊）
  scenarios.push(
    evalCase("vacancy", "空室率+10pt", (i) => {
      if (i.mode === "rental" && i.rental) {
        i.rental.vacancyRatePct += 10;
      } else if (i.mode === "minpaku" && i.minpaku) {
        i.minpaku.occupancyPct = Math.max(0, i.minpaku.occupancyPct - 10);
      }
      return i;
    })
  );

  // 賃料/ADR -10%
  scenarios.push(
    evalCase("rentdown", "賃料/ADR -10%", (i) => {
      if (i.mode === "rental" && i.rental) {
        i.rental.monthlyGrossRent *= 0.9;
      } else if (i.mode === "minpaku" && i.minpaku) {
        i.minpaku.adr *= 0.9;
      }
      return i;
    })
  );

  // 金利 +1%
  scenarios.push(
    evalCase("rate", "金利+1.0%", (i) => {
      i.loan.annualRatePct += 1.0;
      return i;
    })
  );

  // 複合（最悪シナリオ）
  scenarios.push(
    evalCase("worst", "複合（空室+賃料-+金利+）", (i) => {
      if (i.mode === "rental" && i.rental) {
        i.rental.vacancyRatePct += 10;
        i.rental.monthlyGrossRent *= 0.9;
      } else if (i.mode === "minpaku" && i.minpaku) {
        i.minpaku.occupancyPct = Math.max(0, i.minpaku.occupancyPct - 10);
        i.minpaku.adr *= 0.9;
      }
      i.loan.annualRatePct += 1.0;
      return i;
    })
  );

  // delta を計算
  return scenarios.map((s) => ({ ...s, delta: s.btcf - baseCase.btcf }));
}

export interface SensitivityCell {
  adr: number;
  occupancy: number;
  noi: number;
  /** 損益判定: profit / breakeven / loss / target */
  status: "loss" | "breakeven" | "profit" | "target";
  /** 年間返済額に対するNOIの比 (DSCR相当) */
  ratio: number;
}

/**
 * 民泊の「稼働率 × ADR」損益分岐ヒートマップ。
 * requiredNoi = 年間返済額。targetNoi = 目標CF確保ライン。
 */
export function buildSensitivityMatrix(
  params: MinpakuParams,
  adrRange: number[],
  occRange: number[],
  requiredNoi: number,
  targetNoi: number
): SensitivityCell[][] {
  return adrRange.map((adr) =>
    occRange.map((occ) => {
      const noi = Math.round(minpakuNoiAt(params, adr, occ));
      const ratio = requiredNoi > 0 ? noi / requiredNoi : noi > 0 ? Infinity : 0;
      let status: SensitivityCell["status"];
      if (noi >= targetNoi) status = "target";
      else if (noi >= requiredNoi) status = "profit";
      else if (noi >= requiredNoi * 0.95) status = "breakeven";
      else status = "loss";
      return { adr, occupancy: occ, noi, status, ratio };
    })
  );
}
