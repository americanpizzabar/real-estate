// =============================================================
// Web検索（任意）— Google Programmable Search Engine
// GOOGLE_CSE_KEY と GOOGLE_CSE_CX 設定時のみ実検索。
// 同一物件の他ポータル掲載URLの自動探索に使用。
// =============================================================

export interface SearchHit {
  title: string;
  link: string;
  snippet?: string;
}

export function isWebSearchConfigured(): boolean {
  return !!(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX);
}

export async function webSearch(query: string, num = 8): Promise<SearchHit[]> {
  const key = process.env.GOOGLE_CSE_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx || !query.trim()) return [];
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(10, num)));
  try {
    const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items ?? []).map((i: any) => ({
      title: i.title,
      link: i.link,
      snippet: i.snippet,
    }));
  } catch {
    return [];
  }
}
