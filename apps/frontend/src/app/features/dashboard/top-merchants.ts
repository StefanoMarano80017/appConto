import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Panel } from '../../shared/layout/panel';
import { SectionHeader } from '../../shared/layout/section-header';
import { Amount } from '../../shared/ui/amount';
import { TopMerchant } from './dashboard.model';

@Component({
  selector: 'app-top-merchants',
  imports: [RouterLink, Panel, SectionHeader, Amount],
  templateUrl: './top-merchants.html',
  styleUrl: './top-merchants.scss'
})
export class TopMerchantsSection {
  readonly merchants = input.required<TopMerchant[]>();

  /** Richiesta di filtrare la dashboard su un merchant. */
  readonly merchantSelected = output<string>();
}
