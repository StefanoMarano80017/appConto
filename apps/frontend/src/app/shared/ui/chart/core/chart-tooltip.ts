import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Panel } from '@shared/layout/panel/panel';
import { PanelFooter } from '@shared/layout/panel/panel-footer';
import { SectionHeader } from '@shared/layout/section-header/section-header';

/**
 * Tooltip condiviso per i grafici: usa il layout standard di un pannello,
 * intestazione e footer; il grafico proprietario fornisce i dati del corpo.
 */
@Component({
  selector: 'app-chart-tooltip',
  imports: [Panel, SectionHeader, PanelFooter],
  templateUrl: './chart-tooltip.html',
  styleUrl: './chart-tooltip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'tooltip',
    '[class.left-side]': 'side() === "left"',
    '[style.left.%]': 'left()',
    '(keydown.escape)': 'dismiss.emit()',
    role: 'status',
  },
})
export class ChartTooltip {
  readonly title = input.required<string>();
  readonly left = input.required<number>();
  readonly side = input<'left' | 'right'>('right');
  readonly dismiss = output<void>();
}
