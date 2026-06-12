import { NextRequest, NextResponse } from "next/server";
import { fetchPage, extractPortalLinks } from "@/lib/external/urlIntake";
import { detectPortal, portalSearchLinks, buildQuery, PORTALS } from "@/lib/external/portals";
import { isWebSearchConfigured, webSearch } from "@/lib/external/webSearch";
import { parseMaisoku } from "@/lib/external/maisokuParser";
import {
  geminiGenerate,
  textPart,
  isGeminiConfigured,
  GEMINI_MODEL,
} from "@/lib/external/gemini";
import {
  EXTRACTION_SYSTEM,
  extractionInstruction,
  normalizeExtraction,
} from "@/lib/external/extraction";
import type { RelatedLink } from "@/lib/external/related";

// =============================================================
// POST /api/intake-url  { url }
// 指定された物件掲載ページを取得して構造化抽出し、
// 同一物件の他サイト掲載リンクを横断探索する。
//
// ※ ポータルサイトの取得は各社の利用規約に従ってください。
//   本APIはユーザーが指定した単一ページのみを取得します（自動巡回なし）。
// =============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { url } = await req.json().catch(() => ({ url: "" }));
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "有効なURLを指定してください" }, { status: 400 });
  }

  // 1) ページ取得
  let page;
  try {
    page = await fetchPage(url);
  } catch (e: any) {
    return NextResponse.json(
      { error: `ページ取得に失敗しました: ${e?.message ?? e}（サイトの規約・bot制限の可能性）` },
      { status: 502 }
    );
  }

  // 2) 構造化抽出（Gemini or 正規表現）
  let result;
  let source = "regex";
  if (isGeminiConfigured()) {
    try {
      const raw = await geminiGenerate(EXTRACTION_SYSTEM, [
        textPart(extractionInstruction(false, page.text)),
      ]);
      result = normalizeExtraction(raw);
      source = "gemini";
    } catch {
      // フォールバック
    }
  }
  if (!result) {
    const p = parseMaisoku(page.text);
    const { notes, grossYieldPct, ...fields } = p as any;
    result = {
      fields: { ...fields, ...(grossYieldPct != null ? { grossYieldPct } : {}) },
      evidence: [],
      notes: notes ?? [],
    };
  }

  // 3) 同一物件の他サイト掲載を横断探索
  const selfPortal = detectPortal(url);
  const query = buildQuery(result.fields.name, result.fields.address);
  const related: RelatedLink[] = [];

  // 3-1) ページ内に存在した他ポータルへのリンク
  for (const l of extractPortalLinks(page)) {
    related.push({ url: l.url, title: l.text, portal: l.portal, kind: "same-page" });
  }

  // 3-2) 検索API設定時は実検索で他ポータルの掲載URLを取得
  if (isWebSearchConfigured() && query) {
    const hits = await webSearch(query, 10);
    const seen = new Set(related.map((r) => r.url).concat(url));
    for (const h of hits) {
      const p = detectPortal(h.link);
      if (!p) continue;
      if (selfPortal && p.domain === selfPortal.domain) continue;
      if (seen.has(h.link)) continue;
      seen.add(h.link);
      related.push({ url: h.link, title: h.title, portal: p.name, kind: "search-result" });
    }
  }

  // 3-3) クロスポータル検索リンク（キー不要・常時生成）
  for (const sl of portalSearchLinks(result.fields.name, result.fields.address, selfPortal?.domain)) {
    related.push(sl);
  }

  return NextResponse.json({
    source,
    model: source === "gemini" ? GEMINI_MODEL : undefined,
    sourceUrl: url,
    title: page.title,
    portal: selfPortal?.name,
    searchConfigured: isWebSearchConfigured(),
    fields: result.fields,
    evidence: result.evidence,
    notes: result.notes,
    related,
  });
}
