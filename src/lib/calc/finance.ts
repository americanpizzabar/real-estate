// =============================================================
// 金融計算ユーティリティ — IRR / NPV
// キャッシュフロー配列（0年目=初期投資のマイナス）から算出する。
// =============================================================

/** 正味現在価値（NPV）。flows[0] は初期投資（通常マイナス）。 */
export function npv(rate: number, flows: number[]): number {
  return flows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + rate, t), 0);
}

/**
 * 内部収益率（IRR）。二分法 + ニュートン法のハイブリッドで頑健に解く。
 * 解が存在しない（全て同符号等）場合は null。
 */
export function irr(flows: number[], guess = 0.1): number | null {
  if (flows.length < 2) return null;
  const hasPos = flows.some((f) => f > 0);
  const hasNeg = flows.some((f) => f < 0);
  if (!hasPos || !hasNeg) return null;

  // まず二分法で符号反転区間を確保（-0.99 〜 1.0）
  let lo = -0.9999;
  let hi = 1.0;
  let fLo = npv(lo, flows);
  let fHi = npv(hi, flows);

  // hi を広げて符号反転を探す
  let expand = 0;
  while (fLo * fHi > 0 && expand < 50) {
    hi *= 1.5;
    fHi = npv(hi, flows);
    expand++;
  }
  if (fLo * fHi > 0) return null;

  // 二分法
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, flows);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}
