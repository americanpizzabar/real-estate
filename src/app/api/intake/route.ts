import { NextRequest, NextResponse } from "next/server";
import {
  geminiGenerate,
  filePart,
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
// POST /api/intake  (multipart/form-data, field "file")
// PDF/画像のマイソクを Gemini マルチモーダルで直接構造化抽出する。
// OCR不要。画像は読み取り根拠のバウンディングボックスも要求。
// =============================================================

export const dynamic = "force-dynamic";
// 大きめのPDF/画像に備える
export const maxDuration = 60;

const ACCEPTED = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

export async function POST(req: NextRequest) {
  if (!isGeminiConfigured()) {
    return NextResponse.json(
      { error: "GOOGLE_AI_API_KEY が未設定です。ファイル取込にはGoogle AIキーが必要です（テキスト貼付は鍵不要）。" },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data が必要です" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file が必要です" }, { status: 400 });
  }

  const mime = file.type || "application/octet-stream";
  if (!ACCEPTED.includes(mime)) {
    return NextResponse.json(
      { error: `非対応の形式です: ${mime}（PDF/JPEG/PNG/WebP/HEIC対応）` },
      { status: 415 }
    );
  }

  // 10MB上限（Geminiインライン制限・Vercel制限に配慮）
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "ファイルが大きすぎます（10MBまで）" }, { status: 413 });
  }
  const base64 = Buffer.from(bytes).toString("base64");

  const isImage = mime.startsWith("image/");
  try {
    const raw = await geminiGenerate(EXTRACTION_SYSTEM, [
      filePart(mime, base64),
      textPart(extractionInstruction(isImage)),
    ]);
    const result = normalizeExtraction(raw);
    return NextResponse.json({
      source: "gemini",
      model: GEMINI_MODEL,
      mime,
      ...result,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `解析に失敗しました: ${e?.message ?? e}` },
      { status: 502 }
    );
  }
}
