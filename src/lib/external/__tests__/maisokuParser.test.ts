import { describe, it, expect } from "vitest";
import { parseMaisoku } from "../maisokuParser";

describe("parseMaisoku（familycorporation 世田谷区桜2丁目 実物件）", () => {
  const text = [
    "物件名：世田谷区桜2丁目 一棟売アパート",
    "所在地：東京都世田谷区桜2丁目",
    "価格：5,980万円",
    "利回り：5.68%",
    "想定年間収入：340万円",
    "土地面積：91.56㎡",
    "建物面積：99.02㎡",
    "築年月：平成2年6月",
    "構造：木造 2階建",
    "総戸数：4戸",
    "間取り：1DK×4戸",
    "土地権利：所有権",
    "用途地域：第一種低層住居専用地域",
  ].join("\n");
  const r = parseMaisoku(text);

  it("物件名を広告タイトルのまま抽出", () => {
    expect(r.name).toBe("世田谷区桜2丁目 一棟売アパート");
  });
  it("構造は木造→W", () => expect(r.structure).toBe("W"));
  it("築年は平成2年→1990", () => expect(r.builtYear).toBe(1990));
  it("種別はアパート", () => expect(r.propertyKind).toBe("アパート"));
  it("総戸数4戸", () => expect(r.units).toBe(4));
  it("価格・面積・利回り・住所", () => {
    expect(r.price).toBe(59_800_000);
    expect(r.landArea).toBeCloseTo(91.56, 2);
    expect(r.buildingArea).toBeCloseTo(99.02, 2);
    expect(r.grossYieldPct).toBeCloseTo(5.68, 2);
    expect(r.address).toBe("東京都世田谷区桜2丁目");
  });
});

describe("parseMaisoku 種別判定の優先順位", () => {
  it("一戸建てはアパート/マンションより優先", () => {
    expect(parseMaisoku("種別：中古一戸建て マンション隣接").propertyKind).toBe("一戸建て");
  });
  it("区分マンション", () => {
    expect(parseMaisoku("区分マンションの一室").propertyKind).toBe("マンション");
  });
});
