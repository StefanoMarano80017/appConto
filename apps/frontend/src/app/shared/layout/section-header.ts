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
 *
 * Il titolo qui è sempre un `h2`: l'unico `h1` della pagina è quello che la
 * shell disegna leggendo il titolo della rotta (`app.html`). Questo
 * componente portava in passato un `level` ('page' | 'section') che rendeva
 * un `h1` per le pagine senza intestazione propria — rimosso quando la shell
 * ha preso in carico quel ruolo, perché altrimenti ogni rotta finiva con due
 * `h1`.
 */
@Component({
  selector: 'app-section-header',
  templateUrl: './section-header.html',
  styleUrl: './section-header.scss'
})
export class SectionHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string | undefined>(undefined);
}
