import { Signal, computed, signal } from '@angular/core';

export interface DeleteState {
  readonly confirming: Signal<boolean>;
  readonly deleting: Signal<boolean>;
  readonly error: Signal<string | null>;
  readonly done: Signal<string | null>;

  askConfirm(): void;
  cancel(): void;
  start(): void;
  success(message: string): void;
  failure(message: string): void;
  clearMessages(): void;
  reset(): void;
}

export function createDeleteState(): DeleteState {
  const confirming = signal(false);
  const deleting = signal(false);
  const error = signal<string | null>(null);
  const done = signal<string | null>(null);

  const confirmingRead = computed(() => confirming());
  const deletingRead = computed(() => deleting());
  const errorRead = computed(() => error());
  const doneRead = computed(() => done());

  function askConfirm(): void {
    error.set(null);
    done.set(null);
    confirming.set(true);
  }

  function cancel(): void {
    confirming.set(false);
  }

  function start(): void {
    deleting.set(true);
    error.set(null);
  }

  function success(message: string): void {
    deleting.set(false);
    confirming.set(false);
    done.set(message);
  }

  function failure(message: string): void {
    deleting.set(false);
    confirming.set(false);
    error.set(message);
  }

  function clearMessages(): void {
    error.set(null);
    done.set(null);
  }

  function reset(): void {
    confirming.set(false);
    deleting.set(false);
    error.set(null);
    done.set(null);
  }

  return {
    confirming: confirmingRead,
    deleting: deletingRead,
    error: errorRead,
    done: doneRead,
    askConfirm,
    cancel,
    start,
    success,
    failure,
    clearMessages,
    reset,
  };
}
