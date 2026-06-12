import type { RelatedLink } from "./related";

// =============================================================
// 不動産ポータルサイトの定義とクロスポータル検索リンク生成
// =============================================================

export interface Portal {
  domain: string;
  name: string;
}

export const PORTALS: Portal[] = [
  { domain: "suumo.jp", name: "SUUMO" },
  { domain: "athome.co.jp", name: "at home" },
  { domain: "homes.co.jp", name: "LIFULL HOME'S" },
  { domain: "rakumachi.jp", name: "楽待" },
  { domain: "kenbiya.com", name: "健美家" },
  { domain: "realestate.yahoo.co.jp", name: "Yahoo!不動産" },
  { domain: "fudousan.or.jp", name: "不動産ジャパン" },
  { domain: "nifty.com", name: "ニフティ不動産" },
];

/** URLのホストからポータルを判別。 */
export function detectPortal(url: string): Portal | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return PORTALS.find((p) => host === p.domain || host.endsWith(`.${p.domain}`)) ?? null;
  } catch {
    return null;
  }
}

/** クエリ文字列を物件名・住所から組み立てる。 */
export function buildQuery(name?: string, address?: string): string {
  return [name, address].filter(Boolean).join(" ").trim();
}

/**
 * 各ポータルを対象にしたGoogleサイト内検索リンクを生成。
 * 検索APIキー不要で「他サイトの同一物件」へワンクリックで辿れる。
 * @param excludeDomain 取得元ポータル（除外）
 */
export function portalSearchLinks(
  name: string | undefined,
  address: string | undefined,
  excludeDomain?: string
): RelatedLink[] {
  const q = buildQuery(name, address);
  if (!q) return [];
  const links: RelatedLink[] = [];
  for (const p of PORTALS) {
    if (excludeDomain && p.domain === excludeDomain) continue;
    const g = `https://www.google.com/search?q=${encodeURIComponent(`site:${p.domain} ${q}`)}`;
    links.push({ url: g, title: `${p.name} で「${q}」を検索`, portal: p.name, kind: "search-link" });
  }
  // 全ポータル横断の一般検索
  links.push({
    url: `https://www.google.com/search?q=${encodeURIComponent(q + " 物件")}`,
    title: `Webで「${q}」を検索`,
    kind: "search-link",
  });
  return links;
}
