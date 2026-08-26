const amountFormatter = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const dateFormatter = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
});
const monthFormatter = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });
const percentFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });

export function formatAmount(amount: number): string {
  return amountFormatter.format(amount);
}

/** Una percentuale già calcolata: `38.1` diventa `38,1%`. */
export function formatPercent(value: number): string {
  return `${percentFormatter.format(value)}%`;
}

/** Da `YYYY-MM-DD` a `GG/MM/AAAA`. */
export function formatBookingDate(bookingDate: string): string {
  return dateFormatter.format(new Date(`${bookingDate}T00:00:00`));
}

/** Da `YYYY-MM` a `mese anno`. */
export function formatMonth(month: string): string {
  return monthFormatter.format(new Date(`${month}-01T00:00:00`));
}

/** Il mese corrente in formato `YYYY-MM`. */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
