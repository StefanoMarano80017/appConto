-- Natura dei movimenti già archiviati.
--
-- La colonna `type` è stata aggiunta con default 'EXPENSE': qui vengono
-- corretti gli accrediti, riconoscibili dal segno dell'importo. I prelievi
-- non sono deducibili a posteriori (la tipologia della banca non veniva
-- memorizzata) e restano da correggere a mano dalla lista transazioni.
UPDATE `transactions` SET `type` = 'INCOME' WHERE `amount_cents` > 0;
--> statement-breakpoint
-- Riga unica delle impostazioni: saldo di partenza sconosciuto.
INSERT OR IGNORE INTO `settings` (`id`, `initial_balance_cents`, `balance_date`)
VALUES ('default', 0, NULL);
