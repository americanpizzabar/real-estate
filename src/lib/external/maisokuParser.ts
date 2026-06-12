import type { PropertyInput, StructureType } from "@/lib/calc/types";

// =============================================================
// マイソク（物件概要書）テキストからの項目抽出
// LLM未接続でも動くよう、正規表現ベースのヒューリスティック抽出。
// ANTHROPIC_API_KEY があれば parse-maisoku ルート側でLLM抽出に切替。
// =============================================================

export interface ParsedMaisoku extends Partial<PropertyInput> {
  /** 抽出できた利回り（%）。価格と併せて賃料逆算に使える。 */
  grossYieldPct?: number;
  /** 抽出根拠のログ */
  notes: string[];
}

const NUM = "([0-9,，\\.]+)";

function toNum(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s.replace(/[,，]/g, ""));
  return isFinite(n) ? n : undefined;
}

/** 「3,980万円」「1.2億円」等を円に。 */
function parsePriceJP(text: string): number | undefined {
  const oku = text.match(new RegExp(`${NUM}\\s*億`));
  const man = text.match(new RegExp(`${NUM}\\s*万`));
  let total = 0;
  if (oku) total += (toNum(oku[1]) ?? 0) * 100_000_000;
  if (man) total += (toNum(man[1]) ?? 0) * 10_000;
  if (total > 0) return Math.round(total);
  return undefined;
}

const STRUCTURE_MAP: [RegExp, StructureType][] = [
  [/SRC|鉄骨鉄筋/i, "SRC"],
  [/RC|鉄筋コンクリート/i, "RC"],
  [/軽量鉄骨/i, "LightS"],
  [/重量鉄骨|鉄骨造|S造/i, "S"],
  [/木造|W造/i, "W"],
];

export function parseMaisoku(text: string): ParsedMaisoku {
  const notes: string[] = [];
  const out: ParsedMaisoku = { notes };

  // 価格
  const priceLine = text.match(/(?:価格|販売価格|売出価格)[：:\s]*([^\n]+)/);
  const price = parsePriceJP(priceLine?.[1] ?? text);
  if (price) {
    out.price = price;
    notes.push(`価格: ${(price / 10000).toLocaleString()}万円`);
  }

  // 土地面積
  const land = text.match(new RegExp(`(?:土地面積|敷地面積)[：:\\s]*${NUM}\\s*(?:㎡|m2|平米)`));
  if (land) {
    out.landArea = toNum(land[1]);
    notes.push(`土地面積: ${out.landArea}㎡`);
  }

  // 建物面積
  const bldg = text.match(new RegExp(`(?:建物面積|延床面積|延べ床面積)[：:\\s]*${NUM}\\s*(?:㎡|m2|平米)`));
  if (bldg) {
    out.buildingArea = toNum(bldg[1]);
    notes.push(`延床面積: ${out.buildingArea}㎡`);
  }

  // 構造
  for (const [re, st] of STRUCTURE_MAP) {
    if (re.test(text)) {
      out.structure = st;
      notes.push(`構造: ${st}`);
      break;
    }
  }

  // 築年
  const builtWa = text.match(/(?:築年月|建築年月|新築)[：:\s]*(?:昭和|平成|令和)?\s*([0-9]{4})?年?/);
  const builtYear = text.match(/([12][0-9]{3})\s*年(?:築|建築)/);
  if (builtYear) {
    out.builtYear = toNum(builtYear[1]);
    notes.push(`築年: ${out.builtYear}`);
  } else if (builtWa?.[1]) {
    out.builtYear = toNum(builtWa[1]);
  }

  // 利回り
  const yld = text.match(new RegExp(`(?:利回り|表面利回り)[：:\\s]*${NUM}\\s*[%％]`));
  if (yld) {
    out.grossYieldPct = toNum(yld[1]);
    notes.push(`表面利回り: ${out.grossYieldPct}%`);
  }

  // 住所
  const addr = text.match(/(?:所在地|住所)[：:\s]*([^\n]+)/);
  if (addr) {
    out.address = addr[1].trim().slice(0, 60);
  }

  // 路線価
  const rosen = text.match(new RegExp(`路線価[：:\\s]*${NUM}`));
  if (rosen) {
    let v = toNum(rosen[1]) ?? 0;
    // 路線価図は千円/㎡表記が多い。1000未満なら千円単位とみなす。
    if (v > 0 && v < 10000) v *= 1000;
    out.rosenkaPerSqm = v;
  }

  return out;
}
