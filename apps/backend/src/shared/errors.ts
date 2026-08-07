/**
 * Errori di business.
 *
 * Il dominio e i servizi applicativi sollevano questi errori senza conoscere HTTP:
 * la traduzione in status code avviene nell'error handler Express.
 */
export type DomainErrorCode = 'VALIDATION' | 'NOT_FOUND';

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: DomainErrorCode,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'VALIDATION');
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message, 'NOT_FOUND');
  }
}
