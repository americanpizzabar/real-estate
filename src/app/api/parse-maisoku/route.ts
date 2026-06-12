import { NextRequest, NextResponse } from "next/server";
import { parseMaisoku } from "@/lib/external/maisokuParser";

// =============================================================
// POST /api/parse-maisoku  { text: string }
// ANTHROPIC_API_KEY があれば Claude で構造化抽出、無ければ正規表現抽出。
// =============================================================

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { text } = await req.json().catch(() => ({ text: "" }));
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const llm = await extractWithClaude(text, apiKey);
      return NextResponse.json({ source: "llm", parsed: llm });
    } catch (e) {
      // フォールバック
    }
  }

  const parsed = parseMaisoku(text);
  return NextResponse.json({ source: "regex", parsed });
}

async function extractWithClaude(text: string, apiKey: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system:
        "あなたは不動産のマイソク（物件概要書）から投資判断用の項目を抽出するアシスタントです。出力は必ず指定のJSONのみ。",
      messages: [
        {
          role: "user",
          content: `次のマイソクテキストから、JSONで以下のキーを抽出してください。値が不明なキーは省略可。金額は円(number)、面積は㎡(number)、築年は西暦(number)、路線価は円/㎡(number)、利回りは%(number)。
キー: name, address, price, landArea, buildingArea, structure(RC|SRC|S|LightS|W), builtYear, rosenkaPerSqm, koujiPerSqm, grossYieldPct
JSONのみ出力。

---
${text.slice(0, 6000)}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = await res.json();
  const content = data?.content?.[0]?.text ?? "{}";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
  return { ...parsed, notes: ["Claudeで抽出"] };
}
