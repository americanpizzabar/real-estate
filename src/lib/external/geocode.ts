// =============================================================
// ジオコーディング & 地図タイル座標計算
// 国土地理院（GSI）住所検索API（APIキー不要）で住所→緯度経度。
// ハザードタイルのピクセル参照に使うタイル/ピクセル座標も算出する。
// =============================================================

export interface GeocodeResult {
  lat: number;
  lon: number;
  /** 正規化された住所表記（GSIのtitle） */
  normalizedAddress: string;
}

/** GSI住所検索。最も確からしい1件を返す。失敗時null。 */
export async function geocodeGSI(address: string): Promise<GeocodeResult | null> {
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(
    address
  )}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "fudosan-pro/1.0 (+real-estate-analysis)" },
    next: { revalidate: 86400 },
  });
  if (!res.ok) throw new Error(`gsi geocode ${res.status}`);
  const data = (await res.json()) as any[];
  if (!Array.isArray(data) || data.length === 0) return null;
  // GSIは候補を返す。最初（最もマッチ度が高い）を採用。
  const best = data[0];
  const coords = best?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  return {
    lon: Number(coords[0]),
    lat: Number(coords[1]),
    normalizedAddress: best?.properties?.title ?? address,
  };
}

export interface TilePixel {
  z: number;
  x: number;
  y: number;
  px: number; // タイル内ピクセルX (0-255)
  py: number; // タイル内ピクセルY (0-255)
}

/** 緯度経度 → Web Mercator タイル座標＋タイル内ピクセル。 */
export function latLonToTilePixel(lat: number, lon: number, z: number): TilePixel {
  const n = Math.pow(2, z);
  const latRad = (lat * Math.PI) / 180;
  const xf = ((lon + 180) / 360) * n;
  const yf = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  const px = Math.min(255, Math.max(0, Math.floor((xf - x) * 256)));
  const py = Math.min(255, Math.max(0, Math.floor((yf - y) * 256)));
  return { z, x, y, px, py };
}
