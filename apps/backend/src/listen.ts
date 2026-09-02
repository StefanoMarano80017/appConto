import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Mettersi in ascolto, e cosa fare se la porta è occupata.
 *
 * La decisione sulla porta appartiene a **questo** processo, che è quello che
 * apre il listener. È l'unico modo di evitare una corsa: chiunque altro
 * potrebbe soltanto guardare se una porta è libera e riferirlo, e fra
 * quell'istante e l'apposizione del listener un altro programma può
 * prendersela. Il launcher indica quale porta vorrebbe e se accetta un
 * ripiego; a scegliere davvero è il kernel, quando `listen(0)` assegna una
 * porta libera nell'atto stesso di occuparla.
 *
 * Il ripiego non è il comportamento predefinito. `npm start` e i test si
 * aspettano di fallire in modo chiaro su una porta occupata — una porta
 * diversa da quella richiesta, in sviluppo, è un modo di non accorgersi di
 * avere due server accesi. Chi vuole il ripiego lo chiede.
 */

/** Ciò che si chiede: una porta, un indirizzo, e se si accetta un ripiego. */
export interface ListenRequest {
  readonly host: string;
  readonly port: number;
  /** Se `true`, una porta occupata porta a `listen(0)` invece che a un errore. */
  readonly allowFallback: boolean;
}

export interface ListenOutcome {
  /** La porta richiesta: quella configurata dall'utente o dall'ambiente. */
  readonly configuredPort: number;
  /** La porta effettivamente aperta. Diversa dalla precedente solo dopo un ripiego. */
  readonly actualPort: number;
  readonly host: string;
  /** La porta richiesta era occupata. */
  readonly fellBack: boolean;
}

/** L'errore che riporta la porta a cui si riferisce, per il messaggio all'utente. */
export class ListenFailedError extends Error {
  constructor(
    message: string,
    readonly port: number,
    readonly code: string | undefined,
    readonly cause: NodeJS.ErrnoException,
  ) {
    super(message);
  }
}

/** Un solo tentativo, con la coppia di gestori smontata in ogni caso. */
function attempt(server: Server, host: string, port: number): Promise<AddressInfo> {
  return new Promise<AddressInfo>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening);
      reject(error);
    };

    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve(server.address() as AddressInfo);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    // L'host è esplicito: senza di esso Node ascolterebbe su tutte le
    // interfacce, e questa applicazione custodisce dati personali.
    server.listen(port, host);
  });
}

/**
 * Apre il listener sulla porta richiesta, ripiegando su una libera se serve.
 *
 * `EADDRINUSE` è l'unico errore che porta al ripiego: gli altri — un permesso
 * negato, un indirizzo inesistente — non si risolvono cambiando numero, e
 * fingere il contrario nasconderebbe il problema vero.
 */
export async function listenWithFallback(
  server: Server,
  request: ListenRequest,
): Promise<ListenOutcome> {
  try {
    const address = await attempt(server, request.host, request.port);

    return {
      configuredPort: request.port,
      actualPort: address.port,
      host: request.host,
      fellBack: false,
    };
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;

    if (errno.code !== 'EADDRINUSE' || !request.allowFallback) {
      throw new ListenFailedError(
        errno.code === 'EADDRINUSE'
          ? `La porta ${String(request.port)} è già occupata.`
          : `Impossibile mettersi in ascolto su ${request.host}:${String(request.port)}.`,
        request.port,
        errno.code,
        errno,
      );
    }

    // Porta zero: il kernel ne assegna una libera mentre la occupa, quindi
    // fra la scelta e l'uso non esiste un istante in cui qualcun altro possa
    // prendersela.
    const address = await attempt(server, request.host, 0);

    return {
      configuredPort: request.port,
      actualPort: address.port,
      host: request.host,
      fellBack: true,
    };
  }
}
