import type { LoanInput, LoanYearRow } from "./types";

// =============================================================
// ローン（レバレッジ）シミュレーション
// 元利均等 / 元金均等 の両対応。月次計算 → 年次集計。
// =============================================================

/** 月利を返す。 */
function monthlyRate(annualRatePct: number): number {
  return annualRatePct / 100 / 12;
}

/**
 * 元利均等の毎月返済額を求める。
 * PMT = P * r / (1 - (1+r)^-n)
 */
export function equalPaymentMonthly(loan: LoanInput): number {
  const r = monthlyRate(loan.annualRatePct);
  const n = loan.years * 12;
  if (n <= 0) return 0;
  if (r === 0) return loan.amount / n;
  return (loan.amount * r) / (1 - Math.pow(1 + r, -n));
}

/**
 * 償却スケジュールを年次集計で返す。
 * 月次でローン残高を回し、12ヶ月ごとに元金・利息を合算する。
 */
export function buildLoanSchedule(loan: LoanInput): LoanYearRow[] {
  const rows: LoanYearRow[] = [];
  const r = monthlyRate(loan.annualRatePct);
  const n = loan.years * 12;
  if (n <= 0 || loan.amount <= 0) return rows;

  let balance = loan.amount;
  const pmt = equalPaymentMonthly(loan);
  // 元金均等の毎月元金
  const fixedPrincipal = loan.amount / n;

  let yearPrincipal = 0;
  let yearInterest = 0;

  for (let m = 1; m <= n; m++) {
    const interest = balance * r;
    let principal: number;

    if (loan.repayment === "equal-payment") {
      principal = pmt - interest;
    } else {
      principal = fixedPrincipal;
    }
    // 最終月の端数調整
    if (principal > balance) principal = balance;

    balance -= principal;
    yearPrincipal += principal;
    yearInterest += interest;

    if (m % 12 === 0 || m === n) {
      const year = Math.ceil(m / 12);
      rows.push({
        year,
        principalPaid: Math.round(yearPrincipal),
        interestPaid: Math.round(yearInterest),
        totalPaid: Math.round(yearPrincipal + yearInterest),
        balanceEnd: Math.round(Math.max(0, balance)),
      });
      yearPrincipal = 0;
      yearInterest = 0;
    }
  }

  return rows;
}

/** 年間総返済額（初年度ベース、DSCR算出に使用）。 */
export function annualDebtService(loan: LoanInput): number {
  if (loan.repayment === "equal-payment") {
    return Math.round(equalPaymentMonthly(loan) * 12);
  }
  // 元金均等は初年度が最大返済額。保守的に初年度を採用。
  const schedule = buildLoanSchedule(loan);
  return schedule.length > 0 ? schedule[0].totalPaid : 0;
}
