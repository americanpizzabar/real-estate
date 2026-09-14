"use client";
import React from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, LineChart, Line, ComposedChart, Legend,
} from "recharts";
import {
  runMonteCarlo, runTornado, optimalExit, ltvDscrSeries,
  type MonteCarloResult,
} from "@/lib/calc/advanced";
import type { ProjectionInput } from "@/lib/calc/projection";
import type { IncomeMode } from "@/lib/calc/types";
import { Card, Metric } from "./ui";
import { pct, yen } from "@/lib/format";

export function AdvancedTab({ projInput, mode }: { projInput: ProjectionInput; mode: IncomeMode }) {
  const [mc, setMc] = React.useState<MonteCarloResult | null>(null);
  const [running, setRunning] = React.useState(false);

  // 軽量な分析は自動計算
  const tornado = React.useMemo(() => runTornado(projInput), [projInput]);
  const exit = React.useMemo(() => optimalExit(projInput), [projInput]);
  const series = React.useMemo(() => ltvDscrSeries(projInput), [projInput]);

  // モンテカルロは重いので入力変更で無効化 → ボタン実行
  React.useEffect(() => { setMc(null); }, [projInput]);
  const runMC = () => {
    setRunning(true);
    // UIをブロックしないよう次tick
    setTimeout(() => {
      setMc(runMonteCarlo(projInput, 2000));
      setRunning(false);
    }, 10);
  };

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-slate-400">
        機関投資家グレードの定量リスク分析（{mode === "rental" ? "賃貸" : "民泊"}モード）。
        金利・出口Cap・{mode === "rental" ? "空室率・賃料・賃料下落" : "稼働率・ADR"}の不確実性を織り込みます。
      </div>

      {/* モンテカルロ */}
      <Card
        title="モンテカルロ・シミュレーション（IRR分布・損失確率）"
        right={
          <button
            onClick={runMC}
            disabled={running}
            className="px-3 py-1 rounded-md text-xs font-bold bg-accent hover:bg-accent/90 text-white disabled:opacity-50 print:hidden"
          >
            {running ? "計算中…" : mc ? "再実行" : "▶ 2,000回シミュレーション"}
          </button>
        }
      >
        {!mc ? (
          <p className="text-sm text-slate-400 py-6 text-center">
            各ドライバーを確率分布でサンプリングし、IRRの分布（P10/P50/P90）・損失確率・DSCR割れ確率を算出します。
          </p>
        ) : (
          <MonteCarloView mc={mc} />
        )}
      </Card>

      <div className="grid grid-cols-12 gap-4">
        {/* トルネード */}
        <Card title="トルネード感度分析（IRRへの影響度）" className="col-span-12 lg:col-span-6">
          <TornadoView tornado={tornado} />
        </Card>

        {/* 最適出口 */}
        <Card title="最適保有期間（売却年別IRR）" className="col-span-12 lg:col-span-6">
          <ExitView exit={exit} />
        </Card>
      </div>

      {/* LTV/DSCR推移 */}
      <Card title="LTV / DSCR 年次推移（融資評価の時系列）">
        <LtvDscrView series={series} />
      </Card>
    </div>
  );
}

function MonteCarloView({ mc }: { mc: MonteCarloResult }) {
  const p = mc.percentiles;
  const lossColor = mc.probLossIRR > 0.2 ? "#f56c6c" : mc.probLossIRR > 0.05 ? "#f5b14c" : "#2dd4a7";
  const data = mc.histogram.map((h) => ({
    x: `${h.binStart.toFixed(0)}`,
    mid: (h.binStart + h.binEnd) / 2,
    count: h.count,
  }));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Metric label="IRR中央値(P50)" value={isFinite(p.p50) ? pct(p.p50) : "—"} color="#4f9cf9" emphasize />
        <Metric label="悲観(P10)" value={isFinite(p.p10) ? pct(p.p10) : "—"} />
        <Metric label="楽観(P90)" value={isFinite(p.p90) ? pct(p.p90) : "—"} />
        <Metric label="平均" value={isFinite(p.mean) ? pct(p.mean) : "—"} />
        <Metric label="損失確率(IRR<0)" value={pct(mc.probLossIRR * 100)} color={lossColor} sub="下振れリスク" />
        <Metric label="CF赤字が出る確率" value={pct(mc.probNegCF * 100)} color={mc.probNegCF > 0.3 ? "#f56c6c" : undefined} />
        <Metric label="DSCR<1.0 確率" value={pct(mc.probDscrUnder1 * 100)} color={mc.probDscrUnder1 > 0.1 ? "#f56c6c" : undefined} />
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="#1f2937" vertical={false} />
          <XAxis dataKey="x" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(v) => `${v}%`} interval={2} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} width={36} />
          <ReferenceLine x={`${Math.floor(p.p50)}`} stroke="#4f9cf9" strokeDasharray="4 3" label={{ value: "P50", fill: "#4f9cf9", fontSize: 10, position: "top" }} />
          <ReferenceLine x="0" stroke="#f56c6c" />
          <Tooltip
            contentStyle={{ background: "#111827", border: "1px solid #2e3a4f", borderRadius: 8, fontSize: 12 }}
            formatter={(v: number) => [`${v}件`, "試行数"]}
            labelFormatter={(l) => `IRR ${l}%台`}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.mid < 0 ? "#a8443b" : d.mid < (mc.baseIrr ?? 0) ? "#3b6ea8" : "#2dd4a7"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-slate-500">
        {mc.trials.toLocaleString()}回試行。分布が0%より左に広いほど下振れリスクが大きい。
        損失確率 {pct(mc.probLossIRR * 100)} は「IRRがマイナスになる（元本割れ）確率」。
      </p>
    </div>
  );
}

function TornadoView({ tornado }: { tornado: ReturnType<typeof runTornado> }) {
  const base = tornado.baseIrr ?? 0;
  const data = tornado.bars.map((b) => {
    const lo = Math.min(b.low, b.high);
    const hi = Math.max(b.low, b.high);
    return { label: b.label, base: lo, delta: hi - lo, low: b.low, high: b.high, swing: b.swing };
  });
  return (
    <>
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 44)}>
        <BarChart layout="vertical" data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="#1f2937" horizontal={false} />
          <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
          <YAxis type="category" dataKey="label" tick={{ fill: "#cbd5e1", fontSize: 11 }} width={72} />
          <ReferenceLine x={base} stroke="#4f9cf9" strokeDasharray="4 3" label={{ value: "基準", fill: "#4f9cf9", fontSize: 10, position: "top" }} />
          <Tooltip
            contentStyle={{ background: "#111827", border: "1px solid #2e3a4f", borderRadius: 8, fontSize: 12 }}
            formatter={(_: any, __: any, pl: any) => [`${pl.payload.low.toFixed(1)}% 〜 ${pl.payload.high.toFixed(1)}%（幅${pl.payload.swing.toFixed(1)}pt）`, "IRRレンジ"]}
          />
          <Bar dataKey="base" stackId="t" fill="transparent" />
          <Bar dataKey="delta" stackId="t" radius={[3, 3, 3, 3]} fill="#f5b14c" />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-slate-500 mt-1">
        各ドライバーを想定レンジの最小〜最大に振ったときのIRR変動幅。上ほど影響が大きい＝重点管理項目。
      </p>
    </>
  );
}

function ExitView({ exit }: { exit: ReturnType<typeof optimalExit> }) {
  const data = exit.points.map((p) => ({ year: `${p.year}`, irr: p.irrPct }));
  return (
    <>
      <div className="mb-2">
        <Metric
          label="IRR最大の売却年"
          value={exit.bestYear ? `${exit.bestYear}年目` : "—"}
          sub={exit.bestIrr != null ? `IRR ${pct(exit.bestIrr)}` : undefined}
          color="#2dd4a7"
        />
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="#1f2937" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 10 }} interval={1} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} width={40} tickFormatter={(v) => `${v}%`} />
          <ReferenceLine y={0} stroke="#475569" />
          {exit.bestYear && (
            <ReferenceLine x={`${exit.bestYear}`} stroke="#2dd4a7" strokeDasharray="4 3" label={{ value: "最適", fill: "#2dd4a7", fontSize: 10, position: "top" }} />
          )}
          <Tooltip
            contentStyle={{ background: "#111827", border: "1px solid #2e3a4f", borderRadius: 8, fontSize: 12 }}
            formatter={(v: number) => [v != null ? `${v.toFixed(1)}%` : "—", "IRR"]}
            labelFormatter={(l) => `${l}年で売却`}
          />
          <Line type="monotone" dataKey="irr" stroke="#4f9cf9" strokeWidth={2.5} dot={{ r: 2 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-slate-500 mt-1">
        保有年数ごとの想定IRR（各年で売却した場合）。早すぎる出口は諸経費負け、遅すぎるとデッドクロスで効率低下。
      </p>
    </>
  );
}

function LtvDscrView({ series }: { series: ReturnType<typeof ltvDscrSeries> }) {
  const data = series.map((s) => ({
    year: `${s.year}`,
    ltv: Math.round(s.ltv),
    dscr: isFinite(s.dscr) ? Number(s.dscr.toFixed(2)) : null,
  }));
  return (
    <>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="#1f2937" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 10 }} interval={1} />
          <YAxis yAxisId="l" tick={{ fill: "#94a3b8", fontSize: 10 }} width={40} tickFormatter={(v) => `${v}%`} />
          <YAxis yAxisId="r" orientation="right" tick={{ fill: "#94a3b8", fontSize: 10 }} width={36} domain={[0, "auto"]} />
          <ReferenceLine yAxisId="r" y={1.3} stroke="#2dd4a7" strokeDasharray="3 3" label={{ value: "DSCR1.3", fill: "#2dd4a7", fontSize: 9, position: "insideTopLeft" }} />
          <ReferenceLine yAxisId="l" y={100} stroke="#f56c6c" strokeDasharray="3 3" label={{ value: "LTV100%", fill: "#f56c6c", fontSize: 9 }} />
          <Tooltip contentStyle={{ background: "#111827", border: "1px solid #2e3a4f", borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => (v === "ltv" ? "LTV(残債/市場価値)" : "DSCR")} />
          <Line yAxisId="l" type="monotone" dataKey="ltv" stroke="#f56c6c" strokeWidth={2} dot={false} />
          <Line yAxisId="r" type="monotone" dataKey="dscr" stroke="#2dd4a7" strokeWidth={2} dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-slate-500 mt-1">
        LTV＝残債÷推定市場価値（各年NOI÷出口Cap）。返済でLTVが下がりDSCRが改善するほど融資評価は安定。
      </p>
    </>
  );
}
