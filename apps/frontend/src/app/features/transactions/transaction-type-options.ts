import {
  LucideArrowLeftRight,
  LucideBanknote,
  LucideEllipsis,
  LucideHandCoins,
  LucideTrendingDown,
  LucideTrendingUp,
  type LucideIconData,
} from '@lucide/angular';
import type { SelectOption } from '@shared/ui/forms/select/select.model';
import { TRANSACTION_TYPES, TRANSACTION_TYPE_LABELS, TransactionType } from './transaction-type';

/** L'icona di ogni tipo: il verso del denaro, prima ancora di leggere l'etichetta. */
const TRANSACTION_TYPE_ICONS: Record<TransactionType, LucideIconData> = {
  EXPENSE: LucideTrendingDown.icon,
  INCOME: LucideTrendingUp.icon,
  WITHDRAWAL: LucideBanknote.icon,
  LOAN: LucideHandCoins.icon,
  TRANSFER: LucideArrowLeftRight.icon,
  OTHER: LucideEllipsis.icon,
};

/**
 * I tipi di movimento come opzioni della tabella condivisa.
 *
 * Stanno nella feature e non nella tabella: etichette e icone sono dominio,
 * e `shared/` non sa quali tipi esistano. Una sola costante per tutte le
 * pagine che mostrano la tabella, così la stessa riga ha la stessa icona sia
 * nei movimenti sia nella dashboard.
 */
export const TRANSACTION_TYPE_OPTIONS: readonly SelectOption<TransactionType>[] =
  TRANSACTION_TYPES.map((type) => ({
    id: type,
    name: TRANSACTION_TYPE_LABELS[type],
    icon: TRANSACTION_TYPE_ICONS[type],
  }));
