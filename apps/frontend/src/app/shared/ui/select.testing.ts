import type { ComponentFixture } from '@angular/core/testing';

/*
 * Helper per gli spec dei componenti che usano `app-select`: pilotano il
 * trigger e il pannello come farebbe un utente, senza conoscerne il DOM interno.
 * `scope` è un selettore CSS che individua il contenitore del select.
 */

/** Il trigger (`<button role="combobox">`) dell'`app-select` dentro `scope`. */
export function selectTrigger(root: ParentNode, scope: string): HTMLButtonElement {
  const trigger = root.querySelector<HTMLButtonElement>(`${scope} app-select button[role="combobox"]`);
  if (!trigger) {
    throw new Error(`Nessun trigger di app-select in "${scope}"`);
  }
  return trigger;
}

/** Apre il select dentro `scope` e sceglie la voce con il testo `name`. */
export async function chooseOption(
  fixture: ComponentFixture<unknown>,
  root: ParentNode,
  scope: string,
  name: string,
): Promise<void> {
  selectTrigger(root, scope).click();
  await fixture.whenStable();

  const option = Array.from(
    root.querySelectorAll<HTMLElement>(`${scope} app-select [role="option"]`),
  ).find((candidate) => candidate.textContent?.trim() === name);
  if (!option) {
    throw new Error(`Nessuna voce "${name}" nel select di "${scope}"`);
  }
  option.click();
  await fixture.whenStable();
}

/** Il nome mostrato dal trigger del select dentro `scope`. */
export function selectedName(root: ParentNode, scope: string): string {
  return selectTrigger(root, scope).querySelector('.select-name')?.textContent?.trim() ?? '';
}
