import { ConflictError, ValidationError } from '../../shared/errors.js';
import { type Category, type NewCategory, createCategory } from './category.model.js';
import { categoriesRepository } from './categories.repository.js';

/**
 * L'id fisso di "Da classificare": il ripiego usato dalla riassegnazione
 * quando una categoria viene eliminata. Non può essere rinominata né
 * eliminata (vedi `update` e `remove` più sotto).
 */
export const FALLBACK_CATEGORY_ID = 'c9bfcd74-e342-4a3f-8b0c-116f89236d51';

/** Servizio pubblico della feature: unico punto di accesso per le altre feature. */
export const categoriesService = {
  listAll(): Category[] {
    return categoriesRepository.findAll();
  },

  findById(id: string): Category | null {
    return categoriesRepository.findById(id);
  },

  create(input: NewCategory): Category {
    const name = input.name.trim();
    if (name === '') {
      throw new ValidationError('Il nome della categoria non può essere vuoto.');
    }
    if (categoriesRepository.findByName(name) !== null) {
      throw new ConflictError(`Esiste già una categoria con il nome "${name}".`);
    }

    const category = createCategory({ name, color: input.color });
    categoriesRepository.insert(category);

    return category;
  },
};
