import { Router, json } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { ValidationError } from '../../shared/errors.js';
import { resolveBackupFile } from './backup.naming.js';
import { backupService } from './backup.service.js';
import { restoreService } from './restore.service.js';
import {
  toBackupDto,
  toPendingRestoreDto,
  type BackupsDto,
} from './maintenance.view-model.js';

/**
 * Le API di backup e ripristino.
 *
 * Due proprietà valgono per tutte:
 *
 *  - **nessun percorso attraversa il confine.** Un client indica un backup per
 *    nome; il nome passa da `resolveBackupFile`, che restituisce un percorso
 *    solo se resta dentro `backups/`. Fuori non viaggia nessun percorso
 *    assoluto: né nelle risposte, né nei messaggi d'errore.
 *  - **`POST /restore` non ripristina.** Prepara. La sostituzione del database
 *    avviene al riavvio, quando nessuna connessione è aperta.
 */

export const backupsRouter = Router();

const restoreRequestSchema = z.object({ name: z.string().min(1) });

/** La vista completa: cosa c'è in archivio e se un ripristino è in attesa. */
function currentState(): BackupsDto {
  const pending = restoreService.pending();

  return {
    backups: backupService.list().map(toBackupDto),
    pendingRestore: pending === null ? null : toPendingRestoreDto(pending),
  };
}

// GET /backups
backupsRouter.get('/', (_req, res) => {
  res.json(currentState());
});

// POST /backups — crea un backup su richiesta dell'utente, che la ritenzione non cancella
backupsRouter.post('/', (_req, res) => {
  res.status(201).json(toBackupDto(backupService.create('manual')));
});

// GET /backups/:name — scarica il file, per portarlo fuori dal computer
backupsRouter.get('/:name', (req, res, next) => {
  const name = req.params.name;
  const file = name === undefined ? null : resolveBackupFile(config.backupsDir, name);
  if (file === null) {
    // Un nome che non è un nome di backup non è una risorsa mancante: è una
    // richiesta malformata, e la distinzione evita di suggerire che basti
    // insistere con un altro percorso.
    throw new ValidationError('Nome del backup non valido.');
  }

  const check = backupService.verify(name as string);
  if (!check.ok) {
    throw new ValidationError(check.problem);
  }

  res.download(file, name as string, (error) => {
    if (error !== undefined && error !== null) {
      next(error);
    }
  });
});

export const restoreRouter = Router();

// GET /restore — lo stato di un ripristino preparato
restoreRouter.get('/', (_req, res) => {
  const pending = restoreService.pending();
  res.json(pending === null ? null : toPendingRestoreDto(pending));
});

// POST /restore — prepara il ripristino. Non sostituisce il database attivo.
restoreRouter.post('/', json(), (req, res) => {
  const parsed = restoreRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Indica il nome del backup da ripristinare.');
  }

  const staged = restoreService.stage(parsed.data.name);

  res.status(202).json({
    ...staged,
    restartRequired: true,
    message:
      "Ripristino preparato. Riavvia l'applicazione per applicarlo: l'archivio attuale non è ancora stato modificato.",
  });
});

// DELETE /restore — annulla un ripristino preparato e non ancora applicato
restoreRouter.delete('/', (_req, res) => {
  const cancelled = restoreService.cancel();
  res.status(cancelled ? 200 : 404).json({ cancelled });
});
