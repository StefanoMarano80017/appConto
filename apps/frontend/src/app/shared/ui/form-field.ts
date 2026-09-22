import { Component, computed, input } from '@angular/core';
import { formFieldErrorId, formFieldHintId } from './form-field.ids';

/**
 * Involucro di un campo di modulo: etichetta, il controllo reale (proiettato
 * dalla pagina), errore, hint.
 *
 * L'associazione fra etichetta e controllo resta il wrapping implicito
 * (`<label>` che avvolge il contenuto proiettato) già usato in ogni form
 * dell'app — nessun `for`/`id` necessario per quello. `id` serve solo a
 * costruire gli identificatori stabili di `<span class="field-error">` e
 * `<span class="field-hint">`, che la pagina referenzia dal proprio
 * `aria-describedby` tramite gli helper puri di `form-field.ids.ts`:
 * `FormField` non inietta né legge nulla dal controllo proiettato
 * (docs/architecture/frontend-shared-components-proposal.md, §16.3).
 */
@Component({
  selector: 'app-form-field',
  templateUrl: './form-field.html',
  styleUrl: './form-field.scss'
})
export class FormField {
  readonly id = input.required<string>();
  readonly label = input.required<string>();
  readonly error = input<string | undefined>(undefined);
  readonly hint = input<string | undefined>(undefined);

  protected readonly errorId = computed(() => formFieldErrorId(this.id()));
  protected readonly hintId = computed(() => formFieldHintId(this.id()));
}
