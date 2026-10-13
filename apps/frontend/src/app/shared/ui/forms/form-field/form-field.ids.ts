/**
 * Identificatori stabili di errore/hint, derivati dall'`id` del campo.
 *
 * Funzioni pure, non un `exportAs`/riferimento di template: `FormField`
 * decide quali id esistono (in base a `error`/`hint`), la pagina decide dove
 * applicarli — sul proprio controllo nativo proiettato, l'unico elemento che
 * `FormField` non può raggiungere senza reflection implicita
 * (docs/architecture/frontend-shared-components-proposal.md, §16.3).
 */

export function formFieldErrorId(id: string): string {
  return `${id}-error`;
}

export function formFieldHintId(id: string): string {
  return `${id}-hint`;
}

/** Il valore pronto per `aria-describedby`; `null` rimuove l'attributo. */
export function formFieldDescribedBy(
  id: string,
  has: { error: boolean; hint: boolean }
): string | null {
  const ids = [has.error ? formFieldErrorId(id) : null, has.hint ? formFieldHintId(id) : null].filter(
    (value): value is string => value !== null
  );

  return ids.length > 0 ? ids.join(' ') : null;
}
