/** API pubblica della feature `merchants`. */
export { merchantLabel, type Merchant } from './merchant.model.js';
export { merchantResolver, type MerchantResolution } from './merchant-resolver.js';
export {
  merchantsService,
  type MerchantWithCategory,
  type MerchantSummary,
  type MerchantPage,
  type MerchantCounts,
} from './merchants.service.js';
export {
  toMerchantDto,
  toMerchantSummaryDto,
  toMerchantPageDto,
  type MerchantDto,
  type MerchantPageDto,
  type MerchantSummaryDto,
} from './merchants.dto.js';
export { merchantsRouter } from './merchants.routes.js';
