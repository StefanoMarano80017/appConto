import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatAmount } from '../../core/format';
import { TopMerchant } from './dashboard.model';

@Component({
  selector: 'app-top-merchants',
  imports: [RouterLink],
  templateUrl: './top-merchants.html',
  styleUrl: './top-merchants.scss'
})
export class TopMerchantsSection {
  readonly merchants = input.required<TopMerchant[]>();

  /** Richiesta di filtrare la dashboard su un merchant. */
  readonly merchantSelected = output<string>();

  protected readonly formatAmount = formatAmount;
}
