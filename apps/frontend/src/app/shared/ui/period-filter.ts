import { Component, input, output } from '@angular/core';
import { PERIOD_PRESETS, PeriodPreset } from '../../core/period';
import { ChoiceGroup } from './choice-group';

@Component({
  selector: 'app-period-filter',
  standalone: true,
  imports: [ChoiceGroup],
  templateUrl: './period-filter.html',
  styleUrl: './period-filter.scss'
})
export class PeriodFilter {
  readonly preset = input.required<PeriodPreset>();
  readonly from = input<string | null>(null);
  readonly to = input<string | null>(null);

  readonly presetSelected = output<PeriodPreset>();
  readonly fromChange = output<string | null>();
  readonly toChange = output<string | null>();

  protected readonly presets = PERIOD_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.shortLabel,
    description: preset.label
  }));

  protected changeFrom(event: Event): void {
    this.fromChange.emit((event.target as HTMLInputElement).value || null);
  }

  protected changeTo(event: Event): void {
    this.toChange.emit((event.target as HTMLInputElement).value || null);
  }
}