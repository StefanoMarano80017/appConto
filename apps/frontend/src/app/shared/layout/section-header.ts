import { Component, input } from '@angular/core';

/**
 * Intestazione di una sezione: titolo, sottotitolo opzionale, area a destra
 * per contenuto proiettato (link, pulsante, badge — qualunque cosa la pagina
 * ci metta).
 *
 * Normalizza i quattro nomi di classe usati oggi per lo stesso concetto
 * (`.header`/`.head`/`.toolbar`/`.panel-header`), tutti con lo stesso CSS
 * flex/gap. Non dipende da `Panel`: le due si compongono perché è così che
 * appaiono oggi, non perché una "contenga" l'altra nel codice
 * (docs/architecture/frontend-shared-components-proposal.md, §16.1).
 */
@Component({
  selector: 'app-section-header',
  templateUrl: './section-header.html',
  styleUrl: './section-header.scss'
})
export class SectionHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string | undefined>(undefined);

  /**
   * Il livello del titolo.
   *
   * Non è solo tipografia: DESIGN_SYSTEM.md distingue `page-title` (15px) da
   * `section-title` (13px), e la pagina deve avere un `h1` solo. Il default
   * resta `section`, così i nove usi esistenti non cambiano.
   */
  readonly level = input<'page' | 'section'>('section');
}
