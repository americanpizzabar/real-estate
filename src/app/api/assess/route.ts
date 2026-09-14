import { NextRequest, NextResponse } from "next/server";
import { ruleBasedAssessment, type AssessInput, type Assessment } from "@/lib/assess";
import { geminiGenerate, textPart, isGeminiConfigured, GEMINI_MODEL } from "@/lib/external/gemini";

// =============================================================
// POST /api/assess  body: AssessInput
// 物件指標から総合所見を生成。GOOGLE_AI_API_KEY があれば Gemini で
// 自然文の投資所見に拡張、無ければルールベース評価を返す。
// =============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SYSTEM =
  "あなたは日本の不動産投資に精通したプロのアドバイザーです。与えられた物件指標のみに基づき、" +
  "誇張せず具体的な数値に言及して簡潔に所見を述べます。投資家が意思決定に使えるレベルの実務的な内容にしてください。出力は指定JSONのみ。";

export async function POST(req: NextRequest) {
  const a = (await req.json().catch(() => null)) as AssessInput | null;
  if (!a || typeof a.score !== "number") {
    return NextResponse.json({ error: "指標データが不正です" }, { status: 400 });
  }

  // 土台となるルールベース評価（常に算出）
  const rule = ruleBasedAssessment(a);

  if (!isGeminiConfigured()) {
    return NextResponse.json(rule);
  }

  try {
    const prompt = `次の物件指標から投資所見をJSONで出力してください。
指標:
- 物件名: ${a.name}
- 価格: ${a.price.toLocaleString()}円 / 運用: ${a.mode === "rental" ? "賃貸" : "民泊"}
- 表面利回り: ${a.grossYieldPct.toFixed(1)}% / 実質利回り(NOI): ${a.netYieldPct.toFixed(1)}%
- 土地値比率: ${(a.landValueRatio * 100).toFixed(0)}% / 積算評価率: ${(a.costValueRatio * 100).toFixed(0)}%
- DSCR: ${isFinite(a.dscr) ? a.dscr.toFixed(2) : "—"} / CCR: ${a.ccr.toFixed(1)}% / IRR: ${a.irrPct != null ? a.irrPct.toFixed(1) + "%" : "—"}
- 自己資金回収: ${a.paybackYear ?? "期間内不可"} / デッドクロス: ${a.deadCrossYear ?? "なし"}
- 総合スコア: ${a.score}(${a.grade})
${a.vsFairPct != null ? `- 適正価格乖離: ${a.vsFairPct.toFixed(1)}%（+割高）\n` : ""}${a.compTScore != null ? `- 周辺相場 割安度偏差値: ${a.compTScore}\n` : ""}${a.probLossIRR != null ? `- モンテカルロ損失確率: ${(a.probLossIRR * 100).toFixed(0)}%\n` : ""}${a.hazardAffected ? `- ハザード: ${a.hazardSummary ?? "該当あり"}\n` : ""}
出力JSON形式:
{"verdict":"買い推奨"|"条件付き検討"|"慎重・見送り寄り","strengths":[string,...最大4],"weaknesses":[string,...最大4],"risks":[string,...最大4],"exit":"出口戦略の所見","comment":"総合所見2〜3文"}
数値に具体的に言及し、投資家目線で率直に。`;

    const raw = await geminiGenerate(SYSTEM, [textPart(prompt)]);
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : {};
    const verdict = ["買い推奨", "条件付き検討", "慎重・見送り寄り"].includes(parsed.verdict)
      ? parsed.verdict
      : rule.verdict;
    const verdictColor =
      verdict === "買い推奨" ? "#2dd4a7" : verdict === "条件付き検討" ? "#f5b14c" : "#f56c6c";
    const result: Assessment = {
      verdict,
      verdictColor,
      strengths: Array.isArray(parsed.strengths) && parsed.strengths.length ? parsed.strengths.slice(0, 4) : rule.strengths,
      weaknesses: Array.isArray(parsed.weaknesses) && parsed.weaknesses.length ? parsed.weaknesses.slice(0, 4) : rule.weaknesses,
      risks: Array.isArray(parsed.risks) && parsed.risks.length ? parsed.risks.slice(0, 4) : rule.risks,
      exit: typeof parsed.exit === "string" && parsed.exit ? parsed.exit : rule.exit,
      comment: typeof parsed.comment === "string" && parsed.comment ? parsed.comment : rule.comment,
      source: "gemini",
    };
    return NextResponse.json({ ...result, model: GEMINI_MODEL });
  } catch {
    // 失敗時はルールベースへフォールバック
    return NextResponse.json(rule);
  }
}
