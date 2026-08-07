import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fingerprintAll, transactionFingerprint } from './transaction-fingerprint.js';
import type { ParsedTransaction } from './transaction.model.js';

const transaction = (overrides: Partial<ParsedTransaction> = {}): ParsedTransaction => ({
  bookingDate: '2026-07-05',
  description: 'NYX*BlueTowerBV Amsterdam',
  amount: -3.5,
  type: 'EXPENSE',
  ...overrides,
});

describe('transactionFingerprint', () => {
  it('è stabile: gli stessi dati producono sempre lo stesso valore', () => {
    assert.equal(transactionFingerprint(transaction(), 0), transactionFingerprint(transaction(), 0));
  });

  it('cambia se cambia la data', () => {
    assert.notEqual(
      transactionFingerprint(transaction(), 0),
      transactionFingerprint(transaction({ bookingDate: '2026-07-06' }), 0),
    );
  });

  it('cambia se cambia la descrizione', () => {
    assert.notEqual(
      transactionFingerprint(transaction(), 0),
      transactionFingerprint(transaction({ description: 'ALTRO ESERCENTE' }), 0),
    );
  });

  it('cambia se cambia l\'importo, anche di un centesimo', () => {
    assert.notEqual(
      transactionFingerprint(transaction(), 0),
      transactionFingerprint(transaction({ amount: -3.51 }), 0),
    );
  });

  it('distingue il segno dell\'importo', () => {
    assert.notEqual(
      transactionFingerprint(transaction({ amount: -3.5 }), 0),
      transactionFingerprint(transaction({ amount: 3.5 }), 0),
    );
  });

  it('non risente degli errori di virgola mobile', () => {
    assert.equal(
      transactionFingerprint(transaction({ amount: 0.1 + 0.2 }), 0),
      transactionFingerprint(transaction({ amount: 0.3 }), 0),
    );
  });

  it('non cambia se cambia il tipo di movimento', () => {
    // Il tipo è correggibile a mano: non deve alterare l'identità del movimento.
    assert.equal(
      transactionFingerprint(transaction({ type: 'EXPENSE' }), 0),
      transactionFingerprint(transaction({ type: 'WITHDRAWAL' }), 0),
    );
  });

  it('cambia al variare del progressivo', () => {
    assert.notEqual(
      transactionFingerprint(transaction(), 0),
      transactionFingerprint(transaction(), 1),
    );
  });

  it('non confonde i campi fra loro', () => {
    // "AB" + "C" non deve valere quanto "A" + "BC"
    assert.notEqual(
      transactionFingerprint(transaction({ description: 'AB' }), 0),
      transactionFingerprint(transaction({ description: 'A' }), 0),
    );
  });
});

describe('fingerprintAll', () => {
  it('assegna progressivi diversi a movimenti identici dello stesso lotto', () => {
    const [first, second] = fingerprintAll([transaction(), transaction()]);

    assert.ok(first && second);
    assert.notEqual(first.fingerprint, second.fingerprint);
  });

  it('produce gli stessi fingerprint reimportando lo stesso lotto', () => {
    const batch = [transaction(), transaction({ amount: -10 }), transaction()];

    assert.deepEqual(
      fingerprintAll(batch).map((t) => t.fingerprint),
      fingerprintAll(batch).map((t) => t.fingerprint),
    );
  });

  it('non dipende dalle transazioni diverse presenti nel lotto', () => {
    const alone = fingerprintAll([transaction()])[0]?.fingerprint;
    const surrounded = fingerprintAll([
      transaction({ description: 'PRIMA' }),
      transaction(),
      transaction({ description: 'DOPO' }),
    ])[1]?.fingerprint;

    assert.equal(alone, surrounded);
  });
});
