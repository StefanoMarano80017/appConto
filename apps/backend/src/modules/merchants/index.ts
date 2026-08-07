/** API pubblica della feature `merchants`. */
export { merchantLabel, type Merchant } from './merchant.model.js';
export { merchantResolver, type MerchantResolution } from './merchant-resolver.js';
export {
  merchantsService,
  type MerchantWithCategory,
  type MerchantSummary,
} from './merchants.service.js';
export {
  toMerchantDto,
  toMerchantSummaryDto,
  type MerchantDto,
  type MerchantSummaryDto,
} from './merchants.dto.js';
export { merchantsRouter } from './merchants.routes.js';
