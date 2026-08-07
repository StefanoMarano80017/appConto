import type { Category } from './category.model.js';

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
