import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api';

/** Riepilogo dell'importazione restituito dal backend. */
export interface ImportResult {
  /** Righe di dati presenti nel file, intestazione esclusa. */
  rowsRead: number;
  /** Transazioni nuove, effettivamente archiviate. */
  imported: number;
  /** Transazioni già presenti in archivio, non reinserite. */
  duplicates: number;
  /** Righe scartate perché non convertibili. */
  failed: number;
  /** Merchant creati durante questa importazione. */
  merchantsCreated: number;
  errors: { line: number; message: string }[];
}

@Injectable({ providedIn: 'root' })
export class ImportApi {
  private readonly http = inject(HttpClient);

  /** Invia il contenuto testuale del CSV a POST /import/csv. */
  async importCsv(file: File): Promise<ImportResult> {
    const content = await file.text();

    return firstValueFrom(
      this.http.post<ImportResult>(`${API_BASE_URL}/import/csv`, content, {
        headers: { 'Content-Type': 'text/csv' }
      })
    );
  }
}
