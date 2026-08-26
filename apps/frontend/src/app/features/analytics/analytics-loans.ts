import { Component, input } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import { formatAmount, formatBookingDate } from '../../core/format';
import { LoansSection } from './analytics.model';

/**
 * Prestiti del periodo.
 *
 * Mostra ciò che il tipo `LOAN` permette di affermare: quanto denaro è uscito
 * a titolo di prestito. Resta una proiezione delle transazioni — restituzioni e
 * credito residuo vivono nel dominio dei prestiti, e qui c'è solo il rimando.
 */
@Component({
  selector: 'app-analytics-loans',
  imports: [RouterLink],
  templateUrl: './analytics-loans.html',
  styleUrl: './analytics-loans.scss'
})
export class AnalyticsLoans {
  readonly loans = input.required<LoansSection>();
  /** Criteri con cui aprire l'esplorazione sui soli prestiti del periodo. */
  readonly explorerParams = input.required<Params>();

  protected readonly formatAmount = formatAmount;
  protected readonly formatBookingDate = formatBookingDate;
}
