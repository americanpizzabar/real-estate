"use client";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import type { ScoreResult } from "@/lib/calc/scoring";

const AXIS_LABELS: Record<keyof ScoreResult["axes"], string> = {
  landSafety: "土地値比率",
  costValue: "積算評価",
  profitability: "収益性",
  financeability: "融資妥当性",
  marketGap: "市場割安度",
  cashEfficiency: "資金効率",
};

const GRADE_COLOR: Record<ScoreResult["grade"], string> = {
  S: "#2dd4a7",
  A: "#4f9cf9",
  B: "#f5b14c",
  C: "#f59e4c",
  D: "#f56c6c",
};

export function ScoreRadar({ score }: { score: ScoreResult }) {
  const data = (Object.keys(score.axes) as (keyof ScoreResult["axes"])[]).map(
    (k) => ({ axis: AXIS_LABELS[k], value: score.axes[k] })
  );
  const color = GRADE_COLOR[score.grade];

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full" style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="#2e3a4f" />
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fill: "#94a3b8", fontSize: 11 }}
            />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar
              dataKey="value"
              stroke={color}
              fill={color}
              fillOpacity={0.28}
              strokeWidth={2}
            />
          </RadarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] text-slate-400">総合スコア</span>
          <span className="text-4xl font-bold tnum" style={{ color }}>
            {score.total}
          </span>
          <span
            className="text-sm font-bold px-2 rounded mt-0.5"
            style={{ color, border: `1px solid ${color}` }}
          >
            {score.grade}
          </span>
        </div>
      </div>
      <p className="text-xs text-slate-300 mt-2 leading-relaxed">{score.comment}</p>
    </div>
  );
}
