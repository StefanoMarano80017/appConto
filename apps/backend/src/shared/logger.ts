/**
 * Logger minimale.
 *
 * Le operazioni di dominio non lo utilizzano: viene usato solo dai bordi
 * dell'applicazione (bootstrap, routes, error handler).
 */
export const logger = {
  info(message: string, details?: unknown): void {
    console.log(`[info] ${message}`, details ?? '');
  },
  error(message: string, details?: unknown): void {
    console.error(`[error] ${message}`, details ?? '');
  },
};
