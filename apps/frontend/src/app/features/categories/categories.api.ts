import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api';
import { Category, CategoryWithUsage } from './category.model';

export interface NewCategory {
  name: string;
  color: string | null;
}

export interface CategoryPatch {
  name?: string;
  color?: string | null;
}

@Injectable({ providedIn: 'root' })
export class CategoriesApi {
  private readonly http = inject(HttpClient);

  /** Tutte le categorie, con il numero di merchant assegnati a ciascuna. */
  list(): Observable<CategoryWithUsage[]> {
    return this.http.get<CategoryWithUsage[]>(`${API_BASE_URL}/categories`);
  }

  create(category: NewCategory): Observable<Category> {
    return this.http.post<Category>(`${API_BASE_URL}/categories`, category);
  }

  update(id: string, patch: CategoryPatch): Observable<CategoryWithUsage> {
    return this.http.patch<CategoryWithUsage>(`${API_BASE_URL}/categories/${id}`, patch);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/categories/${id}`);
  }
}
