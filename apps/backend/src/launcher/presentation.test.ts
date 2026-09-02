import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EXIT, finestraTemporanea, presentaErrore } from './presentation.js';
import { ErroreUtente } from './run.js';

/**
 * §9 e §10 — cosa vede chi ha fatto doppio clic.
 *
 * Sono decisioni su come si parla all'utente, e per questo vivono in un modulo
 * che si può importare senza avviare l'applicazione.
 */

describe('§9 — messaggi di errore', () => {
  it('un problema dell-utente si mostra come tale, senza dettagli tecnici', () => {
    const presentazione = presentaErrore(
      new ErroreUtente("L'archivio è già in uso da un'altra istanza."),
      'C:\\dati\\logs',
    );

    assert.equal(presentazione.code, EXIT.utente);
    assert.match(presentazione.testo, /Impossibile avviare MyFinance/);
    assert.match(presentazione.testo, /già in uso/);
    // Nessun rimando al log: non c'è niente da diagnosticare.
    assert.doesNotMatch(presentazione.testo, /logs/);
  });

  it('un guasto tecnico dice il dettaglio e dove sta il registro', () => {
    const presentazione = presentaErrore(new Error('EPERM: operation not permitted'), 'C:\\dati\\logs');

    assert.equal(presentazione.code, EXIT.tecnico);
    assert.match(presentazione.testo, /EPERM/);
    assert.match(presentazione.testo, /C:\\dati\\logs/);
    // La rassicurazione conta quanto il dettaglio: chi legge un errore su
    // un'applicazione che custodisce i suoi conti vuole sapere questo.
    assert.match(presentazione.testo, /dati non sono stati modificati/);
  });

  it('non mostra la traccia di stack come unica informazione', () => {
    const errore = new Error('qualcosa è andato storto');
    errore.stack = 'Error: qualcosa\n    at Object.<anonymous> (C:\\app\\backend\\server.js:1:1)';

    const presentazione = presentaErrore(errore, 'C:\\dati\\logs');

    assert.doesNotMatch(presentazione.testo, /at Object/);
    assert.match(presentazione.testo, /qualcosa è andato storto/);
  });

  it('regge anche ciò che non è un errore', () => {
    const presentazione = presentaErrore('stringa nuda', 'C:\\dati\\logs');

    assert.equal(presentazione.code, EXIT.tecnico);
    assert.match(presentazione.testo, /stringa nuda/);
  });
});

describe('§10 — nessun pause cieco', () => {
  it('trattiene la finestra solo con il doppio clic e una console vera', () => {
    assert.equal(finestraTemporanea({ MYFINANCE_CONSOLE_TEMPORANEA: '1' }, true), true);
  });

  it('non trattiene niente se lo lancia uno script', () => {
    // `cmd /c start.bat` da un altro programma: la variabile c'è, ma dall'altra
    // parte non c'è una persona che possa premere un tasto.
    assert.equal(finestraTemporanea({ MYFINANCE_CONSOLE_TEMPORANEA: '1' }, false), false);
  });

  it('non trattiene niente da un terminale', () => {
    // La finestra resta aperta da sé: il messaggio è già leggibile.
    assert.equal(finestraTemporanea({}, true), false);
    assert.equal(finestraTemporanea({ MYFINANCE_CONSOLE_TEMPORANEA: '' }, true), false);
    assert.equal(finestraTemporanea({ MYFINANCE_CONSOLE_TEMPORANEA: '0' }, true), false);
  });
});
