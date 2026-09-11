// =============================================================
// 不動産投資判断ツール — 共通型定義
// すべての計算ロジックは純粋関数として実装し、UIから分離する。
// 金額は原則「円」単位の number で扱う（万円ではない点に注意）。
// =============================================================

/** 建物構造。法定耐用年数・再調達単価のキーになる。 */
export type StructureType = "RC" | "SRC" | "S" | "LightS" | "W";

/** 収益モード。賃貸（長期）か民泊（短期）か。 */
export type IncomeMode = "rental" | "minpaku";

/** ローン返済方式。 */
export type RepaymentType = "equal-payment" | "equal-principal";
// equal-payment   = 元利均等
// equal-principal = 元金均等

/** 物件の基本情報。マイソク（物件概要書）から抽出される項目に対応。 */
export interface PropertyInput {
  /** 物件名・通称 */
  name: string;
  /** 住居表示 or 所在地 */
  address: string;
  /** 物件価格（円） */
  price: number;
  /** 土地面積（㎡） */
  landArea: number;
  /** 建物延床面積（㎡） */
  buildingArea: number;
  /** 構造 */
  structure: StructureType;
  /** 築年（西暦）。新築なら現在年。 */
  builtYear: number;
  /** 路線価（円/㎡）。なければ 0。 */
  rosenkaPerSqm: number;
  /** 公示地価/基準地価（円/㎡）。なければ 0。 */
  koujiPerSqm: number;
  /** 固定資産税評価額（建物）（円）。登録免許税等の概算に使用。0なら自動推定。 */
  fixedAssetValueBuilding?: number;
  /** 固定資産税評価額（土地）（円）。0なら路線価×0.8等で自動推定。 */
  fixedAssetValueLand?: number;
}

/** 画地補正パラメータ（簡易シミュレーション用）。 */
export interface ShapeCorrection {
  /** 間口（m）。狭いと減価。 */
  frontage: number;
  /** 奥行（m）。 */
  depth: number;
  /** 不整形地か。 */
  irregular: boolean;
  /** 角地か（加算要因）。 */
  corner: boolean;
}

/** 積算価格の算出結果。 */
export interface CostApproachResult {
  /** 補正後の土地評価額（円） */
  landValue: number;
  /** 補正前の路線価ベース土地額（円） */
  landValueRaw: number;
  /** 適用した画地補正率（合成） */
  shapeFactor: number;
  /** 実勢流動性価格（路線価×流動性倍率）（円） */
  landMarketValue: number;
  /** 建物の再調達原価（円） */
  buildingReplacementCost: number;
  /** 残存耐用年数による建物価値（円） */
  buildingValue: number;
  /** 残存年数 */
  remainingYears: number;
  /** 法定耐用年数 */
  legalLifespan: number;
  /** 積算価格（土地＋建物）（円） */
  totalCostValue: number;
  /** 土地値比率（土地評価額 / 物件価格） */
  landValueRatio: number;
  /** 積算価格 / 物件価格（積算評価率） */
  costValueRatio: number;
}

/** 初期費用（諸経費）の内訳。 */
export interface InitialCosts {
  brokerageFee: number; // 仲介手数料
  registrationTax: number; // 登録免許税
  acquisitionTax: number; // 不動産取得税
  loanFee: number; // 融資手数料
  insurance: number; // 火災・地震保険料
  settlement: number; // 固都税清算金
  stampTax: number; // 印紙税
  judicialScrivener: number; // 司法書士報酬
  // 民泊特有
  licenseApplication: number; // 旅館業/民泊新法 申請費用
  renovation: number; // リノベ・内装
  furniture: number; // 家具家電一式
  infrastructure: number; // スマートロック・Wi-Fi等
  other: number; // その他予備費
  total: number;
}

/** ローン条件。 */
export interface LoanInput {
  /** 借入額（円） */
  amount: number;
  /** 年利（%、例: 2.0） */
  annualRatePct: number;
  /** 返済期間（年） */
  years: number;
  /** 返済方式 */
  repayment: RepaymentType;
}

/** ローンの年次返済明細（1年分の集計）。 */
export interface LoanYearRow {
  year: number;
  principalPaid: number; // その年の元金返済合計
  interestPaid: number; // その年の利息合計
  totalPaid: number; // 年間返済額
  balanceEnd: number; // 年末残高
}

/** 賃貸モードの収益パラメータ。 */
export interface RentalParams {
  /** 月額満室想定賃料合計（円） */
  monthlyGrossRent: number;
  /** 空室率（%） */
  vacancyRatePct: number;
  /** 運営費率（対EGI＝実効総収入、%）。管理費・修繕積立等の簡易合算。詳細項目があれば opexAnnual を使用。 */
  opexRatePct: number;
  /** 詳細運営費（円/年）。指定時は opexRatePct より優先。 */
  opexAnnual?: number;
  /** 賃料下落率（年率、%）。長期予測に使用。 */
  rentDeclinePctPerYear: number;
}

/** 民泊モードの収益パラメータ。 */
export interface MinpakuParams {
  /** 平均客単価 ADR（円/泊） */
  adr: number;
  /** 稼働率（%） */
  occupancyPct: number;
  /** 営業可能日数/年（民泊新法は180日上限。旅館業なら365）。 */
  operableDays: number;
  /** 運営代行手数料率（対売上、%） */
  managementFeePct: number;
  /** OTA手数料率（対売上、%、Airbnb/Booking加重平均） */
  otaFeePct: number;
  /** 1泊あたり清掃費（オーナー負担分、円） */
  cleaningCostPerStay: number;
  /** 平均宿泊日数（清掃回数換算に使用） */
  avgStayNights: number;
  /** 稼働連動の水道光熱・消耗品（円/泊） */
  variableCostPerNight: number;
  /** 固定運営費（円/年、固都税・通信基本料等） */
  fixedOpexAnnual: number;
}

/** 1年分のキャッシュフロー明細。 */
export interface CashflowYearRow {
  year: number;
  gpi: number; // 潜在総収入（満室想定）
  egi: number; // 実効総収入（空室控除後）
  opex: number; // 運営費
  noi: number; // 純営業利益
  debtService: number; // 年間返済額
  btcf: number; // 税引前キャッシュフロー (NOI - 返済)
  depreciation: number; // 減価償却費
  taxableIncome: number; // 課税所得（NOI - 利息 - 償却）
  tax: number; // 税額（概算）
  atcf: number; // 税引後キャッシュフロー
  cumulativeBtcf: number; // 累積BTCF
  loanBalance: number; // 年末ローン残高
  isDeadCross: boolean; // デッドクロス（償却 < 元金返済）か
}

/** 投資全体の指標サマリ。 */
export interface InvestmentMetrics {
  grossYieldPct: number; // 表面利回り
  netYieldPct: number; // 実質利回り（NOIベース）
  noi: number; // 初年度NOI
  dscr: number; // 初年度DSCR
  ccr: number; // 自己資金配当率（初年度BTCF / 自己資金）
  selfFunds: number; // 自己資金（頭金＋初期費用）
  paybackYear: number | null; // 累積CFがプラスに転じる年（自己資金回収）
  deadCrossYear: number | null; // デッドクロス発生年
  irrPct: number | null; // 内部収益率（売却含む）
  npv: number | null; // 正味現在価値
}
