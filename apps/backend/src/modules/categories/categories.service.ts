import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { type Category, type CategoryWithUsage, type NewCategory, createCategory } from './category.model.js';
import { categoriesRepository } from './categories.repository.js';

/**
 * L'id fisso di "Da classificare": il ripiego usato dalla riassegnazione
 * quando una categoria viene eliminata. Non può essere rinominata né
 * eliminata (vedi `update` e `remove` più sotto).
 */
export const FALLBACK_CATEGORY_ID = 'c9bfcd74-e342-4a3f-8b0c-116f89236d51';

function requireCategory(id: string): Category {
  const category = categoriesRepository.findById(id);
  if (category === null) {
    throw new NotFoundError(`Categoria "${id}" non trovata.`);
  }

  return category;
}

/** Servizio pubblico della feature: unico punto di accesso per le altre feature. */
export const categoriesService = {
  listAll(): Category[] {
    return categoriesRepository.findAll();
  },

  findById(id: string): Category | null {
    return categoriesRepository.findById(id);
  },

  /** Le categorie con il numero di merchant assegnati a ciascuna. */
  listAllWithUsage(): CategoryWithUsage[] {
    const counts = categoriesRepository.countMerchantsByCategory();

    return categoriesRepository.findAll().map((category) => ({
      ...category,
      merchantCount: counts.get(category.id) ?? 0,
    }));
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

  /** Quanti merchant sono assegnati a una categoria. */
  usage(id: string): number {
    requireCategory(id);

    return categoriesRepository.countMerchantsForCategory(id);
  },

  update(id: string, patch: { name?: string; color?: string | null }): Category {
    const category = requireCategory(id);

    const name = patch.name === undefined ? undefined : patch.name.trim();
    if (name !== undefined && name === '') {
      throw new ValidationError('Il nome della categoria non può essere vuoto.');
    }

    if (id === FALLBACK_CATEGORY_ID && name !== undefined && name !== category.name) {
      throw new ConflictError('«Da classificare» non può essere rinominata.');
    }

    if (name !== undefined && name !== category.name && categoriesRepository.findByName(name) !== null) {
      throw new ConflictError(`Esiste già una categoria con il nome "${name}".`);
    }

    const nextPatch = { ...patch, ...(name === undefined ? {} : { name }) };
    categoriesRepository.update(id, nextPatch);

    return { ...category, ...nextPatch };
  },
};
