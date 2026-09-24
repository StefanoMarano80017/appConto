import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-color-marker',
  template: '',
  host: {
    '[style.background-color]': 'safeColor()',
  },
  styles: `
    :host {
      display: inline-block;
      width: 0.8em;
      height: 0.8em;
      border-radius: 0.15em;
      flex: 0 0 auto;
      vertical-align: middle;
      margin-right: 0.25em;
      margin-left: 0.25em;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorMarkerComponent {
  readonly color = input.required<string | null | undefined>();
  readonly safeColor = computed(() => this.color() ?? 'transparent');
}