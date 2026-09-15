"use client";
import React from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, LineChart, Line, ComposedChart, Legend,
} from "recharts";
import {
  runMonteCarlo, runTornado, optimalExit, ltvDscrSeries,
  dcfSeries, heatmapDrivers, irrHeatmap,
  type MonteCarloResult, type HeatmapDriver,
} from "@/lib/calc/advanced";
import type { ProjectionInput } from "@/lib/calc/projection";
import type { IncomeMode, LoanInput } from "@/lib/calc/types";
import { compareLoanStrategies, type LoanEvents } from "@/lib/calc/loanStrategy";
import { analyzeRealOptions, type RealOptionInput } from "@/lib/calc/realOptions";
import { Card, Metric, NumberField, SelectField } from "./ui";
import { pct, yen } from "@/lib/format";

export function AdvancedTab({
  projInput,
  mode,
  loan,
  realOption,
}: {
  projInput: ProjectionInput;
  mode: IncomeMode;
  loan: LoanInput;
  realOption: RealOptionInput;
}) {
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

      {/* DCF精緻化（減価償却内訳＋累積NPV） */}
      <Card title="DCF精緻化（税引後CFの割引現在価値・減価償却内訳）">
        <DcfView projInput={projInput} />
      </Card>

      {/* 2次元感度ヒートマップ */}
      <Card title="2次元感度ヒートマップ（2ドライバー × IRR）">
        <HeatmapView projInput={projInput} />
      </Card>

      {/* LTV/DSCR推移 */}
      <Card title="LTV / DSCR 年次推移（融資評価の時系列）">
        <LtvDscrView series={series} />
      </Card>

      {/* 融資戦略（借換え・繰上返済・変動金利） */}
      <Card title="融資戦略シミュレーション（借換え・繰上返済・変動金利）">
        <LoanStrategyView loan={loan} />
      </Card>

      {/* リアルオプション（最有効使用） */}
      <Card title="リアルオプション分析（最有効使用 HBU）">
        <RealOptionView input={realOption} />
      </Card>
    </div>
  );
}

// ===================== DCF精緻化 =====================
function DcfView({ projInput }: { projInput: ProjectionInput }) {
  const { rows } = React.useMemo(() => dcfSeries(projInput), [projInput]);
  const equipOn = (projInput.equipmentRatio ?? 0) > 0;
  const data = rows.map((r) => ({
    year: `${r.year}`,
    shell: Math.round(r.shellDep / 10000),
    equip: Math.round(r.equipDep / 10000),
    npv: Math.round(r.cumulativeNpv / 10000),
    tax: Math.round(r.tax / 10000),
  }));
  const finalNpv = rows.length ? rows[rows.length - 1].cumulativeNpv : 0;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="運用CFの累積NPV" value={yen(finalNpv)} sub="出口売却は除く" color={finalNpv < 0 ? "#f56c6c" : "#2dd4a7"} />
        <Metric label="設備分離償却" value={equipOn ? `ON（${Math.round((projInput.equipmentRatio ?? 0) * 100)}%設備）` : "OFF"} sub="詳細設定で変更" color={equipOn ? "#4f9cf9" : undefined} />
        <Metric label="初年度償却" value={yen(rows[0]?.shellDep + rows[0]?.equipDep || 0)} />
        <Metric label="初年度税" value={yen(rows[0]?.tax ?? 0)} />
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="#1f2937" vertical={false} />
          <XAxis dataKey="year" tick={{ fill: "#94a3b8", fontSize: 10 }} interval={1} />
          <YAxis yAxisId="l" tick={{ fill: "#94a3b8", fontSize: 10 }} width={44} tickFormatter={(v) => `${v}万`} />
          <YAxis yAxisId="r" orientation="right" tick={{ fill: "#94a3b8", fontSize: 10 }} width={46} tickFormatter={(v) => `${v}万`} />
          <ReferenceLine yAxisId="r" y={0} stroke="#475569" />
          <Tooltip contentStyle={{ background: "#111827", border: "1px solid #2e3a4f", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => `${v}万円`} />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => v === "shell" ? "躯体償却" : v === "equip" ? "設備償却" : v === "npv" ? "累積NPV(右)" : "税額"} />
          <Bar yAxisId="l" dataKey="shell" stackId="dep" fill="#4f9cf9" radius={[0, 0, 0, 0]} />
          <Bar yAxisId="l" dataKey="equip" stackId="dep" fill="#f5b14c" radius={[2, 2, 0, 0]} />
          <Line yAxisId="r" type="monotone" dataKey="npv" stroke="#2dd4a7" strokeWidth={2.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-slate-500">
        棒=減価償却の内訳（躯体＝青／設備＝橙）。設備分離を上げると前半の償却が厚くなり早期の節税＝ATCF改善（累積NPVの立ち上がりが早くなる）。
        「詳細設定 › 設備分離償却」を変えるとこのグラフが連動します。
      </p>
    </div>
  );
}

// ===================== 2次元感度ヒートマップ =====================
function HeatmapView({ projInput }: { projInput: ProjectionInput }) {
  const drivers = React.useMemo(() => heatmapDrivers(projInput), [projInput]);
  const [xKey, setXKey] = React.useState(drivers[2]?.key ?? "rate");
  const [yKey, setYKey] = React.useState(drivers[0]?.key ?? "exitCap");
  const xD = drivers.find((d) => d.key === xKey) ?? drivers[0];
  const yD = drivers.find((d) => d.key === yKey) ?? drivers[1];
  const matrix = React.useMemo(() => irrHeatmap(projInput, xD, yD, "irr"), [projInput, xD, yD]);

  const color = (irr: number | null) => {
    if (irr == null) return "#3a2020";
    if (irr < 0) return "#7f1d1d";
    if (irr < 2) return "#92732b";
    if (irr < 4) return "#556b2f";
    if (irr < 6) return "#1f6f54";
    return "#15803d";
  };
  const fmtVal = (d: HeatmapDriver, v: number) => (d.unit === "円" ? `${Math.round(v / 10000)}万` : `${v}${d.unit}`);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <div>
          <span className="field-label">横軸(X)</span>
          <select className="field-input" value={xKey} onChange={(e) => setXKey(e.target.value)}>
            {drivers.map((d) => <option key={d.key} value={d.key} disabled={d.key === yKey}>{d.label}</option>)}
          </select>
        </div>
        <div>
          <span className="field-label">縦軸(Y)</span>
          <select className="field-input" value={yKey} onChange={(e) => setYKey(e.target.value)}>
            {drivers.map((d) => <option key={d.key} value={d.key} disabled={d.key === xKey}>{d.label}</option>)}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px] tnum">
          <thead>
            <tr>
              <th className="p-1.5 text-slate-400 font-medium text-right">{yD.label}＼{xD.label}</th>
              {xD.values.map((xv, i) => (
                <th key={i} className="p-1.5 text-slate-400 font-medium text-center min-w-[54px]">{fmtVal(xD, xv)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={i}>
                <td className="p-1.5 text-slate-300 font-medium text-right whitespace-nowrap">{fmtVal(yD, yD.values[i])}</td>
                {row.map((cell, j) => (
                  <td key={j} className="p-1.5 text-center text-white/90 rounded-sm" style={{ background: color(cell.irr) }} title={`IRR ${cell.irr?.toFixed(1) ?? "—"}%`}>
                    {cell.irr != null ? `${cell.irr.toFixed(1)}%` : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        セル＝そのX×Y条件でのIRR。緑=高IRR、赤=マイナス。2つのリスク要因が同時に悪化した時の耐性が一目で分かる。軸は上のセレクタで変更可。
      </p>
    </div>
  );
}

// ===================== 融資戦略 (#8) =====================
function LoanStrategyView({ loan }: { loan: LoanInput }) {
  const [refiYear, setRefiYear] = React.useState(5);
  const [refiRate, setRefiRate] = React.useState(Math.max(0.5, loan.annualRatePct - 1));
  const [prepayYear, setPrepayYear] = React.useState(3);
  const [prepayAmt, setPrepayAmt] = React.useState(5_000_000);
  const [prepayMode, setPrepayMode] = React.useState<"shorten" | "reduce">("shorten");

  const rows = React.useMemo(() => {
    const scenarios: { key: string; label: string; events: LoanEvents }[] = [
      {
        key: "refi", label: `借換え(${refiYear}年目→${refiRate}%)`,
        events: { refinance: { year: refiYear, ratePct: refiRate, years: Math.max(1, loan.years - refiYear), feePct: 2.2 } },
      },
      {
        key: "prepay", label: `繰上${(prepayAmt / 10000).toLocaleString()}万(${prepayYear}年目・${prepayMode === "shorten" ? "期間短縮" : "額軽減"})`,
        events: { prepayment: { year: prepayYear, amount: prepayAmt, mode: prepayMode } },
      },
      {
        key: "riseup", label: "変動金利上昇(+1%@6年,+2%@11年)",
        events: { ratePath: [{ year: 6, ratePct: loan.annualRatePct + 1 }, { year: 11, ratePct: loan.annualRatePct + 2 }] },
      },
    ];
    return compareLoanStrategies(loan, scenarios);
  }, [loan, refiYear, refiRate, prepayYear, prepayAmt, prepayMode]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        <NumberField label="借換え年" suffix="年目" value={refiYear} onChange={setRefiYear} />
        <NumberField label="借換え金利" suffix="%" step={0.1} value={refiRate} onChange={setRefiRate} />
        <NumberField label="繰上返済年" suffix="年目" value={prepayYear} onChange={setPrepayYear} />
        <NumberField label="繰上金額" suffix="円" step={1_000_000} value={prepayAmt} onChange={setPrepayAmt} />
        <SelectField<"shorten" | "reduce">
          label="繰上方式"
          value={prepayMode}
          options={[{ value: "shorten", label: "期間短縮" }, { value: "reduce", label: "返済額軽減" }]}
          onChange={setPrepayMode}
        />
      </div>
      <table className="w-full text-sm tnum">
        <thead>
          <tr className="text-[11px] text-slate-400 border-b border-base-600">
            <th className="text-left py-2 font-medium">施策</th>
            <th className="text-right py-2 font-medium">総支払利息</th>
            <th className="text-right py-2 font-medium">完済年</th>
            <th className="text-right py-2 font-medium">手数料</th>
            <th className="text-right py-2 font-medium">利息＋手数料 増減</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-base-700/50">
              <td className="py-2 text-slate-200">{r.label}</td>
              <td className="py-2 text-right text-slate-300">{yen(r.totalInterest)}</td>
              <td className="py-2 text-right text-slate-300">{r.payoffYear ? `${r.payoffYear}年` : "—"}</td>
              <td className="py-2 text-right text-slate-500">{r.refinanceFee ? yen(r.refinanceFee) : "—"}</td>
              <td
                className="py-2 text-right font-semibold"
                style={{ color: r.key === "base" ? "#94a3b8" : r.savingVsBase < 0 ? "#2dd4a7" : "#f56c6c" }}
              >
                {r.key === "base" ? "基準" : `${r.savingVsBase < 0 ? "▼" : "▲"} ${yen(Math.abs(r.savingVsBase))}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-slate-500">
        ▼＝利息＋手数料の節約、▲＝増加。借換えは手数料2.2%込みで比較。繰上返済「期間短縮」は総利息を最も圧縮、「返済額軽減」は毎月の手残りを改善（総利息削減効果は小）。
      </p>
    </div>
  );
}

// ===================== リアルオプション (#11) =====================
function RealOptionView({ input }: { input: RealOptionInput }) {
  const r = React.useMemo(() => analyzeRealOptions(input), [input]);
  const maxVal = Math.max(...r.strategies.map((s) => Math.max(0, s.value)), 1);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Metric label="最有効使用(HBU)" value={r.best.label} color="#2dd4a7" />
        <Metric label="想定価値" value={yen(r.best.value)} emphasize color="#2dd4a7" />
        <Metric
          label="現況比プレミアム"
          value={`${r.optionPremium >= 0 ? "+" : ""}${yen(r.optionPremium)}`}
          color={r.optionPremium > 0 ? "#2dd4a7" : "#94a3b8"}
          sub={`取得価格比 ${pct(r.hbuVsPricePct, 0)}`}
        />
      </div>
      <div className="space-y-2">
        {r.strategies.map((s) => (
          <div key={s.key} className={`rounded-md border p-2.5 ${s.key === r.best.key ? "border-accent-green/50 bg-accent-green/5" : "border-base-600 bg-base-900"}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-slate-200">
                {s.key === r.best.key ? "👑 " : ""}{s.label}
                {!s.feasible && <span className="text-[10px] text-slate-500 ml-1">(不成立)</span>}
              </span>
              <span className="tnum text-sm font-bold" style={{ color: s.key === r.best.key ? "#2dd4a7" : "#cbd5e1" }}>{yen(s.value)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-base-700 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, (s.value / maxVal) * 100))}%`, background: s.key === r.best.key ? "#2dd4a7" : "#4f9cf9" }} />
            </div>
            <div className="text-[11px] text-slate-500 mt-1">{s.detail}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">
        最有効使用（Highest & Best Use）＝現況継続/更地化売却/用途転換/建替えのうち価値最大の戦略。プレミアムが大きいほど「現況のまま以外に妙味」がある物件。建替えは容積率・想定賃料からの概算。
      </p>
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
