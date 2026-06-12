import { PNG } from "pngjs";
import { latLonToTilePixel } from "./geocode";

// =============================================================
// ハザードマップ自動判定
// 国土地理院ハザードマップポータルのラスタタイル（APIキー不要・公開）
// から対象地点のピクセル色を読み取り、リスクを分類する。
// あくまで簡易判定。正式には自治体のハザードマップで確認すること。
// =============================================================

export interface HazardLevel {
  /** リスクあり/なし */
  affected: boolean;
  /** 区分ラベル（浸水深やゾーン種別） */
  label: string;
  /** 0=なし 1..n=強度 */
  level: number;
  /** 判定に使った色（#rrggbb） */
  color?: string;
}

export interface HazardResult {
  flood: HazardLevel; // 洪水（想定最大規模）
  tsunami: HazardLevel; // 津波
  landslide: HazardLevel; // 土砂災害
  /** 総合コメント */
  summary: string;
}

interface PaletteEntry {
  rgb: [number, number, number];
  label: string;
  level: number;
}

// 国土地理院 浸水深（想定最大規模）凡例の近似色
const FLOOD_PALETTE: PaletteEntry[] = [
  { rgb: [247, 245, 169], label: "0〜0.5m未満", level: 1 },
  { rgb: [255, 216, 192], label: "0.5〜3.0m", level: 2 },
  { rgb: [255, 183, 183], label: "3.0〜5.0m", level: 3 },
  { rgb: [255, 145, 145], label: "5.0〜10.0m", level: 4 },
  { rgb: [242, 133, 201], label: "10.0〜20.0m", level: 5 },
  { rgb: [220, 122, 220], label: "20.0m以上", level: 6 },
];

const TSUNAMI_PALETTE = FLOOD_PALETTE.map((p) => ({ ...p, label: `津波浸水 ${p.label}` }));

// 土砂災害（警戒区域）の近似色: イエロー=警戒、レッド/紫=特別警戒
const LANDSLIDE_PALETTE: PaletteEntry[] = [
  { rgb: [255, 237, 74], label: "土砂災害警戒区域（イエロー）", level: 1 },
  { rgb: [255, 153, 0], label: "土石流警戒区域", level: 1 },
  { rgb: [230, 0, 18], label: "土砂災害特別警戒区域（レッド）", level: 2 },
  { rgb: [200, 0, 100], label: "特別警戒区域", level: 2 },
];

const TILE_LAYERS = {
  flood: "01_flood_l2_shinsuishin_data",
  tsunami: "04_tsunami_newlegend_data",
  landslide: "05_dosyakeikai_keikaikuiki_data",
};

const NONE: HazardLevel = { affected: false, label: "該当なし", level: 0 };

function nearest(
  r: number,
  g: number,
  b: number,
  palette: PaletteEntry[],
  threshold = 70
): PaletteEntry | null {
  let best: PaletteEntry | null = null;
  let bestD = Infinity;
  for (const p of palette) {
    const d = Math.sqrt(
      (r - p.rgb[0]) ** 2 + (g - p.rgb[1]) ** 2 + (b - p.rgb[2]) ** 2
    );
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return bestD <= threshold ? best : null;
}

function toHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

async function readTilePixel(
  layer: string,
  lat: number,
  lon: number,
  z: number
): Promise<{ r: number; g: number; b: number; a: number } | null> {
  const { x, y, px, py } = latLonToTilePixel(lat, lon, z);
  const url = `https://disaportaldata.gsi.go.jp/raster/${layer}/${z}/${x}/${y}.png`;
  const res = await fetch(url, {
    headers: { "User-Agent": "fudosan-pro/1.0 (+real-estate-analysis)" },
    next: { revalidate: 86400 },
  });
  if (res.status === 404) return null; // タイルなし=データ整備外/該当なし
  if (!res.ok) throw new Error(`hazard ${layer} ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const png = PNG.sync.read(buf);
  const idx = (png.width * py + px) * 4;
  return {
    r: png.data[idx],
    g: png.data[idx + 1],
    b: png.data[idx + 2],
    a: png.data[idx + 3],
  };
}

async function assess(
  layer: string,
  palette: PaletteEntry[],
  lat: number,
  lon: number,
  z: number
): Promise<HazardLevel> {
  try {
    const px = await readTilePixel(layer, lat, lon, z);
    if (!px || px.a < 10) return NONE; // 透明 = 該当なし
    const match = nearest(px.r, px.g, px.b, palette);
    if (match) {
      return {
        affected: true,
        label: match.label,
        level: match.level,
        color: toHex(px.r, px.g, px.b),
      };
    }
    // 色はあるが凡例外 → 該当あり（詳細不明）
    return {
      affected: true,
      label: "該当あり（区分不明）",
      level: 1,
      color: toHex(px.r, px.g, px.b),
    };
  } catch {
    return { affected: false, label: "取得不可", level: 0 };
  }
}

/** 対象地点のハザードを一括判定。 */
export async function assessHazards(lat: number, lon: number): Promise<HazardResult> {
  const [flood, tsunami, landslide] = await Promise.all([
    assess(TILE_LAYERS.flood, FLOOD_PALETTE, lat, lon, 16),
    assess(TILE_LAYERS.tsunami, TSUNAMI_PALETTE, lat, lon, 16),
    assess(TILE_LAYERS.landslide, LANDSLIDE_PALETTE, lat, lon, 16),
  ]);

  const risks: string[] = [];
  if (flood.affected) risks.push(`洪水(${flood.label})`);
  if (tsunami.affected) risks.push(`津波(${tsunami.label})`);
  if (landslide.affected) risks.push(landslide.label);

  const summary =
    risks.length === 0
      ? "主要ハザード（洪水・津波・土砂）の該当は確認されませんでした。"
      : `次のリスクに該当の可能性: ${risks.join(" / ")}。融資・保険・出口の判断材料に。`;

  return { flood, tsunami, landslide, summary };
}
