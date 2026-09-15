import { NextRequest, NextResponse } from "next/server";
import { geminiGenerate, textPart, isGeminiConfigured, GEMINI_MODEL } from "@/lib/external/gemini";

// =============================================================
// POST /api/portfolio-advice
// body: { summary, optimization }  ← summarizePortfolio + optimizePortfolio
// ポートフォリオ全体への自然文アドバイスを生成。
// GOOGLE_AI_API_KEY があれば Gemini、無ければルールベースを整形。
// =============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SYSTEM =
  "あなたは不動産投資ポートフォリオのアドバイザーです。与えられた集計・分散指標に基づき、" +
  "全体診断・リスク・次の一手（買い増し/売却/借換え等）を具体的に助言します。誇張せず数値に言及。出力は指定JSONのみ。";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.summary || !body?.optimization) {
    return NextResponse.json({ error: "summary と optimization が必要です" }, { status: 400 });
  }
  const s = body.summary;
  const o = body.optimization;

  // ルールベース土台
  const headlineRule =
    o.diversificationScore >= 60 ? "分散良好・安定運用型"
      : o.diversificationScore >= 35 ? "やや集中・改善余地あり"
        : "集中リスク大・要リバランス";
  const ruleAdvice =
    `${s.count}件・合計${Math.round((s.totalPrice ?? 0) / 1e8 * 10) / 10}億円のポートフォリオ。` +
    `全体LTV ${Math.round(s.overallLtvPct)}%、ポートフォリオDSCR ${isFinite(s.portfolioDscr) ? s.portfolioDscr.toFixed(2) : "—"}。` +
    (o.diversificationScore < 40 ? "分散が不足しており、価格変動・空室・災害リスクが特定の物件/エリアに集中しています。" : "リスクは概ね分散されています。");
  const fallback = {
    headline: headlineRule,
    advice: ruleAdvice,
    actions: o.suggestions ?? [],
    source: "rule" as const,
  };

  if (!isGeminiConfigured()) return NextResponse.json(fallback);

  try {
    const prompt = `次の不動産投資ポートフォリオを診断し、JSONで助言してください。
集計:
- 物件数: ${s.count} / 合計投資額: ${Math.round((s.totalPrice ?? 0) / 1e4).toLocaleString()}万円 / 合計借入: ${Math.round((s.totalLoan ?? 0) / 1e4).toLocaleString()}万円
- 全体LTV: ${Math.round(s.overallLtvPct)}% / ポートフォリオDSCR: ${isFinite(s.portfolioDscr) ? s.portfolioDscr.toFixed(2) : "—"}
- 加重表面利回り: ${(s.weightedGrossYieldPct ?? 0).toFixed(1)}% / 加重実質利回り: ${(s.weightedNetYieldPct ?? 0).toFixed(1)}%
- 合計NOI: ${Math.round((s.totalNoi ?? 0) / 1e4).toLocaleString()}万円/年 / 合計税引前CF: ${Math.round((s.totalBtcf ?? 0) / 1e4).toLocaleString()}万円/年
- 平均スコア: ${Math.round(s.avgScore ?? 0)}
分散:
- 分散スコア: ${o.diversificationScore}/100 / 種別集中HHI: ${o.hhiKind?.toFixed(2)} / エリア集中HHI: ${o.hhiArea?.toFixed(2)}
- 最大集中: ${o.topConcentration ? `${o.topConcentration.label}(${o.topConcentration.sharePct}%)` : "—"}
出力JSON: {"headline":"30字以内の総括","advice":"2〜3文の全体診断","actions":["具体的な次の一手",...最大4]}
投資家目線で率直に、リバランス・買い増し・借換え等の実務アクションを。`;
    const raw = await geminiGenerate(SYSTEM, [textPart(prompt)]);
    const m = raw.match(/\{[\s\S]*\}/);
    const p = m ? JSON.parse(m[0]) : {};
    return NextResponse.json({
      headline: typeof p.headline === "string" && p.headline ? p.headline : fallback.headline,
      advice: typeof p.advice === "string" && p.advice ? p.advice : fallback.advice,
      actions: Array.isArray(p.actions) && p.actions.length ? p.actions.slice(0, 4) : fallback.actions,
      source: "gemini",
      model: GEMINI_MODEL,
    });
  } catch {
    return NextResponse.json(fallback);
  }
}
