import { Component } from '@angular/core';

/**
 * Il contenitore a pannello usato in tutta l'applicazione.
 *
 * Solo il box (sfondo, bordo, raggio, spaziatura): non sa nulla di titoli,
 * sottotitoli o azioni — quello è `SectionHeader`, un componente separato
 * (docs/architecture/frontend-shared-components-proposal.md, §16.1).
 *
 * L'host è `display: contents`: il vero elemento di layout è la `<section>`
 * del template, così l'elemento custom non aggiunge un livello alla gerarchia
 * visiva (margini, flow) rispetto a un `<section class="panel">` scritto a
 * mano.
 */
@Component({
  selector: 'app-panel',
  templateUrl: './panel.html',
  styleUrl: './panel.scss'
})
export class Panel {}
