import { latLonToTilePixel } from "./geocode";

// =============================================================
// 不動産情報ライブラリ（MLIT）GISエンドポイント連携
// 用途地域（建蔽率/容積率）・地価公示を GeoJSON で取得し、
// 対象地点に紐付ける。REINFOLIB_API_KEY が必要。
// エンドポイント仕様差異に備え、全て try/catch で優雅に劣化。
// =============================================================

const BASE = "https://www.reinfolib.mlit.go.jp/ex-api/external";

function apiKey(): string | null {
  return process.env.REINFOLIB_API_KEY || null;
}

export function isReinfolibGeoConfigured(): boolean {
  return apiKey() !== null;
}

async function fetchGeoJson(
  path: string,
  z: number,
  x: number,
  y: number,
  extra: Record<string, string> = {}
): Promise<any | null> {
  const key = apiKey();
  if (!key) return null;
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("response_format", "geojson");
  url.searchParams.set("z", String(z));
  url.searchParams.set("x", String(x));
  url.searchParams.set("y", String(y));
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { "Ocp-Apim-Subscription-Key": key },
    next: { revalidate: 86400 },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

// ---- 幾何ユーティリティ ----
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lon: number, lat: number, geom: any): boolean {
  if (!geom) return false;
  if (geom.type === "Polygon") {
    return geom.coordinates.length > 0 && pointInRing(lon, lat, geom.coordinates[0]);
  }
  if (geom.type === "MultiPolygon") {
    return geom.coordinates.some(
      (poly: number[][][]) => poly.length > 0 && pointInRing(lon, lat, poly[0])
    );
  }
  return false;
}

function num(v: any): number | undefined {
  if (v == null) return undefined;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : undefined;
}

/** 候補キーから最初に見つかった値を返す。 */
function pick(props: any, keys: string[]): any {
  for (const k of keys) {
    if (props && props[k] != null && props[k] !== "") return props[k];
  }
  return undefined;
}

export interface LandUseInfo {
  zoningUse?: string; // 用途地域名
  buildingCoveragePct?: number; // 建蔽率
  floorAreaRatioPct?: number; // 容積率
}

/**
 * 用途地域（建蔽率/容積率）を取得。XKT002（用途地域）GeoJSON。
 */
export async function fetchLandUse(lat: number, lon: number): Promise<LandUseInfo | null> {
  try {
    const z = 15;
    const { x, y } = latLonToTilePixel(lat, lon, z);
    const gj = await fetchGeoJson("/XKT002", z, x, y);
    const feats = gj?.features ?? [];
    const hit = feats.find((f: any) => pointInGeometry(lon, lat, f.geometry));
    if (!hit) return null;
    const p = hit.properties ?? {};
    return {
      zoningUse: pick(p, ["use_area_ja", "youto_chiki", "YoutoChiki", "use_area"]),
      buildingCoveragePct: num(pick(p, ["building_coverage_ratio", "kenpei", "u_building_coverage_ratio_ja"])),
      floorAreaRatioPct: num(pick(p, ["floor_area_ratio", "yoseki", "u_floor_area_ratio_ja"])),
    };
  } catch {
    return null;
  }
}

export interface LandPriceInfo {
  koujiPerSqm?: number; // 公示地価（円/㎡）
  pointName?: string; // 最寄基準点
  distanceM?: number; // 対象地からの距離
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * 最寄りの地価公示ポイントを取得。XPT001 GeoJSON。
 */
export async function fetchNearestLandPrice(
  lat: number,
  lon: number,
  year = new Date().getFullYear()
): Promise<LandPriceInfo | null> {
  try {
    const z = 15;
    const { x, y } = latLonToTilePixel(lat, lon, z);
    const gj = await fetchGeoJson("/XPT001", z, x, y, { year: String(year) });
    const feats = gj?.features ?? [];
    let best: { price: number; name?: string; dist: number } | null = null;
    for (const f of feats) {
      const c = f.geometry?.coordinates;
      if (!c) continue;
      const price = num(
        pick(f.properties ?? {}, [
          "u_current_years_price_ja",
          "current_years_price",
          "price",
          "u_price",
        ])
      );
      if (!price) continue;
      const dist = haversineM(lat, lon, Number(c[1]), Number(c[0]));
      if (!best || dist < best.dist) {
        best = {
          price,
          name: pick(f.properties ?? {}, ["standard_lot_number_ja", "address", "location"]),
          dist,
        };
      }
    }
    if (!best) return null;
    return { koujiPerSqm: best.price, pointName: best.name, distanceM: Math.round(best.dist) };
  } catch {
    return null;
  }
}
