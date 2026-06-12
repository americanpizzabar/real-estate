"use client";
import type { SensitivityCell } from "@/lib/calc/stress";
import { yen } from "@/lib/format";

const STATUS_COLOR: Record<SensitivityCell["status"], string> = {
  loss: "#7f1d1d",
  breakeven: "#92732b",
  profit: "#1f6f54",
  target: "#15803d",
};
const STATUS_LABEL: Record<SensitivityCell["status"], string> = {
  loss: "赤字",
  breakeven: "トントン",
  profit: "黒字",
  target: "目標達成",
};

// 民泊: 稼働率 × ADR の損益分岐ヒートマップ
export function SensitivityHeatmap({
  matrix,
  adrRange,
  occRange,
}: {
  matrix: SensitivityCell[][];
  adrRange: number[];
  occRange: number[];
}) {
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px] tnum">
          <thead>
            <tr>
              <th className="p-1.5 text-slate-400 font-medium text-right">
                ADR＼稼働
              </th>
              {occRange.map((o) => (
                <th key={o} className="p-1.5 text-slate-400 font-medium text-center min-w-[52px]">
                  {o}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={i}>
                <td className="p-1.5 text-slate-300 font-medium text-right whitespace-nowrap">
                  {yen(adrRange[i])}
                </td>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="p-1.5 text-center text-white/90 rounded-sm"
                    style={{ background: STATUS_COLOR[cell.status] }}
                    title={`ADR ${yen(cell.adr)} × 稼働${cell.occupancy}% → NOI ${yen(cell.noi)}`}
                  >
                    {yen(cell.noi)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-3 mt-3">
        {(Object.keys(STATUS_COLOR) as SensitivityCell["status"][]).map((s) => (
          <div key={s} className="flex items-center gap-1.5 text-[11px] text-slate-300">
            <span
              className="w-3 h-3 rounded-sm inline-block"
              style={{ background: STATUS_COLOR[s] }}
            />
            {STATUS_LABEL[s]}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mt-2">
        セルの値は年間NOI。「黒字」＝ローン返済をカバー、「目標達成」＝目標CF確保ライン。
      </p>
    </div>
  );
}
