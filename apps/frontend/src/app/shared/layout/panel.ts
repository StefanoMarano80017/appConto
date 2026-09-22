import { Component } from '@angular/core';

/**
 * Wrapper component for a panel layout.
 * Provides a semantic container with standard panel styling.
 */
@Component({
  selector: 'app-panel',
  template: '<section class="panel"><ng-content></ng-content></section>',
  styleUrl: './panel.scss',
  standalone: true
})
export class Panel {}
