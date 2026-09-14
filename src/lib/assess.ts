// =============================================================
// AI総合所見 — ルールベース評価（Gemini未接続でも動作）
// 各指標から強み/弱み/リスク/出口戦略/総合判断を生成する純関数。
// API側で Gemini があれば、この構造化データを土台に自然文へ拡張する。
// =============================================================

export interface AssessInput {
  name: string;
  price: number;
  grossYieldPct: number;
  netYieldPct: number;
  landValueRatio: number; // 0-1
  costValueRatio: number; // 0-1
  dscr: number;
  ccr: number;
  irrPct: number | null;
  paybackYear: number | null;
  deadCrossYear: number | null;
  score: number;
  grade: string;
  mode: "rental" | "minpaku";
  // 任意
  vsFairPct?: number | null; // 適正価格乖離（+割高）
  compTScore?: number | null; // 割安度偏差値
  probLossIRR?: number | null; // モンテカルロ損失確率(0-1)
  hazardSummary?: string | null;
  hazardAffected?: boolean;
}

export type Verdict = "買い推奨" | "条件付き検討" | "慎重・見送り寄り";

export interface Assessment {
  verdict: Verdict;
  verdictColor: string;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  exit: string;
  comment: string;
  source: "rule" | "gemini";
}

const pct = (v: number, d = 1) => `${v.toFixed(d)}%`;

export function ruleBasedAssessment(a: AssessInput): Assessment {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const risks: string[] = [];

  // 強み
  if (a.landValueRatio >= 0.7) strengths.push(`土地値比率${pct(a.landValueRatio * 100, 0)}と高く、資産保全性・融資評価に優れる`);
  else if (a.landValueRatio >= 0.5) strengths.push(`土地値比率${pct(a.landValueRatio * 100, 0)}でバランス良好`);
  if (a.netYieldPct >= 6) strengths.push(`実質利回り${pct(a.netYieldPct)}と収益性が高い`);
  if (isFinite(a.dscr) && a.dscr >= 1.3) strengths.push(`DSCR ${a.dscr.toFixed(2)}で返済余力が厚く融資が引きやすい`);
  if (a.compTScore != null && a.compTScore >= 55) strengths.push(`周辺相場に対し割安度偏差値${a.compTScore}（割安）`);
  if (a.vsFairPct != null && a.vsFairPct <= -5) strengths.push(`適正市場価格より${pct(Math.abs(a.vsFairPct))}割安`);
  if (a.ccr >= 8) strengths.push(`自己資金配当率(CCR) ${pct(a.ccr)}と資金効率が高い`);

  // 弱み
  if (a.landValueRatio < 0.3) weaknesses.push(`土地値比率${pct(a.landValueRatio * 100, 0)}と低く、将来の融資評価・出口に不安`);
  if (a.netYieldPct < 4) weaknesses.push(`実質利回り${pct(a.netYieldPct)}と低く収益性が弱い`);
  if (isFinite(a.dscr) && a.dscr < 1.1) weaknesses.push(`DSCR ${a.dscr.toFixed(2)}と返済余力が薄い`);
  if (a.costValueRatio < 0.7) weaknesses.push(`積算評価率${pct(a.costValueRatio * 100, 0)}で価格が積算を上回り割高感`);
  if (a.vsFairPct != null && a.vsFairPct >= 8) weaknesses.push(`適正市場価格より${pct(a.vsFairPct)}割高`);
  if (a.paybackYear == null) weaknesses.push("予測期間内に自己資金を回収できない");

  // リスク
  if (a.deadCrossYear != null && a.deadCrossYear <= 8) risks.push(`${a.deadCrossYear}年目にデッドクロス（黒字倒産リスク）`);
  if (a.probLossIRR != null && a.probLossIRR >= 0.2) risks.push(`モンテカルロで損失確率${pct(a.probLossIRR * 100, 0)}と下振れリスクが大きい`);
  if (a.hazardAffected) risks.push(`ハザード該当（${a.hazardSummary ?? "要確認"}）。保険・融資・出口に影響`);
  if (a.mode === "minpaku") risks.push("民泊は稼働率・ADRの変動と規制（180日/条例）に収益が左右される");
  if (isFinite(a.dscr) && a.dscr < 1.3) risks.push("金利上昇・空室でDSCRが1.0を割ると赤字転落");

  // 出口戦略
  let exit: string;
  if (a.landValueRatio >= 0.8) exit = "土地値が下支えするため、更地化・実需売却・保有継続いずれも柔軟。下値が堅い。";
  else if (a.landValueRatio >= 0.5) exit = "収益還元と土地値の両にらみ。市況を見て売却/保有を選択可能。";
  else if (a.landValueRatio >= 0.3) exit = "収益物件としての売却が基本。買主の融資が付く築年・利回りのうちに出口を。";
  else exit = "更地化より実需（実住）向け転売を想定。融資評価が出にくく出口難度は高い。";

  // 総合判断（スコア＋主要指標で決定）
  let verdict: Verdict;
  let verdictColor: string;
  const dscrOk = !isFinite(a.dscr) || a.dscr >= 1.2;
  if (a.score >= 70 && dscrOk && weaknesses.length <= 1) {
    verdict = "買い推奨";
    verdictColor = "#2dd4a7";
  } else if (a.score >= 50 && (isFinite(a.dscr) ? a.dscr >= 1.05 : true)) {
    verdict = "条件付き検討";
    verdictColor = "#f5b14c";
  } else {
    verdict = "慎重・見送り寄り";
    verdictColor = "#f56c6c";
  }

  const comment =
    `総合スコア${a.score}(${a.grade})。${verdict}。` +
    (strengths[0] ? `最大の強みは${strengths[0]}。` : "") +
    (weaknesses[0] ? `一方で${weaknesses[0]}点に留意。` : "") +
    (risks[0] ? `主要リスクは${risks[0]}。` : "");

  return {
    verdict, verdictColor,
    strengths: strengths.length ? strengths : ["特筆すべき強みは限定的"],
    weaknesses: weaknesses.length ? weaknesses : ["致命的な弱みは見当たらない"],
    risks: risks.length ? risks : ["標準的な賃貸経営リスクの範囲"],
    exit, comment, source: "rule",
  };
}
