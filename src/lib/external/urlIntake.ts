// =============================================================
// WEBリンク取り込み — ページ取得とHTML解析
// ユーザーが指定した1ページを取得し、抽出用テキストを取り出す
// （DOMライブラリ非依存の軽量パース）。
// =============================================================

export interface FetchedPage {
  url: string;
  title: string;
  /** AI抽出に渡す統合テキスト（メタ・JSON-LD・本文） */
  text: string;
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

  // 構造化データ: JSON-LD / __NEXT_DATA__ / application/json / 状態オブジェクト
  // SPA(React/Next/Nuxt等)は物件データをインラインJSONに持つため必ず拾う。
  const dataBlobs: string[] = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = scriptRe.exec(html)) !== null && dataBlobs.length < 8) {
    const attrs = sm[1] || "";
    const content = (sm[2] || "").trim();
    if (!content || !content.includes("{")) continue;
    const isJson = /type=["']application\/(ld\+)?json["']/i.test(attrs);
    const isNextData = /__NEXT_DATA__/.test(attrs);
    const hasState = /(__NUXT__|__INITIAL_STATE__|__APOLLO_STATE__|__NEXT_DATA__|window\.__|self\.__next_f)/.test(content);
    // 物件らしきキーワードを含む生JSONも対象
    const looksData = /("price"|"address"|"area"|価格|所在地|面積|利回|"yield")/.test(content);
    if (isJson || isNextData || hasState || looksData) {
      dataBlobs.push(content.slice(0, 14000));
    }
  }

  // 本文テキスト: script/styleを除去 → タグ除去 → 空白圧縮
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const visible = decodeEntities(body).replace(/\s+/g, " ").trim().slice(0, 4000);

  // 物件データはメタ＞構造化JSON＞本文の順で価値が高い
  const text = [
    title && `タイトル: ${title}`,
    ogTitle && `OG:title: ${ogTitle}`,
    (ogDesc || desc) && `説明: ${ogDesc || desc}`,
    dataBlobs.length ? `構造化データ:\n${dataBlobs.join("\n---\n")}` : "",
    visible && `本文: ${visible}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { url, title: ogTitle || title, text };
}
