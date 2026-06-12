"use client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { yen } from "@/lib/format";
import type { IncomeBreakdown } from "@/lib/calc/income";

// 収入 → 手残り（BTCF）までの資金の川流れ（ウォーターフォール）
export interface WaterfallStep {
  label: string;
  amount: number; // 正=収入/起点、負=控除
  kind: "total" | "minus" | "result";
}

export function buildWaterfall(
  income: IncomeBreakdown,
  debtService: number
): WaterfallStep[] {
  const steps: WaterfallStep[] = [
    { label: "満室総収入(GPI)", amount: income.gpi, kind: "total" },
    { label: "空室・稼働ロス", amount: -income.vacancyLoss, kind: "minus" },
  ];
  for (const d of income.opexDetail) {
    if (d.amount > 0) steps.push({ label: d.label, amount: -d.amount, kind: "minus" });
  }
  steps.push({ label: "ローン返済", amount: -debtService, kind: "minus" });
  const btcf = income.noi - debtService;
  steps.push({ label: "税引前CF(手残り)", amount: btcf, kind: "result" });
  return steps;
}

interface FloatingBar {
  label: string;
  base: number; // 透明な下駄
  delta: number; // 実際に描画する高さ
  amount: number;
  kind: WaterfallStep["kind"];
}

function toFloating(steps: WaterfallStep[]): FloatingBar[] {
  let running = 0;
  const out: FloatingBar[] = [];
  for (const s of steps) {
    if (s.kind === "total" || s.kind === "result") {
      out.push({
        label: s.label,
        base: 0,
        delta: s.amount,
        amount: s.amount,
        kind: s.kind,
      });
      running = s.amount;
    } else {
      // 控除: running から下へ
      const top = running;
      const bottom = running + s.amount; // amount は負
      out.push({
        label: s.label,
        base: Math.min(top, bottom),
        delta: Math.abs(s.amount),
        amount: s.amount,
        kind: s.kind,
      });
      running = bottom;
    }
  }
  return out;
}

const COLORS = {
  total: "#4f9cf9",
  minus: "#f56c6c",
  result: "#2dd4a7",
};

export function WaterfallChart({ steps }: { steps: WaterfallStep[] }) {
  const data = toFloating(steps);
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 40 }}>
        <XAxis
          dataKey="label"
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={60}
        />
        <YAxis
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          tickFormatter={(v) => yen(v)}
          width={64}
        />
        <ReferenceLine y={0} stroke="#475569" />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={{
            background: "#111827",
            border: "1px solid #2e3a4f",
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(_, __, p) => [yen((p.payload as FloatingBar).amount), "金額"]}
        />
        <Bar dataKey="base" stackId="w" fill="transparent" />
        <Bar dataKey="delta" stackId="w" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={COLORS[d.kind]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
