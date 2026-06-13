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

export interface MuniInfo {
  /** 市区町村コード（5桁、例: "13102"=東京都中央区） */
  muniCd: string;
  /** 都道府県コード（2桁） */
  prefCd: string;
  /** 大字・町名（GSIが返す参考表記） */
  lv01Nm?: string;
}

/**
 * 国土地理院 逆ジオコーダ（キー不要）。
 * 緯度経度 → 市区町村コード。周辺事例の市区町村絞り込みに使用。
 */
export async function reverseGeocodeMuni(lat: number, lon: number): Promise<MuniInfo | null> {
  const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "fudosan-pro/1.0 (+real-estate-analysis)" },
    next: { revalidate: 86400 },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const muniCd = data?.results?.muniCd ? String(data.results.muniCd) : null;
  if (!muniCd || muniCd.length < 5) return null;
  return {
    muniCd: muniCd.slice(0, 5),
    prefCd: muniCd.slice(0, 2),
    lv01Nm: data?.results?.lv01Nm,
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
