"use client";
import React from "react";
import {
  Section,
  Segmented,
  NumberField,
  TextField,
  SelectField,
  Toggle,
} from "./ui";
import type {
  PropertyInput,
  ShapeCorrection,
  LoanInput,
  RentalParams,
  MinpakuParams,
  StructureType,
  RepaymentType,
  IncomeMode,
} from "@/lib/calc/types";
import { STRUCTURE_LABEL } from "@/lib/calc/constants";
import { man } from "@/lib/format";

const STRUCTURE_OPTIONS = (Object.keys(STRUCTURE_LABEL) as StructureType[]).map(
  (k) => ({ value: k, label: STRUCTURE_LABEL[k] })
);

export interface InputState {
  property: PropertyInput;
  shape: ShapeCorrection;
  loan: LoanInput;
  rental: RentalParams;
  minpaku: MinpakuParams;
  downPayment: number;
  taxRatePct: number;
  exitCapRatePct: number;
  years: number;
}

export function InputPanel({
  state,
  set,
  mode,
  setMode,
  onIntake,
}: {
  state: InputState;
  set: (patch: Partial<InputState>) => void;
  mode: IncomeMode;
  setMode: (m: IncomeMode) => void;
  onIntake: () => void;
}) {
  const p = state.property;
  const setProp = (patch: Partial<PropertyInput>) =>
    set({ property: { ...p, ...patch } });
  const ltv = p.price > 0 ? Math.round((state.loan.amount / p.price) * 100) : 0;

  return (
    <div className="space-y-2.5">
      {/* 取り込み導線 */}
      <button
        onClick={onIntake}
        className="w-full bg-accent hover:bg-accent/90 text-white text-sm font-bold rounded-lg py-2.5 flex items-center justify-center gap-2 shadow-sm"
      >
        📥 物件を取り込む
        <span className="text-[10px] font-normal opacity-80">PDF・画像・URL・カメラ</span>
      </button>

      {/* 物件情報 */}
      <Section title="物件情報">
        <div className="space-y-2.5">
          <TextField label="物件名" value={p.name} onChange={(v) => setProp({ name: v })} />
          <TextField label="所在地" value={p.address} onChange={(v) => setProp({ address: v })} />
          <div>
            <NumberField
              label="物件価格"
              suffix="円"
              value={p.price}
              step={1_000_000}
              onChange={(v) => setProp({ price: v })}
            />
            <div className="text-[11px] text-slate-500 mt-0.5">≒ {man(p.price).toLocaleString()}万円</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="土地面積" suffix="㎡" value={p.landArea} onChange={(v) => setProp({ landArea: v })} />
            <NumberField label="延床面積" suffix="㎡" value={p.buildingArea} onChange={(v) => setProp({ buildingArea: v })} />
          </div>
          <SelectField
            label="構造"
            value={p.structure}
            options={STRUCTURE_OPTIONS}
            onChange={(v) => setProp({ structure: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="築年（西暦）" value={p.builtYear} onChange={(v) => setProp({ builtYear: v })} />
            <NumberField label="路線価" suffix="円/㎡" step={10_000} value={p.rosenkaPerSqm} onChange={(v) => setProp({ rosenkaPerSqm: v })} />
          </div>
          <NumberField label="公示地価/基準地価" suffix="円/㎡" step={10_000} value={p.koujiPerSqm} onChange={(v) => setProp({ koujiPerSqm: v })} />
        </div>
      </Section>

      {/* ローン条件 */}
      <Section title="ローン条件（レバレッジ）" right={<span className="text-[10px] text-slate-500 tnum">LTV {ltv}%</span>}>
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="借入額" suffix="円" step={1_000_000} value={state.loan.amount} onChange={(v) => set({ loan: { ...state.loan, amount: v } })} />
            <NumberField label="自己資金(頭金)" suffix="円" step={1_000_000} value={state.downPayment} onChange={(v) => set({ downPayment: v })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="金利" suffix="%" step={0.1} value={state.loan.annualRatePct} onChange={(v) => set({ loan: { ...state.loan, annualRatePct: v } })} />
            <NumberField label="期間" suffix="年" value={state.loan.years} onChange={(v) => set({ loan: { ...state.loan, years: v } })} />
          </div>
          <SelectField<RepaymentType>
            label="返済方式"
            value={state.loan.repayment}
            options={[
              { value: "equal-payment", label: "元利均等" },
              { value: "equal-principal", label: "元金均等" },
            ]}
            onChange={(v) => set({ loan: { ...state.loan, repayment: v } })}
          />
        </div>
      </Section>

      {/* 収益設定（モード連動・選択中のモードのみ表示） */}
      <Section
        title="収益設定"
        right={
          <Segmented<IncomeMode>
            size="sm"
            value={mode}
            options={[
              { value: "rental", label: "賃貸" },
              { value: "minpaku", label: "民泊" },
            ]}
            onChange={setMode}
          />
        }
      >
        {mode === "rental" ? (
          <div className="space-y-2.5">
            <NumberField label="月額満室賃料(合計)" suffix="円" step={10_000} value={state.rental.monthlyGrossRent} onChange={(v) => set({ rental: { ...state.rental, monthlyGrossRent: v } })} />
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="空室率" suffix="%" value={state.rental.vacancyRatePct} onChange={(v) => set({ rental: { ...state.rental, vacancyRatePct: v } })} />
              <NumberField label="運営費率" suffix="%" value={state.rental.opexRatePct} onChange={(v) => set({ rental: { ...state.rental, opexRatePct: v } })} />
            </div>
            <NumberField label="賃料下落率" suffix="%/年" step={0.1} value={state.rental.rentDeclinePctPerYear} onChange={(v) => set({ rental: { ...state.rental, rentDeclinePctPerYear: v } })} />
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="ADR(客単価)" suffix="円/泊" step={1_000} value={state.minpaku.adr} onChange={(v) => set({ minpaku: { ...state.minpaku, adr: v } })} />
              <NumberField label="稼働率" suffix="%" value={state.minpaku.occupancyPct} onChange={(v) => set({ minpaku: { ...state.minpaku, occupancyPct: v } })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="営業可能日数" suffix="日/年" value={state.minpaku.operableDays} onChange={(v) => set({ minpaku: { ...state.minpaku, operableDays: v } })} />
              <NumberField label="平均宿泊数" suffix="泊" step={0.5} value={state.minpaku.avgStayNights} onChange={(v) => set({ minpaku: { ...state.minpaku, avgStayNights: v } })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="運営代行手数料" suffix="%" value={state.minpaku.managementFeePct} onChange={(v) => set({ minpaku: { ...state.minpaku, managementFeePct: v } })} />
              <NumberField label="OTA手数料" suffix="%" value={state.minpaku.otaFeePct} onChange={(v) => set({ minpaku: { ...state.minpaku, otaFeePct: v } })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="清掃費" suffix="円/回" step={500} value={state.minpaku.cleaningCostPerStay} onChange={(v) => set({ minpaku: { ...state.minpaku, cleaningCostPerStay: v } })} />
              <NumberField label="変動費" suffix="円/泊" step={500} value={state.minpaku.variableCostPerNight} onChange={(v) => set({ minpaku: { ...state.minpaku, variableCostPerNight: v } })} />
            </div>
            <NumberField label="固定運営費" suffix="円/年" step={50_000} value={state.minpaku.fixedOpexAnnual} onChange={(v) => set({ minpaku: { ...state.minpaku, fixedOpexAnnual: v } })} />
          </div>
        )}
        <p className="text-[10px] text-slate-500 mt-2">
          ※「賃貸×民泊 比較」タブでは両モードの値を使用。上の切替で各モードの値を編集できます。
        </p>
      </Section>

      {/* 詳細設定（既定は折りたたみ） */}
      <Section title="詳細設定（画地補正・試算条件）" defaultOpen={false}>
        <div className="space-y-3">
          <div>
            <div className="field-label">画地補正（土地評価）</div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <NumberField label="間口" suffix="m" value={state.shape.frontage} onChange={(v) => set({ shape: { ...state.shape, frontage: v } })} />
              <NumberField label="奥行" suffix="m" value={state.shape.depth} onChange={(v) => set({ shape: { ...state.shape, depth: v } })} />
            </div>
            <div className="flex gap-4">
              <Toggle label="不整形地" checked={state.shape.irregular} onChange={(v) => set({ shape: { ...state.shape, irregular: v } })} />
              <Toggle label="角地" checked={state.shape.corner} onChange={(v) => set({ shape: { ...state.shape, corner: v } })} />
            </div>
          </div>
          <div className="border-t border-base-700 pt-3">
            <div className="field-label">試算条件</div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="予測年数" suffix="年" value={state.years} onChange={(v) => set({ years: v })} />
              <NumberField label="出口還元利回り" suffix="%" step={0.1} value={state.exitCapRatePct} onChange={(v) => set({ exitCapRatePct: v })} />
              <NumberField label="実効税率" suffix="%" value={state.taxRatePct} onChange={(v) => set({ taxRatePct: v })} />
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
