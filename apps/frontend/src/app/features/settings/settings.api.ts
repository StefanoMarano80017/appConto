import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api';
import { Settings } from './settings.model';

@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly http = inject(HttpClient);

  get(): Observable<Settings> {
    return this.http.get<Settings>(`${API_BASE_URL}/settings`);
  }

  update(settings: Settings): Observable<Settings> {
    return this.http.patch<Settings>(`${API_BASE_URL}/settings`, settings);
  }
}
