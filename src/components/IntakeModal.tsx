"use client";
import React from "react";
import { ReviewSplit } from "./ReviewSplit";
import type { ExtractedFields, ExtractionResult } from "@/lib/external/extraction";
import type { RelatedLink } from "@/lib/external/related";

type Phase = "select" | "loading" | "review" | "error";

export function IntakeModal({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (fields: ExtractedFields, sourceName?: string) => void;
}) {
  const [phase, setPhase] = React.useState<Phase>("select");
  const [result, setResult] = React.useState<ExtractionResult | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [mime, setMime] = React.useState<string | null>(null);
  const [sourceName, setSourceName] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");
  const [dragOver, setDragOver] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [urlText, setUrlText] = React.useState("");
  const [sourceUrl, setSourceUrl] = React.useState<string | undefined>(undefined);
  const [related, setRelated] = React.useState<RelatedLink[]>([]);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const cameraInputRef = React.useRef<HTMLInputElement>(null);

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhase("select");
    setResult(null);
    setPreviewUrl(null);
    setMime(null);
    setSourceName("");
    setError("");
    setPasteText("");
    setUrlText("");
    setSourceUrl(undefined);
    setRelated([]);
  };

  async function handleUrl(url: string) {
    if (!url.trim()) return;
    setMime(null);
    setPreviewUrl(null);
    setSourceName(url);
    setSourceUrl(url);
    setPhase("loading");
    try {
      const res = await fetch("/api/intake-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "取得に失敗しました");
      setResult({ fields: data.fields ?? {}, evidence: data.evidence ?? [], notes: data.notes ?? [] });
      setRelated(data.related ?? []);
      setSourceUrl(data.sourceUrl ?? url);
      setPhase("review");
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhase("error");
    }
  }

  const close = () => {
    reset();
    onClose();
  };

  async function handleFile(file: File) {
    setSourceName(file.name);
    setMime(file.type);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setPhase("loading");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/intake", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "解析に失敗しました");
      setResult({ fields: data.fields ?? {}, evidence: data.evidence ?? [], notes: data.notes ?? [] });
      setPhase("review");
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhase("error");
    }
  }

  async function handlePaste() {
    if (!pasteText.trim()) return;
    setMime(null);
    setPreviewUrl(null);
    setSourceName("貼付テキスト");
    setPhase("loading");
    try {
      const res = await fetch("/api/parse-maisoku", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: pasteText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "解析に失敗しました");
      setResult({ fields: data.fields ?? {}, evidence: data.evidence ?? [], notes: data.notes ?? [] });
      setPhase("review");
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhase("error");
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-base-800 border border-base-600 rounded-xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-base-600">
          <h2 className="text-sm font-bold">📥 物件取り込み（送るだけ・置くだけ）</h2>
          <button onClick={close} className="text-slate-400 hover:text-slate-200 text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-auto">
          {phase === "select" && (
            <div className="p-5 space-y-4">
              {/* ドラッグ&ドロップ */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
                  dragOver ? "border-accent bg-accent/10" : "border-base-500 hover:border-accent/60 hover:bg-base-700/40"
                }`}
              >
                <div className="text-4xl mb-2">📄</div>
                <p className="text-sm font-semibold text-slate-200">
                  マイソクPDF・画像をここにドラッグ&ドロップ
                </p>
                <p className="text-[11px] text-slate-400 mt-1">またはクリックしてファイルを選択（PDF / JPEG / PNG / WebP・10MBまで）</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* カメラ */}
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="rounded-lg border border-base-500 hover:border-accent/60 hover:bg-base-700/40 p-4 text-center"
                >
                  <div className="text-2xl mb-1">📷</div>
                  <p className="text-sm font-semibold text-slate-200">カメラでスキャン</p>
                  <p className="text-[11px] text-slate-400">現地で紙の概要書を撮影 → 即テキスト化</p>
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                  />
                </button>

                {/* メール転送（案内） */}
                <div className="rounded-lg border border-base-600 p-4 text-center bg-base-900/50">
                  <div className="text-2xl mb-1">📧</div>
                  <p className="text-sm font-semibold text-slate-300">メール転送で取り込み</p>
                  <p className="text-[11px] text-slate-500">
                    upload-yourname@… への転送で自動登録（要メール受信設定・README参照）
                  </p>
                </div>
              </div>

              {/* WEBリンク取り込み */}
              <div className="rounded-lg border border-base-500 p-3">
                <p className="field-label">
                  🔗 WEBリンクから取り込む（SUUMO・楽待・at home・HOME&apos;S 等の物件ページURL）
                </p>
                <div className="flex gap-2">
                  <input
                    type="url"
                    className="field-input flex-1"
                    placeholder="https://… 物件掲載ページのURLを貼り付け"
                    value={urlText}
                    onChange={(e) => setUrlText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleUrl(urlText)}
                  />
                  <button
                    onClick={() => handleUrl(urlText)}
                    disabled={!/^https?:\/\//i.test(urlText.trim())}
                    className="px-3 rounded-md text-sm font-semibold bg-accent/90 hover:bg-accent text-white disabled:opacity-50 whitespace-nowrap"
                  >
                    リンクから取り込み
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  ページを解析して物件情報を抽出し、<b>同一物件の他サイト掲載リンクを横断探索</b>します。
                  ※ 各サイトの利用規約に従ってご利用ください。
                </p>
              </div>

              {/* テキスト貼付 */}
              <div>
                <p className="field-label">テキストを貼り付けて取り込む（鍵なしでも動作）</p>
                <textarea
                  className="field-input h-24 resize-none"
                  placeholder="物件概要書のテキストを貼り付け…"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <button
                  onClick={handlePaste}
                  disabled={!pasteText.trim()}
                  className="mt-2 w-full bg-accent/90 hover:bg-accent text-white text-sm font-semibold rounded-md py-2 disabled:opacity-50"
                >
                  テキストから抽出
                </button>
              </div>
            </div>
          )}

          {phase === "loading" && (
            <div className="p-16 text-center">
              <div className="inline-block w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-300 mt-3">AIがマイソクを解析中…</p>
              <p className="text-[11px] text-slate-500 mt-1">表記揺れの正規化・項目抽出を実行しています</p>
            </div>
          )}

          {phase === "review" && result && (
            <div className="h-[70vh]">
              <ReviewSplit
                previewUrl={previewUrl}
                mime={mime}
                result={result}
                sourceName={sourceName}
                sourceUrl={sourceUrl}
                related={related}
                onOpenRelated={handleUrl}
                onConfirm={(fields) => {
                  onApply(fields, sourceName);
                  close();
                }}
                onCancel={reset}
              />
            </div>
          )}

          {phase === "error" && (
            <div className="p-10 text-center">
              <div className="text-3xl mb-2">⚠️</div>
              <p className="text-sm text-red-400">{error}</p>
              <button onClick={reset} className="mt-4 px-4 py-2 rounded-md bg-base-700 hover:bg-base-600 text-sm">
                やり直す
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
