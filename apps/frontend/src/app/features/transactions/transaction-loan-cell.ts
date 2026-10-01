import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatAmount } from '../../core/format';
import { Truncate } from '../../core/truncate';
import { LoanLink } from '../loans/loan.model';

/**
 * Ciò che la cella legge del movimento.
 *
 * Una forma strutturale e non `Transaction`: la cella è resa dentro il
 * template proiettato nella tabella condivisa, il cui contesto è tipizzato
 * sulla riga di `shared/` (con `type: string`), non sul modello di dominio.
 * Per confrontare il tipo con `'LOAN'` la stringa basta.
 */
export interface LoanCellTransaction {
  readonly id: string;
  readonly type: string;
  readonly amount: number;
}

/**
 * Ciò che la colonna dei prestiti mostra per un movimento.
 *
 * I tre casi non si escludono: un movimento può aver originato un prestito e
 * poterne originare un altro.
 */
interface LoanCell {
  /** I prestiti nati da questo movimento. */
  origins: LoanLink[];
  /** I prestiti che questo movimento ha contribuito a restituire. */
  repayments: LoanLink[];
  /** Da questo movimento si può creare un prestito. */
  creatable: boolean;
  /**
   * Quanto del movimento non è credito di nessuno.
   *
   * È spesa propria, e come tale entra nelle uscite del mese: senza dirlo, un
   * pagamento di 1.920 € con un prestito da 1.030 sembrerebbe tutto prestato.
   */
  ownExpense: number;
}

/**
 * La cella «Prestito» della tabella dei movimenti.
 *
 * Vive nella feature e non nella tabella condivisa: link al workspace dei
 * prestiti, regole su cosa sia creabile e quota di spesa propria sono dominio.
 * La pagina dei movimenti la proietta come colonna aggiuntiva
 * (`appTransactionsTableExtraColumn`), e le passa i legami già indicizzati per
 * movimento: l'indice si costruisce una volta per pagina, non una per cella.
 */
@Component({
  selector: 'app-transaction-loan-cell',
  imports: [RouterLink, Truncate],
  templateUrl: './transaction-loan-cell.html',
  styleUrl: './transaction-loan-cell.scss',
})
export class TransactionLoanCell {
  readonly transaction = input.required<LoanCellTransaction>();
  /** I legami di **questo** movimento con i prestiti; vuoto se non ne ha. */
  readonly links = input.required<readonly LoanLink[]>();

  protected readonly formatAmount = formatAmount;

  protected readonly cell = computed<LoanCell>(() => {
    const transaction = this.transaction();
    const links = this.links();
    const origins = links.filter((link) => link.role === 'ORIGIN');
    const lent = origins.reduce((sum, link) => sum + link.amount, 0);

    return {
      origins,
      repayments: links.filter((link) => link.role === 'REPAYMENT'),
      // Un movimento di tipo prestito resta creabile anche se un prestito
      // c'è già: lo stesso pagamento può aver anticipato denaro per più
      // persone, e il backend controlla che la somma ci stia dentro.
      creatable: transaction.type === 'LOAN',
      ownExpense:
        transaction.type === 'LOAN' && origins.length > 0
          ? Math.max(Math.abs(transaction.amount) - lent, 0)
          : 0,
    };
  });
}
