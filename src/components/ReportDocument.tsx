"use client";
import React from "react";
import type { PropertyInput, IncomeMode } from "@/lib/calc/types";
import type { CostApproachResult, InvestmentMetrics, CashflowYearRow } from "@/lib/calc/types";
import type { ScoreResult } from "@/lib/calc/scoring";
import type { InitialCosts } from "@/lib/calc/types";
import type { Enrichment } from "@/lib/external/enrichment";
import type { CatalogExtras } from "@/lib/catalog";
import { STRUCTURE_LABEL } from "@/lib/calc/constants";
import { yen, yenExact, pct, signedPct } from "@/lib/format";

// =============================================================
// 銀行提出用・投資委員会用レポート（A4帳票）
// 画面では非表示、印刷時のみ表示（hidden print:block）。
// ブラウザのPDF印刷でそのまま提出可能な品質を狙う。
// 自己完結のライト配色で、印刷時の見栄えを担保する。
// =============================================================

export interface ReportData {
  property: PropertyInput;
  mode: IncomeMode;
  cost: CostApproachResult;
  stance: { label: string; message: string };
  score: ScoreResult;
  metrics: InvestmentMetrics;
  rows: CashflowYearRow[];
  initialCosts: InitialCosts;
  dscrLabel: string;
  market: {
    source: string;
    municipality: string | null;
    periods: string[];
    counts: string;
  } | null;
  fairValue: { fairValue: number; formula: string } | null;
  deviation: { vsFairPct: number; vsCostPct: number; message: string } | null;
  enrichment: Enrichment | null;
  extras: CatalogExtras;
}

const KEY_YEARS = [1, 2, 3, 5, 10, 15, 20];

export function ReportDocument({ data, className = "" }: { data: ReportData; className?: string }) {
  const { property: p, cost, score, metrics, rows, mode } = data;
  const today = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
  const keyRows = KEY_YEARS.map((y) => rows.find((r) => r.year === y)).filter(Boolean) as CashflowYearRow[];

  return (
    <div className={`report ${className}`} style={{ color: "#111", background: "#fff" }}>
      {/* ヘッダー */}
      <div className="report-head">
        <div>
          <div style={{ fontSize: 11, color: "#666" }}>不動産投資 評価レポート</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "2px 0" }}>{p.name || "（物件名未設定）"}</h1>
          <div style={{ fontSize: 12, color: "#444" }}>{p.address}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 11, color: "#666" }}>
          <div>作成日: {today}</div>
          <div>判定: {mode === "rental" ? "賃貸（長期）運用" : "民泊（短期）運用"}</div>
          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 28, fontWeight: 800 }}>{score.total}</span>
            <span style={{ fontSize: 14, marginLeft: 4 }}>点 / {score.grade}</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#333", marginTop: 4 }}>{score.comment}</div>

      {/* 物件概要 + 資産評価 */}
      <div className="report-cols">
        <Section title="物件概要">
          <Row k="販売価格" v={yenExact(p.price)} strong />
          <Row k="土地面積" v={`${p.landArea} ㎡`} />
          <Row k="建物延床面積" v={`${p.buildingArea} ㎡`} />
          <Row k="構造 / 築年" v={`${STRUCTURE_LABEL[p.structure]} / ${p.builtYear}年`} />
          <Row k="表面利回り" v={pct(metrics.grossYieldPct)} />
          <Row k="実質利回り(NOI)" v={pct(metrics.netYieldPct)} />
          {data.extras.zoningUse && <Row k="用途地域" v={data.extras.zoningUse} />}
          {data.extras.buildingCoveragePct != null && (
            <Row k="建蔽率 / 容積率" v={`${data.extras.buildingCoveragePct}% / ${data.extras.floorAreaRatioPct ?? "—"}%`} />
          )}
        </Section>

        <Section title="資産評価（積算・コストアプローチ）">
          <Row k="積算価格（土地＋建物）" v={yenExact(cost.totalCostValue)} strong />
          <Row k="土地評価額" v={yenExact(cost.landValue)} />
          <Row k="建物価値" v={yenExact(cost.buildingValue)} />
          <Row k="残存 / 法定耐用年数" v={`${cost.remainingYears} / ${cost.legalLifespan} 年`} />
          <Row k="積算評価率（積算/価格）" v={pct(cost.costValueRatio * 100)} />
          <Row k="土地値比率" v={`${pct(cost.landValueRatio * 100, 0)}（${data.stance.label}）`} strong />
          <Row k="実勢流動性価格" v={yenExact(cost.landMarketValue)} />
        </Section>
      </div>

      {/* 収益サマリ */}
      <Section title={`収益サマリ（${mode === "rental" ? "賃貸" : "民泊"}）`}>
        <div className="report-grid4">
          <Kpi k="初年度NOI" v={yen(metrics.noi)} />
          <Kpi k="DSCR" v={isFinite(metrics.dscr) ? metrics.dscr.toFixed(2) : "—"} sub={data.dscrLabel} />
          <Kpi k="自己資金" v={yen(metrics.selfFunds)} />
          <Kpi k="CCR" v={pct(metrics.ccr)} />
          <Kpi k="IRR" v={metrics.irrPct != null ? pct(metrics.irrPct) : "—"} />
          <Kpi k="NPV" v={metrics.npv != null ? yen(metrics.npv) : "—"} />
          <Kpi k="元本回収" v={metrics.paybackYear ? `${metrics.paybackYear}年目` : "期間内未回収"} />
          <Kpi k="デッドクロス" v={metrics.deadCrossYear ? `${metrics.deadCrossYear}年目` : "なし"} />
        </div>
        <div style={{ fontSize: 10, color: "#666", marginTop: 6 }}>
          初期費用合計: {yenExact(data.initialCosts.total)}（仲介手数料・登録免許税・取得税・融資手数料{mode === "minpaku" ? "・民泊申請/家具家電一式" : ""} 等を含む）
        </div>
      </Section>

      {/* キャッシュフロー推移 */}
      <Section title="キャッシュフロー推移（主要年）">
        <table className="report-table">
          <thead>
            <tr>
              <th>年</th><th>NOI</th><th>年間返済</th><th>税引前CF</th><th>累積CF</th><th>ローン残高</th>
            </tr>
          </thead>
          <tbody>
            {keyRows.map((r) => (
              <tr key={r.year}>
                <td>{r.year}年</td>
                <td>{yen(r.noi)}</td>
                <td>{yen(r.debtService)}</td>
                <td style={{ color: r.btcf < 0 ? "#c00" : "#111" }}>{yen(r.btcf)}</td>
                <td style={{ color: r.cumulativeBtcf < 0 ? "#c00" : "#111" }}>{yen(r.cumulativeBtcf)}</td>
                <td>{yen(r.loanBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* 周辺相場 / 公的データ */}
      {(data.deviation || data.enrichment) && (
        <div className="report-cols">
          {data.deviation && data.market && (
            <Section title="周辺相場（マーケットアプローチ）">
              {data.fairValue && data.fairValue.fairValue > 0 && (
                <Row k="推定適正市場価格" v={yenExact(data.fairValue.fairValue)} />
              )}
              <Row k="対 適正価格 乖離" v={signedPct(data.deviation.vsFairPct)} strong />
              <Row k="対 積算価格 乖離" v={signedPct(data.deviation.vsCostPct)} />
              <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>{data.deviation.message}</div>
              {data.fairValue && (
                <div style={{ fontSize: 9, color: "#777", marginTop: 3 }}>算定式: {data.fairValue.formula}</div>
              )}
              <div style={{ fontSize: 9, color: "#999", marginTop: 2 }}>
                出典: {data.market.source === "reinfolib"
                  ? `不動産情報ライブラリ 取引価格情報（${data.market.municipality ?? ""}・${data.market.periods.join(",")}）`
                  : "デモデータ（参考値・実相場ではありません）"}
                ・{data.market.counts}
              </div>
            </Section>
          )}
          {data.enrichment?.hazard && (
            <Section title="ハザード・公的データ">
              <Row k="洪水浸水" v={data.enrichment.hazard.flood.affected ? `該当（${data.enrichment.hazard.flood.label}）` : "該当なし"} />
              <Row k="津波浸水" v={data.enrichment.hazard.tsunami.affected ? `該当（${data.enrichment.hazard.tsunami.label}）` : "該当なし"} />
              <Row k="土砂災害" v={data.enrichment.hazard.landslide.affected ? data.enrichment.hazard.landslide.label : "該当なし"} />
              {data.enrichment.landPrice?.koujiPerSqm && (
                <Row k="公示地価（最寄）" v={`${yen(data.enrichment.landPrice.koujiPerSqm)}/㎡`} />
              )}
              <div style={{ fontSize: 9, color: "#999", marginTop: 4 }}>出典: 国土地理院ハザードマップ（簡易判定）</div>
            </Section>
          )}
        </div>
      )}

      {/* 免責 */}
      <div className="report-foot">
        本レポートは「不動産投資 一撃判定」ツールによる簡易シミュレーション結果です。記載の数値は前提条件に基づく試算であり、
        実際の取引価格・賃料・融資条件・税額・災害リスク等を保証するものではありません。投資判断は必ず専門家にご確認ください。
        <span style={{ float: "right" }}>作成: {today}</span>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="report-section">
      <div className="report-section-title">{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="report-row">
      <span style={{ color: "#555" }}>{k}</span>
      <span style={{ fontWeight: strong ? 700 : 500 }}>{v}</span>
    </div>
  );
}

function Kpi({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="report-kpi">
      <div style={{ fontSize: 10, color: "#666" }}>{k}</div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{v}</div>
      {sub && <div style={{ fontSize: 9, color: "#888" }}>{sub}</div>}
    </div>
  );
}
