import { NextRequest, NextResponse } from "next/server";
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
// POST /api/parse-maisoku  { text: string }
// GOOGLE_AI_API_KEY (Gemini) があれば LLM で構造化抽出、無ければ正規表現抽出。
// ファイル(PDF/画像)の取込は /api/intake を使用。
// =============================================================

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { text } = await req.json().catch(() => ({ text: "" }));
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  if (isGeminiConfigured()) {
    try {
      const raw = await geminiGenerate(EXTRACTION_SYSTEM, [
        textPart(extractionInstruction(false, text)),
      ]);
      const result = normalizeExtraction(raw);
      return NextResponse.json({ source: "gemini", model: GEMINI_MODEL, ...result });
    } catch (e) {
      // 失敗時は正規表現抽出にフォールバック
    }
  }

  // 正規表現フォールバック（鍵なしでも動作）。evidence は付与しない。
  const parsed = parseMaisoku(text);
  const { notes, grossYieldPct, ...fields } = parsed as any;
  return NextResponse.json({
    source: "regex",
    fields: { ...fields, ...(grossYieldPct != null ? { grossYieldPct } : {}) },
    evidence: [],
    notes: notes ?? [],
  });
}
