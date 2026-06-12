// 表示用フォーマットユーティリティ

/** 円を「○○万円」「○○億円」表記に。 */
export function yen(v: number, opts?: { unit?: boolean }): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(Math.round(v));
  if (abs >= 100_000_000) {
    const oku = abs / 100_000_000;
    return `${sign}${trim(oku)}億円`;
  }
  if (abs >= 10_000) {
    const man = abs / 10_000;
    return `${sign}${trim(man)}万円`;
  }
  return `${sign}${abs.toLocaleString()}円`;
}

/** 円をカンマ区切りの円表記に（厳密値）。 */
export function yenExact(v: number): string {
  return `${Math.round(v).toLocaleString()}円`;
}

/** 万円単位（数値のみ）。 */
export function man(v: number): number {
  return Math.round(v / 10_000);
}

function trim(n: number): string {
  // 小数1桁、末尾0を除去
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function pct(v: number, digits = 1): string {
  return `${v.toFixed(digits)}%`;
}

export function signedPct(v: number, digits = 1): string {
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(digits)}%`;
}
