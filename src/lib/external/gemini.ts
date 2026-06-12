// =============================================================
// Google AI (Gemini) クライアント
// テキスト/ 画像 / PDF を generateContent に投げて構造化JSONを得る。
// GOOGLE_AI_API_KEY または GEMINI_API_KEY を使用。
// =============================================================

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

export function geminiApiKey(): string | null {
  return process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || null;
}

export function isGeminiConfigured(): boolean {
  return geminiApiKey() !== null;
}

type Part =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

/** Gemini にコンテンツ群を投げ、生成テキスト（JSON文字列想定）を返す。 */
export async function geminiGenerate(
  system: string,
  parts: Part[]
): Promise<string> {
  const key = geminiApiKey();
  if (!key) throw new Error("GOOGLE_AI_API_KEY 未設定");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": key,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`gemini ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
}

/** 画像/PDFをマルチモーダルで解析するためのパートを組み立てる。 */
export function filePart(mimeType: string, base64: string): Part {
  return { inline_data: { mime_type: mimeType, data: base64 } };
}

export function textPart(text: string): Part {
  return { text };
}
