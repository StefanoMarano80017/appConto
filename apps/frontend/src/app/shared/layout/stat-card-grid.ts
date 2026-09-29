import { Component, input } from '@angular/core';
import {
  LucideArrowDown,
  LucideArrowUp,
  LucideReceipt,
  LucideTrendingDown,
  LucideTrendingUp,
  LucideWallet
} from '@lucide/angular';
import { signedPercent } from '../../core/format';
import { Amount, AmountTone } from '../ui/amount';

/**
 * Le quattro icone che una card KPI può portare.
 *
 * Un'unione chiusa, non una stringa libera. Le icone di Lucide sono
 * componenti con selettore d'attributo (`svg[lucideWallet]`, non
 * `<lucide-icon name="...">`), quindi non possono arrivare come stringa
 * qualunque dentro i dati: `StatCardGrid` deve conoscere in anticipo ogni
 * variante per importarla e per averla nel proprio `@switch`. Con una
 * stringa libera un refuso nel nome dell'icona fallirebbe solo a schermo,
 * silenziosamente; con l'unione lo segnala il compilatore. Aggiungerne una
 * quinta domani resta un caso in più nello `@switch` e negli import, non
 * una stringa che nessuno verifica.
 */
export type StatCardIcon = 'entrate' | 'uscite' | 'saldo' | 'conteggio';

/**
 * La variazione mostrata sotto un importo, con un tono dichiarato e non
 * dedotto.
 *
 * Per le uscite un `percent` positivo è una cattiva notizia (la spesa è
 * cresciuta) e uno negativo una buona; per le entrate vale il contrario. Il
 * componente non può indovinarlo dal segno di `percent`, né da come si
 * chiama la card che lo porta: è lo stesso errore, già commesso una volta su
 * questo branch, di dedurre la semantica dal nome di un campo. Per questo
 * `tone` è un campo a sé, obbligatorio, e chi costruisce la card lo dichiara
 * esplicitamente conoscendo il dominio (qui, il confronto mensile delle
 * uscite).
 */
export type StatCardDelta = {
  readonly percent: number;
  readonly caption: string;
  readonly tone: 'positive' | 'negative' | 'neutral';
};

/**
 * Una card della griglia KPI.
 *
 * Unione discriminata e non due campi opzionali: con due opzionali il
 * compilatore non impedirebbe di passarli entrambi, né di non passarne
 * nessuno. Angular restringe l'unione discriminata nei template, quindi
 * `@if (item.kind === 'amount')` dà il tipo giusto in entrambi i rami.
 *
 * `delta` sta solo sulla variante `amount`: il backend confronta col mese
 * precedente soltanto le uscite, e un conteggio o un'etichetta di testo non
 * avrebbero comunque una percentuale sensata da mostrare.
 */
export type StatCardItem =
  | {
      /** Un importo in euro: lo rende `Amount`, con segno, mono e cifre tabulari. */
      readonly kind: 'amount';
      readonly label: string;
      readonly value: number;
      readonly tone?: AmountTone;
      readonly icon?: StatCardIcon;
      readonly delta?: StatCardDelta;
    }
  | {
      /** Un valore che importo non è: un conteggio, una data, un'etichetta. */
      readonly kind: 'text';
      readonly label: string;
      readonly value: string;
      readonly icon?: StatCardIcon;
    };

/**
 * Griglia responsive di indicatori KPI (etichetta + valore).
 *
 * Solo rendering: chi la usa calcola già `items`, senza logica di dominio nel
 * componente. Una card `amount` delega interamente ad `Amount` — segno, mono,
 * cifre tabulari e colore del tono sono suoi, non di questa griglia; una card
 * `text` resta un conteggio o un'etichetta, e non deve ricevere né l'uno né
 * gli altri.
 */
@Component({
  selector: 'app-stat-card-grid',
  imports: [
    Amount,
    LucideArrowDown,
    LucideArrowUp,
    LucideReceipt,
    LucideTrendingDown,
    LucideTrendingUp,
    LucideWallet
  ],
  templateUrl: './stat-card-grid.html',
  styleUrl: './stat-card-grid.scss'
})
export class StatCardGrid {
  readonly items = input.required<readonly StatCardItem[]>();

  /*
   * Esposta al template, non reimplementata: la formattazione vive in
   * `core/format.ts`, una volta sola. Prima stava qui e in `month-comparison`
   * in due copie identiche, con un commento in ciascuna che rimandava
   * all'altra — e una modifica a una sola delle due le ha fatte divergere
   * davvero, mostrando due glifi di meno diversi sulla stessa pagina.
   */
  protected readonly signedPercent = signedPercent;
}
