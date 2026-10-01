import type { VisualSelectIcon, VisualSelectOption } from '../../shared/ui/visual-select';
import { TRANSACTION_TYPES, TRANSACTION_TYPE_LABELS, TransactionType } from './transaction-type';

/** L'icona di ogni tipo: il verso del denaro, prima ancora di leggere l'etichetta. */
const TRANSACTION_TYPE_ICONS: Record<TransactionType, VisualSelectIcon> = {
  EXPENSE: 'trending-down',
  INCOME: 'trending-up',
  WITHDRAWAL: 'banknote',
  LOAN: 'hand-coins',
  TRANSFER: 'arrow-left-right',
  OTHER: 'ellipsis',
};

/**
 * I tipi di movimento come opzioni della tabella condivisa.
 *
 * Stanno nella feature e non nella tabella: etichette e icone sono dominio,
 * e `shared/` non sa quali tipi esistano. Una sola costante per tutte le
 * pagine che mostrano la tabella, così la stessa riga ha la stessa icona sia
 * nei movimenti sia nella dashboard.
 */
export const TRANSACTION_TYPE_OPTIONS: readonly VisualSelectOption<TransactionType>[] =
  TRANSACTION_TYPES.map((type) => ({
    id: type,
    name: TRANSACTION_TYPE_LABELS[type],
    icon: TRANSACTION_TYPE_ICONS[type],
  }));
