"use client";
import React from "react";

interface Check { name: string; ok: boolean; detail: string; keyNeeded?: boolean; configured?: boolean }
interface Result { ranAt: string; summary: string; env: Record<string, boolean>; checks: Check[] }

export function DiagnosticsPanel() {
  const [open, setOpen] = React.useState(false);
  const [result, setResult] = React.useState<Result | null>(null);
  const [loading, setLoading] = React.useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/selftest");
      const d = await res.json();
      setResult(d);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="print:hidden">
      <button
        onClick={() => { setOpen((o) => !o); if (!result) run(); }}
        className="text-[11px] text-slate-500 hover:text-slate-300 underline"
      >
        🔧 データ源の実地診断（外部API接続テスト）
      </button>
      {open && (
        <div className="mt-2 card p-3 max-w-3xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-300">{loading ? "診断中…" : result?.summary ?? "—"}</span>
            <button onClick={run} disabled={loading} className="text-[11px] px-2 py-0.5 rounded bg-base-700 hover:bg-base-600 text-slate-200 disabled:opacity-50">再実行</button>
          </div>
          {result && (
            <>
              <div className="flex flex-wrap gap-2 mb-2">
                {Object.entries(result.env).map(([k, v]) => (
                  <span key={k} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: v ? "#2dd4a722" : "#f56c6c22", color: v ? "#2dd4a7" : "#f56c6c" }}>
                    {v ? "✓" : "✗"} {k}
                  </span>
                ))}
              </div>
              <div className="space-y-1">
                {result.checks.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span style={{ color: c.ok ? "#2dd4a7" : c.configured === false ? "#94a3b8" : "#f56c6c" }}>{c.ok ? "✓" : c.configured === false ? "○" : "✗"}</span>
                    <span className="text-slate-300 shrink-0 font-medium min-w-[180px]">{c.name}</span>
                    <span className="text-slate-400">{c.detail}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-600 mt-2">
                ✓=正常, ✗=失敗（要確認）, ○=キー未設定。ジオコーディング/逆ジオ/ハザードはキー不要。取引事例/公示地価/用途地域は REINFOLIB_API_KEY が必要。
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
