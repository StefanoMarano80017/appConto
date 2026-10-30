import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatBookingDate } from '../../core/format';
import { Panel } from '@shared/layout/panel/panel';
import { SectionHeader } from '@shared/layout/section-header/section-header';
import { Amount } from '@shared/ui/data/amount/amount';
import { Dashboard } from './dashboard.model';
import { isStale } from './dashboard-month';

/** Ci sono merchant da classificare: la voce di «Da sistemare» che li elenca. */
function hasUnclassifiedMerchants(attention: Dashboard['attention']): boolean {
  return attention.unclassifiedMerchants > 0;
}

/** Ci sono prestiti da riscuotere: la sezione «Prestiti». */
function hasOpenLoans(loans: Dashboard['loans']): boolean {
  return loans.openCount > 0;
}

/**
 * Il pannello ha almeno una voce da mostrare.
 *
 * Unica definizione: la usano il pannello, per non disegnare un riquadro
 * vuoto, e la pagina, per dare tutta la riga alle categorie quando questa
 * colonna non c'è. I movimenti di prestito senza dettaglio da soli non
 * contano: sono già saldati, e la loro nota accompagna i prestiti aperti.
 */
export function attentionHasContent(
  attention: Dashboard['attention'],
  loans: Dashboard['loans'],
  lastTransactionDate: string | null,
  today: string
): boolean {
  return (
    hasUnclassifiedMerchants(attention) ||
    isStale(lastTransactionDate, today) ||
    hasOpenLoans(loans)
  );
}

/**
 * «Da sistemare» e «Prestiti»: le cose che chiedono un'azione, ognuna un
 * collegamento alla pagina dove si fa.
 *
 * Ogni sezione c'è solo se ha qualcosa da dire; senza nessuna delle due il
 * pannello non disegna nulla. Tutti i conteggi riguardano l'intero archivio,
 * non il mese mostrato.
 */
@Component({
  selector: 'app-attention-panel',
  imports: [Amount, Panel, RouterLink, SectionHeader],
  templateUrl: './attention-panel.html',
  styleUrl: './attention-panel.scss'
})
export class AttentionPanel {
  readonly attention = input.required<Dashboard['attention']>();
  readonly loans = input.required<Dashboard['loans']>();
  readonly lastTransactionDate = input.required<string | null>();
  /** La data del server, per la soglia dei dati non aggiornati. */
  readonly today = input.required<string>();

  protected readonly formatBookingDate = formatBookingDate;

  protected readonly showMerchants = computed(() => hasUnclassifiedMerchants(this.attention()));
  protected readonly showImport = computed(() => isStale(this.lastTransactionDate(), this.today()));
  protected readonly showLoans = computed(() => hasOpenLoans(this.loans()));

  readonly hasContent = computed(() =>
    attentionHasContent(this.attention(), this.loans(), this.lastTransactionDate(), this.today())
  );
}
