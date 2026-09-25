import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-panel-content',
  standalone: true,
  template: `
    <div class="panel-content">
      <ng-content />
    </div>
  `,
  styleUrl: './panel-content.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelContentComponent {}