import { NextRequest, NextResponse } from "next/server";
import { fetchPage } from "@/lib/external/urlIntake";
import { renderPage } from "@/lib/external/renderPage";
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
  type ExtractionResult,
} from "@/lib/external/extraction";

// =============================================================
// POST /api/intake-url  { url }
// 指定された物件掲載ページを取得して、その物件の情報のみを構造化抽出する。
//
// 抽出パイプライン（多段フォールバック）:
//  1. 静的HTML取得（メタ・インラインJSON・本文）→ Gemini抽出
//  2. 抽出が乏しい場合: ヘッドレスブラウザでJS描画
//     （描画後テキスト＋ページ自身が読むXHRのJSON）→ Gemini再抽出
//
// ※ ページの取得は各サイトの利用規約に従ってください。
//   本APIはユーザーが指定した単一ページ（とそのページ自身の通信）のみを
//   対象とします（自動巡回なし）。
// =============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 主要フィールドがどれだけ取れたか（name/addressだけでは不十分とみなす） */
function richness(fields: object | undefined): number {
  if (!fields) return 0;
  const f = fields as Record<string, unknown>;
  const important = ["price", "landArea", "buildingArea", "grossYieldPct", "annualRentIncome", "builtYear"];
  return important.filter((k) => f[k] != null).length;
}

async function extract(text: string): Promise<{ result: ExtractionResult; source: string }> {
  if (isGeminiConfigured()) {
    try {
      const raw = await geminiGenerate(EXTRACTION_SYSTEM, [
        textPart(extractionInstruction(false, text, 18000)),
      ]);
      return { result: normalizeExtraction(raw), source: "gemini" };
    } catch {
      // 正規表現へフォールバック
    }
  }
  const p = parseMaisoku(text);
  const { notes, grossYieldPct, ...fields } = p as any;
  return {
    result: {
      fields: { ...fields, ...(grossYieldPct != null ? { grossYieldPct } : {}) },
      evidence: [],
      notes: notes ?? [],
    },
    source: "regex",
  };
}

export async function POST(req: NextRequest) {
  const { url } = await req.json().catch(() => ({ url: "" }));
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "有効なURLを指定してください" }, { status: 400 });
  }

  // ---- 1) 静的HTML取得 → 抽出 ----
  let staticFailed: string | null = null;
  let result: ExtractionResult | null = null;
  let source = "";
  let title = "";
  let method: "static" | "rendered" = "static";

  // 診断情報（0項目時にUIへ表示し、原因切り分けに使う）
  const diag: Record<string, unknown> = {};

  try {
    const page = await fetchPage(url);
    title = page.title;
    diag.staticTextLen = page.text.length;
    diag.staticTitle = page.title?.slice(0, 60) || "";
    const r = await extract(page.text);
    result = r.result;
    source = r.source;
    diag.staticRich = richness(result.fields);
  } catch (e: any) {
    staticFailed = String(e?.message ?? e);
    diag.staticError = staticFailed.slice(0, 200);
  }

  // ---- 2) 主要データが取れていなければ ヘッドレスブラウザで描画 ----
  if (!result || richness(result.fields) < 2) {
    diag.renderAttempted = true;
    try {
      const rendered = await renderPage(url);
      diag.renderOk = true;
      diag.renderTextLen = rendered.text.length;
      diag.jsonBodies = rendered.jsonBodies.length;
      diag.renderTitle = rendered.title?.slice(0, 60) || "";
      diag.renderSample = rendered.text.slice(0, 200);
      const combined = [
        rendered.title && `タイトル: ${rendered.title}`,
        rendered.jsonBodies.length
          ? `ページが取得したデータ(JSON):\n${rendered.jsonBodies.join("\n---\n")}`
          : "",
        rendered.text && `描画後の本文: ${rendered.text}`,
      ]
        .filter(Boolean)
        .join("\n");

      if (combined.trim()) {
        const r = await extract(combined);
        // 描画版の方が情報量が多ければ採用
        if (!result || richness(r.result.fields) > richness(result.fields)) {
          result = r.result;
          source = r.source;
          method = "rendered";
          if (rendered.title) title = rendered.title;
        }
      }
    } catch (e: any) {
      diag.renderOk = false;
      diag.renderError = String(e?.message ?? e).slice(0, 200);
      if (!result) {
        return NextResponse.json(
          {
            error: `ページの取得・描画に失敗しました: ${staticFailed ?? e?.message ?? e}（会員限定ページ・bot制限の可能性）`,
            debug: diag,
          },
          { status: 502 }
        );
      }
    }
  }

  if (!result) {
    return NextResponse.json(
      { error: `ページ取得に失敗しました: ${staticFailed}（サイトの規約・bot制限の可能性）`, debug: diag },
      { status: 502 }
    );
  }

  // 主要データがほとんど取れていない場合の案内（診断つき）
  // ※ structure等が1つだけ取れて「0項目でない」ケースも拾う
  if (richness(result.fields) < 2) {
    const d = diag;
    const renderInfo = d.renderAttempted
      ? d.renderOk
        ? `描画成功(本文${d.renderTextLen}字・JSON${d.jsonBodies}件)`
        : `描画失敗(${d.renderError})`
      : "描画未実行";
    const gotKeys = Object.keys(result.fields ?? {});
    result.notes = [
      gotKeys.length
        ? `物件データを十分に取得できませんでした（取得できた項目: ${gotKeys.join(", ")}）。会員限定/bot対策の可能性があります。確実なのはページのPDF保存/スクショ→画像取込です。`
        : "このページから物件データを自動抽出できませんでした。会員限定（要ログイン）やbot対策の可能性があります。確実なのはページのPDF保存/スクショ→画像取込です。",
      `[診断] 静的取得${d.staticTextLen ?? "—"}字 / ${renderInfo}${d.renderSample ? ` / 冒頭:「${String(d.renderSample).slice(0, 80)}…」` : ""}`,
    ];
  }

  return NextResponse.json({
    source,
    method,
    model: source === "gemini" ? GEMINI_MODEL : undefined,
    sourceUrl: url,
    title,
    debug: diag,
    fields: result.fields,
    evidence: result.evidence,
    notes: result.notes,
  });
}
