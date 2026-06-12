import { NextRequest, NextResponse } from "next/server";
import { parseMaisoku } from "@/lib/external/maisokuParser";

// =============================================================
// POST /api/parse-maisoku  { text: string }
// GOOGLE_AI_API_KEY (Gemini) があれば LLM で構造化抽出、無ければ正規表現抽出。
// =============================================================

export const dynamic = "force-dynamic";

// 使用モデル（環境変数で上書き可）。Google AI Studio の無料枠で利用可能な高速モデル。
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

export async function POST(req: NextRequest) {
  const { text } = await req.json().catch(() => ({ text: "" }));
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  // GOOGLE_AI_API_KEY / GEMINI_API_KEY のどちらでも受け付ける
  const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const llm = await extractWithGemini(text, apiKey);
      return NextResponse.json({ source: "gemini", model: GEMINI_MODEL, parsed: llm });
    } catch (e) {
      // 失敗時は正規表現抽出にフォールバック
    }
  }

  const parsed = parseMaisoku(text);
  return NextResponse.json({ source: "regex", parsed });
}

const SYSTEM_PROMPT =
  "あなたは不動産のマイソク（物件概要書）から投資判断用の項目を抽出するアシスタントです。出力は必ず指定スキーマのJSONのみ。";

const USER_PROMPT = (text: string) =>
  `次のマイソクテキストから項目を抽出してください。値が不明なキーは省略可。金額は円(number)、面積は㎡(number)、築年は西暦(number)、路線価は円/㎡(number)、利回りは%(number)。
キー: name, address, price, landArea, buildingArea, structure(RC|SRC|S|LightS|W のいずれか), builtYear, rosenkaPerSqm, koujiPerSqm, grossYieldPct

---
${text.slice(0, 6000)}`;

async function extractWithGemini(text: string, apiKey: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // ヘッダー経由でキーを渡す（URLに載せないことで漏洩リスクを低減）
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: USER_PROMPT(text) }] }],
      generationConfig: {
        temperature: 0,
        // JSON出力を強制
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`gemini ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const content: string =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
  return { ...parsed, notes: ["Gemini で抽出"] };
}
