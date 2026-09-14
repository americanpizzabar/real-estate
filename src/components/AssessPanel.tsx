"use client";
import React from "react";
import type { Assessment, AssessInput } from "@/lib/assess";

export function AssessPanel({ input }: { input: AssessInput }) {
  const [result, setResult] = React.useState<(Assessment & { model?: string }) | null>(null);
  const [loading, setLoading] = React.useState(false);

  // 入力が変わったら所見をリセット
  React.useEffect(() => { setResult(null); }, [input.price, input.score, input.mode, input.netYieldPct]);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/assess", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (res.ok) setResult(data);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="card-title">🤖 AI総合所見</h3>
        <button
          onClick={run}
          disabled={loading}
          className="px-3 py-1 rounded-md text-xs font-bold bg-accent hover:bg-accent/90 text-white disabled:opacity-50 print:hidden"
        >
          {loading ? "生成中…" : result ? "再生成" : "所見を生成"}
        </button>
      </div>

      {!result ? (
        <p className="text-sm text-slate-400 py-3">
          物件の全指標（積算・収益・DSCR・IRR・相場乖離・ハザード等）から、強み・弱み・リスク・出口戦略・総合判断をAIが講評します。
          <span className="text-[11px] text-slate-500">（Google AIキー設定時はAI文章、未設定でもルールベースで生成）</span>
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span
              className="px-3 py-1.5 rounded-lg text-sm font-bold"
              style={{ color: result.verdictColor, border: `1.5px solid ${result.verdictColor}`, background: `${result.verdictColor}18` }}
            >
              {result.verdict}
            </span>
            <span className="text-[10px] text-slate-500">
              {result.source === "gemini" ? `AI生成 (${result.model ?? "Gemini"})` : "ルールベース生成"}
            </span>
          </div>
          <p className="text-sm text-slate-200 leading-relaxed">{result.comment}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <AssessList title="強み" color="#2dd4a7" items={result.strengths} />
            <AssessList title="弱み" color="#f5b14c" items={result.weaknesses} />
            <AssessList title="主要リスク" color="#f56c6c" items={result.risks} />
          </div>
          <div className="rounded-md bg-base-900 border border-base-600 p-3">
            <div className="text-[11px] text-slate-400 mb-1">出口戦略</div>
            <p className="text-sm text-slate-200 leading-relaxed">{result.exit}</p>
          </div>
          <p className="text-[10px] text-slate-500">
            ※ 本所見は入力指標に基づく参考意見です。最終判断は現地調査・専門家確認のうえ行ってください。
          </p>
        </div>
      )}
    </div>
  );
}

function AssessList({ title, color, items }: { title: string; color: string; items: string[] }) {
  return (
    <div className="rounded-md bg-base-900 border border-base-600 p-3">
      <div className="text-xs font-semibold mb-1.5" style={{ color }}>
        {title}
      </div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-[12px] text-slate-300 leading-relaxed flex gap-1.5">
            <span style={{ color }}>•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
