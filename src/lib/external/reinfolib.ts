// =============================================================
// 国土交通省「不動産情報ライブラリ」API クライアント
// https://www.reinfolib.mlit.go.jp/ （APIキーが必要）
//
// 環境変数 REINFOLIB_API_KEY が設定されていれば実APIを叩き、
// 無ければ呼び出し側でモック/手入力にフォールバックする。
//
// 公開エンドポイント例:
//  - 不動産取引価格情報 (XIT001)
//  - 地価公示・地価調査 (XPT001 / XCT001)
//  - 用途地域・都市計画 (XKT...) ※ベクトルタイル
// =============================================================

const BASE = "https://www.reinfolib.mlit.go.jp/ex-api/external";

export interface TransactionRecord {
  /** 取引価格（円） */
  price: number;
  /** 単価（円/㎡） */
  unitPrice?: number;
  /** 面積（㎡） */
  area?: number;
  /** 最寄駅 */
  station?: string;
  /** 取引時期（例: 2024年第2四半期） */
  period?: string;
  /** 用途（住宅地/商業地など） */
  use?: string;
  /** 取引の種類（宅地(土地)/宅地(土地と建物)/中古マンション等） */
  type?: string;
  /** 建物構造 */
  structure?: string;
  /** 市区町村 */
  municipality?: string;
  /** 地区名（駅名・大字） */
  district?: string;
}

export interface LandPricePoint {
  /** 地点名/所在 */
  location: string;
  /** 価格（円/㎡） */
  pricePerSqm: number;
  /** 種別: 公示地価/基準地価 */
  type: string;
  /** 年 */
  year: number;
}

function apiKey(): string | null {
  return process.env.REINFOLIB_API_KEY || null;
}

export function isReinfolibConfigured(): boolean {
  return apiKey() !== null;
}

async function fetchJson(path: string, params: Record<string, string>): Promise<any> {
  const key = apiKey();
  if (!key) throw new Error("REINFOLIB_API_KEY 未設定");
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { "Ocp-Apim-Subscription-Key": key },
    // 公的API。キャッシュは1時間。
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`reinfolib ${path} ${res.status}`);
  }
  return res.json();
}

/**
 * 不動産取引価格情報を取得する（成約事例ベースの実勢）。
 * @param area 都道府県コード（例: "13" = 東京都）
 * @param year 年（例: 2024）
 * @param quarter 四半期（1-4）。省略時は通年集計を狙う。
 */
export async function fetchTransactions(
  area: string,
  year: number,
  quarter = 2,
  city?: string
): Promise<TransactionRecord[]> {
  const params: Record<string, string> = {
    area,
    year: String(year),
    quarter: String(quarter),
  };
  if (city) params.city = city;
  const data = await fetchJson("/XIT001", params);
  const list = (data?.data ?? []) as any[];
  return list.map((d) => ({
    price: Number(d.TradePrice ?? 0),
    unitPrice: d.UnitPrice ? Number(d.UnitPrice) : undefined,
    area: d.Area ? Number(d.Area) : undefined,
    station: d.NearestStation,
    period: d.Period,
    use: d.Use ?? d.Region,
    type: d.Type,
    structure: d.Structure,
    municipality: d.Municipality,
    district: d.DistrictName,
  }));
}

/**
 * 直近の複数四半期をまとめて取得する（市区町村レベル）。
 * データ公開は四半期遅れのため、前年4Q＋当年分を対象に並行取得し、
 * 失敗した四半期は無視して結合する。
 * @returns records と 実際に取得できた期間ラベル
 */
export async function fetchRecentTransactions(
  area: string,
  city: string | undefined,
  now = new Date()
): Promise<{ records: TransactionRecord[]; periods: string[]; allFailed: boolean; lastError: string | null }> {
  const y = now.getFullYear();
  const targets: { year: number; quarter: number }[] = [
    { year: y - 1, quarter: 1 },
    { year: y - 1, quarter: 2 },
    { year: y - 1, quarter: 3 },
    { year: y - 1, quarter: 4 },
    { year: y, quarter: 1 },
    { year: y, quarter: 2 },
  ];
  const results = await Promise.all(
    targets.map((t) =>
      fetchTransactions(area, t.year, t.quarter, city)
        .then((records) => ({ t, records, error: null as string | null }))
        .catch((e) => ({ t, records: [] as TransactionRecord[], error: String(e?.message ?? e) }))
    )
  );
  const records: TransactionRecord[] = [];
  const periods: string[] = [];
  let anySucceeded = false;
  let lastError: string | null = null;
  for (const r of results) {
    if (r.error) lastError = r.error;
    else anySucceeded = true;
    if (r.records.length === 0) continue;
    records.push(...r.records);
    periods.push(`${r.t.year}年Q${r.t.quarter}`);
  }
  // 全四半期がエラー（キー不正・API障害）と「取得成功だが0件」を区別する
  const allFailed = !anySucceeded;
  return { records, periods, allFailed, lastError };
}

/**
 * 地価公示・地価調査ポイントを取得する。
 */
export async function fetchLandPrices(
  area: string,
  year: number
): Promise<LandPricePoint[]> {
  const data = await fetchJson("/XPT001", { area, year: String(year) });
  const list = (data?.data ?? []) as any[];
  return list.map((d) => ({
    location: d.Address ?? d.Location ?? "",
    pricePerSqm: Number(d.PricePerSquareMeter ?? d.Price ?? 0),
    type: d.PriceType ?? "公示地価",
    year,
  }));
}
