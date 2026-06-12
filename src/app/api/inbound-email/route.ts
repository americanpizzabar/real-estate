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
// POST /api/inbound-email
// 「転送するだけ」インポートの受け口（Webhook）。
//
// メール受信は外部サービス（SendGrid Inbound Parse / Mailgun Routes /
// Cloudflare Email Workers 等）が必要。各サービスの "Inbound Parse" を
//   宛先: upload-<user>@<your-domain>
//   転送先(Webhook): https://<your-app>/api/inbound-email
// に設定すると、添付PDF/画像付きの POST がここに届く。
//
// 本ルートは SendGrid Inbound Parse の multipart 形式を主に想定し、
// 添付ファイルを取り出して Gemini で解析、抽出結果を返す。
// 永続化（どのユーザーのカタログに入れるか）は宛先アドレスの
// ローカルパート（upload-<user>）でルーティングする設計。
//
// セキュリティ: 本番では送信元の署名検証（SendGrid: 公開鍵, Mailgun: HMAC）
// を必ず追加すること。下記は雛形。
// =============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isGeminiConfigured()) {
    return NextResponse.json({ error: "GOOGLE_AI_API_KEY 未設定" }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data が必要です" }, { status: 400 });
  }

  // 宛先アドレスからユーザーを特定（例: upload-tanaka@app.com → "tanaka"）
  const to = String(form.get("to") || form.get("recipient") || "");
  const userMatch = to.match(/upload-([a-zA-Z0-9_.-]+)@/);
  const userKey = userMatch ? userMatch[1] : null;

  // 添付ファイル（SendGrid: attachment1, attachment2... / 件数は attachments）
  const files: File[] = [];
  for (const [, v] of form.entries()) {
    if (v instanceof File && /pdf|image\//.test(v.type)) files.push(v);
  }

  if (files.length === 0) {
    // 添付が無い場合は本文テキストでの抽出にフォールバック
    const bodyText = String(form.get("text") || form.get("html") || "");
    if (!bodyText) {
      return NextResponse.json({ error: "添付・本文がありません" }, { status: 400 });
    }
    const raw = await geminiGenerate(EXTRACTION_SYSTEM, [
      textPart(extractionInstruction(false, bodyText)),
    ]);
    return NextResponse.json({ userKey, count: 1, results: [normalizeExtraction(raw)] });
  }

  const results = [];
  for (const f of files.slice(0, 5)) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const base64 = Buffer.from(bytes).toString("base64");
    const isImage = f.type.startsWith("image/");
    try {
      const raw = await geminiGenerate(EXTRACTION_SYSTEM, [
        filePart(f.type, base64),
        textPart(extractionInstruction(isImage)),
      ]);
      results.push(normalizeExtraction(raw));
    } catch (e: any) {
      results.push({ fields: {}, evidence: [], notes: [`解析失敗: ${e?.message}`] });
    }
  }

  // NOTE: 実運用では results を userKey のカタログ（DB）へ保存する。
  // 現状はlocalStorageベースのためサーバ保存は未接続（Supabase等への拡張ポイント）。
  return NextResponse.json({ userKey, model: GEMINI_MODEL, count: results.length, results });
}
