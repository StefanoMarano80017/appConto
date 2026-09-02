/**
 * Quando l'applicazione è pronta.
 *
 * "Il processo è partito" e "l'applicazione risponde" sono due cose diverse, e
 * la distanza fra loro non è breve: fra l'una e l'altra ci sono l'apertura del
 * database, un eventuale ripristino differito, le migrazioni, il backup
 * obbligatorio prima di migrare. Aprire il browser sul primo dei due momenti
 * mostrerebbe all'utente un errore di connessione — o, peggio, una pagina che
 * si carica a metà.
 *
 * Quindi non un'attesa a tempo, ma una domanda ripetuta a cui il server deve
 * rispondere. E una condizione di uscita in più: se il processo muore mentre
 * si attende, non si attende invano fino alla scadenza — si dice subito che
 * non partirà.
 */

export type ReadinessOutcome =
  | { readonly kind: 'pronto'; readonly attempts: number; readonly elapsedMs: number }
  | { readonly kind: 'terminato'; readonly attempts: number }
  | { readonly kind: 'scaduto'; readonly attempts: number; readonly elapsedMs: number };

export interface ReadinessPort {
  /** Un solo tentativo: `true` se l'applicazione ha risposto di essere in salute. */
  readonly probe: () => Promise<boolean>;
  /** Il processo del server è ancora in esecuzione. */
  readonly alive: () => boolean;
  readonly now: () => number;
  readonly wait: (ms: number) => Promise<void>;
  readonly timeoutMs: number;
  readonly intervalMs: number;
}

/**
 * Attende che l'applicazione risponda.
 *
 * L'ordine dei controlli dentro il ciclo è deliberato: si guarda **prima** se
 * il processo è vivo. Un processo morto non risponderà mai, e chiedere a una
 * porta chiusa costa un timeout di connessione per ogni giro.
 */
export async function waitUntilReady(port: ReadinessPort): Promise<ReadinessOutcome> {
  const inizio = port.now();
  let attempts = 0;

  for (;;) {
    if (!port.alive()) {
      return { kind: 'terminato', attempts };
    }

    attempts += 1;
    if (await port.probe()) {
      return { kind: 'pronto', attempts, elapsedMs: port.now() - inizio };
    }

    // Il processo può essere morto **durante** il tentativo: senza questo
    // controllo si aspetterebbe un intervallo in più per accorgersene.
    if (!port.alive()) {
      return { kind: 'terminato', attempts };
    }

    if (port.now() - inizio >= port.timeoutMs) {
      return { kind: 'scaduto', attempts, elapsedMs: port.now() - inizio };
    }

    await port.wait(port.intervalMs);
  }
}

/**
 * Un tentativo su `/api/health`.
 *
 * Qualunque errore è un "non ancora": durante l'avvio la porta non è ancora
 * aperta, e un rifiuto di connessione è la risposta normale, non un guasto.
 */
export async function httpHealthProbe(url: string, timeoutMs = 2_000): Promise<boolean> {
  try {
    const risposta = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!risposta.ok) {
      return false;
    }

    const corpo = (await risposta.json()) as { status?: unknown };

    return corpo.status === 'ok';
  } catch {
    return false;
  }
}
