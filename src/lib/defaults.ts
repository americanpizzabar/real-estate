import type {
  PropertyInput,
  RentalParams,
  MinpakuParams,
  LoanInput,
  ShapeCorrection,
} from "./calc/types";

// 初期表示用のサンプル物件（東京都心の一棟RM想定）
export const SAMPLE_PROPERTY: PropertyInput = {
  name: "サンプル物件（中央区マンション）",
  address: "東京都中央区日本橋",
  price: 80_000_000,
  landArea: 120,
  buildingArea: 240,
  structure: "RC",
  builtYear: 2008,
  rosenkaPerSqm: 550_000,
  koujiPerSqm: 700_000,
};

export const DEFAULT_RENTAL: RentalParams = {
  monthlyGrossRent: 520_000,
  vacancyRatePct: 8,
  opexRatePct: 20,
  rentDeclinePctPerYear: 1,
};

export const DEFAULT_MINPAKU: MinpakuParams = {
  adr: 18_000,
  occupancyPct: 65,
  operableDays: 180,
  managementFeePct: 22,
  otaFeePct: 8,
  cleaningCostPerStay: 6_000,
  avgStayNights: 2.5,
  variableCostPerNight: 1_500,
  fixedOpexAnnual: 300_000,
};

export const DEFAULT_LOAN: LoanInput = {
  amount: 64_000_000, // LTV 80%
  annualRatePct: 2.0,
  years: 25,
  repayment: "equal-payment",
};

export const DEFAULT_SHAPE: ShapeCorrection = {
  frontage: 8,
  depth: 15,
  irregular: false,
  corner: true,
};

export const DEFAULT_DOWN_PAYMENT = 16_000_000; // 自己資金（頭金20%）
export const DEFAULT_TAX_RATE = 0.33;
export const DEFAULT_DISCOUNT_RATE = 0.04;
export const DEFAULT_PROJECTION_YEARS = 20;
export const DEFAULT_EXIT_CAP_RATE = 7;

// 都道府県コード（不動産情報ライブラリAPI / 取引価格情報用）
export const PREFECTURES: { code: string; name: string }[] = [
  { code: "13", name: "東京都" },
  { code: "14", name: "神奈川県" },
  { code: "11", name: "埼玉県" },
  { code: "12", name: "千葉県" },
  { code: "27", name: "大阪府" },
  { code: "28", name: "兵庫県" },
  { code: "26", name: "京都府" },
  { code: "23", name: "愛知県" },
  { code: "40", name: "福岡県" },
  { code: "01", name: "北海道" },
];
