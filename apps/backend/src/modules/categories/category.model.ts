/**
 * Modello di dominio.
 *
 * Una categoria rappresenta una tipologia di spesa. Non contiene logica:
 * serve solo a raggruppare i merchant.
 */
export interface Category {
  id: string;
  name: string;
  /** Colore di visualizzazione, in formato esadecimale. */
  color: string | null;
}
