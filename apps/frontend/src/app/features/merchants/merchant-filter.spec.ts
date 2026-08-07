import { filterMerchants } from './merchant-filter';
import { MerchantSummary } from './merchant.model';

const merchant = (overrides: Partial<MerchantSummary>): MerchantSummary => ({
  id: overrides.name ?? 'id',
  name: 'MERCHANT',
  displayName: null,
  label: overrides.displayName ?? overrides.name ?? 'MERCHANT',
  normalizedName: 'merchant',
  category: null,
  transactionCount: 1,
  totalSpent: 10,
  lastTransactionDate: '2026-07-01',
  ...overrides
});

const alimentari = { id: 'c1', name: 'Alimentari', color: '#3f8f4f' };

const esselunga = merchant({ name: 'ESSELUNGA MILANO', category: alimentari });
const eni = merchant({ name: 'ENI STATION' });
const rinominato = merchant({
  name: 'NYX*BlueTowerBV Amsterdam',
  displayName: 'Caffè Amsterdam',
  label: 'Caffè Amsterdam'
});
const tutti = [esselunga, eni, rinominato];

describe('filterMerchants', () => {
  it('senza ricerca né filtro restituisce tutti i merchant', () => {
    expect(filterMerchants(tutti, { search: '', filter: 'all' })).toEqual(tutti);
  });

  it('mostra solo i merchant classificati', () => {
    const risultato = filterMerchants(tutti, { search: '', filter: 'classified' });
    expect(risultato.map((m) => m.name)).toEqual(['ESSELUNGA MILANO']);
  });

  it('mostra solo i merchant da classificare', () => {
    const risultato = filterMerchants(tutti, { search: '', filter: 'unclassified' });
    expect(risultato.map((m) => m.name)).toEqual(['ENI STATION', 'NYX*BlueTowerBV Amsterdam']);
  });

  it('cerca senza distinguere maiuscole e spazi esterni', () => {
    expect(filterMerchants(tutti, { search: '  esselunga ', filter: 'all' })).toEqual([esselunga]);
  });

  it('trova un merchant rinominato sia col nuovo nome sia con quello della banca', () => {
    expect(filterMerchants(tutti, { search: 'caffè', filter: 'all' })).toEqual([rinominato]);
    expect(filterMerchants(tutti, { search: 'bluetower', filter: 'all' })).toEqual([rinominato]);
  });

  it('combina ricerca e filtro', () => {
    expect(filterMerchants(tutti, { search: 'a', filter: 'classified' })).toEqual([esselunga]);
    expect(filterMerchants(tutti, { search: 'esselunga', filter: 'unclassified' })).toEqual([]);
  });

  it('restituisce un elenco vuoto quando nulla corrisponde', () => {
    expect(filterMerchants(tutti, { search: 'inesistente', filter: 'all' })).toEqual([]);
  });
});
