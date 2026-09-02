import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Copia ricorsiva, e perché non si usa `fs.cpSync`.
 *
 * `cpSync` verso una destinazione il cui percorso contiene un carattere non
 * ASCII — `D:\Applicazioni Portàtili\...` — **non copia niente e non solleva
 * niente**: ritorna come se avesse funzionato, lasciando la cartella vuota.
 * Verificato su Node v24.11.1 / Windows 11, confrontato con `copyFileSync` e
 * `robocopy`, che sullo stesso percorso funzionano.
 *
 * Per uno strumento di confezionamento questo è il guasto peggiore possibile:
 * un package silenziosamente vuoto. Da qui due decisioni — questa funzione, e
 * il fatto che chi confeziona verifichi *dopo* che i file attesi ci siano
 * davvero, invece di fidarsi del valore di ritorno di una copia.
 *
 * Restituisce quanti file ha scritto, così chi chiama può confrontare.
 */
export function copyTree(from, to) {
  mkdirSync(to, { recursive: true });

  let copiati = 0;
  for (const voce of readdirSync(from, { withFileTypes: true })) {
    const sorgente = path.join(from, voce.name);
    const destinazione = path.join(to, voce.name);

    if (voce.isDirectory()) {
      copiati += copyTree(sorgente, destinazione);
    } else {
      copyFileSync(sorgente, destinazione);
      copiati += 1;
    }
  }

  return copiati;
}

/** Copia un singolo file, creando la cartella che lo conterrà. */
export function copyFile(from, to) {
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
}

/** Quanti file contiene un albero, per confrontare origine e destinazione. */
export function countFiles(dir) {
  if (!existsSync(dir)) {
    return 0;
  }

  let totale = 0;
  for (const voce of readdirSync(dir, { withFileTypes: true })) {
    totale += voce.isDirectory() ? countFiles(path.join(dir, voce.name)) : 1;
  }

  return totale;
}

/**
 * Copia un albero e pretende che sia arrivato.
 *
 * Il controllo sul numero di file non è pignoleria: è la difesa contro una
 * copia che dichiara di essere riuscita e non lo è.
 */
export function copyTreeVerified(from, to) {
  const attesi = countFiles(from);
  const copiati = copyTree(from, to);
  const trovati = countFiles(to);

  if (copiati !== attesi || trovati !== attesi) {
    throw new Error(
      `Copia incompleta di ${from} in ${to}: attesi ${attesi} file, copiati ${copiati}, trovati ${trovati}.`,
    );
  }

  const sorgenteByte = statSync(from).isDirectory() ? null : statSync(from).size;

  return { file: attesi, sorgenteByte };
}
