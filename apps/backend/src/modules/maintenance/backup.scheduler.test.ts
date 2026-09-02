import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  createBackupScheduler,
  momentOf,
  newestAuto,
  nextDelayMs,
  type BackupScheduler,
  type SchedulerEvent,
} from './backup.scheduler.js';
import type { BackupInfo } from './backup.service.js';

/**
 * Lo scheduler dei backup automatici.
 *
 * Nessun database e nessun file: `create` e `list` sono iniettati. È la stessa
 * ragione per cui esistono in quella forma — un test che aspettasse
 * ventiquattro ore non esisterebbe, e uno che aspettasse un `VACUUM INTO`
 * proverebbe il servizio di backup, che ha già i suoi test.
 *
 * Lo scheduler avviato in questo file viene fermato: un timer che sopravvive
 * al test è un test che ha lasciato qualcosa in esecuzione.
 */

const avviati: BackupScheduler[] = [];

const ORA = 3_600_000;

function backup(nome: string, extra: Partial<BackupInfo> = {}): BackupInfo {
  const kind = nome.startsWith('auto') ? 'auto' : nome.startsWith('manual') ? 'manual' : 'pre-migration';

  return {
    name: nome,
    kind,
    createdAt: null,
    localTime: '',
    bytes: 1024,
    appVersion: '1.0.0',
    schemaVersion: null,
    rowCounts: {},
    status: 'completo',
    problem: null,
    ...extra,
  };
}

describe("l'istante di un backup", () => {
  it('viene dal manifest quando c-è', () => {
    const istante = momentOf(
      backup('auto-20260902-100000.sqlite', { createdAt: '2026-09-02T08:00:00.000Z' }),
    );

    assert.equal(istante?.toISOString(), '2026-09-02T08:00:00.000Z');
  });

  it('viene dal nome quando il manifest manca', () => {
    // Il nome porta l'ora locale: un backup senza manifest è un residuo che
    // il ripristino rifiuterebbe, ma per sapere *quando* è stato fatto vale.
    const istante = momentOf(backup('auto-20260902-143000.sqlite'));

    assert.ok(istante !== null);
    assert.equal(istante.getFullYear(), 2026);
    assert.equal(istante.getMonth(), 8);
    assert.equal(istante.getDate(), 2);
    assert.equal(istante.getHours(), 14);
    assert.equal(istante.getMinutes(), 30);
  });

  it('un manifest con una data insensata non fa perdere il nome', () => {
    const istante = momentOf(backup('auto-20260902-143000.sqlite', { createdAt: 'ieri' }));

    assert.ok(istante !== null);
    assert.equal(istante.getHours(), 14);
  });

  it('un nome che non è un nome di backup non ha istante', () => {
    assert.equal(momentOf(backup('qualcosa.sqlite')), null);
  });
});

describe('il backup automatico più recente', () => {
  it('ignora i backup di altro tipo', () => {
    // Un `pre-migration` di stamattina non copre la giornata: non è un backup
    // periodico, è la rete di sicurezza di un'operazione rischiosa.
    const trovato = newestAuto([
      backup('pre-migration-20260902-120000.sqlite'),
      backup('manual-20260902-130000.sqlite'),
      backup('auto-20260901-030000.sqlite'),
    ]);

    assert.equal(trovato?.getDate(), 1);
  });

  it('sceglie il più recente fra molti', () => {
    const trovato = newestAuto([
      backup('auto-20260830-030000.sqlite'),
      backup('auto-20260902-030000.sqlite'),
      backup('auto-20260901-030000.sqlite'),
    ]);

    assert.equal(trovato?.getDate(), 2);
  });

  it('senza backup automatici non c-è un più recente', () => {
    assert.equal(newestAuto([]), null);
    assert.equal(newestAuto([backup('manual-20260902-130000.sqlite')]), null);
  });
});

describe('quando fare il prossimo backup', () => {
  const adesso = new Date('2026-09-02T12:00:00.000Z');

  it('senza backup precedenti si attende solo il margine di avvio', () => {
    assert.equal(nextDelayMs(null, adesso, 24 * ORA, 30_000), 30_000);
  });

  it('con un backup di quattro ore fa si attende il resto dell-intervallo', () => {
    const quattroOreFa = new Date(adesso.getTime() - 4 * ORA);

    assert.equal(nextDelayMs(quattroOreFa, adesso, 24 * ORA, 30_000), 20 * ORA);
  });

  it('con un backup scaduto si attende solo il margine di avvio', () => {
    // È il caso normale di un'applicazione da scrivania: acceso dieci minuti
    // al giorno, l'ultimo backup è sempre "di ieri". Un timer contato
    // dall'avvio non scatterebbe mai.
    const treGiorniFa = new Date(adesso.getTime() - 72 * ORA);

    assert.equal(nextDelayMs(treGiorniFa, adesso, 24 * ORA, 30_000), 30_000);
  });

  it('un backup datato nel futuro non congela i backup per giorni', () => {
    // Orologio spostato indietro, o archivio arrivato da un'altra macchina.
    const domani = new Date(adesso.getTime() + 24 * ORA);

    assert.equal(nextDelayMs(domani, adesso, 24 * ORA, 30_000), 24 * ORA);
  });

  it('il margine di avvio è un minimo, non un-aggiunta', () => {
    const unMinutoFa = new Date(adesso.getTime() - 60_000);

    // L'intervallo residuo è più lungo del margine: vince il residuo.
    assert.equal(nextDelayMs(unMinutoFa, adesso, 2 * 60_000, 30_000), 60_000);
  });
});

describe('lo scheduler in esecuzione', () => {
  it('crea un backup, poi si riarma per l-intervallo pieno', async () => {
    const eventi: SchedulerEvent[] = [];
    const creati: string[] = [];
    let numero = 0;

    const scheduler = createBackupScheduler({
      intervalMs: 60,
      settleMs: 10,
      list: () => [],
      create: () => {
        numero += 1;
        const nome = `auto-20260902-00000${String(numero)}.sqlite`;
        creati.push(nome);

        return backup(nome);
      },
      now: () => new Date('2026-09-02T12:00:00.000Z'),
      onEvent: (event) => {
        eventi.push(event);
      },
    });
    avviati.push(scheduler);

    scheduler.start();
    await new Promise((r) => setTimeout(r, 200));
    scheduler.stop();

    assert.ok(creati.length >= 2, `attesi almeno due backup, creati ${String(creati.length)}`);

    // Il primo dopo il margine, i successivi ogni intervallo.
    const programmazioni = eventi.filter((e) => e.kind === 'programmato');
    assert.equal(programmazioni[0]?.kind === 'programmato' ? programmazioni[0].delayMs : -1, 10);
    assert.equal(programmazioni[1]?.kind === 'programmato' ? programmazioni[1].delayMs : -1, 60);

    // Ogni creazione è registrata.
    assert.equal(eventi.filter((e) => e.kind === 'creato').length, creati.length);
  });

  it('non si sovrappone a sé stesso', async () => {
    const attivi: number[] = [];
    let contemporanei = 0;

    const scheduler = createBackupScheduler({
      intervalMs: 20,
      settleMs: 5,
      list: () => [],
      create: () => {
        contemporanei += 1;
        attivi.push(contemporanei);
        // Una creazione lunga: `VACUUM INTO` su un archivio grande può durare
        // più dell'intervallo. Essendo sincrona, il timer successivo non
        // esiste ancora — non c'è nulla da accodare.
        const fino = Date.now() + 40;
        while (Date.now() < fino) {
          // occupato
        }
        contemporanei -= 1;

        return backup('auto-20260902-000001.sqlite');
      },
      now: () => new Date(),
      onEvent: () => {
        // irrilevante qui
      },
    });
    avviati.push(scheduler);

    scheduler.start();
    await new Promise((r) => setTimeout(r, 250));
    scheduler.stop();

    assert.ok(attivi.length >= 2, 'devono essere avvenute più creazioni');
    assert.deepEqual(
      [...new Set(attivi)],
      [1],
      'nessuna creazione deve essere iniziata mentre un-altra era in corso',
    );
  });

  it('un backup fallito non ferma lo scheduler', async () => {
    const eventi: SchedulerEvent[] = [];
    let tentativi = 0;

    const scheduler = createBackupScheduler({
      intervalMs: 30,
      settleMs: 5,
      list: () => [],
      create: () => {
        tentativi += 1;
        if (tentativi <= 2) {
          throw new Error('disco pieno');
        }

        return backup('auto-20260902-000003.sqlite');
      },
      now: () => new Date(),
      onEvent: (event) => {
        eventi.push(event);
      },
    });
    avviati.push(scheduler);

    scheduler.start();
    await new Promise((r) => setTimeout(r, 200));
    scheduler.stop();

    const falliti = eventi.filter((e) => e.kind === 'fallito');
    assert.equal(falliti.length, 2);
    assert.equal(falliti[0]?.kind === 'fallito' ? falliti[0].problem : '', 'disco pieno');
    // E poi ce l'ha fatta: rinunciare al primo errore significherebbe non
    // riprovare più.
    assert.ok(eventi.some((e) => e.kind === 'creato'));
  });

  it('fermato prima della scadenza non crea niente', async () => {
    let creati = 0;
    const eventi: SchedulerEvent[] = [];

    const scheduler = createBackupScheduler({
      intervalMs: 1_000,
      settleMs: 500,
      list: () => [],
      create: () => {
        creati += 1;

        return backup('auto-20260902-000001.sqlite');
      },
      now: () => new Date(),
      onEvent: (event) => {
        eventi.push(event);
      },
    });

    scheduler.start();
    assert.equal(scheduler.running(), true);
    scheduler.stop();
    assert.equal(scheduler.running(), false);

    await new Promise((r) => setTimeout(r, 700));

    assert.equal(creati, 0, 'un backup non deve partire durante l-arresto');
    assert.ok(eventi.some((e) => e.kind === 'fermato'));
  });

  it('fermato due volte non fa nulla la seconda', () => {
    const eventi: SchedulerEvent[] = [];
    const scheduler = createBackupScheduler({
      intervalMs: 1_000,
      settleMs: 500,
      list: () => [],
      create: () => backup('auto-20260902-000001.sqlite'),
      now: () => new Date(),
      onEvent: (event) => {
        eventi.push(event);
      },
    });

    scheduler.start();
    scheduler.stop();
    scheduler.stop();

    assert.equal(eventi.filter((e) => e.kind === 'fermato').length, 1);
  });

  it('dopo l-arresto non si riavvia', async () => {
    let creati = 0;
    const scheduler = createBackupScheduler({
      intervalMs: 30,
      settleMs: 5,
      list: () => [],
      create: () => {
        creati += 1;

        return backup('auto-20260902-000001.sqlite');
      },
      now: () => new Date(),
      onEvent: () => {
        // irrilevante
      },
    });

    scheduler.stop();
    scheduler.start();

    await new Promise((r) => setTimeout(r, 100));

    assert.equal(creati, 0);
    assert.equal(scheduler.running(), false);
  });

  it('due start non raddoppiano i timer', async () => {
    let creati = 0;
    const scheduler = createBackupScheduler({
      intervalMs: 10_000,
      settleMs: 30,
      list: () => [],
      create: () => {
        creati += 1;

        return backup('auto-20260902-000001.sqlite');
      },
      now: () => new Date(),
      onEvent: () => {
        // irrilevante
      },
    });
    avviati.push(scheduler);

    scheduler.start();
    scheduler.start();
    await new Promise((r) => setTimeout(r, 120));
    scheduler.stop();

    assert.equal(creati, 1, 'un solo timer, quindi un solo backup');
  });

  it('con l-intervallo a zero non fa niente e lo dichiara', async () => {
    const eventi: SchedulerEvent[] = [];
    let creati = 0;

    const scheduler = createBackupScheduler({
      intervalMs: 0,
      settleMs: 5,
      list: () => [],
      create: () => {
        creati += 1;

        return backup('auto-20260902-000001.sqlite');
      },
      now: () => new Date(),
      onEvent: (event) => {
        eventi.push(event);
      },
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(creati, 0);
    assert.deepEqual(eventi, [{ kind: 'disattivato' }]);
    assert.equal(scheduler.running(), false);
  });

  it('parte dal backup automatico già presente, non dall-avvio', () => {
    const eventi: SchedulerEvent[] = [];
    const adesso = new Date('2026-09-02T12:00:00.000Z');

    const scheduler = createBackupScheduler({
      intervalMs: 24 * ORA,
      settleMs: 30_000,
      // Un backup di sei ore fa: ne restano diciotto, non ventiquattro.
      list: () => [
        backup('auto-20260902-060000.sqlite', { createdAt: '2026-09-02T06:00:00.000Z' }),
      ],
      create: () => backup('auto-20260902-120000.sqlite'),
      now: () => adesso,
      onEvent: (event) => {
        eventi.push(event);
      },
    });
    avviati.push(scheduler);

    scheduler.start();
    scheduler.stop();

    const programmato = eventi.find((e) => e.kind === 'programmato');
    assert.equal(programmato?.kind === 'programmato' ? programmato.delayMs : -1, 18 * ORA);
  });
});

after(() => {
  for (const scheduler of avviati) {
    scheduler.stop();
  }
});
