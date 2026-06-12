"use client";
import React from "react";
import { InputPanel, type InputState } from "@/components/InputPanel";
import { Card, Metric, Bar } from "@/components/ui";
import { ScoreRadar } from "@/components/ScoreRadar";
import { WaterfallChart, buildWaterfall } from "@/components/WaterfallChart";
import { CashflowChart } from "@/components/CashflowChart";
import { SensitivityHeatmap } from "@/components/SensitivityHeatmap";
import { StressTable } from "@/components/StressTable";
import {
  SAMPLE_PROPERTY,
  DEFAULT_RENTAL,
  DEFAULT_MINPAKU,
  DEFAULT_LOAN,
  DEFAULT_SHAPE,
  DEFAULT_DOWN_PAYMENT,
  DEFAULT_TAX_RATE,
  DEFAULT_DISCOUNT_RATE,
  DEFAULT_PROJECTION_YEARS,
  DEFAULT_EXIT_CAP_RATE,
  PREFECTURES,
} from "@/lib/defaults";
import { calcCostApproach, judgeLandValueStance } from "@/lib/calc/costApproach";
import { calcInitialCosts } from "@/lib/calc/initialCosts";
import { buildProjection, judgeDscr, type ProjectionInput } from "@/lib/calc/projection";
import { rentalIncome, minpakuIncome } from "@/lib/calc/income";
import { runStressTest, buildSensitivityMatrix } from "@/lib/calc/stress";
import { annualDebtService } from "@/lib/calc/loan";
import { computeScore } from "@/lib/calc/scoring";
import { calcDeviation, type MarketStats } from "@/lib/external/marketAnalysis";
import type { IncomeMode } from "@/lib/calc/types";
import { yen, pct, signedPct, man } from "@/lib/format";

const CURRENT_YEAR = 2026;

type Tab = "asset" | "income" | "compare";

const initialState: InputState = {
  property: SAMPLE_PROPERTY,
  shape: DEFAULT_SHAPE,
  loan: DEFAULT_LOAN,
  rental: DEFAULT_RENTAL,
  minpaku: DEFAULT_MINPAKU,
  downPayment: DEFAULT_DOWN_PAYMENT,
  taxRatePct: DEFAULT_TAX_RATE * 100,
  exitCapRatePct: DEFAULT_EXIT_CAP_RATE,
  years: DEFAULT_PROJECTION_YEARS,
};

export default function Home() {
  const [state, setState] = React.useState<InputState>(initialState);
  const [tab, setTab] = React.useState<Tab>("asset");
  const [mode, setMode] = React.useState<IncomeMode>("rental");
  const [parsing, setParsing] = React.useState(false);
  const [market, setMarket] = React.useState<{ stats: MarketStats; source: string } | null>(null);
  const [pref, setPref] = React.useState("13");
  const [loadingMarket, setLoadingMarket] = React.useState(false);

  const set = (patch: Partial<InputState>) => setState((s) => ({ ...s, ...patch }));

  // ---- マイソク抽出 ----
  async function onParse(text: string) {
    setParsing(true);
    try {
      const res = await fetch("/api/parse-maisoku", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      const p = data.parsed ?? {};
      setState((s) => {
        const next = { ...s, property: { ...s.property } };
        for (const k of ["name", "address", "price", "landArea", "buildingArea", "structure", "builtYear", "rosenkaPerSqm", "koujiPerSqm"] as const) {
          if (p[k] != null) (next.property as any)[k] = p[k];
        }
        // 利回りから月額賃料を逆算（賃貸初期値）
        if (p.grossYieldPct && next.property.price) {
          const annual = (next.property.price * p.grossYieldPct) / 100;
          next.rental = { ...next.rental, monthlyGrossRent: Math.round(annual / 12) };
        }
        return next;
      });
    } catch (e) {
      alert("抽出に失敗しました。手入力で続行できます。");
    } finally {
      setParsing(false);
    }
  }

  // ---- 市場データ取得 ----
  async function loadMarket() {
    setLoadingMarket(true);
    try {
      const u = new URL("/api/market", window.location.origin);
      u.searchParams.set("area", pref);
      u.searchParams.set("targetArea", String(state.property.landArea));
      const res = await fetch(u.toString());
      const data = await res.json();
      setMarket({ stats: data.stats, source: data.source });
    } catch {
      setMarket(null);
    } finally {
      setLoadingMarket(false);
    }
  }

  // ============ 計算（メモ化）============
  const cost = React.useMemo(
    () => calcCostApproach(state.property, CURRENT_YEAR, state.shape),
    [state.property, state.shape]
  );

  const stance = judgeLandValueStance(cost.landValueRatio);
  const taxRate = state.taxRatePct / 100;

  const buildProjFor = React.useCallback(
    (m: IncomeMode): ProjectionInput => {
      const initial = calcInitialCosts(state.property, m, {
        loanAmount: state.loan.amount,
      });
      return {
        property: state.property,
        mode: m,
        rental: state.rental,
        minpaku: state.minpaku,
        loan: state.loan,
        downPayment: state.downPayment,
        initialCostsTotal: initial.total,
        years: state.years,
        taxRate,
        discountRate: DEFAULT_DISCOUNT_RATE,
        exitYear: state.years,
        exitCapRatePct: state.exitCapRatePct,
        currentYear: CURRENT_YEAR,
      };
    },
    [state, taxRate]
  );

  const rentalProj = React.useMemo(() => buildProjection(buildProjFor("rental")), [buildProjFor]);
  const minpakuProj = React.useMemo(() => buildProjection(buildProjFor("minpaku")), [buildProjFor]);
  const proj = mode === "rental" ? rentalProj : minpakuProj;

  const initialCosts = React.useMemo(
    () => calcInitialCosts(state.property, mode, { loanAmount: state.loan.amount }),
    [state.property, state.loan.amount, mode]
  );

  // 市場乖離
  const deviation = React.useMemo(() => {
    if (!market || market.stats.estimatedFairValue <= 0) return null;
    return calcDeviation(state.property.price, market.stats.estimatedFairValue, cost.totalCostValue);
  }, [market, state.property.price, cost.totalCostValue]);

  const score = React.useMemo(
    () => computeScore(cost, proj.metrics, deviation ? -deviation.vsFairPct : null),
    [cost, proj.metrics, deviation]
  );

  const dscrJudge = judgeDscr(proj.metrics.dscr);

  // ウォーターフォール
  const income1 = mode === "rental" ? rentalIncome(state.rental) : minpakuIncome(state.minpaku);
  const waterfall = buildWaterfall(income1, annualDebtService(state.loan));

  // 民泊感度マトリクス
  const sensitivity = React.useMemo(() => {
    const adrRange = [10000, 14000, 18000, 22000, 26000, 30000];
    const occRange = [40, 50, 60, 70, 80, 90];
    const requiredNoi = annualDebtService(state.loan);
    const targetNoi = requiredNoi * 1.3;
    return {
      matrix: buildSensitivityMatrix(state.minpaku, adrRange, occRange, requiredNoi, targetNoi),
      adrRange,
      occRange,
    };
  }, [state.minpaku, state.loan]);

  const stress = React.useMemo(() => runStressTest(buildProjFor(mode)), [buildProjFor, mode]);

  return (
    <div className="min-h-screen">
      <Header
        score={score.total}
        grade={score.grade}
        propertyName={state.property.name}
        tab={tab}
        setTab={setTab}
      />

      <div className="max-w-[1600px] mx-auto px-4 py-4 grid grid-cols-12 gap-4">
        {/* 左: 入力 */}
        <aside className="col-span-12 lg:col-span-3 print:hidden">
          <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto pr-1">
            <InputPanel state={state} set={set} onParse={onParse} parsing={parsing} />
          </div>
        </aside>

        {/* 右: コンテンツ */}
        <main className="col-span-12 lg:col-span-9 space-y-4">
          {tab === "asset" && (
            <AssetTab
              cost={cost}
              stance={stance}
              score={score}
              property={state.property}
              market={market}
              deviation={deviation}
              pref={pref}
              setPref={setPref}
              loadMarket={loadMarket}
              loadingMarket={loadingMarket}
            />
          )}

          {tab === "income" && (
            <IncomeTab
              mode={mode}
              setMode={setMode}
              proj={proj}
              dscrJudge={dscrJudge}
              waterfall={waterfall}
              sensitivity={sensitivity}
              stress={stress}
              initialCosts={initialCosts}
              property={state.property}
            />
          )}

          {tab === "compare" && (
            <CompareTab rental={rentalProj} minpaku={minpakuProj} property={state.property} />
          )}
        </main>
      </div>
      <footer className="max-w-[1600px] mx-auto px-4 py-6 text-[11px] text-slate-600 print:hidden">
        ※ 本ツールの算出値は簡易シミュレーションです。実際の投資判断・融資審査は専門家にご確認ください。
        外部API（不動産情報ライブラリ）未設定時はデモデータで動作します。
      </footer>
    </div>
  );
}

// ===================== Header =====================
function Header({
  score,
  grade,
  propertyName,
  tab,
  setTab,
}: {
  score: number;
  grade: string;
  propertyName: string;
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  const tabs: { key: Tab; label: string }[] = [
    { key: "asset", label: "① 資産価値・物件判定" },
    { key: "income", label: "② 収益シミュレーション" },
    { key: "compare", label: "③ 賃貸×民泊 比較" },
  ];
  const color = grade === "S" || grade === "A" ? "#2dd4a7" : grade === "B" ? "#f5b14c" : "#f56c6c";
  return (
    <header className="sticky top-0 z-20 bg-base-900/95 backdrop-blur border-b border-base-600 print:static">
      <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center text-accent font-bold">
            不
          </div>
          <div>
            <h1 className="text-sm font-bold leading-none">不動産投資 一撃判定</h1>
            <p className="text-[11px] text-slate-400 leading-none mt-0.5 truncate max-w-[240px]">
              {propertyName}
            </p>
          </div>
        </div>

        <nav className="flex gap-1 ml-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                tab === t.key
                  ? "bg-accent text-white"
                  : "text-slate-400 hover:text-slate-200 hover:bg-base-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="text-right">
            <span className="text-[10px] text-slate-400 block leading-none">総合スコア</span>
            <span className="tnum text-lg font-bold leading-none" style={{ color }}>
              {score} <span className="text-sm">({grade})</span>
            </span>
          </div>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-base-700 hover:bg-base-600 text-slate-200 border border-base-500 print:hidden"
          >
            📄 レポートPDF出力
          </button>
        </div>
      </div>
    </header>
  );
}

// ===================== Asset Tab =====================
function AssetTab({
  cost,
  stance,
  score,
  property,
  market,
  deviation,
  pref,
  setPref,
  loadMarket,
  loadingMarket,
}: any) {
  return (
    <>
      <div className="grid grid-cols-12 gap-4">
        {/* スコア */}
        <Card title="一撃判定スコア" className="col-span-12 md:col-span-4">
          <ScoreRadar score={score} />
        </Card>

        {/* 積算 */}
        <Card title="積算価格（コストアプローチ）" className="col-span-12 md:col-span-4">
          <div className="space-y-3">
            <Metric label="積算価格（土地＋建物）" value={yen(cost.totalCostValue)} emphasize color="#4f9cf9" />
            <div className="grid grid-cols-2 gap-3">
              <Metric label="土地評価額" value={yen(cost.landValue)} sub={`補正率 ${cost.shapeFactor.toFixed(3)}`} />
              <Metric label="建物価値" value={yen(cost.buildingValue)} sub={`残存 ${cost.remainingYears}/${cost.legalLifespan}年`} />
            </div>
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>積算評価率（積算/価格）</span>
                <span className="tnum">{pct(cost.costValueRatio * 100)}</span>
              </div>
              <Bar value={cost.costValueRatio * 100} max={120} color="#4f9cf9" />
            </div>
            <Metric label="実勢流動性価格（参考）" value={yen(cost.landMarketValue)} sub="路線価×流動性倍率/公示平均" />
          </div>
        </Card>

        {/* 土地値比率スタンス */}
        <Card title="土地値比率・出口判定" className="col-span-12 md:col-span-4">
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <span className="tnum text-4xl font-bold" style={{ color: stance.color }}>
                {pct(cost.landValueRatio * 100, 0)}
              </span>
              <span className="pill mb-1.5" style={{ background: `${stance.color}22`, color: stance.color }}>
                {stance.label}
              </span>
            </div>
            <Bar value={cost.landValueRatio * 100} max={100} color={stance.color} />
            <p className="text-xs text-slate-300 leading-relaxed">{stance.message}</p>
          </div>
        </Card>
      </div>

      {/* マーケットアプローチ */}
      <Card
        title="マーケットアプローチ（実勢価格・乖離率）"
        right={
          <div className="flex items-center gap-2 print:hidden">
            <select
              className="bg-base-900 border border-base-600 rounded-md px-2 py-1 text-xs"
              value={pref}
              onChange={(e) => setPref(e.target.value)}
            >
              {PREFECTURES.map((p: any) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={loadMarket}
              disabled={loadingMarket}
              className="px-2.5 py-1 rounded-md text-xs font-semibold bg-accent/90 hover:bg-accent text-white disabled:opacity-50"
            >
              {loadingMarket ? "取得中…" : "周辺事例を取得"}
            </button>
          </div>
        }
      >
        {!market ? (
          <p className="text-sm text-slate-400 py-6 text-center">
            「周辺事例を取得」で、不動産情報ライブラリの取引価格情報（成約事例）から適正市場価格と乖離率を算出します。
            <br />
            <span className="text-[11px] text-slate-500">※ APIキー未設定時はデモデータで動作確認できます。</span>
          </p>
        ) : (
          <div className="grid grid-cols-12 gap-4 items-center">
            <div className="col-span-12 md:col-span-7 grid grid-cols-2 gap-3">
              <Metric label="売出価格" value={yen(state2price(property))} />
              <Metric label="推定適正市場価格" value={yen(market.stats.estimatedFairValue)} sub={`事例${market.stats.count}件・中央値${yen(market.stats.medianUnitPrice)}/㎡`} />
              <Metric label="単価レンジ" value={`${man(market.stats.minUnitPrice)}〜${man(market.stats.maxUnitPrice)}万/㎡`} />
              <Metric label="データソース" value={market.source === "reinfolib" ? "不動産情報ライブラリ" : "デモデータ"} />
            </div>
            {deviation && (
              <div className="col-span-12 md:col-span-5">
                <div
                  className="rounded-lg p-4 border"
                  style={{
                    borderColor: deviation.verdict === "discount" ? "#2dd4a7" : deviation.verdict === "premium" ? "#f56c6c" : "#f5b14c",
                    background: deviation.verdict === "discount" ? "#2dd4a722" : deviation.verdict === "premium" ? "#f56c6c22" : "#f5b14c22",
                  }}
                >
                  <div className="text-[11px] text-slate-300">適正市場価格との乖離</div>
                  <div className="tnum text-3xl font-bold" style={{ color: deviation.verdict === "discount" ? "#2dd4a7" : deviation.verdict === "premium" ? "#f56c6c" : "#f5b14c" }}>
                    {signedPct(deviation.vsFairPct)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">対 積算価格: {signedPct(deviation.vsCostPct)}</div>
                  <p className="text-xs text-slate-200 mt-2 leading-relaxed">{deviation.message}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}

function state2price(p: any) {
  return p.price;
}

// ===================== Income Tab =====================
function IncomeTab({
  mode,
  setMode,
  proj,
  dscrJudge,
  waterfall,
  sensitivity,
  stress,
  initialCosts,
  property,
}: any) {
  const m = proj.metrics;
  return (
    <>
      {/* モード切替 + 主要指標 */}
      <Card
        title="収益指標サマリ"
        right={
          <div className="flex gap-1 print:hidden">
            {(["rental", "minpaku"] as IncomeMode[]).map((md) => (
              <button
                key={md}
                onClick={() => setMode(md)}
                className={`px-3 py-1 rounded-md text-xs font-semibold ${
                  mode === md ? "bg-accent text-white" : "bg-base-700 text-slate-400 hover:text-slate-200"
                }`}
              >
                {md === "rental" ? "賃貸モード" : "民泊モード"}
              </button>
            ))}
          </div>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <Metric label="表面利回り" value={pct(m.grossYieldPct)} />
          <Metric label="実質利回り(NOI)" value={pct(m.netYieldPct)} color="#4f9cf9" />
          <Metric label="初年度NOI" value={yen(m.noi)} />
          <Metric label="DSCR" value={isFinite(m.dscr) ? m.dscr.toFixed(2) : "—"} color={dscrJudge.color} sub={dscrJudge.label} />
          <Metric label="CCR(自己資金配当)" value={pct(m.ccr)} />
          <Metric label="IRR" value={m.irrPct != null ? pct(m.irrPct) : "—"} color="#2dd4a7" />
          <Metric label="NPV" value={m.npv != null ? yen(m.npv) : "—"} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-base-700">
          <Metric label="自己資金" value={yen(m.selfFunds)} sub={`頭金＋初期費用`} />
          <Metric label="元本回収（自己資金）" value={m.paybackYear ? `${m.paybackYear}年目` : "期間内回収せず"} />
          <Metric label="デッドクロス" value={m.deadCrossYear ? `${m.deadCrossYear}年目` : "なし"} color={m.deadCrossYear ? "#f56c6c" : "#2dd4a7"} />
          <Metric label="初期費用合計" value={yen(initialCosts.total)} sub={mode === "minpaku" ? "家具家電・申請含む" : undefined} />
        </div>
      </Card>

      <div className="grid grid-cols-12 gap-4">
        {/* ウォーターフォール */}
        <Card title="資金の川流れ（収入→手残り）" className="col-span-12 lg:col-span-6">
          <WaterfallChart steps={waterfall} />
        </Card>

        {/* 累積CF */}
        <Card title="累積キャッシュフロー / デッドクロス" className="col-span-12 lg:col-span-6">
          <CashflowChart rows={proj.rows} metrics={proj.metrics} />
        </Card>
      </div>

      {/* 初期費用内訳 */}
      <Card title="初期費用（諸経費）内訳">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-sm">
          <CostItem label="仲介手数料" v={initialCosts.brokerageFee} />
          <CostItem label="登録免許税" v={initialCosts.registrationTax} />
          <CostItem label="不動産取得税" v={initialCosts.acquisitionTax} />
          <CostItem label="融資手数料" v={initialCosts.loanFee} />
          <CostItem label="火災・地震保険" v={initialCosts.insurance} />
          <CostItem label="固都税清算金" v={initialCosts.settlement} />
          <CostItem label="印紙税" v={initialCosts.stampTax} />
          <CostItem label="司法書士報酬" v={initialCosts.judicialScrivener} />
          {mode === "minpaku" && (
            <>
              <CostItem label="民泊申請費用" v={initialCosts.licenseApplication} />
              <CostItem label="リノベ・内装" v={initialCosts.renovation} />
              <CostItem label="家具家電一式" v={initialCosts.furniture} />
              <CostItem label="インフラ初期" v={initialCosts.infrastructure} />
            </>
          )}
          <CostItem label="その他予備費" v={initialCosts.other} />
          <CostItem label="合計" v={initialCosts.total} emphasize />
        </div>
      </Card>

      {/* 民泊感度 + ストレス */}
      <div className="grid grid-cols-12 gap-4">
        {mode === "minpaku" && (
          <Card title="損益分岐ヒートマップ（稼働率 × ADR）" className="col-span-12 lg:col-span-7">
            <SensitivityHeatmap matrix={sensitivity.matrix} adrRange={sensitivity.adrRange} occRange={sensitivity.occRange} />
          </Card>
        )}
        <Card title="ストレステスト" className={mode === "minpaku" ? "col-span-12 lg:col-span-5" : "col-span-12"}>
          <StressTable scenarios={stress} />
        </Card>
      </div>
    </>
  );
}

function CostItem({ label, v, emphasize }: { label: string; v: number; emphasize?: boolean }) {
  return (
    <div className={`flex flex-col ${emphasize ? "bg-base-700 rounded-lg p-2 -m-0.5" : ""}`}>
      <span className="text-[11px] text-slate-400">{label}</span>
      <span className={`tnum ${emphasize ? "text-lg font-bold text-accent" : "text-sm font-medium"}`}>{yen(v)}</span>
    </div>
  );
}

// ===================== Compare Tab =====================
function CompareTab({ rental, minpaku, property }: any) {
  const rows: { label: string; r: React.ReactNode; m: React.ReactNode; better?: "r" | "m" }[] = [
    { label: "実質利回り(NOI)", r: pct(rental.metrics.netYieldPct), m: pct(minpaku.metrics.netYieldPct), better: minpaku.metrics.netYieldPct > rental.metrics.netYieldPct ? "m" : "r" },
    { label: "初年度NOI", r: yen(rental.metrics.noi), m: yen(minpaku.metrics.noi), better: minpaku.metrics.noi > rental.metrics.noi ? "m" : "r" },
    { label: "初年度税引前CF", r: yen(rental.rows[0]?.btcf ?? 0), m: yen(minpaku.rows[0]?.btcf ?? 0), better: (minpaku.rows[0]?.btcf ?? 0) > (rental.rows[0]?.btcf ?? 0) ? "m" : "r" },
    { label: "DSCR", r: isFinite(rental.metrics.dscr) ? rental.metrics.dscr.toFixed(2) : "—", m: isFinite(minpaku.metrics.dscr) ? minpaku.metrics.dscr.toFixed(2) : "—", better: minpaku.metrics.dscr > rental.metrics.dscr ? "m" : "r" },
    { label: "CCR", r: pct(rental.metrics.ccr), m: pct(minpaku.metrics.ccr), better: minpaku.metrics.ccr > rental.metrics.ccr ? "m" : "r" },
    { label: "IRR", r: rental.metrics.irrPct != null ? pct(rental.metrics.irrPct) : "—", m: minpaku.metrics.irrPct != null ? pct(minpaku.metrics.irrPct) : "—", better: (minpaku.metrics.irrPct ?? -99) > (rental.metrics.irrPct ?? -99) ? "m" : "r" },
    { label: "NPV", r: rental.metrics.npv != null ? yen(rental.metrics.npv) : "—", m: minpaku.metrics.npv != null ? yen(minpaku.metrics.npv) : "—", better: (minpaku.metrics.npv ?? -1e18) > (rental.metrics.npv ?? -1e18) ? "m" : "r" },
    { label: "自己資金", r: yen(rental.metrics.selfFunds), m: yen(minpaku.metrics.selfFunds) },
    { label: "元本回収", r: rental.metrics.paybackYear ? `${rental.metrics.paybackYear}年` : "—", m: minpaku.metrics.paybackYear ? `${minpaku.metrics.paybackYear}年` : "—" },
  ];

  const rWins = rows.filter((x) => x.better === "r").length;
  const mWins = rows.filter((x) => x.better === "m").length;

  return (
    <>
      <Card title={`賃貸 × 民泊 一括比較（${property.name}）`}>
        <div className="grid grid-cols-3 gap-2 mb-4 text-center">
          <div />
          <div className={`rounded-lg py-2 font-bold ${rWins >= mWins ? "bg-accent/20 text-accent border border-accent/40" : "bg-base-700 text-slate-300"}`}>
            賃貸（長期）{rWins >= mWins ? " 👑" : ""}
          </div>
          <div className={`rounded-lg py-2 font-bold ${mWins > rWins ? "bg-accent-green/20 text-accent-green border border-accent-green/40" : "bg-base-700 text-slate-300"}`} style={{ color: mWins > rWins ? "#2dd4a7" : undefined }}>
            民泊（短期）{mWins > rWins ? " 👑" : ""}
          </div>
        </div>
        <table className="w-full text-sm tnum">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-base-700/50">
                <td className="py-2.5 text-slate-400 text-[12px]">{row.label}</td>
                <td className={`py-2.5 text-center font-semibold ${row.better === "r" ? "text-accent" : "text-slate-200"}`}>{row.r}</td>
                <td className={`py-2.5 text-center font-semibold ${row.better === "m" ? "text-accent-green" : "text-slate-200"}`} style={row.better === "m" ? { color: "#2dd4a7" } : undefined}>{row.m}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-12 gap-4">
        <Card title="賃貸: 累積キャッシュフロー" className="col-span-12 lg:col-span-6">
          <CashflowChart rows={rental.rows} metrics={rental.metrics} />
        </Card>
        <Card title="民泊: 累積キャッシュフロー" className="col-span-12 lg:col-span-6">
          <CashflowChart rows={minpaku.rows} metrics={minpaku.metrics} />
        </Card>
      </div>
    </>
  );
}
