/**
 * Le API vivono sulla stessa origine dell'interfaccia.
 *
 * In produzione è Express a servire entrambe; in sviluppo ci pensa il proxy del
 * dev server Angular (`proxy.conf.json`). In nessuno dei due casi il frontend
 * deve sapere dove gira il backend: un URL assoluto qui rimetterebbe questa
 * conoscenza nel codice, e romperebbe una delle due modalità.
 */
export const API_BASE_URL = '/api';
