import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toErrorMessage } from '../../core/http-error';
import { ImportApi, ImportResult } from './import.api';

@Component({
  selector: 'app-import-page',
  imports: [RouterLink],
  templateUrl: './import-page.html',
  styleUrl: './import-page.scss'
})
export class ImportPage {
  private readonly api = inject(ImportApi);

  protected readonly selectedFile = signal<File | null>(null);
  protected readonly importing = signal(false);
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly error = signal<string | null>(null);

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
    this.result.set(null);
    this.error.set(null);
  }

  protected async importCsv(): Promise<void> {
    const file = this.selectedFile();
    if (file === null) {
      return;
    }

    this.importing.set(true);
    this.result.set(null);
    this.error.set(null);

    try {
      this.result.set(await this.api.importCsv(file));
    } catch (error: unknown) {
      this.error.set(toErrorMessage(error));
    } finally {
      this.importing.set(false);
    }
  }
}
