import { Component } from '@angular/core';

/**
 * L'impalcatura di una pagina: la colonna dei dati piu' la toolbox laterale.
 *
 * La toolbox non ha un input che la accenda: c'e' se qualcuno ci proietta
 * qualcosa, e la griglia se ne accorge da sola con `:has`. Una pagina senza
 * filtri non dichiara nulla e non paga nulla.
 *
 * ATTENZIONE per chi la usa: l'attributo `pageToolbox` va messo sull'elemento
 * che esiste sempre. Metterlo su un contenitore il cui contenuto sta dietro un
 * `@if` falso lascerebbe comunque un figlio nella colonna, e la griglia
 * riserverebbe 300px per il nulla.
 */
@Component({
  selector: 'app-page-layout',
  templateUrl: './page-layout.html',
  styleUrl: './page-layout.scss'
})
export class PageLayout {}
