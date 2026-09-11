import { describe, it, expect } from "vitest";
import { parseHtml } from "../urlIntake";
import { cleanAddress } from "../extraction";

describe("cleanAddress（住所クレンジング）", () => {
  it("物件情報の混入を除去", () => {
    expect(cleanAddress("東京都港区六本木3-2-1 価格: 9800万円 専有面積54.32㎡")).toBe("東京都港区六本木3-2-1");
  });
  it("先頭の余計な語を落として都道府県起点に", () => {
    expect(cleanAddress("所在地 東京都中央区日本橋1-1-1 交通 東京駅徒歩5分")).toBe("東京都中央区日本橋1-1-1");
  });
  it("面積・利回り表記の手前で切る", () => {
    expect(cleanAddress("神奈川県横浜市西区みなとみらい4-3 土地面積120㎡ 利回り7%")).toBe("神奈川県横浜市西区みなとみらい4-3");
  });
  it("空や無効はそのまま空に近い処理", () => {
    expect(cleanAddress("")).toBe("");
  });
  it("「円」を含む地名を切らない（円山町・円町）", () => {
    expect(cleanAddress("東京都渋谷区円山町5-1")).toBe("東京都渋谷区円山町5-1");
    expect(cleanAddress("京都府京都市中京区円町10")).toBe("京都府京都市中京区円町10");
  });
  it("数字＋万円（価格）は正しく切る", () => {
    expect(cleanAddress("東京都新宿区西新宿2-8-1 8,000万円")).toBe("東京都新宿区西新宿2-8-1");
  });
});

const SAMPLE_HTML = `
<html><head>
<title>中央区日本橋 一棟マンション 8,000万円 | SUUMO</title>
<meta property="og:title" content="日本橋RMマンション">
<meta name="description" content="価格8000万円 利回り7.5% RC造 2008年築">
<script type="application/ld+json">{"@type":"Product","name":"日本橋RM"}</script>
</head><body>
<script>var x = 1;</script>
<p>所在地: 東京都中央区日本橋</p>
</body></html>`;

describe("urlIntake parseHtml", () => {
  const page = parseHtml("https://suumo.jp/detail/123", SAMPLE_HTML);

  it("タイトル・OG・説明・JSON-LD・本文を統合テキスト化", () => {
    expect(page.title).toContain("日本橋RM");
    expect(page.text).toContain("8000万円");
    expect(page.text).toContain("構造化データ");
    expect(page.text).toContain("東京都中央区日本橋");
    // scriptの中身（データでないもの）は本文に含めない
    expect(page.text).not.toContain("var x = 1");
  });
});

describe("urlIntake SPA(JSON)対応", () => {
  const SPA_HTML = `<html><head><title>物件</title></head><body>
  <div id="__next"></div>
  <script id="__NEXT_DATA__" type="application/json">
  {"props":{"pageProps":{"property":{"name":"渋谷RMマンション","address":"東京都渋谷区","price":150000000,"area":85.5,"yield":5.2}}}}
  </script>
  <script>window.__INITIAL_STATE__ = {"x":1};</script>
  </body></html>`;

  it("__NEXT_DATA__内のJSONを抽出テキストに含める", () => {
    const page = parseHtml("https://marketplace.example.jp/property/305", SPA_HTML);
    expect(page.text).toContain("渋谷RMマンション");
    expect(page.text).toContain("150000000");
    expect(page.text).toContain("構造化データ");
  });
});
