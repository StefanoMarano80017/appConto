import { BACKUP_KINDS, parseBackupName, type BackupKind, type ParsedBackupName } from './backup.naming.js';

/**
 * Quali backup si conservano.
 *
 * La politica è diversa per tipo perché i tipi hanno vite diverse: un backup
 * pre-migrazione serve fino a quando la migrazione si è dimostrata buona, uno
 * automatico serve a coprire l'ultimo mese, uno manuale l'utente lo ha chiesto
 * lui e nessun automatismo ha il diritto di cancellarlo.
 *
 * È una funzione pura da nomi a nomi. Non guarda il disco, non guarda
 * l'orologio: dato lo stesso elenco decide sempre allo stesso modo, e questo
 * la rende l'unica parte del sistema di backup che si può verificare
 * esaustivamente senza creare un file.
 */

/** Quanti backup si conservano, per tipo. */
export const RETENTION: Record<BackupKind, { readonly days: number; readonly weeks: number } | number | null> = {
  'pre-migration': 5,
  'pre-restore': 3,
  auto: { days: 7, weeks: 4 },
  /** Mai cancellato: lo ha chiesto l'utente. */
  manual: null,
};

interface Candidate {
  readonly name: string;
  readonly parsed: ParsedBackupName;
}

/**
 * La settimana ISO 8601 del giorno indicato, come `2026-W36`.
 *
 * ISO e non "sette giorni fa" perché serve una chiave stabile: due backup
 * della stessa settimana devono ricadere nello stesso gruppo indipendentemente
 * da quando si esegue il pruning.
 */
export function isoWeekKey(day: string): string {
  const moment = new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))),
  );

  // Il giovedì della stessa settimana determina l'anno ISO a cui appartiene.
  const offsetToThursday = 3 - ((moment.getUTCDay() + 6) % 7);
  moment.setUTCDate(moment.getUTCDate() + offsetToThursday);

  const firstThursday = new Date(Date.UTC(moment.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() + (3 - ((firstThursday.getUTCDay() + 6) % 7)),
  );

  const week =
    1 + Math.round((moment.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));

  return `${String(moment.getUTCFullYear())}-W${String(week).padStart(2, '0')}`;
}

/** I più recenti per primi: il nome contiene la data in forma ordinabile. */
function newestFirst(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/**
 * I nomi da conservare per il tipo `auto`.
 *
 * Sette slot giornalieri e quattro settimanali, come insieme unione: il più
 * recente di ciascuno degli ultimi sette giorni, più il più recente di ciascuna
 * delle ultime quattro settimane. Gli slot si sovrappongono nella settimana
 * corrente, e va bene — l'unione è ciò che fa sì che la copertura si estenda
 * indietro di un mese senza conservare un file per ogni giorno del mese.
 */
function autoToKeep(candidates: Candidate[], days: number, weeks: number): Set<string> {
  const ordered = newestFirst(candidates);
  const keep = new Set<string>();

  const newestPerGroup = (key: (candidate: Candidate) => string, slots: number): void => {
    const seen = new Map<string, string>();
    for (const candidate of ordered) {
      const group = key(candidate);
      if (!seen.has(group)) {
        seen.set(group, candidate.name);
      }
    }

    for (const name of [...seen.values()].slice(0, slots)) {
      keep.add(name);
    }
  };

  newestPerGroup((candidate) => candidate.parsed.day, days);
  newestPerGroup((candidate) => isoWeekKey(candidate.parsed.day), weeks);

  return keep;
}

/**
 * I backup da eliminare, dato l'elenco completo dei nomi presenti.
 *
 * Un nome che non rispetta la convenzione non viene mai restituito: questa
 * funzione non è autorizzata a cancellare ciò che non ha prodotto lei.
 */
export function backupsToPrune(names: readonly string[]): string[] {
  const byKind = new Map<BackupKind, Candidate[]>();
  for (const kind of BACKUP_KINDS) {
    byKind.set(kind, []);
  }

  for (const name of names) {
    const parsed = parseBackupName(name);
    if (parsed !== null) {
      byKind.get(parsed.kind)?.push({ name, parsed });
    }
  }

  const toPrune: string[] = [];

  for (const kind of BACKUP_KINDS) {
    const candidates = byKind.get(kind) ?? [];
    const policy = RETENTION[kind];

    if (policy === null) {
      continue;
    }

    const keep =
      typeof policy === 'number'
        ? new Set(newestFirst(candidates).slice(0, policy).map((candidate) => candidate.name))
        : autoToKeep(candidates, policy.days, policy.weeks);

    for (const candidate of candidates) {
      if (!keep.has(candidate.name)) {
        toPrune.push(candidate.name);
      }
    }
  }

  return toPrune.sort();
}
