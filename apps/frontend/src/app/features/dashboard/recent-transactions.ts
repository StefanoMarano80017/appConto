import { Component, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { formatBookingDate } from '../../core/format';
import { Panel } from '@shared/layout/panel/panel';
import { SectionHeader } from '@shared/layout/section-header/section-header';
import { Amount } from '@shared/ui/data/amount/amount';
import { ColorMarkerComponent } from '@shared/ui/data/color-marker/color-marker';
import { EmptyState } from '@shared/ui/feedback/empty-state/empty-state';
import { RecentTransaction } from './dashboard.model';

/**
 * Gli ultimi movimenti dell'archivio, indipendenti dal mese mostrato.
 *
 * Elenco compatto in sola lettura, nell'ordine in cui arriva dal backend:
 * per esplorare c'è Movimenti, a cui porta l'intestazione. Non usa la
 * tabella condivisa dei movimenti, che porta colonne fisse, paginazione e
 * totale.
 */
@Component({
  selector: 'app-recent-transactions',
  imports: [Amount, ColorMarkerComponent, EmptyState, Panel, RouterLink, SectionHeader],
  templateUrl: './recent-transactions.html',
  styleUrl: './recent-transactions.scss'
})
export class RecentTransactions {
  private readonly router = inject(Router);

  readonly transactions = input.required<RecentTransaction[]>();

  protected readonly formatBookingDate = formatBookingDate;

  protected goToImport(): void {
    void this.router.navigateByUrl('/import');
  }
}
