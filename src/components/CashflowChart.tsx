"use client";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
  Cell,
} from "recharts";
import { yen } from "@/lib/format";
import type { CashflowYearRow, InvestmentMetrics } from "@/lib/calc/types";

// 累積キャッシュフロー（折れ線）+ 年次BTCF（棒）+ デッドクロス/元本回収マーカー
export function CashflowChart({
  rows,
  metrics,
}: {
  rows: CashflowYearRow[];
  metrics: InvestmentMetrics;
}) {
  const data = rows.map((r) => ({
    year: `${r.year}年`,
    yearNum: r.year,
    btcf: r.btcf,
    cumulative: r.cumulativeBtcf,
    isDeadCross: r.isDeadCross,
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <CartesianGrid stroke="#1f2937" vertical={false} />
        <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 10 }} interval={0} />
        <YAxis
          tick={{ fill: "#94a3b8", fontSize: 10 }}
          tickFormatter={(v) => yen(v)}
          width={64}
        />
        <ReferenceLine y={0} stroke="#475569" />
        {metrics.paybackYear && (
          <ReferenceLine
            x={`${metrics.paybackYear}年`}
            stroke="#2dd4a7"
            strokeDasharray="4 3"
            label={{ value: "元本回収", fill: "#2dd4a7", fontSize: 10, position: "top" }}
          />
        )}
        {metrics.deadCrossYear && (
          <ReferenceLine
            x={`${metrics.deadCrossYear}年`}
            stroke="#f56c6c"
            strokeDasharray="4 3"
            label={{ value: "デッドクロス", fill: "#f56c6c", fontSize: 10, position: "insideTopRight" }}
          />
        )}
        <Tooltip
          contentStyle={{
            background: "#111827",
            border: "1px solid #2e3a4f",
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(v: number, name) => [
            yen(v),
            name === "btcf" ? "年次BTCF" : "累積CF",
          ]}
        />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          formatter={(v) => (v === "btcf" ? "年次BTCF" : "累積CF（自己資金回収）")}
        />
        <Bar dataKey="btcf" barSize={14} radius={[2, 2, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.btcf >= 0 ? "#3b6ea8" : "#a8443b"} />
          ))}
        </Bar>
        <Line
          type="monotone"
          dataKey="cumulative"
          stroke="#2dd4a7"
          strokeWidth={2.5}
          dot={{ r: 2 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
