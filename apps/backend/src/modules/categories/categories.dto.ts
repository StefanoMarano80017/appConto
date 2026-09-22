import type { Category, CategoryWithUsage } from './category.model.js';

/** Rappresentazione della categoria esposta dalle API. */
export interface CategoryDto {
  id: string;
  name: string;
  color: string | null;
}

export function toCategoryDto(category: Category): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    color: category.color,
  };
}

/**
 * Rappresentazione della categoria con il numero di merchant assegnati.
 *
 * Distinta da `CategoryDto`: quest'ultima è annidata dentro un merchant
 * (`merchants.dto.ts`), dove il conteggio non ha senso — un merchant ha una
 * sola categoria, non serve sapere quanti merchant condivide.
 */
export interface CategoryWithUsageDto extends CategoryDto {
  merchantCount: number;
}

export function toCategoryWithUsageDto(category: CategoryWithUsage): CategoryWithUsageDto {
  return {
    ...toCategoryDto(category),
    merchantCount: category.merchantCount,
  };
}
