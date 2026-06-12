"use client";
import type { StressScenario } from "@/lib/calc/stress";
import { yen, signedPct } from "@/lib/format";

export function StressTable({ scenarios }: { scenarios: StressScenario[] }) {
  return (
    <table className="w-full text-sm tnum">
      <thead>
        <tr className="text-[11px] text-slate-400 border-b border-base-600">
          <th className="text-left py-2 font-medium">シナリオ</th>
          <th className="text-right py-2 font-medium">NOI</th>
          <th className="text-right py-2 font-medium">税引前CF</th>
          <th className="text-right py-2 font-medium">DSCR</th>
          <th className="text-right py-2 font-medium">CF増減</th>
        </tr>
      </thead>
      <tbody>
        {scenarios.map((s) => {
          const dscrColor =
            !isFinite(s.dscr) || s.dscr >= 1.3
              ? "#2dd4a7"
              : s.dscr >= 1.1
                ? "#f5b14c"
                : "#f56c6c";
          return (
            <tr key={s.key} className="border-b border-base-700/50">
              <td className="py-2 text-slate-200">{s.label}</td>
              <td className="py-2 text-right text-slate-300">{yen(s.noi)}</td>
              <td
                className="py-2 text-right font-medium"
                style={{ color: s.btcf >= 0 ? "#e6ebf2" : "#f56c6c" }}
              >
                {yen(s.btcf)}
              </td>
              <td className="py-2 text-right font-semibold" style={{ color: dscrColor }}>
                {isFinite(s.dscr) ? s.dscr.toFixed(2) : "—"}
              </td>
              <td
                className="py-2 text-right text-[12px]"
                style={{ color: s.delta < 0 ? "#f56c6c" : "#94a3b8" }}
              >
                {s.key === "base" ? "—" : yen(s.delta)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
