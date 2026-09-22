import { Component, Directive, Input } from '@angular/core';

/**
 * Directive to mark content for placement in the panel actions area.
 */
@Directive({
  selector: '[panelActions]',
  standalone: true
})
export class PanelActionsDirective {}

/**
 * Header component for a panel section.
 * Displays a title and subtitle with an actions area.
 */
@Component({
  selector: 'app-section-header',
  template: `
    <div class="panel-header">
      <div>
        <h2>{{ title }}</h2>
        @if (subtitle) {
          <p class="subtitle">{{ subtitle }}</p>
        }
      </div>
      <ng-content></ng-content>
    </div>
  `,
  styleUrl: './section-header.scss',
  standalone: true
})
export class SectionHeader {
  @Input() title!: string;
  @Input() subtitle?: string;
}
