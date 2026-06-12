import type { HazardResult } from "./hazard";
import type { LandUseInfo } from "./reinfolibGeo";

// 公的データ自動紐付けの結果（住所→緯度経度→各種公的情報）。
export interface Enrichment {
  lat: number;
  lon: number;
  normalizedAddress: string;
  hazard: HazardResult | null;
  landUse: (LandUseInfo & { source: "reinfolib" | "none" }) | null;
  landPrice: {
    source: "reinfolib" | "none";
    koujiPerSqm?: number;
    pointName?: string;
    distanceM?: number;
  } | null;
  /** マイソク記載と公的データの突合せ結果（食い違いアラート）。 */
  checks: EnrichCheck[];
}

export interface EnrichCheck {
  field: string;
  maisokuValue: string;
  officialValue: string;
  status: "match" | "mismatch" | "info";
  message: string;
}
