import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Footer di un pannello con contenuti proiettati e allineati ai due lati.
 *
 * `panelFooterLeft` e `panelFooterRight` identificano gli slot; il footer
 * resta riusabile senza conoscere il contenuto che ogni pannello vi inserisce.
 */
@Component({
  selector: 'app-panel-footer',
  templateUrl: './panel-footer.html',
  styleUrl: './panel-footer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PanelFooter {}
