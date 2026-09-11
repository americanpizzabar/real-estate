import { describe, it, expect } from "vitest";
import {
  classify,
  analyzeMarket,
  estimateFairValue,
  calcDeviation,
} from "../marketAnalysis";
import type { TransactionRecord } from "../reinfolib";

function rec(over: Partial<TransactionRecord>): TransactionRecord {
  return { price: 0, ...over };
}

describe("classify（取引種別の分類）", () => {
  it("中古マンション等 → condo", () => {
    expect(classify(rec({ type: "中古マンション等" }))).toBe("condo");
  });
  it("宅地(土地と建物) → landBldg", () => {
    expect(classify(rec({ type: "宅地(土地と建物)" }))).toBe("landBldg");
  });
  it("宅地(土地) → land", () => {
    expect(classify(rec({ type: "宅地(土地)" }))).toBe("land");
  });
  it("不明 → other", () => {
    expect(classify(rec({ type: "林地" }))).toBe("other"); // 土地を含むが宅地系として扱う仕様ならland。林地は'土地'を含まない→other
  });
});

describe("analyzeMarket（分類別の統計）", () => {
  const records: TransactionRecord[] = [
    // 土地のみ: 単価 50万/55万/60万 → 中央値55万
    rec({ type: "宅地(土地)", unitPrice: 500_000, price: 50_000_000, area: 100 }),
    rec({ type: "宅地(土地)", unitPrice: 550_000, price: 55_000_000, area: 100 }),
    rec({ type: "宅地(土地)", unitPrice: 600_000, price: 60_000_000, area: 100 }),
    // 土地と建物: unitPriceなし → price/area で 80万
    rec({ type: "宅地(土地と建物)", price: 80_000_000, area: 100, municipality: "中央区" }),
    // 区分: 専有単価 100万
    rec({ type: "中古マンション等", price: 50_000_000, area: 50 }),
    // 単価導出不能（面積なし）→ 集計から除外される
    rec({ type: "宅地(土地)", price: 30_000_000 }),
  ];

  const m = analyzeMarket(records);

  it("土地のみの中央値・件数（単価不能は除外）", () => {
    expect(m.land?.count).toBe(3);
    expect(m.land?.medianUnitPrice).toBe(550_000);
  });

  it("unitPrice欠落時は price/area で補完", () => {
    expect(m.landBldg?.count).toBe(1);
    expect(m.landBldg?.medianUnitPrice).toBe(800_000);
  });

  it("区分は専有面積単価", () => {
    expect(m.condo?.medianUnitPrice).toBe(1_000_000);
  });

  it("市区町村名をレコードから取得", () => {
    expect(m.municipality).toBe("中央区");
  });

  it("種別を混ぜて集計しない（landに区分が混ざらない）", () => {
    // landの単価レンジに区分の100万が混入していないこと
    expect(m.land?.maxUnitPrice).toBe(600_000);
  });
});

describe("estimateFairValue（優先順位と計算式）", () => {
  const landRecs = Array.from({ length: 4 }, (_, i) =>
    rec({ type: "宅地(土地)", unitPrice: 500_000 + i * 10_000, area: 100, price: 1 })
  );
  const condoRecs = Array.from({ length: 4 }, (_, i) =>
    rec({ type: "中古マンション等", price: (90 + i) * 1_000_000, area: 60 })
  );

  it("優先1: 土地事例×面積＋建物積算", () => {
    const m = analyzeMarket(landRecs);
    const fv = estimateFairValue(m, 120, 200, 20_000_000);
    // 中央値 = (510000+520000)/2 = 515000
    expect(fv.basis).toBe("land+building");
    expect(fv.fairValue).toBe(515_000 * 120 + 20_000_000);
    expect(fv.formula).toContain("515,000円/㎡");
    expect(fv.formula).toContain("120㎡");
  });

  it("土地事例3件未満なら使わない → 区分へフォールバック", () => {
    const m = analyzeMarket([landRecs[0], ...condoRecs]); // 土地1件のみ
    const fv = estimateFairValue(m, 120, 60, 20_000_000);
    expect(fv.basis).toBe("condo");
  });

  it("有効事例なしは推定不可", () => {
    const m = analyzeMarket([]);
    const fv = estimateFairValue(m, 120, 60, 20_000_000);
    expect(fv.basis).toBe("none");
    expect(fv.fairValue).toBe(0);
  });

  it("区分判定: 土地が延床に対し極小なら区分基準を優先", () => {
    const landRecs = Array.from({ length: 4 }, () =>
      rec({ type: "宅地(土地)", unitPrice: 500_000, area: 100, price: 1 })
    );
    const condoRecs = Array.from({ length: 4 }, () =>
      rec({ type: "中古マンション等", price: 60_000_000, area: 60 })
    );
    const m = analyzeMarket([...landRecs, ...condoRecs]);
    // 土地15㎡ / 延床70㎡（持分＝区分）→ land事例が3件以上でもcondo基準
    const fv = estimateFairValue(m, 15, 70, 5_000_000);
    expect(fv.basis).toBe("condo");
  });
});

describe("calcDeviation（乖離率）", () => {
  it("割安判定（-5%以下）", () => {
    const d = calcDeviation(90_000_000, 100_000_000, 80_000_000);
    expect(d.vsFairPct).toBeCloseTo(-10, 5);
    expect(d.verdict).toBe("discount");
  });
  it("割高判定（+8%以上）", () => {
    const d = calcDeviation(110_000_000, 100_000_000, 80_000_000);
    expect(d.verdict).toBe("premium");
    expect(d.vsCostPct).toBeCloseTo(37.5, 1);
  });
});
