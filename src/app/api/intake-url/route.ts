import { NextRequest, NextResponse } from "next/server";
import { fetchPage } from "@/lib/external/urlIntake";
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

// =============================================================
// POST /api/intake-url  { url }
// 指定された物件掲載ページを取得して、その物件の情報のみを構造化抽出する。
//
// ※ ページの取得は各サイトの利用規約に従ってください。
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
        textPart(extractionInstruction(false, page.text, 18000)),
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

  // 何も抽出できなかった場合の案内（JS描画SPA等）
  const extractedCount = Object.keys(result.fields ?? {}).length;
  if (extractedCount === 0) {
    result.notes = [
      ...(result.notes ?? []),
      "このページからは物件データを自動抽出できませんでした。JavaScriptで描画されるサイトや会員限定ページの可能性があります。PDF/画像のドラッグ&ドロップ、またはページ本文のテキスト貼付でお試しください。",
    ];
  }

  return NextResponse.json({
    source,
    model: source === "gemini" ? GEMINI_MODEL : undefined,
    sourceUrl: url,
    title: page.title,
    fields: result.fields,
    evidence: result.evidence,
    notes: result.notes,
  });
}
