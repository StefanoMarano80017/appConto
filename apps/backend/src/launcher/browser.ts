import { spawn, type SpawnOptions } from 'node:child_process';

/**
 * Aprire l'applicazione nel browser predefinito dell'utente.
 *
 * Non si nomina un browser: si chiede a Windows di aprire un indirizzo, e
 * decide lui. Cercare Edge, o Chrome, o l'uno con ripiego sull'altro,
 * significherebbe imporre una scelta che appartiene a chi usa il computer — e
 * mantenere un elenco di programmi che cambia nel tempo.
 *
 * Lo strumento è `cmd /c start`, cioè la stessa cosa che accade quando si fa
 * doppio clic su un collegamento. `cmd.exe` viene indicato con il percorso che
 * il sistema dichiara in `COMSPEC`, e non risolto tramite `PATH`: la cartella
 * portatile non deve dipendere da come è configurato il `PATH` della macchina.
 */

/** Il primo argomento di `start` è il titolo della finestra: vuoto, ma necessario. */
const EMPTY_TITLE = '';

export interface BrowserPort {
  readonly comspec: string;
  readonly spawn: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => { unref: () => void };
}

/** L'indirizzo su cui aprire l'applicazione. Sempre loopback, come il binding. */
export function localUrl(host: string, port: number): string {
  // `127.0.0.1` e non `localhost`: su alcune macchine `localhost` risolve
  // prima in IPv6, e il server ascolta sull'indirizzo IPv4 su cui è stato
  // messo. L'indirizzo giusto è quello a cui il server ha detto di essere.
  return `http://${host}:${String(port)}/`;
}

/**
 * Chiede al sistema di aprire l'indirizzo.
 *
 * Non attende, e non riporta se il browser si è davvero aperto: `start`
 * ritorna appena ha consegnato la richiesta alla shell. Un browser che non si
 * apre non è comunque un motivo per non avviare l'applicazione — l'indirizzo
 * è scritto nel log e nella finestra.
 */
export function openInBrowser(
  url: string,
  port: BrowserPort = {
    comspec: process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe',
    spawn: (command, args, options) => spawn(command, [...args], options),
  },
): void {
  const child = port.spawn(port.comspec, ['/c', 'start', EMPTY_TITLE, url], {
    // Staccato e senza flussi: il browser sopravvive all'uscita del launcher,
    // e non ne trattiene l'arresto.
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  child.unref();
}

/**
 * Se il browser va aperto.
 *
 * L'unico motivo per non aprirlo è un contesto automatico: i test avviano il
 * package decine di volte, e ognuna aprirebbe una finestra. Non è una
 * configurazione dell'utente — chi avvia l'applicazione vuole vederla — e per
 * questo non compare in `settings.json`.
 */
export function shouldOpenBrowser(env: Record<string, string | undefined>): boolean {
  return env.MYFINANCE_NO_BROWSER !== '1';
}
