"use client";
import React from "react";
import {
  ExtractedFields,
  ExtractionResult,
  FieldEvidence,
} from "@/lib/external/extraction";
import { FIELD_LABELS } from "@/lib/external/extraction";
import type { RelatedLink } from "@/lib/external/related";

// 2画面スプリット確認UI: 左=元マイソク, 右=抽出フォーム。
// フィールドにフォーカスすると、画像側の読み取り箇所がハイライトされる。

const FIELD_ORDER: (keyof ExtractedFields)[] = [
  "name", "address", "price", "grossYieldPct", "annualRentIncome",
  "landArea", "buildingArea", "structure", "floors", "builtYear",
  "nearestStation", "stationWalkMin", "rosenkaPerSqm", "koujiPerSqm",
  "landRightType", "zoningUse", "buildingCoveragePct", "floorAreaRatioPct",
];

const NUMERIC = new Set<keyof ExtractedFields>([
  "price", "landArea", "buildingArea", "floors", "builtYear",
  "rosenkaPerSqm", "koujiPerSqm", "grossYieldPct", "annualRentIncome",
  "stationWalkMin", "buildingCoveragePct", "floorAreaRatioPct",
]);

export function ReviewSplit({
  previewUrl,
  mime,
  result,
  sourceName,
  sourceUrl,
  related,
  onOpenRelated,
  onConfirm,
  onCancel,
}: {
  previewUrl: string | null;
  mime: string | null;
  result: ExtractionResult;
  sourceName?: string;
  sourceUrl?: string;
  related?: RelatedLink[];
  onOpenRelated?: (url: string) => void;
  onConfirm: (fields: ExtractedFields) => void;
  onCancel: () => void;
}) {
  const [fields, setFields] = React.useState<ExtractedFields>(result.fields);
  const [active, setActive] = React.useState<keyof ExtractedFields | null>(null);

  const evidenceMap = React.useMemo(() => {
    const m = new Map<keyof ExtractedFields, FieldEvidence>();
    for (const e of result.evidence) m.set(e.field, e);
    return m;
  }, [result.evidence]);

  const isImage = (mime ?? "").startsWith("image/");
  const isPdf = mime === "application/pdf";

  const setField = (k: keyof ExtractedFields, v: string) => {
    setFields((f) => {
      const next = { ...f };
      if (v === "") {
        delete next[k];
      } else if (NUMERIC.has(k)) {
        const n = Number(v);
        (next as any)[k] = isFinite(n) ? n : undefined;
      } else {
        (next as any)[k] = v;
      }
      return next;
    });
  };

  const filledCount = FIELD_ORDER.filter((k) => fields[k] != null && fields[k] !== "").length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 h-full">
      {/* 左: 元マイソク */}
      <div className="bg-base-900 border-r border-base-600 flex flex-col min-h-[300px]">
        <div className="px-3 py-2 text-[11px] text-slate-400 border-b border-base-700 flex items-center justify-between">
          <span>元マイソク {sourceName ? `· ${sourceName}` : ""}</span>
          <span className="text-slate-500">読み取り箇所が青枠で表示されます</span>
        </div>
        <div className="relative flex-1 overflow-auto p-3">
          {previewUrl && isImage && (
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="マイソク" className="max-w-full rounded" />
              {result.evidence.map((e, i) =>
                e.box ? (
                  <div
                    key={i}
                    className="absolute border-2 rounded-sm pointer-events-none transition-all"
                    style={{
                      top: `${e.box[0] / 10}%`,
                      left: `${e.box[1] / 10}%`,
                      height: `${(e.box[2] - e.box[0]) / 10}%`,
                      width: `${(e.box[3] - e.box[1]) / 10}%`,
                      borderColor: active === e.field ? "#4f9cf9" : "rgba(79,156,249,0.35)",
                      background: active === e.field ? "rgba(79,156,249,0.18)" : "transparent",
                      boxShadow: active === e.field ? "0 0 0 9999px rgba(0,0,0,0.35)" : "none",
                    }}
                  />
                ) : null
              )}
            </div>
          )}
          {previewUrl && isPdf && (
            <object data={previewUrl} type="application/pdf" className="w-full h-[70vh] rounded">
              <p className="text-sm text-slate-400">
                PDFプレビューを表示できません。{" "}
                <a href={previewUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                  別タブで開く
                </a>
              </p>
            </object>
          )}
          {!previewUrl && sourceUrl && (
            <div className="space-y-3">
              <div className="rounded-md bg-base-800 border border-base-600 p-2.5">
                <div className="text-[11px] text-slate-400 mb-1">取得元ページ</div>
                <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-accent underline break-all">
                  {sourceUrl}
                </a>
              </div>
              <RelatedLinks related={related ?? []} onOpenRelated={onOpenRelated} />
            </div>
          )}
          {!previewUrl && !sourceUrl && (
            <div className="text-sm text-slate-400 p-6 text-center">
              テキスト貼付からの抽出のため、元画像プレビューはありません。各フィールドの読み取り根拠は右側に表示されます。
            </div>
          )}
        </div>
      </div>

      {/* 右: 抽出フォーム */}
      <div className="flex flex-col min-h-[300px] bg-base-800">
        <div className="px-3 py-2 text-[11px] text-slate-400 border-b border-base-700 flex items-center justify-between">
          <span>AI抽出結果（{filledCount}項目）· クリックで確認・修正</span>
          {result.notes.length > 0 && (
            <span className="text-slate-500 truncate max-w-[200px]">{result.notes.join(" / ")}</span>
          )}
        </div>
        <div className="flex-1 overflow-auto p-3 space-y-2">
          {filledCount === 0 && result.notes.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-200 leading-relaxed">
              ⚠ {result.notes.join(" ")}
            </div>
          )}
          {FIELD_ORDER.map((k) => {
            const ev = evidenceMap.get(k);
            const val = fields[k];
            return (
              <div
                key={k}
                className={`rounded-md border px-2.5 py-1.5 transition-colors ${
                  active === k ? "border-accent bg-base-700" : "border-base-600 bg-base-900"
                }`}
                onMouseEnter={() => setActive(k)}
                onFocus={() => setActive(k)}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] text-slate-400">{FIELD_LABELS[k]}</span>
                  {ev?.sourceText && (
                    <span className="text-[10px] text-slate-500 truncate max-w-[55%]" title={ev.sourceText}>
                      原文: {ev.sourceText}
                    </span>
                  )}
                </div>
                {k === "structure" ? (
                  <select
                    className="field-input"
                    value={(val as string) ?? ""}
                    onChange={(e) => setField(k, e.target.value)}
                    onFocus={() => setActive(k)}
                  >
                    <option value="">—</option>
                    {["RC", "SRC", "S", "LightS", "W"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="field-input"
                    type={NUMERIC.has(k) ? "number" : "text"}
                    value={(val as any) ?? ""}
                    onChange={(e) => setField(k, e.target.value)}
                    onFocus={() => setActive(k)}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="p-3 border-t border-base-700 flex gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-md text-sm font-semibold bg-base-700 hover:bg-base-600 text-slate-200"
          >
            キャンセル
          </button>
          <button
            onClick={() => onConfirm(fields)}
            className="flex-1 px-3 py-2 rounded-md text-sm font-bold bg-accent hover:bg-accent/90 text-white"
          >
            この内容で取り込む →
          </button>
        </div>
      </div>
    </div>
  );
}

// 同一物件の他サイト掲載・横断探索リンク
function RelatedLinks({
  related,
  onOpenRelated,
}: {
  related: RelatedLink[];
  onOpenRelated?: (url: string) => void;
}) {
  if (related.length === 0) {
    return (
      <p className="text-[11px] text-slate-500 px-1">
        他サイトの掲載リンクは見つかりませんでした。物件名・住所が抽出できると検索リンクを生成します。
      </p>
    );
  }
  const importable = related.filter((r) => r.kind === "same-page" || r.kind === "search-result");
  const searchLinks = related.filter((r) => r.kind === "search-link");

  const KIND_LABEL: Record<RelatedLink["kind"], string> = {
    "same-page": "ページ内リンク",
    "search-result": "検索ヒット",
    "search-link": "検索リンク",
  };

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-slate-400">
        同一物件の他サイト掲載（横断探索）{importable.length ? `· 取込可能 ${importable.length}件` : ""}
      </div>
      {importable.map((r, i) => (
        <div key={`imp-${i}`} className="rounded-md border border-base-600 bg-base-800 p-2 flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent/20 text-accent shrink-0">
            {r.portal ?? KIND_LABEL[r.kind]}
          </span>
          <span className="text-[11px] text-slate-300 truncate flex-1" title={r.title}>
            {r.title || r.url}
          </span>
          {onOpenRelated && (
            <button
              onClick={() => onOpenRelated(r.url)}
              className="px-2 py-0.5 rounded text-[10px] font-bold bg-accent/90 hover:bg-accent text-white shrink-0"
            >
              取り込む
            </button>
          )}
          <a href={r.url} target="_blank" rel="noreferrer" className="text-[10px] text-slate-400 hover:text-accent shrink-0">
            開く↗
          </a>
        </div>
      ))}
      {searchLinks.length > 0 && (
        <details className="rounded-md border border-base-700 bg-base-900 p-2">
          <summary className="text-[11px] text-slate-400 cursor-pointer">
            クロスポータル検索リンク（{searchLinks.length}件）
          </summary>
          <div className="mt-2 space-y-1">
            {searchLinks.map((r, i) => (
              <a
                key={`s-${i}`}
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="block text-[11px] text-accent hover:underline truncate"
              >
                🔎 {r.title}
              </a>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
