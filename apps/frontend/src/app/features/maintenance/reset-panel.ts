import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toErrorMessage } from '../../core/http-error';
import { MaintenanceApi } from './maintenance.api';
import { RESET_CONFIRMATION, ResetOutcome } from './maintenance.model';

/**
 * Azzerare l'applicazione.
 *
 * È l'unica azione dell'interfaccia che cancella dati che l'utente non ha
 * eliminato uno per uno, e la protezione non è un avvertimento: **la parola di
 * conferma va scritta**. Un pulsante, per quanto rosso, si preme per sbaglio;
 * una parola no. La stessa parola la pretende il backend, quindi non è una
 * formalità che si possa aggirare.
 *
 * Il pannello dice anche cosa **non** viene toccato. È l'informazione che
 * rende la decisione possibile: chi legge «cancella tutto» e non sa che i
 * backup restano, non azzera — e chi lo fa credendo che restino qualcosa
 * d'altro, si pente.
 */
@Component({
  selector: 'app-reset-panel',
  imports: [FormsModule],
  templateUrl: './reset-panel.html',
  styleUrl: './reset-panel.scss'
})
export class ResetPanel {
  private readonly api = inject(MaintenanceApi);

  protected readonly parola = RESET_CONFIRMATION;

  /** Quanto l'utente ha scritto nella casella di conferma. */
  protected readonly digitato = signal('');
  protected readonly running = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal<ResetOutcome | null>(null);

  /** Il pannello è chiuso finché non lo si apre: non invita a premere. */
  protected readonly aperto = signal(false);

  protected readonly confermato = computed(() => this.digitato().trim() === RESET_CONFIRMATION);

  protected apri(): void {
    this.aperto.set(true);
    this.error.set(null);
  }

  protected annulla(): void {
    this.aperto.set(false);
    this.digitato.set('');
    this.error.set(null);
  }

  protected azzera(): void {
    if (!this.confermato() || this.running()) {
      return;
    }

    this.running.set(true);
    this.error.set(null);

    this.api.reset().subscribe({
      next: (esito) => {
        this.running.set(false);
        this.aperto.set(false);
        this.digitato.set('');
        this.done.set(esito);
      },
      error: (error: unknown) => {
        this.running.set(false);
        // Il pannello resta aperto con la parola scritta: se il motivo è
        // rimediabile — un ripristino in attesa da annullare — si riprova
        // senza ricominciare.
        this.error.set(toErrorMessage(error));
      }
    });
  }

  /** Quante righe sono state eliminate in tutto. */
  protected readonly totaleEliminate = computed(() => {
    const esito = this.done();
    if (esito === null) {
      return 0;
    }

    return Object.values(esito.removed).reduce((somma, quante) => somma + quante, 0);
  });
}
