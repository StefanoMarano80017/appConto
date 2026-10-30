import { httpResource } from '@angular/common/http';
import { Component, computed, inject, linkedSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { LucideChevronLeft, LucideChevronRight } from '@lucide/angular';
import { formatBookingDate, formatMonth } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import { Panel } from '@shared/layout/panel/panel';
import { PageLayout } from '@shared/layout/page-layout/page-layout';
import { StatCardDelta, StatCardGrid, StatCardItem } from '@shared/layout/stat-card-grid/stat-card-grid';
import { Amount } from '@shared/ui/data/amount/amount';
import { ErrorRetry } from '@shared/ui/feedback/error-retry/error-retry';
import { Dashboard } from './dashboard.model';
import { dashboardRequest } from './dashboard.api';
import { comparisonCaption, monthBounds, parseMonthParam, shiftMonth } from './dashboard-month';
import { AttentionPanel, attentionHasContent } from './attention-panel';
import { RecentTransactions } from './recent-transactions';
import { TopCategories } from './top-categories';

/**
 * Home dell'applicazione: il riepilogo essenziale di un mese.
 *
 * Il mese vive nell'URL (`/?month=YYYY-MM`): ricaricare o tornare indietro
 * non lo perde. Senza mese, o con uno non valido, lo sceglie il backend.
 * Una sola richiesta per tutta la pagina: le sezioni leggono porzioni della
 * stessa risposta, quindi non possono mostrare mesi diversi fra loro.
 *
 * L'orologio è quello del server (`today` nella risposta): mese corrente e
 * freccia › non leggono la data del browser.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [
    Amount,
    AttentionPanel,
    ErrorRetry,
    LucideChevronLeft,
    LucideChevronRight,
    PageLayout,
    Panel,
    RecentTransactions,
    StatCardGrid,
    TopCategories
  ],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss'
})
export class DashboardPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap
  });

  /** Il mese chiesto dall'URL; `null` se manca o non è valido. */
  private readonly month = computed(() => parseMonthParam(this.params().get('month')));

  protected readonly dashboard = httpResource<Dashboard>(() => dashboardRequest(this.month()));

  /**
   * L'ultimo riepilogo caricato, che resta a schermo mentre ne arriva un altro.
   *
   * Stessa latch di Analytics: `httpResource` azzera il valore quando la
   * richiesta cambia, e senza questa cambiare mese svuoterebbe la pagina.
   * `value()` solleverebbe l'errore di una richiesta fallita: risposta ed
   * errore restano due stati distinti, entrambi mostrabili.
   */
  readonly data = linkedSignal<Dashboard | undefined, Dashboard | undefined>({
    source: () => (this.dashboard.hasValue() ? this.dashboard.value() : undefined),
    computation: (caricato, precedente) => caricato ?? precedente?.value
  });

  /**
   * Primo e ultimo giorno del mese a schermo, per i collegamenti delle sezioni.
   *
   * Ha senso solo con dei dati: chi lo legge sta sotto `@if (data())`, quindi
   * prima di allora resta un intervallo vuoto che nessuno mostra.
   */
  readonly monthRange = computed(() => {
    const data = this.data();

    return data === undefined ? { from: '', to: '' } : monthBounds(data.month);
  });

  /**
   * La colonna «Da sistemare» / «Prestiti» ha qualcosa da mostrare. Se no,
   * le categorie prendono tutta la riga. Stessa regola del pannello, non una
   * copia: una sola funzione decide per entrambi.
   */
  protected readonly hasAttention = computed(() => {
    const data = this.data();

    return (
      data !== undefined &&
      attentionHasContent(data.attention, data.loans, data.lastTransactionDate, data.today)
    );
  });

  protected readonly error = computed(() => {
    const error = this.dashboard.error();

    return error === undefined ? null : toErrorMessage(error);
  });

  /** I dati a schermo non sono quelli del mese chiesto: ne stanno arrivando altri, o la richiesta è fallita. */
  protected readonly isReloading = computed(
    () => this.dashboard.isLoading() || this.error() !== null
  );

  /** Non si va nel futuro: il mese in corso è l'ultimo raggiungibile. */
  protected readonly isCurrentMonth = computed(() => {
    const data = this.data();

    return data !== undefined && data.month >= data.today.slice(0, 7);
  });

  protected readonly formatMonth = formatMonth;
  protected readonly formatBookingDate = formatBookingDate;

  protected readonly cards = computed<StatCardItem[]>(() => {
    const data = this.data();
    if (data === undefined) {
      return [];
    }

    const { income, expenses, balance } = data.summary;

    return [
      // `income` è una magnitudine positiva: nessuna negazione, nessun tono.
      { kind: 'amount', label: 'Entrate', value: income, icon: 'entrate' },
      // `expenses` è una magnitudine positiva ma rappresenta un'uscita: la
      // neghiamo senza forzare il tono, così un mese dominato da rimborsi
      // torna verde da solo invece di restare rosso a forza.
      {
        kind: 'amount',
        label: 'Uscite',
        value: -expenses,
        icon: 'uscite',
        delta: this.expensesDelta(data.comparison)
      },
      // `balance` è già `income - expenses`, con il segno giusto.
      { kind: 'amount', label: 'Risultato del mese', value: balance, icon: 'saldo' }
    ];
  });

  /**
   * Il confronto della card «Uscite».
   *
   * Assente quando `percentChange` è `null`: il periodo precedente non ha
   * spese, e uno `0%` sarebbe un dato falso. Il tono è invertito rispetto al
   * segno: per le uscite crescere è una cattiva notizia.
   */
  private expensesDelta(comparison: Dashboard['comparison']): StatCardDelta | undefined {
    const { percentChange } = comparison;
    if (percentChange === null) {
      return undefined;
    }

    return {
      percent: percentChange,
      caption: comparisonCaption(comparison, comparison.previousFrom.slice(0, 7)),
      tone: percentChange > 0 ? 'negative' : percentChange < 0 ? 'positive' : 'neutral'
    };
  }

  /** Il mese precedente o successivo a quello a schermo, nell'URL. */
  protected goToMonth(delta: number): void {
    const data = this.data();
    if (data === undefined) {
      return;
    }

    void this.router.navigate([], { queryParams: { month: shiftMonth(data.month, delta) } });
  }
}
