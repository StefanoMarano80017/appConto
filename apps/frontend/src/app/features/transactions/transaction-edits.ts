import { Signal, computed, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { toErrorMessage } from '../../core/http-error';
import { MerchantsApi } from '../merchants/merchants.api';
import { TransactionType } from './transaction-type';
import { Transaction } from './transaction.model';
import { TransactionsApi } from './transactions.api';

export interface TransactionEdits {
  /** Riga con una modifica in corso. */
  readonly savingId: Signal<string | null>;
  /** L'ultimo errore di salvataggio; si azzera all'inizio del successivo. */
  readonly error: Signal<string | null>;

  /** Corregge la natura del movimento: riguarda la singola transazione. */
  changeType(transaction: Transaction, type: TransactionType): void;
  /**
   * Cambia la categoria del merchant: tutte le transazioni dello stesso
   * esercente la ereditano. `null` la toglie.
   */
  changeCategory(transaction: Transaction, categoryId: string | null): void;
}

/**
 * Il salvataggio delle correzioni fatte in linea nella tabella dei movimenti.
 *
 * Stava dentro la tabella; ora che la tabella è condivisa e di sola
 * presentazione, il salvataggio resta qui, nella feature che conosce le API.
 * La tabella segnala l'intenzione (`typeChange`, `categoryChange`) e riceve
 * di ritorno `savingId` ed `error`.
 *
 * A differenza di `createDeleteState` e `createSelectionState` inietta i
 * propri servizi, quindi va chiamata in un contesto d'iniezione — tipicamente
 * nell'inizializzazione di un campo del componente.
 *
 * `onSaved` è chiamato a salvataggio concluso **anche quando fallisce**: chi
 * ospita la tabella ricarica, e i dati ricaricati riportano a video lo stato
 * vero, invece del valore scelto e non salvato che il `select` mostrerebbe.
 *
 * I controlli «niente da cambiare» (stesso tipo, stessa categoria) li fa la
 * tabella prima di emettere: qui arriva solo una modifica vera. Resta il
 * controllo sul merchant mancante, perché senza merchant non c'è nessuna
 * categoria da assegnare.
 */
export function createTransactionEdits(onSaved: () => void): TransactionEdits {
  const transactionsApi = inject(TransactionsApi);
  const merchantsApi = inject(MerchantsApi);

  const savingId = signal<string | null>(null);
  const error = signal<string | null>(null);

  const savingIdRead = computed(() => savingId());
  const errorRead = computed(() => error());

  function save(transactionId: string, request: Observable<unknown>): void {
    savingId.set(transactionId);
    error.set(null);

    request.subscribe({
      next: () => {
        savingId.set(null);
        onSaved();
      },
      error: (cause: unknown) => {
        error.set(toErrorMessage(cause));
        savingId.set(null);
        onSaved(); // ripristina lo stato mostrato a video
      },
    });
  }

  function changeType(transaction: Transaction, type: TransactionType): void {
    save(transaction.id, transactionsApi.updateType(transaction.id, type));
  }

  function changeCategory(transaction: Transaction, categoryId: string | null): void {
    const merchant = transaction.merchant;
    if (merchant === null) {
      return;
    }

    save(transaction.id, merchantsApi.updateCategory(merchant.id, categoryId));
  }

  return {
    savingId: savingIdRead,
    error: errorRead,
    changeType,
    changeCategory,
  };
}
