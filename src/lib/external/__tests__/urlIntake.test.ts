import { describe, it, expect } from "vitest";
import { parseHtml, extractPortalLinks } from "../urlIntake";
import { detectPortal, portalSearchLinks } from "../portals";

const SAMPLE_HTML = `
<html><head>
<title>中央区日本橋 一棟マンション 8,000万円 | SUUMO</title>
<meta property="og:title" content="日本橋RMマンション">
<meta name="description" content="価格8000万円 利回り7.5% RC造 2008年築">
<script type="application/ld+json">{"@type":"Product","name":"日本橋RM"}</script>
</head><body>
<a href="/detail/123">この物件の詳細</a>
<a href="https://www.athome.co.jp/buy/789">at homeで見る</a>
<a href="https://www.rakumachi.jp/property/456">楽待の掲載</a>
<a href="https://suumo.jp/other">SUUMO別ページ</a>
<script>var x = 1;</script>
<p>所在地: 東京都中央区日本橋</p>
</body></html>`;

describe("urlIntake parseHtml", () => {
  const page = parseHtml("https://suumo.jp/detail/123", SAMPLE_HTML);

  it("タイトル・OG・説明・JSON-LD・本文を統合テキスト化", () => {
    expect(page.title).toContain("日本橋RM");
    expect(page.text).toContain("8000万円");
    expect(page.text).toContain("JSON-LD");
    expect(page.text).toContain("東京都中央区日本橋");
    // scriptの中身は本文に含めない
    expect(page.text).not.toContain("var x = 1");
  });

  it("相対URLを絶対化してアンカー抽出", () => {
    const hrefs = page.anchors.map((a) => a.href);
    expect(hrefs).toContain("https://suumo.jp/detail/123");
    expect(hrefs.some((h) => h.includes("athome.co.jp"))).toBe(true);
  });

  it("他ポータルの掲載リンクのみ抽出（自ポータル除外）", () => {
    const links = extractPortalLinks(page);
    const portals = links.map((l) => l.portal);
    expect(portals).toContain("at home");
    expect(portals).toContain("楽待");
    // 自身(SUUMO)の別ページは除外
    expect(links.some((l) => l.url.includes("suumo.jp"))).toBe(false);
  });
});

describe("portals", () => {
  it("ホストからポータル判別", () => {
    expect(detectPortal("https://www.suumo.jp/x")?.name).toBe("SUUMO");
    expect(detectPortal("https://example.com")).toBeNull();
  });

  it("クロスポータル検索リンクを生成（取得元は除外）", () => {
    const links = portalSearchLinks("日本橋RM", "東京都中央区日本橋", "suumo.jp");
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.kind === "search-link")).toBe(true);
    expect(links.some((l) => l.url.includes("athome.co.jp"))).toBe(true);
    expect(links.some((l) => l.url.includes("site:suumo.jp"))).toBe(false);
  });
});
