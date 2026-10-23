/** Dashes wide enough to read as "hidden", not as a missing value. */
export const MASK = "––––";

export function money(
  amount: number,
  currency: string,
  { hidden = false, cents = false }: { hidden?: boolean; cents?: boolean } = {},
): string {
  if (hidden) return MASK;
  try {
    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency,
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    }).format(amount);
  } catch {
    return `${currency} ${cents ? amount.toFixed(2) : Math.round(amount)}`;
  }
}
