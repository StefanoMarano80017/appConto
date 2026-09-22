/** API pubblica della feature `categories`. */
export type { Category, CategoryWithUsage, NewCategory } from './category.model.js';
export { categoriesService, FALLBACK_CATEGORY_ID } from './categories.service.js';
export {
  toCategoryDto,
  type CategoryDto,
  toCategoryWithUsageDto,
  type CategoryWithUsageDto,
} from './categories.dto.js';
export { categoriesRouter } from './categories.routes.js';
