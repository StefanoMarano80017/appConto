import type { Category } from './category.model.js';
import { categoriesRepository } from './categories.repository.js';

/** Servizio pubblico della feature: unico punto di accesso per le altre feature. */
export const categoriesService = {
  listAll(): Category[] {
    return categoriesRepository.findAll();
  },

  findById(id: string): Category | null {
    return categoriesRepository.findById(id);
  },
};
