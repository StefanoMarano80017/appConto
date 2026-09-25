import { createDeleteState } from './transaction-delete';

describe('createDeleteState', () => {
  it('starts idle', () => {
    const deleteState = createDeleteState();

    expect(deleteState.confirming()).toBe(false);
    expect(deleteState.deleting()).toBe(false);
    expect(deleteState.error()).toBeNull();
    expect(deleteState.done()).toBeNull();
  });

  it('asks for confirmation and clears messages', () => {
    const deleteState = createDeleteState();
    deleteState.failure('old error');
    deleteState.success('old success');

    deleteState.askConfirm();

    expect(deleteState.confirming()).toBe(true);
    expect(deleteState.error()).toBeNull();
    expect(deleteState.done()).toBeNull();
  });

  it('cancels confirmation', () => {
    const deleteState = createDeleteState();

    deleteState.askConfirm();
    deleteState.cancel();

    expect(deleteState.confirming()).toBe(false);
  });

  it('marks deletion as started', () => {
    const deleteState = createDeleteState();

    deleteState.start();

    expect(deleteState.deleting()).toBe(true);
    expect(deleteState.error()).toBeNull();
  });

  it('marks deletion as successful', () => {
    const deleteState = createDeleteState();

    deleteState.start();
    deleteState.success('2 movimenti eliminati.');

    expect(deleteState.deleting()).toBe(false);
    expect(deleteState.confirming()).toBe(false);
    expect(deleteState.done()).toBe('2 movimenti eliminati.');
  });

  it('marks deletion as failed and keeps the confirmation closed', () => {
    const deleteState = createDeleteState();

    deleteState.start();
    deleteState.failure('Errore.');

    expect(deleteState.deleting()).toBe(false);
    expect(deleteState.confirming()).toBe(false);
    expect(deleteState.error()).toBe('Errore.');
  });

  it('resets its state', () => {
    const deleteState = createDeleteState();

    deleteState.askConfirm();
    deleteState.start();
    deleteState.failure('Errore.');
    deleteState.success('ok');

    deleteState.reset();

    expect(deleteState.confirming()).toBe(false);
    expect(deleteState.deleting()).toBe(false);
    expect(deleteState.error()).toBeNull();
    expect(deleteState.done()).toBeNull();
  });

  it('exposes readonly signals', () => {
    const deleteState = createDeleteState();

    expect('set' in deleteState.confirming).toBe(false);
    expect('update' in deleteState.confirming).toBe(false);
    expect('set' in deleteState.deleting).toBe(false);
    expect('update' in deleteState.deleting).toBe(false);
    expect('set' in deleteState.error).toBe(false);
    expect('update' in deleteState.error).toBe(false);
    expect('set' in deleteState.done).toBe(false);
    expect('update' in deleteState.done).toBe(false);
  });
});
