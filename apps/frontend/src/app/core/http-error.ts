import { HttpErrorResponse } from '@angular/common/http';

/** Estrae il messaggio d'errore restituito dal backend. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const backendMessage = (error.error as { error?: string } | null)?.error;
    if (backendMessage) {
      return backendMessage;
    }
    if (error.status === 0) {
      return 'Backend non raggiungibile. Verifica che l\'applicazione sia in esecuzione.';
    }
    return error.message;
  }

  return 'Si è verificato un errore imprevisto.';
}
