import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { creditCents, expenseCents, hasExpense, netWorthCents } from './transaction-type.js';

/**
 * Ripartizione di un movimento fra spesa propria e credito.
 *
 * Sono funzioni pure: nessun database, nessun servizio. Gli importi sono in
 * centesimi, negativi quando il denaro è uscito.
 */

/** Il caso reale: 1.920 € pagati, di cui 1.030 anticipati per un'altra persona. */
const PAGAMENTO = -192000;
const PRESTATO = 103000;
const PROPRIO = 89000;

describe('spesa e credito di un movimento', () => {
  it('una spesa è spesa per intero, e i prestiti non la riguardano', () => {
    assert.equal(expenseCents('EXPENSE', -4500, 0), 4500);
    assert.equal(expenseCents('EXPENSE', PAGAMENTO, PRESTATO), 192000, 'il tipo ha la precedenza');
    assert.equal(creditCents('EXPENSE', PAGAMENTO, PRESTATO), 0);
  });

  it('un importo positivo su una spesa resta un rimborso, e riduce il totale', () => {
    assert.equal(expenseCents('EXPENSE', 2500, 0), -2500);
  });

  it('un prestito senza prestiti registrati è tutto credito: non si sa a chi', () => {
    assert.equal(creditCents('LOAN', PAGAMENTO, 0), 192000);
    assert.equal(expenseCents('LOAN', PAGAMENTO, 0), 0);
    assert.equal(netWorthCents('LOAN', PAGAMENTO, 0), 0);
  });

  it('un prestito parziale si divide: la quota non prestata è spesa', () => {
    assert.equal(creditCents('LOAN', PAGAMENTO, PRESTATO), PRESTATO);
    assert.equal(expenseCents('LOAN', PAGAMENTO, PRESTATO), PROPRIO);
    assert.equal(
      creditCents('LOAN', PAGAMENTO, PRESTATO) + expenseCents('LOAN', PAGAMENTO, PRESTATO),
      -PAGAMENTO,
      'le due quote ricompongono esattamente il movimento',
    );
  });

  it('un prestito che copre tutto il movimento non lascia spesa', () => {
    assert.equal(expenseCents('LOAN', PAGAMENTO, 192000), 0);
    assert.equal(creditCents('LOAN', PAGAMENTO, 192000), 192000);
  });

  it('più prestiti sullo stesso movimento sommano il credito', () => {
    // 1.100 + 820 = tutto il movimento: nessuna spesa propria.
    assert.equal(expenseCents('LOAN', PAGAMENTO, 110000 + 82000), 0);
  });

  it('prelievi, trasferimenti, entrate e "altro" non sono spesa', () => {
    for (const type of ['WITHDRAWAL', 'TRANSFER', 'INCOME', 'OTHER'] as const) {
      assert.equal(expenseCents(type, PAGAMENTO, PRESTATO), 0, type);
      assert.equal(creditCents(type, PAGAMENTO, PRESTATO), 0, type);
    }
  });

  it('un movimento in entrata marcato come prestito non produce spesa', () => {
    assert.equal(expenseCents('LOAN', 5000, 0), 0);
    assert.equal(creditCents('LOAN', 5000, 0), 0);
    assert.equal(netWorthCents('LOAN', 5000, 0), 0);
  });
});

describe('cosa entra nelle uscite e nelle categorie', () => {
  it('una spesa sempre, anche a importo zero', () => {
    assert.equal(hasExpense('EXPENSE', -4500, 0), true);
    assert.equal(hasExpense('EXPENSE', 0, 0), true);
  });

  it('un prestito solo per la quota rimasta propria', () => {
    assert.equal(hasExpense('LOAN', PAGAMENTO, 0), false, 'nessun prestito registrato');
    assert.equal(hasExpense('LOAN', PAGAMENTO, 192000), false, 'prestato tutto');
    assert.equal(hasExpense('LOAN', PAGAMENTO, PRESTATO), true, 'prestato in parte');
  });

  it('prelievi e trasferimenti mai', () => {
    assert.equal(hasExpense('WITHDRAWAL', -20000, 0), false);
    assert.equal(hasExpense('TRANSFER', -30000, 0), false);
  });
});

describe('effetto sul patrimonio', () => {
  it('prelievi e trasferimenti lo lasciano intatto: il denaro è ancora proprio', () => {
    assert.equal(netWorthCents('WITHDRAWAL', -20000, 0), 0);
    assert.equal(netWorthCents('TRANSFER', -30000, 0), 0);
  });

  it('spese ed entrate lo muovono per intero', () => {
    assert.equal(netWorthCents('EXPENSE', -4500, 0), -4500);
    assert.equal(netWorthCents('INCOME', 150000, 0), 150000);
    assert.equal(netWorthCents('OTHER', -1000, 0), -1000);
  });

  it('un prestito lo riduce solo per la quota realmente spesa', () => {
    assert.equal(netWorthCents('LOAN', PAGAMENTO, PRESTATO), -PROPRIO);
    assert.equal(netWorthCents('LOAN', PAGAMENTO, 192000), 0, 'prestato tutto: solo un credito');
  });
});
