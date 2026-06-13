"use client";
import React from "react";
import dynamic from "next/dynamic";
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
} from "@/lib/defaults";
import { calcCostApproach, judgeLandValueStance } from "@/lib/calc/costApproach";
import { calcInitialCosts } from "@/lib/calc/initialCosts";
import { buildProjection, judgeDscr, type ProjectionInput } from "@/lib/calc/projection";
import { rentalIncome, minpakuIncome } from "@/lib/calc/income";
import { runStressTest, buildSensitivityMatrix } from "@/lib/calc/stress";
import { annualDebtService } from "@/lib/calc/loan";
import { computeScore } from "@/lib/calc/scoring";
import {
  calcDeviation,
  estimateFairValue,
  type MarketAnalysis,
} from "@/lib/external/marketAnalysis";
import type { IncomeMode, PropertyInput, RentalParams } from "@/lib/calc/types";
import { yen, pct, signedPct, man } from "@/lib/format";
import { IntakeModal } from "@/components/IntakeModal";
import { Catalog } from "@/components/Catalog";
import { ReportDocument, type ReportData } from "@/components/ReportDocument";
import type { ExtractedFields } from "@/lib/external/extraction";
import type { Enrichment } from "@/lib/external/enrichment";
import {
  newId,
  generateTags,
  type CatalogItem,
  type CatalogExtras,
  type PropertyStatus,
} from "@/lib/catalog";
import {
  fetchCatalog,
  saveItem,
  patchStatus,
  removeItem as removeFromStore,
  getMode,
} from "@/lib/catalogStore";

const CURRENT_YEAR = 2026;

// Leafletはwindow依存のためSSR無効でクライアント読み込み
const PropertyMap = dynamic(() => import("@/components/PropertyMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[480px] flex items-center justify-center text-slate-400 text-sm">
      地図を読み込み中…
    </div>
  ),
});

type Tab = "asset" | "income" | "compare" | "catalog" | "map";

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
  const [market, setMarket] = React.useState<{
    analysis: MarketAnalysis;
    scope: any;
    source: string;
    fetchError: string | null;
  } | null>(null);
  const [pref, setPref] = React.useState("13");
  const [loadingMarket, setLoadingMarket] = React.useState(false);
  const [intakeOpen, setIntakeOpen] = React.useState(false);
  const [catalog, setCatalog] = React.useState<CatalogItem[]>([]);
  const [currentItemId, setCurrentItemId] = React.useState<string | null>(null);
  const [extras, setExtras] = React.useState<CatalogExtras>({});
  const [enrichment, setEnrichment] = React.useState<Enrichment | null>(null);
  const [enriching, setEnriching] = React.useState(false);
  const [onboarded, setOnboarded] = React.useState(true); // 既定はtrue→ちらつき防止、effectで判定
  const [mobileInputsOpen, setMobileInputsOpen] = React.useState(false);

  React.useEffect(() => {
    fetchCatalog().then(({ items }) => setCatalog(items));
    setOnboarded(window.localStorage.getItem("fudosan_onboarded") === "1");
  }, []);

  const dismissOnboarding = () => {
    window.localStorage.setItem("fudosan_onboarded", "1");
    setOnboarded(true);
  };

  const set = (patch: Partial<InputState>) => setState((s) => ({ ...s, ...patch }));

  // ---- 周辺事例の取得（住所→市区町村レベルで自動絞り込み）----
  async function loadMarket() {
    setLoadingMarket(true);
    try {
      const u = new URL("/api/market", window.location.origin);
      // 公的データ取得済みなら座標で（速い・確実）、無ければ住所から自動特定
      if (enrichment) {
        u.searchParams.set("lat", String(enrichment.lat));
        u.searchParams.set("lon", String(enrichment.lon));
      } else if (state.property.address) {
        u.searchParams.set("address", state.property.address);
      } else {
        u.searchParams.set("area", pref); // 最終フォールバック（県レベル）
      }
      const res = await fetch(u.toString());
      const data = await res.json();
      setMarket({
        analysis: data.analysis,
        scope: data.scope,
        source: data.source,
        fetchError: data.fetchError ?? null,
      });
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
    (
      m: IncomeMode,
      ov?: { property?: PropertyInput; rental?: RentalParams }
    ): ProjectionInput => {
      const property = ov?.property ?? state.property;
      const rental = ov?.rental ?? state.rental;
      const initial = calcInitialCosts(property, m, {
        loanAmount: state.loan.amount,
      });
      return {
        property,
        mode: m,
        rental,
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

  // 適正市場価格の推定（計算式つき）と乖離
  const fairValue = React.useMemo(() => {
    if (!market) return null;
    return estimateFairValue(
      market.analysis,
      state.property.landArea,
      state.property.buildingArea,
      cost.buildingValue
    );
  }, [market, state.property.landArea, state.property.buildingArea, cost.buildingValue]);

  const deviation = React.useMemo(() => {
    if (!fairValue || fairValue.fairValue <= 0) return null;
    return calcDeviation(state.property.price, fairValue.fairValue, cost.totalCostValue);
  }, [fairValue, state.property.price, cost.totalCostValue]);

  // デモ事例は判断材料にしない（スコアの市場割安度は中立50のまま）
  const score = React.useMemo(
    () =>
      computeScore(
        cost,
        proj.metrics,
        deviation && market?.source === "reinfolib" ? -deviation.vsFairPct : null
      ),
    [cost, proj.metrics, deviation, market?.source]
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

  // ---- 抽出結果をフォーム＋カタログへ適用 ----
  function applyExtracted(f: ExtractedFields, sourceName?: string) {
    const np: PropertyInput = { ...state.property };
    if (f.name) np.name = f.name;
    if (f.address) np.address = f.address;
    if (f.price) np.price = f.price;
    if (f.landArea) np.landArea = f.landArea;
    if (f.buildingArea) np.buildingArea = f.buildingArea;
    if (f.structure) np.structure = f.structure;
    if (f.builtYear) np.builtYear = f.builtYear;
    if (f.rosenkaPerSqm) np.rosenkaPerSqm = f.rosenkaPerSqm;
    if (f.koujiPerSqm) np.koujiPerSqm = f.koujiPerSqm;

    // 賃料: 満室想定年収 > 利回り逆算 の順で反映
    let newRental = state.rental;
    if (f.annualRentIncome && f.annualRentIncome > 0) {
      newRental = { ...state.rental, monthlyGrossRent: Math.round(f.annualRentIncome / 12) };
    } else if (f.grossYieldPct && np.price) {
      newRental = { ...state.rental, monthlyGrossRent: Math.round((np.price * f.grossYieldPct) / 100 / 12) };
    }

    const newExtras: CatalogExtras = {
      floors: f.floors,
      grossYieldPct: f.grossYieldPct,
      annualRentIncome: f.annualRentIncome,
      nearestStation: f.nearestStation,
      stationWalkMin: f.stationWalkMin,
      landRightType: f.landRightType,
      zoningUse: f.zoningUse,
      buildingCoveragePct: f.buildingCoveragePct,
      floorAreaRatioPct: f.floorAreaRatioPct,
    };

    // スナップショット（カタログ表示用）を新state値から直接計算
    const snapCost = calcCostApproach(np, CURRENT_YEAR, state.shape);
    const snapProj = buildProjection(buildProjFor("rental", { property: np, rental: newRental }));
    const snapScore = computeScore(snapCost, snapProj.metrics, null);
    const snapshot = {
      landValueRatio: snapCost.landValueRatio,
      grossYieldPct: snapProj.metrics.grossYieldPct,
      score: snapScore.total,
      grade: snapScore.grade,
    };

    const id = newId();
    const item: CatalogItem = {
      id,
      createdAt: Date.now(),
      status: "reviewing",
      property: np,
      extras: newExtras,
      tags: generateTags(np, newExtras, snapshot),
      sourceName,
      snapshot,
    };
    saveItem(item).then(setCatalog);
    setCurrentItemId(id);
    setExtras(newExtras);
    setEnrichment(null);
    setState((s) => ({ ...s, property: np, rental: newRental }));
    setTab("asset");
  }

  // ---- 公的データ自動紐付け ----
  async function runEnrich() {
    if (!state.property.address) {
      alert("所在地を入力してください。");
      return;
    }
    setEnriching(true);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: state.property.address,
          maisoku: {
            rosenkaPerSqm: state.property.rosenkaPerSqm || undefined,
            koujiPerSqm: state.property.koujiPerSqm || undefined,
            zoningUse: extras.zoningUse,
            buildingCoveragePct: extras.buildingCoveragePct,
            floorAreaRatioPct: extras.floorAreaRatioPct,
          },
        }),
      });
      const data = (await res.json()) as Enrichment & { error?: string };
      if (!res.ok) throw new Error((data as any).error || "取得に失敗しました");
      setEnrichment(data);
      // 空欄を公的データで自動補完
      if (data.landPrice?.koujiPerSqm && !state.property.koujiPerSqm) {
        setState((s) => ({ ...s, property: { ...s.property, koujiPerSqm: data.landPrice!.koujiPerSqm! } }));
      }
      const lu = data.landUse;
      if (lu && lu.source === "reinfolib") {
        setExtras((e) => ({
          ...e,
          zoningUse: e.zoningUse ?? lu.zoningUse,
          buildingCoveragePct: e.buildingCoveragePct ?? lu.buildingCoveragePct,
          floorAreaRatioPct: e.floorAreaRatioPct ?? lu.floorAreaRatioPct,
        }));
      }
    } catch (e: any) {
      alert(`公的データ取得エラー: ${e?.message ?? e}`);
    } finally {
      setEnriching(false);
    }
  }

  // ---- カタログ操作 ----
  function loadFromCatalog(item: CatalogItem) {
    setState((s) => ({ ...s, property: item.property }));
    setExtras(item.extras);
    setCurrentItemId(item.id);
    setEnrichment(null);
    setTab("asset");
  }
  function changeStatus(id: string, status: PropertyStatus) {
    patchStatus(id, status).then(setCatalog);
  }
  function removeItem(id: string) {
    removeFromStore(id).then(setCatalog);
    if (currentItemId === id) setCurrentItemId(null);
  }
  // 現在の物件をカタログへ保存/更新
  function saveCurrent() {
    const snapshot = {
      landValueRatio: cost.landValueRatio,
      grossYieldPct: proj.metrics.grossYieldPct,
      score: score.total,
      grade: score.grade,
    };
    const existing = currentItemId ? catalog.find((c) => c.id === currentItemId) : null;
    const id = existing?.id ?? newId();
    const item: CatalogItem = {
      id,
      createdAt: existing?.createdAt ?? Date.now(),
      status: existing?.status ?? "reviewing",
      property: state.property,
      extras,
      tags: generateTags(state.property, extras, snapshot),
      sourceName: existing?.sourceName,
      snapshot,
    };
    saveItem(item).then(setCatalog);
    setCurrentItemId(id);
  }

  const reportData: ReportData = {
    property: state.property,
    mode,
    cost,
    stance,
    score,
    metrics: proj.metrics,
    rows: proj.rows,
    initialCosts,
    dscrLabel: dscrJudge.label,
    market: market
      ? {
          source: market.source,
          municipality: market.analysis.municipality,
          periods: market.scope?.periods ?? [],
          counts: `土地${market.analysis.land?.count ?? 0}件・土地建物${market.analysis.landBldg?.count ?? 0}件・区分${market.analysis.condo?.count ?? 0}件`,
        }
      : null,
    fairValue: fairValue && fairValue.fairValue > 0 ? fairValue : null,
    deviation,
    enrichment,
    extras,
  };

  return (
    <div className="min-h-screen">
      {/* 印刷時はダッシュボードを隠し、帳票のみ出力 */}
      <ReportDocument data={reportData} className="hidden print:block" />
      <div className="print:hidden">
      <Header
        score={score.total}
        grade={score.grade}
        propertyName={state.property.name}
        tab={tab}
        setTab={setTab}
        catalogCount={catalog.length}
        onIntake={() => setIntakeOpen(true)}
        onSave={saveCurrent}
        saved={!!currentItemId}
      />

      <IntakeModal open={intakeOpen} onClose={() => setIntakeOpen(false)} onApply={applyExtracted} />

      {tab === "catalog" ? (
        <div className="max-w-[1600px] mx-auto px-4 py-4">
          <Catalog
            items={catalog}
            onLoad={loadFromCatalog}
            onChangeStatus={changeStatus}
            onDelete={removeItem}
            onNewIntake={() => setIntakeOpen(true)}
          />
        </div>
      ) : tab === "map" ? (
        <div className="max-w-[1600px] mx-auto px-4 py-4">
          <MapTab
            property={state.property}
            extras={extras}
            enrichment={enrichment}
            runEnrich={runEnrich}
            enriching={enriching}
          />
        </div>
      ) : (
        <div className="max-w-[1600px] mx-auto px-4 py-4 grid grid-cols-12 gap-4">
          {/* 左: 入力 */}
          <aside className="col-span-12 lg:col-span-3 print:hidden">
            {/* モバイルは折りたたみ */}
            <button
              onClick={() => setMobileInputsOpen((o) => !o)}
              className="lg:hidden w-full mb-2 flex items-center justify-between bg-base-800 border border-base-600 rounded-lg px-3.5 py-2.5 text-sm font-semibold text-slate-200"
            >
              <span>⚙️ 物件・条件を編集</span>
              <span className="text-xs text-slate-400">{mobileInputsOpen ? "閉じる ▲" : "開く ▼"}</span>
            </button>
            <div
              className={`${mobileInputsOpen ? "block" : "hidden"} lg:block lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto pr-1`}
            >
              <InputPanel state={state} set={set} mode={mode} setMode={setMode} onIntake={() => setIntakeOpen(true)} />
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
                fairValue={fairValue}
                pref={pref}
                setPref={setPref}
                loadMarket={loadMarket}
                loadingMarket={loadingMarket}
                enrichment={enrichment}
                runEnrich={runEnrich}
                enriching={enriching}
                showOnboarding={!onboarded}
                onIntake={() => setIntakeOpen(true)}
                dismissOnboarding={dismissOnboarding}
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
      )}
      <footer className="max-w-[1600px] mx-auto px-4 py-6 text-[11px] text-slate-600 print:hidden">
        ※ 本ツールの算出値は簡易シミュレーションです。実際の投資判断・融資審査は専門家にご確認ください。
        外部API（不動産情報ライブラリ）未設定時はデモデータで動作します。
      </footer>
      </div>
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
  catalogCount,
  onIntake,
  onSave,
  saved,
}: {
  score: number;
  grade: string;
  propertyName: string;
  tab: Tab;
  setTab: (t: Tab) => void;
  catalogCount: number;
  onIntake: () => void;
  onSave: () => void;
  saved: boolean;
}) {
  const tabs: { key: Tab; label: string; short: string }[] = [
    { key: "asset", label: "① 資産価値・物件判定", short: "資産価値" },
    { key: "income", label: "② 収益シミュレーション", short: "収益" },
    { key: "compare", label: "③ 賃貸×民泊 比較", short: "比較" },
    { key: "map", label: "④ 地図(GIS)", short: "地図" },
    { key: "catalog", label: `⑤ 物件カタログ${catalogCount ? ` (${catalogCount})` : ""}`, short: `カタログ${catalogCount ? `(${catalogCount})` : ""}` },
  ];
  const color = grade === "S" || grade === "A" ? "#2dd4a7" : grade === "B" ? "#f5b14c" : "#f56c6c";
  return (
    <header className="sticky top-0 z-20 bg-base-900/95 backdrop-blur border-b border-base-600 print:static">
      <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex items-center gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center text-accent font-bold">
            不
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-bold leading-none">不動産投資 一撃判定</h1>
            <p className="text-[11px] text-slate-400 leading-none mt-0.5 truncate max-w-[180px]">
              {propertyName}
            </p>
          </div>
        </div>

        <nav className="flex gap-1 ml-1 overflow-x-auto no-scrollbar min-w-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                tab === t.key
                  ? "bg-accent text-white"
                  : "text-slate-400 hover:text-slate-200 hover:bg-base-700"
              }`}
            >
              <span className="md:hidden">{t.short}</span>
              <span className="hidden md:inline">{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <div className="text-right mr-1">
            <span className="text-[9px] text-slate-400 block leading-none">スコア</span>
            <span className="tnum text-base font-bold leading-none" style={{ color }}>
              {score}<span className="text-xs">({grade})</span>
            </span>
          </div>
          <button
            onClick={onSave}
            className="w-8 h-8 rounded-md text-sm bg-base-700 hover:bg-base-600 text-slate-200 border border-base-500 print:hidden"
            title={saved ? "カタログを更新" : "カタログに保存"}
          >
            💾
          </button>
          <button
            onClick={() => window.print()}
            className="w-8 h-8 rounded-md text-sm bg-base-700 hover:bg-base-600 text-slate-200 border border-base-500 print:hidden"
            title="レポートPDF出力（印刷）"
          >
            📄
          </button>
          <button
            onClick={onIntake}
            className="px-3 py-1.5 rounded-md text-xs font-bold bg-accent hover:bg-accent/90 text-white print:hidden whitespace-nowrap"
          >
            📥 取り込む
          </button>
        </div>
      </div>
    </header>
  );
}

// ===================== オンボーディング =====================
function OnboardingHero({ onIntake, dismiss }: { onIntake: () => void; dismiss: () => void }) {
  const methods = [
    { icon: "📄", label: "PDF/画像をドラッグ" },
    { icon: "📷", label: "カメラで撮影" },
    { icon: "🔗", label: "物件URLを貼付" },
    { icon: "📝", label: "テキスト貼付" },
  ];
  return (
    <div className="card p-5 mb-4 relative overflow-hidden bg-gradient-to-br from-base-800 to-base-700 border-accent/30 print:hidden">
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 text-slate-400 hover:text-slate-200 text-sm"
        title="閉じる"
      >
        ✕
      </button>
      <h2 className="text-lg font-bold text-slate-100">マイソクを取り込んで、一撃で投資判断。</h2>
      <p className="text-sm text-slate-300 mt-1">
        積算価格・土地値比率・収益（賃貸/民泊）・ハザード・周辺相場までワンストップ。まずは物件を取り込みましょう。
      </p>
      <div className="flex flex-wrap gap-2 mt-3">
        {methods.map((m) => (
          <span key={m.label} className="pill bg-base-900/70 text-slate-300 border border-base-600">
            {m.icon} {m.label}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={onIntake}
          className="px-4 py-2 rounded-lg text-sm font-bold bg-accent hover:bg-accent/90 text-white shadow"
        >
          📥 物件を取り込む
        </button>
        <button onClick={dismiss} className="text-xs text-slate-400 hover:text-slate-200">
          サンプル物件のまま試す →
        </button>
      </div>
    </div>
  );
}

// ===================== 地図(GIS)タブ =====================
function MapTab({
  property,
  extras,
  enrichment,
  runEnrich,
  enriching,
}: {
  property: PropertyInput;
  extras: CatalogExtras;
  enrichment: Enrichment | null;
  runEnrich: () => void;
  enriching: boolean;
}) {
  const lat = enrichment?.lat;
  const lon = enrichment?.lon;

  const extLinks = (la: number, lo: number) => [
    { label: "ハザードマップポータル", url: `https://disaportal.gsi.go.jp/maps/?ll=${la},${lo}&z=16` },
    { label: "地理院地図", url: `https://maps.gsi.go.jp/#16/${la}/${lo}/` },
    { label: "国税庁 路線価図", url: "https://www.rosenka.nta.go.jp/" },
    { label: "全国地価マップ", url: "https://www.chikamap.jp/chikamap/Portal" },
  ];

  return (
    <div className="space-y-4">
      <Card
        title="地図（GIS）— 国土地理院タイル × ハザード重畳"
        right={
          <button
            onClick={runEnrich}
            disabled={enriching}
            className="px-2.5 py-1 rounded-md text-xs font-bold bg-accent/90 hover:bg-accent text-white disabled:opacity-50 print:hidden"
          >
            {enriching ? "測位中…" : lat != null ? "📍 再測位" : "📍 住所を測位して地図表示"}
          </button>
        }
      >
        {lat == null || lon == null ? (
          <div className="py-16 text-center">
            <div className="text-4xl mb-2">🗺️</div>
            <p className="text-sm text-slate-300">
              所在地（{property.address || "未入力"}）を測位すると、ハザードマップ等を重ねた地図を表示します。
            </p>
            <button
              onClick={runEnrich}
              disabled={enriching}
              className="mt-4 px-4 py-2 rounded-md text-sm font-bold bg-accent hover:bg-accent/90 text-white disabled:opacity-50"
            >
              {enriching ? "測位中…" : "📍 住所を測位して地図表示"}
            </button>
          </div>
        ) : (
          <>
            <div className="rounded-lg overflow-hidden border border-base-600" style={{ height: 520 }}>
              <PropertyMap lat={lat} lon={lon} label={property.name || property.address} />
            </div>
            {/* 用途地域の凡例 */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-[11px] text-slate-400 mr-1">用途地域:</span>
              {[
                ["低層住居専用", "#3fa36b"],
                ["中高層住居専用", "#a8e0a0"],
                ["住居", "#f2e15c"],
                ["近隣商業", "#ffb3a0"],
                ["商業", "#ef8fc0"],
                ["準工業", "#c0a0d8"],
                ["工業", "#a8c4e8"],
              ].map(([label, color]) => (
                <span key={label} className="inline-flex items-center gap-1 text-[10px] text-slate-300">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ background: color as string, opacity: 0.7 }} />
                  {label}
                </span>
              ))}
              <span className="text-[10px] text-slate-500">（要 不動産情報ライブラリAPIキー）</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <span className="text-[11px] text-slate-400">
                右上のレイヤー操作で、洪水・津波・土砂・高潮・用途地域の重畳を切替できます。
              </span>
              <div className="flex flex-wrap gap-2 ml-auto print:hidden">
                {extLinks(lat, lon).map((l) => (
                  <a
                    key={l.label}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-base-700 hover:bg-base-600 text-slate-200 border border-base-500"
                  >
                    {l.label} ↗
                  </a>
                ))}
              </div>
            </div>
          </>
        )}
      </Card>

      {/* 用途地域・規制サマリ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="用途地域">
          <div className="text-lg font-semibold">{extras.zoningUse ?? enrichment?.landUse?.zoningUse ?? "未取得"}</div>
        </Card>
        <Card title="建蔽率 / 容積率">
          <div className="text-lg font-semibold tnum">
            {(extras.buildingCoveragePct ?? enrichment?.landUse?.buildingCoveragePct) != null
              ? `${extras.buildingCoveragePct ?? enrichment?.landUse?.buildingCoveragePct}% / ${extras.floorAreaRatioPct ?? enrichment?.landUse?.floorAreaRatioPct ?? "—"}%`
              : "未取得"}
          </div>
        </Card>
        <Card title="公示地価（最寄）">
          <div className="text-lg font-semibold tnum">
            {enrichment?.landPrice?.koujiPerSqm ? yen(enrichment.landPrice.koujiPerSqm) + "/㎡" : "未取得"}
          </div>
        </Card>
        <Card title="ハザード総括">
          <div className="text-xs text-slate-300">
            {enrichment?.hazard ? enrichment.hazard.summary : "「測位」で判定します"}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ===================== 公的データ自動紐付け =====================
function EnrichPanel({
  enrichment,
  runEnrich,
  enriching,
  address,
}: {
  enrichment: Enrichment | null;
  runEnrich: () => void;
  enriching: boolean;
  address: string;
}) {
  const hazardLevelColor = (level: number) =>
    level === 0 ? "#2dd4a7" : level <= 2 ? "#f5b14c" : "#f56c6c";
  return (
    <Card
      title="公的データ自動紐付け（住所→緯度経度→用途地域・地価・ハザード）"
      right={
        <button
          onClick={runEnrich}
          disabled={enriching}
          className="px-2.5 py-1 rounded-md text-xs font-bold bg-accent/90 hover:bg-accent text-white disabled:opacity-50 print:hidden"
        >
          {enriching ? "取得中…" : "📍 公的データ取得"}
        </button>
      }
    >
      {!enrichment ? (
        <p className="text-sm text-slate-400 py-4 text-center">
          「公的データ取得」で、所在地（{address || "未入力"}）をジオコーディングし、
          ハザード（洪水・津波・土砂）・用途地域・公示地価を自動取得して、マイソク記載と突合せます。
          <br />
          <span className="text-[11px] text-slate-500">
            ※ ジオコーディング・ハザードはキー不要で動作。用途地域・公示地価は不動産情報ライブラリAPIキー設定時に取得。
          </span>
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>📌 {enrichment.normalizedAddress}</span>
            <span className="tnum">
              ({enrichment.lat.toFixed(5)}, {enrichment.lon.toFixed(5)})
            </span>
            <a
              href={`https://www.google.com/maps?q=${enrichment.lat},${enrichment.lon}`}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline print:hidden"
            >
              地図で開く
            </a>
          </div>

          {/* ハザード */}
          {enrichment.hazard && (
            <div>
              <div className="text-[11px] text-slate-400 mb-1.5">ハザードマップ判定（国土地理院）</div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "洪水浸水", h: enrichment.hazard.flood },
                  { label: "津波浸水", h: enrichment.hazard.tsunami },
                  { label: "土砂災害", h: enrichment.hazard.landslide },
                ].map(({ label, h }) => (
                  <div
                    key={label}
                    className="rounded-lg border p-2.5"
                    style={{ borderColor: `${hazardLevelColor(h.level)}66`, background: `${hazardLevelColor(h.level)}14` }}
                  >
                    <div className="text-[11px] text-slate-400">{label}</div>
                    <div className="text-sm font-bold" style={{ color: hazardLevelColor(h.level) }}>
                      {h.affected ? "⚠ 該当" : "✓ 該当なし"}
                    </div>
                    <div className="text-[11px] text-slate-300 mt-0.5">{h.label}</div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">{enrichment.hazard.summary}</p>
            </div>
          )}

          {/* 用途地域・地価 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric
              label="用途地域"
              value={enrichment.landUse?.zoningUse ?? "未取得"}
              sub={enrichment.landUse?.source === "reinfolib" ? "不動産情報ライブラリ" : "要APIキー"}
            />
            <Metric
              label="建蔽率 / 容積率"
              value={
                enrichment.landUse?.buildingCoveragePct != null
                  ? `${enrichment.landUse.buildingCoveragePct}% / ${enrichment.landUse.floorAreaRatioPct ?? "—"}%`
                  : "未取得"
              }
            />
            <Metric
              label="公示地価（最寄）"
              value={enrichment.landPrice?.koujiPerSqm ? yen(enrichment.landPrice.koujiPerSqm) + "/㎡" : "未取得"}
              sub={enrichment.landPrice?.distanceM != null ? `約${enrichment.landPrice.distanceM}m先` : undefined}
            />
            <Metric label="緯度経度" value={`${enrichment.lat.toFixed(4)}, ${enrichment.lon.toFixed(4)}`} />
          </div>

          {/* 突合せアラート */}
          {enrichment.checks.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-slate-400">マイソク記載 × 公的データ 突合せ</div>
              {enrichment.checks.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs rounded-md px-2.5 py-1.5"
                  style={{
                    background: c.status === "match" ? "#2dd4a714" : "#f56c6c14",
                    color: c.status === "match" ? "#2dd4a7" : "#f56c6c",
                  }}
                >
                  <span>{c.status === "match" ? "✓" : "⚠"}</span>
                  <span className="text-slate-200">{c.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ===================== 透明性: 計算方法とデータソース =====================
function MethodologyPanel({ cost, property, market, enrichment, fairValue }: any) {
  const rows: { item: string; how: string; values: string }[] = [
    {
      item: "土地評価額（積算）",
      how: "路線価 × 土地面積 × 画地補正率。路線価は手入力（マイソク/国税庁路線価図）または公的データ取得で補完。",
      values: `${(property.rosenkaPerSqm || 0).toLocaleString()}円/㎡ × ${property.landArea}㎡ × 補正${cost.shapeFactor.toFixed(3)} = ${yen(cost.landValue)}`,
    },
    {
      item: "建物価値（積算）",
      how: "構造別の再調達単価 × 延床面積 × 残存年数/法定耐用年数（RC47年/S34年/木造22年等）。",
      values: `再調達 ${yen(cost.buildingReplacementCost)} × 残存${cost.remainingYears}/${cost.legalLifespan}年 = ${yen(cost.buildingValue)}`,
    },
    {
      item: "実勢流動性価格（参考）",
      how: "補正後土地値 × 流動性倍率1.18（路線価≒公示の8割の補正）。公示地価入力時はその面積換算と平均。",
      values: yen(cost.landMarketValue),
    },
    {
      item: "公示地価（自動取得）",
      how: "「公的データ取得」実行時、座標から最寄りの地価公示ポイントを距離計算で特定（不動産情報ライブラリ）。",
      values: enrichment?.landPrice?.koujiPerSqm
        ? `${yen(enrichment.landPrice.koujiPerSqm)}/㎡（${enrichment.landPrice.pointName ?? "最寄地点"}・約${enrichment.landPrice.distanceM}m）`
        : "未取得（資産価値タブの「公的データ取得」で取得）",
    },
    {
      item: "周辺成約事例",
      how: "住所→国土地理院ジオコーダ→市区町村コード→国交省 取引価格情報API（直近約6四半期）。土地のみ/土地建物/区分に分類し中央値で集計。",
      values: market
        ? `${market.analysis.municipality ?? "—"} / ${(market.scope?.periods ?? []).join(",")} / 土地${market.analysis.land?.count ?? 0}件・一体${market.analysis.landBldg?.count ?? 0}件・区分${market.analysis.condo?.count ?? 0}件${market.source !== "reinfolib" ? "（⚠デモ）" : ""}`
        : "未取得",
    },
    {
      item: "適正市場価格",
      how: "事例分類の優先順で推定: ①土地事例単価×土地面積＋建物積算 ②土地建物一体単価×土地面積 ③区分専有単価×延床。3件未満の分類は使わない。",
      values: fairValue ? fairValue.formula : "未算出",
    },
    {
      item: "ハザード判定",
      how: "座標から国土地理院ハザードタイルの該当ピクセル色を読取り、凡例色と照合（洪水/津波/土砂）。簡易判定のため正式には自治体ハザードマップを確認。",
      values: enrichment?.hazard ? enrichment.hazard.summary : "未取得",
    },
  ];
  return (
    <Card title="🔍 計算方法とデータソース（透明性）">
      <div className="space-y-2">
        {rows.map((r) => (
          <details key={r.item} className="rounded-md border border-base-700 bg-base-900/60 px-3 py-2">
            <summary className="cursor-pointer flex items-baseline justify-between gap-3">
              <span className="text-xs font-semibold text-slate-200">{r.item}</span>
              <span className="text-[11px] text-slate-400 tnum truncate max-w-[60%]">{r.values}</span>
            </summary>
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{r.how}</p>
            <p className="text-[11px] text-slate-300 mt-1 tnum">使用値: {r.values}</p>
          </details>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 mt-3">
        ※ 各数値はクリックで根拠を展開できます。出典: 国税庁路線価・国交省不動産情報ライブラリ・国土地理院。
        本ツールは簡易シミュレーションであり、最終判断は専門家にご確認ください。
      </p>
    </Card>
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
  fairValue,
  pref,
  setPref,
  loadMarket,
  loadingMarket,
  enrichment,
  runEnrich,
  enriching,
  showOnboarding,
  onIntake,
  dismissOnboarding,
}: any) {
  return (
    <>
      {showOnboarding && (
        <OnboardingHero onIntake={onIntake} dismiss={dismissOnboarding} />
      )}
      <EnrichPanel
        enrichment={enrichment}
        runEnrich={runEnrich}
        enriching={enriching}
        address={property.address}
      />
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
            <Bar value={Math.min(100, cost.landValueRatio * 100)} max={100} color={stance.color} />
            {cost.landValueRatio > 1.5 ? (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300 leading-relaxed">
                ⚠ 土地値比率が異常に高い値です。<b>路線価・物件価格・土地面積</b>の入力をご確認ください
                （路線価は「円/㎡」単位。万円や総額を入れていないか、桁ズレがないか）。
              </div>
            ) : (
              <p className="text-xs text-slate-300 leading-relaxed">{stance.message}</p>
            )}
          </div>
        </Card>
      </div>

      {/* マーケットアプローチ */}
      <Card
        title="マーケットアプローチ（周辺成約事例・乖離率）"
        right={
          <button
            onClick={loadMarket}
            disabled={loadingMarket}
            className="px-2.5 py-1 rounded-md text-xs font-semibold bg-accent/90 hover:bg-accent text-white disabled:opacity-50 print:hidden"
          >
            {loadingMarket ? "取得中…" : "📍 所在地の市区町村で事例取得"}
          </button>
        }
      >
        {!market ? (
          <p className="text-sm text-slate-400 py-6 text-center">
            所在地（{property.address || "未入力"}）から市区町村を自動特定し、国交省「不動産情報ライブラリ」の
            成約事例（直近約6四半期）を取引種別ごとに集計して、適正市場価格と乖離率を算出します。
            <br />
            <span className="text-[11px] text-slate-500">
              ※ 経路: 住所 → 国土地理院ジオコーダ → 市区町村コード → 取引価格情報API。キー未設定時はデモ表示。
            </span>
          </p>
        ) : (
          <div className="space-y-3">
            {/* デモデータ警告 */}
            {market.source !== "reinfolib" && (
              <div className="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                ⚠ <b>これはデモデータです（実在の相場ではありません）</b>。実データには
                REINFOLIB_API_KEY の設定が必要です。
                {market.fetchError ? ` 理由: ${market.fetchError}` : ""}
              </div>
            )}

            {/* 取得範囲（計算根拠） */}
            <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
              <span>出典: {market.scope?.api}</span>
              <span>対象: {market.analysis.municipality ?? market.scope?.muniHint ?? "—"}{market.scope?.muniCd ? `（コード ${market.scope.muniCd}）` : ""}</span>
              <span>期間: {(market.scope?.periods ?? []).join(", ") || "—"}</span>
              <span>全{market.analysis.totalCount}件</span>
            </div>

            {/* 分類別統計 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {[
                { label: "土地のみ（宅地(土地)）", s: market.analysis.land, unit: "円/㎡(土地)" },
                { label: "土地と建物（一棟/戸建）", s: market.analysis.landBldg, unit: "円/㎡(土地按分)" },
                { label: "中古マンション（区分）", s: market.analysis.condo, unit: "円/㎡(専有)" },
              ].map(({ label, s, unit }) => (
                <div key={label} className="rounded-md border border-base-600 bg-base-900 p-2.5">
                  <div className="text-[11px] text-slate-400">{label}</div>
                  {s ? (
                    <>
                      <div className="tnum text-lg font-semibold">{yen(s.medianUnitPrice)}<span className="text-[10px] text-slate-500">/㎡ 中央値</span></div>
                      <div className="text-[10px] text-slate-500 tnum">
                        {s.count}件 · {man(s.minUnitPrice)}〜{man(s.maxUnitPrice)}万{unit.includes("専有") ? "(専有)" : ""}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-slate-500 py-1">事例なし</div>
                  )}
                </div>
              ))}
            </div>

            {/* 適正価格と乖離 */}
            <div className="grid grid-cols-12 gap-4 items-stretch">
              <div className="col-span-12 md:col-span-7 space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="売出価格" value={yen(property.price)} />
                  <Metric
                    label="推定適正市場価格"
                    value={fairValue && fairValue.fairValue > 0 ? yen(fairValue.fairValue) : "推定不可"}
                  />
                </div>
                {fairValue && (
                  <div className="rounded-md bg-base-900 border border-base-600 p-2.5">
                    <div className="text-[10px] text-slate-500 mb-0.5">計算式（根拠）</div>
                    <div className="text-[11px] text-slate-300 leading-relaxed">{fairValue.formula}</div>
                  </div>
                )}
              </div>
              {deviation && (
                <div className="col-span-12 md:col-span-5">
                  <div
                    className="rounded-lg p-4 border h-full"
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

            {/* 代表事例（中央値近傍） */}
            {(market.analysis.land?.samples?.length || market.analysis.landBldg?.samples?.length) ? (
              <details className="rounded-md border border-base-700 bg-base-900/60 p-2.5">
                <summary className="text-[11px] text-slate-400 cursor-pointer">代表事例を表示（相場中央値に近い成約）</summary>
                <table className="w-full text-[11px] tnum mt-2">
                  <thead>
                    <tr className="text-slate-500 border-b border-base-700">
                      <th className="text-left py-1">種別</th>
                      <th className="text-left py-1">地区</th>
                      <th className="text-right py-1">総額</th>
                      <th className="text-right py-1">面積</th>
                      <th className="text-right py-1">単価</th>
                      <th className="text-right py-1">時期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(market.analysis.land?.samples ?? []), ...(market.analysis.landBldg?.samples ?? []), ...(market.analysis.condo?.samples ?? [])].slice(0, 9).map((r: any, i: number) => (
                      <tr key={i} className="border-b border-base-800">
                        <td className="py-1 text-slate-300">{r.type ?? "—"}</td>
                        <td className="py-1 text-slate-400">{r.district ?? r.station ?? "—"}</td>
                        <td className="py-1 text-right">{yen(r.price)}</td>
                        <td className="py-1 text-right">{r.area ?? "—"}㎡</td>
                        <td className="py-1 text-right">{r.unitPrice ? yen(r.unitPrice) : r.area ? yen(Math.round(r.price / r.area)) : "—"}/㎡</td>
                        <td className="py-1 text-right text-slate-500">{r.period ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : null}
          </div>
        )}
      </Card>

      {/* 透明性: 計算方法とデータソース */}
      <MethodologyPanel cost={cost} property={property} market={market} enrichment={enrichment} fairValue={fairValue} />
    </>
  );
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
