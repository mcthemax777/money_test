/**
 * 예산 진행률.
 *
 * 예전에는 이 계산이 대시보드 JSX에 다섯 번 복붙되어 있었다.
 * 그중 하나에서 금액이 문자열로 들어와 `"3000" > "10000"`이 true가 되는 바람에
 * 사용액이 예산보다 적은데도 101%로 표시됐다. 계산을 한 곳으로 모아 그런 차이를 없앤다.
 *
 * 초과했으면 최소 101%를 돌려준다. 막대가 꽉 찬 100%와 초과를 눈으로 구분하기 위함이다.
 */
export function budgetPercentage(monthlyAmount: number, usedAmount: number): number {
  const budget = Number(monthlyAmount) || 0;
  const used = Number(usedAmount) || 0;

  if (budget <= 0) return 0;

  const ratio = Math.floor((used / budget) * 100);
  return used > budget ? Math.max(101, ratio) : ratio;
}
