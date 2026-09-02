import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toErrorMessage } from '../../core/http-error';
import {
  ColumnMappingErrors,
  ColumnMappingFormValue,
  CsvAnalysis,
  ImportMode,
  boundColumns,
  formFromProposal,
  isProposalComplete,
  proposalColumns,
  unrecognizedFields,
  validateColumnMapping
} from './column-mapping';
import { ColumnPicker } from './column-picker';
import { ImportApi, ImportResult } from './import.api';

/**
 * Importazione di un estratto conto, in due modalità.
 *
 * Il file viene prima analizzato — quali colonne contiene, quali sono state
 * riconosciute — e solo dopo importato: così la scelta delle colonne si può
 * correggere *prima* di scrivere in archivio, non dopo.
 *
 * La modalità manuale non è un ripiego per i casi disperati: serve anche
 * quando il rilevamento riesce ma sceglie male, ed è per questo che resta
 * disponibile sempre. Quando invece il rilevamento è incompleto è l'unica
 * strada, e la pagina ci si porta da sé.
 */
@Component({
  selector: 'app-import-page',
  imports: [RouterLink, ColumnPicker],
  templateUrl: './import-page.html',
  styleUrl: './import-page.scss'
})
export class ImportPage {
  private readonly api = inject(ImportApi);

  /** Contenuto del file scelto: torna al backend insieme alla scelta manuale. */
  private content: string | null = null;

  protected readonly fileName = signal<string | null>(null);
  protected readonly analysis = signal<CsvAnalysis | null>(null);
  protected readonly analyzing = signal(false);
  protected readonly importing = signal(false);
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly mode = signal<ImportMode>('auto');
  protected readonly form = signal<ColumnMappingFormValue | null>(null);
  protected readonly errors = signal<ColumnMappingErrors>({});

  /** Colonne proposte dal rilevamento, in forma leggibile. */
  protected readonly proposed = computed(() => {
    const analysis = this.analysis();

    return analysis === null ? [] : boundColumns(proposalColumns(analysis.proposal));
  });

  /** I campi obbligatori che il rilevamento non ha riconosciuto. */
  protected readonly unrecognized = computed(() => {
    const analysis = this.analysis();

    return analysis === null ? [] : unrecognizedFields(analysis.proposal);
  });

  /** Senza i tre campi obbligatori l'automatico non ha modo di funzionare. */
  protected readonly canImportAutomatically = computed(() => {
    const analysis = this.analysis();

    return analysis !== null && isProposalComplete(analysis.proposal);
  });

  /** Colonne effettivamente usate dall'ultimo import. */
  protected readonly columns = computed(() => {
    const result = this.result();

    return result === null ? [] : boundColumns(result.columns);
  });

  protected async onFileSelected(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;

    this.reset();
    this.fileName.set(file?.name ?? null);
    if (file === null) {
      return;
    }

    this.content = await file.text();
    this.analyzing.set(true);

    try {
      const analysis = await this.api.analyze(this.content);

      this.analysis.set(analysis);
      this.form.set(formFromProposal(analysis.proposal));
      // Se manca qualcosa la scelta è già di fatto manuale: tanto vale dirlo.
      this.mode.set(isProposalComplete(analysis.proposal) ? 'auto' : 'manual');
    } catch (error: unknown) {
      this.error.set(toErrorMessage(error));
    } finally {
      this.analyzing.set(false);
    }
  }

  protected selectMode(mode: ImportMode): void {
    this.mode.set(mode);
    this.errors.set({});
  }

  protected updateForm(form: ColumnMappingFormValue): void {
    this.form.set(form);
    this.errors.set({});
  }

  protected async importCsv(): Promise<void> {
    const content = this.content;
    if (content === null || this.importing()) {
      return;
    }

    const request = this.mode() === 'auto' ? this.automatic(content) : this.manual(content);
    if (request === null) {
      return;
    }

    this.importing.set(true);
    this.result.set(null);
    this.error.set(null);

    try {
      this.result.set(await request());
    } catch (error: unknown) {
      this.error.set(toErrorMessage(error));
    } finally {
      this.importing.set(false);
    }
  }

  private automatic(content: string): () => Promise<ImportResult> {
    return () => this.api.importCsv(content);
  }

  /** `null` quando la scelta è incompleta: gli errori restano sulle tendine. */
  private manual(content: string): (() => Promise<ImportResult>) | null {
    const form = this.form();
    if (form === null) {
      return null;
    }

    const validated = validateColumnMapping(form);
    if (!validated.valid) {
      this.errors.set(validated.errors);
      return null;
    }

    this.errors.set({});
    return () => this.api.importMapped(content, validated.mapping);
  }

  private reset(): void {
    this.content = null;
    this.analysis.set(null);
    this.form.set(null);
    this.errors.set({});
    this.result.set(null);
    this.error.set(null);
    this.mode.set('auto');
  }
}
