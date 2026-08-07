import { createMerchant, type Merchant } from './merchant.model.js';
import { normalizeMerchantName } from './merchant-normalizer.js';
import { merchantsRepository } from './merchants.repository.js';

export interface MerchantResolution {
  /** Mappa `nome originale -> merchant`, esistente o appena creato. */
  byName: Map<string, Merchant>;
  /** Quanti merchant sono stati creati durante questa risoluzione. */
  created: number;
}

/**
 * Trova o crea i merchant a partire dai nomi presenti in un estratto conto.
 *
 * Chi importa non deve conoscere le regole di normalizzazione: passa i nomi
 * originali e ottiene i merchant corrispondenti.
 */
export const merchantResolver = {
  /**
   * @param rawNames nomi così come compaiono in banca (anche ripetuti)
   */
  resolveAll(rawNames: readonly string[]): MerchantResolution {
    const normalizedByRawName = new Map<string, string>();
    for (const rawName of rawNames) {
      if (!normalizedByRawName.has(rawName)) {
        normalizedByRawName.set(rawName, normalizeMerchantName(rawName));
      }
    }

    const existing = merchantsRepository.findByNormalizedNames([
      ...new Set(normalizedByRawName.values()),
    ]);
    const byNormalizedName = new Map(existing.map((merchant) => [merchant.normalizedName, merchant]));

    const created: Merchant[] = [];
    const resolved = new Map<string, Merchant>();

    for (const [rawName, normalizedName] of normalizedByRawName) {
      let merchant = byNormalizedName.get(normalizedName);

      if (merchant === undefined) {
        merchant = createMerchant({ name: rawName.trim(), normalizedName });
        byNormalizedName.set(normalizedName, merchant);
        created.push(merchant);
      }

      resolved.set(rawName, merchant);
    }

    merchantsRepository.insertMany(created);

    return { byName: resolved, created: created.length };
  },
};
