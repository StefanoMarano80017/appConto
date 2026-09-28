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

/**
 * Il meno tipografico (U+2212 MINUS SIGN) al posto del trattino ASCII che
 * `Intl` produce per i negativi.
 *
 * Non è un vezzo: i due glifi hanno larghezze diverse, e in una colonna di
 * importi il trattino non si allinea col meno. Sta qui, e non nei chiamanti,
 * perché i chiamanti sono due — `Amount`, che lo applica a ogni importo, e la
 * fascia di `MonthComparison`, che rende una variazione firmata senza passare
 * da `Amount` (v. il commento di `signed()` là). Averlo in due copie era il
 * modo di ritrovarsi, fra qualche mese, con due convenzioni di segno nella
 * stessa fascia di tre cifre: è precisamente quello che è appena successo.
 *
 * NON è applicato dentro `formatAmount`: gli altri chiamanti (timeline,
 * prestiti, merchant, tabella movimenti) rendono oggi il trattino ASCII, e
 * uniformarli è un cambiamento che attraversa quattro feature e i loro test —
 * da fare come lavoro dichiarato, non di soppiatto dentro questa correzione.
 */
export function typographicMinus(text: string): string {
  return text.replace('-', '−');
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
