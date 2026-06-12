import type { StructureType } from "@/lib/calc/types";

// =============================================================
// マイソク抽出の共通スキーマ・プロンプト
// テキスト貼付（parse-maisoku）とファイル取込（intake）で共有し、
// 抽出項目・表記揺れ補正ルールを一元管理する。
// =============================================================

/** AIが抽出する物件フィールド（投資判断に必要な緻密なデータ）。 */
export interface ExtractedFields {
  name?: string;
  address?: string;
  price?: number; // 円
  landArea?: number; // ㎡
  buildingArea?: number; // ㎡（延床）
  structure?: StructureType;
  floors?: number; // 階数
  builtYear?: number; // 西暦
  rosenkaPerSqm?: number; // 円/㎡
  koujiPerSqm?: number; // 円/㎡
  grossYieldPct?: number; // 表面利回り %
  annualRentIncome?: number; // 満室時想定 年間賃料（円）
  nearestStation?: string;
  stationWalkMin?: number; // 駅徒歩（分）
  landRightType?: string; // 所有権 / 借地 等
  zoningUse?: string; // 用途地域
  buildingCoveragePct?: number; // 建蔽率 %
  floorAreaRatioPct?: number; // 容積率 %
}

/** フィールド単位の抽出根拠（2画面ハイライト用）。 */
export interface FieldEvidence {
  field: keyof ExtractedFields;
  /** マイソク内の該当文字列（生テキスト） */
  sourceText: string;
  /** 画像内の正規化バウンディングボックス [ymin,xmin,ymax,xmax]（0-1000）。画像のみ。 */
  box?: [number, number, number, number];
}

export interface ExtractionResult {
  fields: ExtractedFields;
  evidence: FieldEvidence[];
  notes: string[];
}

export const FIELD_LABELS: Record<keyof ExtractedFields, string> = {
  name: "物件名",
  address: "所在地",
  price: "価格",
  landArea: "土地面積",
  buildingArea: "建物面積（延床）",
  structure: "構造",
  floors: "階数",
  builtYear: "築年",
  rosenkaPerSqm: "路線価",
  koujiPerSqm: "公示地価",
  grossYieldPct: "表面利回り",
  annualRentIncome: "満室時想定年収",
  nearestStation: "最寄駅",
  stationWalkMin: "駅徒歩",
  landRightType: "権利形態",
  zoningUse: "用途地域",
  buildingCoveragePct: "建蔽率",
  floorAreaRatioPct: "容積率",
};

export const EXTRACTION_SYSTEM =
  "あなたは日本の不動産マイソク（物件概要書）を読み取り、投資判断用データに構造化するプロのアシスタントです。" +
  "表記の揺れ（例: 「RC 3F」「鉄筋コンクリート造3階建」「RC造」→ 構造:RC, 階数:3）を正しく正規化します。" +
  "「年間予定賃料」「満室時想定収入」等は annualRentIncome として認識します。出力は指定スキーマのJSONのみ。";

/** 抽出指示の本文（画像/PDFいずれでも共通。withBox=true で画像のバウンディングボックスも要求）。 */
export function extractionInstruction(withBox: boolean, pastedText?: string, maxChars = 8000): string {
  const base = `次のマイソクから物件情報を抽出し、以下の形のJSONを1つだけ出力してください。

{
  "fields": {
    "name": string, "address": string,
    "price": number(円), "landArea": number(㎡), "buildingArea": number(㎡延床),
    "structure": "RC"|"SRC"|"S"|"LightS"|"W", "floors": number,
    "builtYear": number(西暦), "rosenkaPerSqm": number(円/㎡), "koujiPerSqm": number(円/㎡),
    "grossYieldPct": number(%), "annualRentIncome": number(満室時想定の年間賃料・円),
    "nearestStation": string, "stationWalkMin": number(分),
    "landRightType": string, "zoningUse": string,
    "buildingCoveragePct": number(%), "floorAreaRatioPct": number(%)
  },
  "evidence": [ { "field": fieldsのキー名, "sourceText": "マイソク内の該当文字列"${withBox ? ', "box": [ymin,xmin,ymax,xmax]（0-1000正規化）' : ""} } ]
}

ルール:
- 不明な項目は fields から省略（推測で埋めない）。
- 金額は必ず円単位の数値（「1億2000万円」→ 120000000）。
- 構造は表記揺れを RC/SRC/S/LightS/W に正規化。軽量鉄骨=LightS, 重量鉄骨/S造=S。
- 利回りが無く満室想定年収と価格がある場合は grossYieldPct を計算して補完してよい。
- evidence は抽出した各フィールドについて、読み取り元の文字列を必ず含める。${withBox ? "画像座標は左上原点・0-1000正規化で box に格納。" : ""}`;
  if (pastedText) {
    return `${base}\n\n--- マイソク本文（HTML/JSON断片を含む場合あり。物件データを読み取ること）---\n${pastedText.slice(0, maxChars)}`;
  }
  return base;
}

/** Gemini等の生JSON文字列を ExtractionResult に正規化（堅牢パース）。 */
export function normalizeExtraction(raw: string): ExtractionResult {
  const notes: string[] = [];
  let obj: any = {};
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    obj = JSON.parse(m ? m[0] : raw);
  } catch {
    notes.push("JSONパースに失敗しました");
  }
  // fields が直下に展開されているケースにも対応
  const fields: ExtractedFields = obj.fields ?? pickFields(obj);
  const evidence: FieldEvidence[] = Array.isArray(obj.evidence)
    ? obj.evidence
        .filter((e: any) => e && e.field)
        .map((e: any) => ({
          field: e.field,
          sourceText: String(e.sourceText ?? ""),
          box: Array.isArray(e.box) && e.box.length === 4 ? e.box : undefined,
        }))
    : [];
  return { fields: coerceNumbers(fields), evidence, notes };
}

const FIELD_KEYS = Object.keys(FIELD_LABELS) as (keyof ExtractedFields)[];

function pickFields(obj: any): ExtractedFields {
  const out: any = {};
  for (const k of FIELD_KEYS) if (obj[k] != null) out[k] = obj[k];
  return out;
}

const NUMERIC_KEYS: (keyof ExtractedFields)[] = [
  "price", "landArea", "buildingArea", "floors", "builtYear",
  "rosenkaPerSqm", "koujiPerSqm", "grossYieldPct", "annualRentIncome",
  "stationWalkMin", "buildingCoveragePct", "floorAreaRatioPct",
];

function coerceNumbers(f: ExtractedFields): ExtractedFields {
  const out: any = { ...f };
  for (const k of NUMERIC_KEYS) {
    if (out[k] != null && typeof out[k] !== "number") {
      const n = Number(String(out[k]).replace(/[^0-9.\-]/g, ""));
      if (isFinite(n)) out[k] = n;
      else delete out[k];
    }
  }
  return out;
}
