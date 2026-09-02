import type { RequestHandler } from 'express';

/**
 * Il perimetro di un backend locale.
 *
 * Il server ascolta solo su loopback, quindi la rete non lo raggiunge. Restano
 * però due strade che passano dal browser dell'utente — una pagina qualsiasi
 * può chiamare `127.0.0.1`, e un dominio ostile può risolvere a `127.0.0.1` —
 * e sono queste due funzioni a chiuderle.
 *
 * Non c'è autenticazione né CSRF token: l'applicazione ha un solo utente, che
 * è già davanti alla macchina. Ciò che va impedito è che sia una *pagina web
 * altrui* a usare il suo browser per parlare con l'archivio.
 */

/** I nomi con cui la macchina chiama sé stessa. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** I metodi che modificano l'archivio. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * L'hostname contenuto in un `Host`, senza la porta.
 *
 * Gli indirizzi IPv6 arrivano fra parentesi quadre (`[::1]:3000`): il primo
 * `:` non è il separatore della porta, e va cercato dopo la chiusura.
 */
function hostnameOf(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();

  if (value.startsWith('[')) {
    const close = value.indexOf(']');

    return close === -1 ? value : value.slice(0, close + 1);
  }

  const colon = value.indexOf(':');

  return colon === -1 ? value : value.slice(0, colon);
}

/** Se l'origine indicata è una pagina servita da questa stessa macchina. */
function isLocalOrigin(origin: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(hostnameOf(new URL(origin).host));
  } catch {
    return false;
  }
}

/**
 * Accetta solo richieste indirizzate alla macchina stessa.
 *
 * La porta non viene verificata: cambia legittimamente — 3000 in produzione,
 * 4200 quando la richiesta passa dal dev server Angular — mentre il pericolo
 * sta nel *nome*. Un attacco di DNS rebinding arriva qui come
 * `Host: evil.example`, e si ferma.
 */
export const hostAllowlist: RequestHandler = (req, res, next) => {
  const host = req.headers.host;

  if (host === undefined || !LOOPBACK_HOSTNAMES.has(hostnameOf(host))) {
    res.status(403).json({ error: 'Host non consentito.' });
    return;
  }

  next();
};

/**
 * Impedisce che una pagina esterna modifichi l'archivio.
 *
 * Due controlli indipendenti, entrambi vincolanti quando l'informazione è
 * presente:
 *
 * - `Origin`, se c'è, deve essere una pagina locale;
 * - `Sec-Fetch-Site`, se c'è, deve dire che la richiesta nasce da qui. È il
 *   dato più affidabile, perché lo scrive il browser e la pagina non può
 *   alterarlo.
 *
 * Una richiesta priva di entrambi non viene da una pagina web (`curl`, uno
 * script): non è la minaccia da cui questo controllo difende, e bloccarla
 * renderebbe l'API inutilizzabile dalla riga di comando.
 *
 * Le letture non vengono verificate: senza intestazioni CORS in risposta il
 * browser non consegna il corpo a chi ha chiamato, quindi non c'è nulla da
 * proteggere che non sia già protetto.
 */
export const sameOriginMutations: RequestHandler = (req, res, next) => {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== 'null' && !isLocalOrigin(origin)) {
    res.status(403).json({ error: 'Origine non consentita.' });
    return;
  }

  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    res.status(403).json({ error: 'Richiesta proveniente da un contesto esterno.' });
    return;
  }

  next();
};
