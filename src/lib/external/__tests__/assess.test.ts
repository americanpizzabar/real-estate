import { describe, it, expect } from "vitest";
import { ruleBasedAssessment, type AssessInput } from "@/lib/assess";
import { deviationScore, analyzeMarket } from "@/lib/external/marketAnalysis";
import type { TransactionRecord } from "@/lib/external/reinfolib";

const strong: AssessInput = {
  name: "優良", price: 60_000_000, grossYieldPct: 9, netYieldPct: 7,
  landValueRatio: 0.82, costValueRatio: 1.1, dscr: 1.5, ccr: 9, irrPct: 8,
  paybackYear: 12, deadCrossYear: null, score: 82, grade: "S", mode: "rental",
};
const weak: AssessInput = {
  name: "弱め", price: 60_000_000, grossYieldPct: 5, netYieldPct: 3.2, landValueRatio: 0.2,
  costValueRatio: 0.5, dscr: 1.0, ccr: 2, irrPct: 1, paybackYear: null, deadCrossYear: 3,
  score: 38, grade: "D", mode: "minpaku", probLossIRR: 0.35, hazardAffected: true, hazardSummary: "洪水",
};

describe("ruleBasedAssessment", () => {
  it("優良物件は買い推奨で強みを列挙", () => {
    const a = ruleBasedAssessment(strong);
    expect(a.verdict).toBe("買い推奨");
    expect(a.strengths.length).toBeGreaterThan(0);
    expect(a.strengths.join()).toContain("土地値比率");
    expect(a.source).toBe("rule");
  });
  it("弱い物件は見送り寄りでリスクを列挙", () => {
    const a = ruleBasedAssessment(weak);
    expect(a.verdict).toBe("慎重・見送り寄り");
    expect(a.risks.join()).toMatch(/デッドクロス|損失確率|ハザード/);
    expect(a.exit).toContain("実需");
  });
  it("中庸物件は条件付き検討", () => {
    const mid: AssessInput = { ...strong, score: 58, landValueRatio: 0.45, netYieldPct: 5, dscr: 1.15, ccr: 5, grade: "B" };
    expect(ruleBasedAssessment(mid).verdict).toBe("条件付き検討");
  });
});

describe("deviationScore（偏差値化）", () => {
  const recs: TransactionRecord[] = [500, 520, 540, 560, 600, 480, 510, 530].map((u) =>
    ({ price: u * 100 * 10000, unitPrice: u * 10000, area: 100, type: "宅地(土地)" } as TransactionRecord)
  );
  const stats = analyzeMarket(recs).land!;
  it("平均より安い単価は偏差値>50（割安）", () => {
    const d = deviationScore(4_500_000, stats, "land")!; // 平均約531万より安い
    expect(d.tScore).toBeGreaterThan(50);
    expect(["割安", "やや割安"]).toContain(d.verdict);
  });
  it("平均より高い単価は偏差値<50（割高）", () => {
    const d = deviationScore(6_500_000, stats, "land")!;
    expect(d.tScore).toBeLessThan(50);
  });
  it("事例3件未満やstd0はnull", () => {
    expect(deviationScore(5_000_000, { ...stats, count: 2 }, "land")).toBeNull();
    expect(deviationScore(5_000_000, { ...stats, stdUnitPrice: 0 }, "land")).toBeNull();
  });
});
