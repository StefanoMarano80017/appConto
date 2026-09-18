import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api';
import { BoundColumns, ColumnMapping, CsvAnalysis } from './column-mapping';

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
  /** Colonne del file usate per ogni campo: `null` se assente. */
  columns: BoundColumns;
}

/** Il CSV viaggia come testo grezzo, non come multipart. */
const CSV_HEADERS = { 'Content-Type': 'text/csv' };

@Injectable({ providedIn: 'root' })
export class ImportApi {
  private readonly http = inject(HttpClient);

  /**
   * Chiede cosa contiene il file e quali colonne sono state riconosciute.
   *
   * Non importa niente: è il passo che precede entrambe le modalità.
   */
  analyze(content: string): Promise<CsvAnalysis> {
    return firstValueFrom(
      this.http.post<CsvAnalysis>(`${API_BASE_URL}/import/csv/analysis`, content, {
        headers: CSV_HEADERS
      })
    );
  }

  /** Importa con le colonne rilevate dal contenuto del file. */
  importCsv(content: string): Promise<ImportResult> {
    return firstValueFrom(
      this.http.post<ImportResult>(`${API_BASE_URL}/import/csv`, content, {
        headers: CSV_HEADERS
      })
    );
  }

  /**
   * Importa con le colonne indicate dall'utente.
   *
   * Il file torna insieme alla scelta: il backend non conserva nulla fra
   * l'anteprima e l'import.
   */
  importMapped(content: string, mapping: ColumnMapping): Promise<ImportResult> {
    return firstValueFrom(
      this.http.post<ImportResult>(`${API_BASE_URL}/import/csv/mapped`, { content, mapping })
    );
  }
}
