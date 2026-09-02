import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Il package è completo?
 *
 * Una cartella portatile si copia, e una copia può essere incompleta: un
 * antivirus che mette in quarantena il binario di SQLite, uno zip estratto a
 * metà, un aggiornamento interrotto. Il modo in cui questi guasti si
 * manifestano senza un controllo è pessimo — una traccia di stack su un
 * `require` fallito, o un frontend che risponde 404 — e nessuno di quei
 * messaggi dice all'utente cosa fare.
 *
 * Il controllo costa quattro `existsSync` all'avvio e trasforma tutto in una
 * frase sola: manca questo file, la copia è incompleta, ricopiala.
 */

export interface PackageLayout {
  /** La cartella che contiene `server.js`, cioè il backend confezionato. */
  readonly backendDir: string;
  readonly frontendDir: string;
  readonly migrationsDir: string;
}

export interface MissingPiece {
  readonly what: string;
  readonly file: string;
}

/**
 * I pezzi che mancano, con il nome di ciò che servono a fare.
 *
 * `exists` è iniettabile perché la funzione descrive una politica — quali file
 * sono indispensabili — e quella politica va verificata senza costruire quattro
 * alberi di directory su disco.
 */
export function missingPrerequisites(
  layout: PackageLayout,
  exists: (file: string) => boolean = existsSync,
): MissingPiece[] {
  const richiesti: MissingPiece[] = [
    { what: "il programma dell'applicazione", file: path.join(layout.backendDir, 'server.js') },
    {
      what: 'il motore del database',
      file: path.join(layout.backendDir, 'native', 'better_sqlite3.node'),
    },
    { what: "l'interfaccia", file: path.join(layout.frontendDir, 'index.html') },
    {
      what: 'la descrizione della struttura dei dati',
      file: path.join(layout.migrationsDir, 'meta', '_journal.json'),
    },
  ];

  return richiesti.filter((pezzo) => !exists(pezzo.file));
}

/** Il percorso del programma da avviare, dedotto da dove sta il launcher. */
export function serverEntry(backendDir: string): string {
  return path.join(backendDir, 'server.js');
}
