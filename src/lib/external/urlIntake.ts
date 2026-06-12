import { PORTALS, detectPortal } from "./portals";

// =============================================================
// WEBリンク取り込み — ページ取得とHTML解析
// ユーザーが指定した1ページを取得し、抽出用テキストと
// ページ内リンクを取り出す（DOMライブラリ非依存の軽量パース）。
// =============================================================

export interface FetchedPage {
  url: string;
  title: string;
  /** AI抽出に渡す統合テキスト（メタ・JSON-LD・本文） */
  text: string;
  /** ページ内アンカー（href, text） */
  anchors: { href: string; text: string }[];
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function fetchPage(url: string): Promise<FetchedPage> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ja,en;q=0.8",
    },
    redirect: "follow",
    next: { revalidate: 1800 },
  });
  if (!res.ok) throw new Error(`ページ取得失敗 ${res.status}`);
  const html = await res.text();
  return parseHtml(url, html);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function parseHtml(url: string, html: string): FetchedPage {
  const pick = (re: RegExp): string => {
    const m = html.match(re);
    return m ? decodeEntities(m[1].trim()) : "";
  };

  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogTitle = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const ogDesc = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const desc = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);

  // JSON-LD（schema.org 構造化データ）
  const jsonld: string[] = [];
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = ldRe.exec(html)) !== null) {
    jsonld.push(lm[1].trim().slice(0, 2000));
  }

  // アンカー抽出
  const anchors: { href: string; text: string }[] = [];
  const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let am: RegExpExecArray | null;
  while ((am = aRe.exec(html)) !== null && anchors.length < 500) {
    const href = resolveUrl(url, am[1]);
    const text = decodeEntities(am[2].replace(/<[^>]+>/g, "").trim()).slice(0, 80);
    if (href) anchors.push({ href, text });
  }

  // 本文テキスト: script/styleを除去 → タグ除去 → 空白圧縮
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const visible = decodeEntities(body).replace(/\s+/g, " ").trim().slice(0, 6000);

  const text = [
    title && `タイトル: ${title}`,
    ogTitle && `OG:title: ${ogTitle}`,
    (ogDesc || desc) && `説明: ${ogDesc || desc}`,
    jsonld.length ? `構造化データ(JSON-LD): ${jsonld.join("\n")}` : "",
    `本文: ${visible}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { url, title: ogTitle || title, text, anchors };
}

function resolveUrl(base: string, href: string): string | null {
  try {
    if (href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:"))
      return null;
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/**
 * ページ内アンカーから、他ポータルの物件掲載らしきリンクを抽出。
 * 取得元と同一ポータルや同一URLは除外し、重複も排除。
 */
export function extractPortalLinks(page: FetchedPage): { url: string; text: string; portal: string }[] {
  const selfPortal = detectPortal(page.url);
  const seen = new Set<string>([page.url]);
  const out: { url: string; text: string; portal: string }[] = [];
  for (const a of page.anchors) {
    const p = detectPortal(a.href);
    if (!p) continue;
    if (selfPortal && p.domain === selfPortal.domain) continue; // 同一ポータル内ナビは除外
    const clean = a.href.split("#")[0];
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push({ url: a.href, text: a.text || p.name, portal: p.name });
    if (out.length >= 12) break;
  }
  return out;
}
